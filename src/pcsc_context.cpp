#include "pcsc_context.h"
#include "pcsc_debug.h"
#include "pcsc_errors.h"
#include "pcsc_reader.h"
#include <cstring>
#include <memory>

Napi::FunctionReference PCSCContext::constructor;

// Event data passed from worker thread to JS thread
struct EventData {
  std::string eventType;
  std::string readerName;
  DWORD state;
  DWORD code;
  std::vector<uint8_t> atr;
};

Napi::Object PCSCContext::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(
      env, "PCSCContext",
      {
          InstanceMethod("startMonitor", &PCSCContext::StartMonitor),
          InstanceMethod("stopMonitor", &PCSCContext::StopMonitor),
          InstanceMethod("close", &PCSCContext::Close),
          InstanceAccessor("isValid", &PCSCContext::GetIsValid, nullptr),
      });

  constructor = Napi::Persistent(func);
  constructor.SuppressDestruct();

  exports.Set("PCSCContext", func);
  return exports;
}

PCSCContext::PCSCContext(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<PCSCContext>(info), closed_(false), cancelContext_(0),
      monitoring_(false) {}

PCSCContext::~PCSCContext() { StopMonitorInternal(); }

Napi::Value PCSCContext::StartMonitor(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (monitoring_) {
    Napi::Error::New(env, "Monitor is already running")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (closed_) {
    Napi::Error::New(env, "Context is closed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Callback function required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Function callback = info[0].As<Napi::Function>();

  tsfn_ =
      Napi::ThreadSafeFunction::New(env, callback, "PCSCMonitor",
                                    0, // Unlimited queue size
                                    1, // 1 initial thread
                                    [this](Napi::Env) { monitoring_ = false; });

  monitoring_ = true;
  monitorThread_ = std::thread(&PCSCContext::MonitorLoop, this);

  return env.Undefined();
}

Napi::Value PCSCContext::StopMonitor(const Napi::CallbackInfo &info) {
  StopMonitorInternal();
  return info.Env().Undefined();
}

void PCSCContext::StopMonitorInternal() {
  if (!monitoring_) {
    return;
  }

  monitoring_ = false;

  // Wake any interruptible sleep in the monitor loop.
  sleepCv_.notify_all();

  // Cancel any blocking SCardGetStatusChange call
  SCARDCONTEXT cancelContext = cancelContext_.load();
  if (cancelContext != 0) {
    SCardCancel(cancelContext);
  }

  if (monitorThread_.joinable()) {
    monitorThread_.join();
  }

  tsfn_.Release();
  readerStates_.clear();
}

Napi::Value PCSCContext::Close(const Napi::CallbackInfo &info) {
  StopMonitorInternal();
  closed_ = true;
  return info.Env().Undefined();
}

Napi::Value PCSCContext::GetIsValid(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), !closed_);
}

// Outer loop: establish context, run inner loop, release context.
void PCSCContext::MonitorLoop() {
  bool readyEmitted = false;
  bool unreadyEmitted = false;

  while (monitoring_) {
    SCARDCONTEXT ctx = 0;
    LONG result =
        SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &ctx);

    if (result == SCARD_S_SUCCESS) {
      cancelContext_.store(ctx);
      result = MonitorReadersLoop(ctx, readyEmitted, unreadyEmitted);
    }

    if (ctx != 0) {
      cancelContext_.store(0);
      SCardReleaseContext(ctx);
    }

    if (!monitoring_) {
      break;
    } else if (result == static_cast<LONG>(SCARD_E_INVALID_PARAMETER)) {
      // Fatal error: likely a bug in our code. Stop monitor.
      EmitEvent("error", GetPCSCErrorString(result), 0, {},
                static_cast<DWORD>(GetPCSCErrorCode(result)));
      break;
    } else if (result != SCARD_S_SUCCESS) {
      // Any other error is retryable: service unavailability, comm errors, etc.
      // Emit unready once, then retry after delay.
      LogPcscDebug(GetPCSCErrorString(result), result);

      if (!unreadyEmitted) {
        EmitEvent("unready", GetPCSCErrorString(result), 0, {},
                  static_cast<DWORD>(GetPCSCErrorCode(result)));
        unreadyEmitted = true;
      }
      readyEmitted = false;

      std::unique_lock<std::mutex> lock(sleepMutex_);
      sleepCv_.wait_for(lock, std::chrono::milliseconds(1000),
                        [this]() { return !monitoring_; });
      continue;
    }
  }

  for (const auto &pair : readerStates_) {
    if (pair.second.announced)
      EmitEvent("detached", pair.first, 0, {});
  }

  readerStates_.clear();
}

// Inner loop: list readers, get reader status changes.
LONG PCSCContext::MonitorReadersLoop(SCARDCONTEXT ctx, bool &readyEmitted,
                                     bool &unreadyEmitted) {
  LONG result = SCARD_S_SUCCESS;

  while (monitoring_) {
    // Mark all readers unseen.
    for (auto &pair : readerStates_)
      pair.second.seenInScan = false;

    // Get number of readers.
    DWORD readersLen = 0;
    result = SCardListReaders(ctx, nullptr, nullptr, &readersLen);

    // No readers is not an error.
    if (result == static_cast<LONG>(SCARD_E_NO_READERS_AVAILABLE)) {
      result = SCARD_S_SUCCESS;
      readersLen = 0;
    }

    // Get reader names.
    if (result == SCARD_S_SUCCESS && readersLen > 0) {
      std::vector<char> buffer(readersLen);
      result = SCardListReaders(ctx, nullptr, buffer.data(), &readersLen);
      if (result == SCARD_S_SUCCESS) {
        const char *p = buffer.data();
        while (*p != '\0') {
          std::string name(p);
          auto [it, inserted] = readerStates_.try_emplace(name, ReaderInfo{});
          if (inserted) {
            it->second.lastState = SCARD_STATE_UNAWARE;
            it->second.atr.clear();
            it->second.announced = false;
          }
          // Mark seen.
          it->second.seenInScan = true;
          p += strlen(p) + 1;
        }
      }
    }

    // Clean readers that have not been seen.
    for (auto it = readerStates_.begin(); it != readerStates_.end();) {
      if (!it->second.seenInScan) {
        if (it->second.announced)
          EmitEvent("detached", it->first, 0, {});
        it = readerStates_.erase(it);
      } else {
        ++it;
      }
    }

    if (result != SCARD_S_SUCCESS)
      return result;

    // We have readers, get status changes.
    if (!readerStates_.empty()) {
      const size_t readerCount = readerStates_.size();
      std::vector<SCARD_READERSTATE> states(readerCount);

      size_t i = 0;
      for (auto &pair : readerStates_) {
        SCARD_READERSTATE state = {};
        state.szReader = pair.first.c_str();
        state.dwCurrentState = pair.second.lastState;
        state.pvUserData = &pair.second;
        states[i] = state;

        i++;
      }

      result = SCardGetStatusChange(ctx, 1000, states.data(),
                                    static_cast<DWORD>(states.size()));

      // Timeout waiting for changes == no changes, repeat.
      if (result == static_cast<LONG>(SCARD_E_TIMEOUT))
        continue;

      if (result != SCARD_S_SUCCESS)
        return result;

      for (size_t i = 0; i < states.size(); i++) {
        if (!(states[i].dwEventState & SCARD_STATE_CHANGED))
          continue;

        const std::string readerName =
            states[i].szReader ? states[i].szReader : "";
        LogPcscState(readerName, states[i].dwEventState);
        auto *info = static_cast<ReaderInfo *>(states[i].pvUserData);
        if (!info)
          continue;

        DWORD newState = states[i].dwEventState & ~SCARD_STATE_CHANGED;
        std::vector<uint8_t> atr;
        if (states[i].cbAtr > 0)
          atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);

        const DWORD prevState = info->lastState;
        info->lastState = newState;
        info->atr = atr;

        const bool wasUnresolved = prevState == SCARD_STATE_UNAWARE ||
                                   (prevState & SCARD_STATE_UNKNOWN) != 0;
        const bool isResolved = newState != SCARD_STATE_UNAWARE &&
                                (newState & SCARD_STATE_UNKNOWN) == 0;

        if (!info->announced && wasUnresolved && isResolved) {
          info->announced = true;
          EmitEvent("attached", readerName, newState, atr);
        } else if (info->announced && newState != prevState) {
          EmitEvent("changed", readerName, newState, atr);
        }
      }
    }

    if (!readyEmitted) {
      bool hasUnknown = false;
      for (const auto &pair : readerStates_) {
        if ((pair.second.lastState & SCARD_STATE_UNKNOWN) != 0) {
          hasUnknown = true;
          break;
        }
      }
      if (!hasUnknown) {
        EmitEvent("ready", "", 0, {});
        readyEmitted = true;
        unreadyEmitted = false;
      }
    }

    if (readerStates_.empty()) {
      // We didn't wait for changes in SCardGetStatusChange so wait here.
      std::unique_lock<std::mutex> lock(sleepMutex_);
      sleepCv_.wait_for(lock, std::chrono::milliseconds(1000),
                        [this]() { return !monitoring_; });
      continue;
    }
  }

  return result;
}

void PCSCContext::EmitEvent(const std::string &eventType,
                            const std::string &readerName, DWORD state,
                            const std::vector<uint8_t> &atr, DWORD code) {
  LogPcscEvent(eventType, readerName);
  auto data = std::make_shared<EventData>(
      EventData{eventType, readerName, state, code, atr});

  auto status = tsfn_.NonBlockingCall([data](Napi::Env env,
                                             Napi::Function callback) {
    auto ptr = data.get();

    Napi::Object event = Napi::Object::New(env);
    event.Set("type", Napi::String::New(env, ptr->eventType));
    event.Set("name", Napi::String::New(env, ptr->readerName));
    event.Set("state", Napi::Number::New(env, ptr->state));
    event.Set("code", Napi::Number::New(env, ptr->code));

    if (!ptr->atr.empty()) {
      event.Set("atr", Napi::Buffer<uint8_t>::Copy(env, ptr->atr.data(),
                                                   ptr->atr.size()));
    } else {
      event.Set("atr", env.Null());
    }

    if (ptr->eventType == "attached") {
      event.Set("nativeReader", PCSCReader::NewInstance(env, ptr->readerName));
    }

    callback.Call({event});
  });

  (void)status;
}
