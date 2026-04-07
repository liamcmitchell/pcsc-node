#include "pcsc_context.h"
#include "pcsc_reader.h"
#include "pcsc_errors.h"
#include "pcsc_debug.h"
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
    SCARDCONTEXT context;  // For creating PCSCReader on "attached"
};


Napi::Object PCSCContext::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "PCSCContext", {
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

PCSCContext::PCSCContext(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PCSCContext>(info), context_(0), valid_(false), monitoring_(false) {

    Napi::Env env = info.Env();

    LONG result = SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &context_);

    if (result != SCARD_S_SUCCESS) {
        ThrowPCSCError(env, result);
        return;
    }

    valid_ = true;
}

PCSCContext::~PCSCContext() {
    StopMonitorInternal();

    if (valid_ && context_ != 0) {
        SCardReleaseContext(context_);
        valid_ = false;
        context_ = 0;
    }
}

Napi::Value PCSCContext::StartMonitor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (monitoring_) {
        Napi::Error::New(env, "Monitor is already running").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!valid_) {
        Napi::Error::New(env, "Context is not valid").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Function callback = info[0].As<Napi::Function>();

    tsfn_ = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "PCSCMonitor",
        0,    // Unlimited queue size
        1,    // 1 initial thread
        [this](Napi::Env) {
            monitoring_ = false;
        }
    );

    monitoring_ = true;
    monitorThread_ = std::thread(&PCSCContext::MonitorLoop, this);

    return env.Undefined();
}

Napi::Value PCSCContext::StopMonitor(const Napi::CallbackInfo& info) {
    StopMonitorInternal();
    return info.Env().Undefined();
}

void PCSCContext::StopMonitorInternal() {
    if (!monitoring_) {
        return;
    }

    monitoring_ = false;

    // Cancel any blocking SCardGetStatusChange call
    if (valid_) {
        SCardCancel(context_);
    }

    if (monitorThread_.joinable()) {
        monitorThread_.join();
    }

    tsfn_.Release();
    readerStates_.clear();
}

Napi::Value PCSCContext::Close(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    StopMonitorInternal();

    if (valid_ && context_ != 0) {
        SCardReleaseContext(context_);
        valid_ = false;
        context_ = 0;
    }

    return env.Undefined();
}

Napi::Value PCSCContext::GetIsValid(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), valid_);
}

void PCSCContext::MonitorLoop() {
    std::vector<SCARD_READERSTATE> states;
    std::vector<std::string> readerNames;
    DWORD pnpCurrentState = SCARD_STATE_UNAWARE;
    bool checkReaders = true;
    bool readyEmitted = false;

    // Detect PnP support.
    bool pnpSupported = false;
    SCARD_READERSTATE pnp_state = {};
    pnp_state.szReader = "\\\\?PnP?\\Notification";
    pnp_state.dwCurrentState = SCARD_STATE_UNAWARE;
    LONG pnp_result = SCardGetStatusChange(context_, 0, &pnp_state, 1);
    if ((pnp_result == SCARD_S_SUCCESS || pnp_result == static_cast<LONG>(SCARD_E_TIMEOUT)) &&
        !(pnp_state.dwEventState & SCARD_STATE_UNKNOWN)) {
        pnpSupported = true;
    }

    while (monitoring_) {
        if (checkReaders) {
            std::vector<std::string> detachedNames;

            for (auto& pair : readerStates_) {
                pair.second.seenInScan = false;
            }

            DWORD readersLen = 0;
            LONG listResult = SCardListReaders(context_, nullptr, nullptr, &readersLen);

            if (listResult == static_cast<LONG>(SCARD_E_NO_READERS_AVAILABLE) || readersLen == 0) {
                for (const auto& pair : readerStates_) {
                    detachedNames.push_back(pair.first);
                }
                readerStates_.clear();
            } else if (listResult == SCARD_S_SUCCESS) {
                std::vector<char> buffer(readersLen);
                listResult = SCardListReaders(context_, nullptr, buffer.data(), &readersLen);

                if (listResult == SCARD_S_SUCCESS) {
                    const char* p = buffer.data();
                    while (*p != '\0') {
                        std::string name(p);
                        auto [it, inserted] = readerStates_.try_emplace(name, ReaderInfo{});
                        if (inserted) {
                            it->second.lastState = SCARD_STATE_UNAWARE;
                            it->second.atr.clear();
                            it->second.announced = false;
                        }
                        it->second.seenInScan = true;
                        p += strlen(p) + 1;
                    }

                    for (auto it = readerStates_.begin(); it != readerStates_.end();) {
                        if (!it->second.seenInScan) {
                            detachedNames.push_back(it->first);
                            it = readerStates_.erase(it);
                        } else {
                            ++it;
                        }
                    }
                }
            }

            for (const auto& name : detachedNames) {
                EmitEvent("detached", name, 0, {});
            }

            checkReaders = false;
        }

        // Build states array using reader names from our map
        states.clear();
        readerNames.clear();

        for (const auto& pair : readerStates_) {
            SCARD_READERSTATE state = {};
            readerNames.push_back(pair.first);
            state.szReader = readerNames.back().c_str();
            state.dwCurrentState = pair.second.lastState;
            state.pvUserData = const_cast<ReaderInfo*>(&pair.second);
            states.push_back(state);
        }

        if (pnpSupported) {
            readerNames.push_back("\\\\?PnP?\\Notification");
            SCARD_READERSTATE pnpState = {};
            pnpState.szReader = readerNames.back().c_str();
            pnpState.dwCurrentState = pnpCurrentState;
            pnpState.pvUserData = nullptr;
            states.push_back(pnpState);
        }

        // No readers and no PnP support: just poll reader list at 1s cadence.
        if (states.empty() && !pnpSupported) {
            if (!readyEmitted) {
                EmitEvent("ready", "", 0, {});
                readyEmitted = true;
            }
            std::this_thread::sleep_for(std::chrono::seconds(1));
            checkReaders = true;
            continue;
        }

        DWORD timeoutMs = pnpSupported ? INFINITE : 1000;
        LONG result = SCardGetStatusChange(context_, timeoutMs, states.data(), states.size());

        if (!monitoring_) {
            break;
        }

        if (result == static_cast<LONG>(SCARD_E_CANCELLED)) {
            break;
        }

        if (result == static_cast<LONG>(SCARD_E_TIMEOUT) && !pnpSupported) {
            checkReaders = true;
            continue;
        }

        if (result != SCARD_S_SUCCESS) {
            EmitEvent(
                "error",
                GetPCSCErrorString(result),
                0,
                {},
                static_cast<DWORD>(GetPCSCErrorCode(result))
            );
            std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            continue;
        }

        for (size_t i = 0; i < states.size(); i++) {
            if (!(states[i].dwEventState & SCARD_STATE_CHANGED)) {
                continue;
            }

            const std::string& readerName = readerNames[i];

            if (pnpSupported && readerName == "\\\\?PnP?\\Notification") {
                pnpCurrentState = states[i].dwEventState;
                checkReaders = true;
                continue;
            }

            LogPcscState(readerName, states[i].dwEventState);
            auto* info = static_cast<ReaderInfo*>(states[i].pvUserData);
            if (info == nullptr) {
                continue;
            }

            DWORD newState = states[i].dwEventState & ~SCARD_STATE_CHANGED;

            std::vector<uint8_t> atr;
            if (states[i].cbAtr > 0) {
                atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);
            }

            const DWORD prevState = info->lastState;
            info->lastState = newState;
            info->atr = atr;

            const bool wasUnresolved =
                prevState == SCARD_STATE_UNAWARE || (prevState & SCARD_STATE_UNKNOWN) != 0;
            const bool isResolved =
                newState != SCARD_STATE_UNAWARE && (newState & SCARD_STATE_UNKNOWN) == 0;

            if (!info->announced && wasUnresolved && isResolved) {
                info->announced = true;
                EmitEvent("attached", readerName, newState, atr);
            } else if (info->announced && newState != prevState) {
                EmitEvent("changed", readerName, newState, atr);
            }
        }

        if (!readyEmitted) {
            // Ready means initial monitor state is stable enough for consumers:
            // all currently tracked readers have resolved beyond UNKNOWN.
            bool hasUnknown = false;
            for (const auto& pair : readerStates_) {
                if ((pair.second.lastState & SCARD_STATE_UNKNOWN) != 0) {
                    hasUnknown = true;
                    break;
                }
            }

            if (!hasUnknown) {
                EmitEvent("ready", "", 0, {});
                readyEmitted = true;
            }
        }
    }
}

void PCSCContext::EmitEvent(const std::string& eventType, const std::string& readerName,
                             DWORD state, const std::vector<uint8_t>& atr, DWORD code) {
    LogPcscEvent(eventType, readerName);
    auto data = std::make_shared<EventData>(EventData{eventType, readerName, state, code, atr, context_});

    auto status = tsfn_.NonBlockingCall([data](Napi::Env env, Napi::Function callback) {
        auto ptr = data.get();

        Napi::Object event = Napi::Object::New(env);
        event.Set("type", Napi::String::New(env, ptr->eventType));
        event.Set("name", Napi::String::New(env, ptr->readerName));
        event.Set("state", Napi::Number::New(env, ptr->state));
        event.Set("code", Napi::Number::New(env, ptr->code));

        if (!ptr->atr.empty()) {
            event.Set("atr", Napi::Buffer<uint8_t>::Copy(env, ptr->atr.data(), ptr->atr.size()));
        } else {
            event.Set("atr", env.Null());
        }

        if (ptr->eventType == "attached") {
            event.Set("nativeReader", PCSCReader::NewInstance(env, ptr->context, ptr->readerName));
        }

        callback.Call({event});
    });

    (void)status;
}
