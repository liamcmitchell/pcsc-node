#include "pcsc_context.h"
#include "pcsc_reader.h"
#include "pcsc_errors.h"
#include "async_workers.h"
#include <cstring>
#include <memory>

Napi::FunctionReference PCSCContext::constructor;

// Number of iterations between forced full state refreshes (Windows reliability fix)
static const int STATE_REFRESH_INTERVAL = 10;

// Event data passed from worker thread to JS thread
struct EventData {
    std::string eventType;
    std::string readerName;
    DWORD state;
    std::vector<uint8_t> atr;
    SCARDCONTEXT context;  // For creating PCSCReader on "attached"
};

Napi::Object PCSCContext::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Context", {
        InstanceMethod("startMonitor", &PCSCContext::StartMonitor),
        InstanceMethod("stopMonitor", &PCSCContext::StopMonitor),
        InstanceMethod("close", &PCSCContext::Close),
        InstanceAccessor("isValid", &PCSCContext::GetIsValid, nullptr),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Context", func);
    return exports;
}

PCSCContext::PCSCContext(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PCSCContext>(info), context_(0), valid_(false), monitoring_(false) {

    Napi::Env env = info.Env();

    LONG result = SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &context_);

    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
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

// ============================================================================
// Monitor
// ============================================================================

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

    std::lock_guard<std::mutex> lock(mutex_);
    readerStates_.clear();
}

// ============================================================================
// Close
// ============================================================================

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

// ============================================================================
// Monitor Loop (runs on background thread)
// ============================================================================

void PCSCContext::MonitorLoop() {
    // Get initial reader list
    UpdateReaderList();

    // Emit attached events for all pre-existing readers
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& pair : readerStates_) {
            EmitEvent("attached", pair.first, pair.second.lastState, pair.second.atr);
        }
    }

    std::vector<SCARD_READERSTATE> states;
    std::vector<std::string> readerNames;
    int iterationCount = 0;

    while (monitoring_) {
        // Periodic full state refresh to handle Windows PC/SC state drift
        if (++iterationCount >= STATE_REFRESH_INTERVAL) {
            iterationCount = 0;
            std::lock_guard<std::mutex> lock(mutex_);

            std::vector<SCARD_READERSTATE> refreshStates;
            std::vector<std::string> refreshNames;

            for (const auto& pair : readerStates_) {
                refreshNames.push_back(pair.first);
                SCARD_READERSTATE state = {};
                state.szReader = refreshNames.back().c_str();
                state.dwCurrentState = SCARD_STATE_UNAWARE;
                refreshStates.push_back(state);
            }

            if (!refreshStates.empty()) {
                LONG refreshResult = SCardGetStatusChange(context_, 0, refreshStates.data(), refreshStates.size());
                if (refreshResult == SCARD_S_SUCCESS) {
                    for (size_t i = 0; i < refreshStates.size(); i++) {
                        const std::string& name = refreshNames[i];
                        auto it = readerStates_.find(name);
                        if (it != readerStates_.end()) {
                            DWORD newState = refreshStates[i].dwEventState & ~SCARD_STATE_CHANGED;

                            if (newState != it->second.lastState) {
                                std::vector<uint8_t> atr;
                                if (refreshStates[i].cbAtr > 0) {
                                    atr.assign(refreshStates[i].rgbAtr,
                                              refreshStates[i].rgbAtr + refreshStates[i].cbAtr);
                                }

                                it->second.lastState = newState;
                                it->second.atr = atr;
                                EmitEvent("changed", name, newState, atr);
                            }
                        }
                    }
                }
            }
        }

        // Build states array using reader names from our map
        {
            std::lock_guard<std::mutex> lock(mutex_);
            states.clear();
            readerNames.clear();

            for (const auto& pair : readerStates_) {
                SCARD_READERSTATE state = {};
                readerNames.push_back(pair.first);
                state.szReader = readerNames.back().c_str();
                state.dwCurrentState = pair.second.lastState;
                states.push_back(state);
            }

            // Add PnP notification for new reader detection
            readerNames.push_back("\\\\?PnP?\\Notification");
            SCARD_READERSTATE pnpState = {};
            pnpState.szReader = readerNames.back().c_str();
            pnpState.dwCurrentState = SCARD_STATE_UNAWARE;
            states.push_back(pnpState);
        }

        // Wait for changes (with 1 second timeout for periodic refresh)
        LONG result = SCardGetStatusChange(context_, 1000, states.data(), states.size());

        if (!monitoring_) {
            break;
        }

        if (result == static_cast<LONG>(SCARD_E_CANCELLED)) {
            break;
        }

        if (result == static_cast<LONG>(SCARD_E_TIMEOUT)) {
            // Timeout - query fresh state to detect missed events
            std::lock_guard<std::mutex> lock(mutex_);

            if (readerStates_.empty()) {
                continue;
            }

            std::vector<SCARD_READERSTATE> freshStates;
            std::vector<std::string> freshNames;

            for (const auto& pair : readerStates_) {
                freshNames.push_back(pair.first);
                SCARD_READERSTATE state = {};
                state.szReader = freshNames.back().c_str();
                state.dwCurrentState = SCARD_STATE_UNAWARE;
                freshStates.push_back(state);
            }

            LONG freshResult = SCardGetStatusChange(context_, 0, freshStates.data(), freshStates.size());
            if (freshResult != SCARD_S_SUCCESS) {
                continue;
            }

            for (size_t i = 0; i < freshStates.size(); i++) {
                const std::string& name = freshNames[i];
                auto it = readerStates_.find(name);
                if (it != readerStates_.end()) {
                    DWORD freshState = freshStates[i].dwEventState & ~SCARD_STATE_CHANGED;

                    if (freshState != it->second.lastState) {
                        std::vector<uint8_t> atr;
                        if (freshStates[i].cbAtr > 0) {
                            atr.assign(freshStates[i].rgbAtr,
                                      freshStates[i].rgbAtr + freshStates[i].cbAtr);
                        }

                        it->second.lastState = freshState;
                        it->second.atr = atr;
                        EmitEvent("changed", name, freshState, atr);
                    }
                }
            }
            continue;
        }

        if (result != SCARD_S_SUCCESS) {
            EmitEvent("error", GetPCSCErrorString(result), 0, {});
            std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            continue;
        }

        std::lock_guard<std::mutex> lock(mutex_);
        bool pnpTriggered = false;

        for (size_t i = 0; i < states.size(); i++) {
            if (!(states[i].dwEventState & SCARD_STATE_CHANGED)) {
                continue;
            }

            // PnP notification - reader list changed
            if (readerNames[i] == "\\\\?PnP?\\Notification") {
                pnpTriggered = true;
                const auto oldReaderStates = readerStates_;

                std::vector<std::string> oldNames;
                for (const auto& pair : readerStates_) {
                    oldNames.push_back(pair.first);
                }

                UpdateReaderList();

                // Find new readers
                for (const auto& pair : readerStates_) {
                    bool found = false;
                    for (const auto& old : oldNames) {
                        if (old == pair.first) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        EmitEvent("attached", pair.first, pair.second.lastState, pair.second.atr);
                    }
                }

                // Find removed readers
                for (const auto& old : oldNames) {
                    if (readerStates_.find(old) == readerStates_.end()) {
                        EmitEvent("detached", old, 0, {});
                    }
                }

                // Reconcile state changes for readers that still exist after PnP update
                for (const auto& pair : readerStates_) {
                    const std::string& name = pair.first;
                    auto oldIt = oldReaderStates.find(name);
                    if (oldIt == oldReaderStates.end()) {
                        continue;
                    }

                    if (pair.second.lastState != oldIt->second.lastState) {
                        EmitEvent("changed", name, pair.second.lastState, pair.second.atr);
                    }
                }

                break;
            }

            if (pnpTriggered) {
                continue;
            }

            const std::string& readerName = readerNames[i];
            auto it = readerStates_.find(readerName);

            if (it != readerStates_.end()) {
                DWORD newState = states[i].dwEventState & ~SCARD_STATE_CHANGED;

                std::vector<uint8_t> atr;
                if (states[i].cbAtr > 0) {
                    atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);
                }

                it->second.lastState = newState;
                it->second.atr = atr;
                EmitEvent("changed", readerName, newState, atr);
            }
        }

        if (pnpTriggered) {
            continue;
        }
    }
}

void PCSCContext::UpdateReaderList() {
    DWORD readersLen = 0;
    LONG result = SCardListReaders(context_, nullptr, nullptr, &readersLen);

    if (result == static_cast<LONG>(SCARD_E_NO_READERS_AVAILABLE) || readersLen == 0) {
        readerStates_.clear();
        return;
    }

    if (result != SCARD_S_SUCCESS) {
        return;
    }

    std::vector<char> buffer(readersLen);
    result = SCardListReaders(context_, nullptr, buffer.data(), &readersLen);

    if (result != SCARD_S_SUCCESS) {
        return;
    }

    // Parse multi-string
    std::vector<std::string> newNames;
    const char* p = buffer.data();
    while (*p != '\0') {
        newNames.push_back(std::string(p));
        p += strlen(p) + 1;
    }

    // Preserve previous state for readers that still exist
    const auto previousStates = readerStates_;

    // Get initial state for listed readers
    std::vector<SCARD_READERSTATE> readerStateArr(newNames.size());
    for (size_t i = 0; i < newNames.size(); i++) {
        readerStateArr[i].szReader = newNames[i].c_str();
        readerStateArr[i].dwCurrentState = SCARD_STATE_UNAWARE;
    }

    LONG stateResult = SCARD_S_SUCCESS;
    if (!readerStateArr.empty()) {
        stateResult = SCardGetStatusChange(context_, 0, readerStateArr.data(), readerStateArr.size());
    }

    // Update reader states map
    std::unordered_map<std::string, ReaderInfo> updatedStates;
    for (size_t i = 0; i < newNames.size(); i++) {
        const std::string& name = newNames[i];
        ReaderInfo info = {};

        auto previousIt = previousStates.find(name);
        if (previousIt != previousStates.end()) {
            info = previousIt->second;
        } else {
            info.lastState = SCARD_STATE_UNAWARE;
        }

        if (stateResult == SCARD_S_SUCCESS) {
            info.lastState = readerStateArr[i].dwEventState & ~SCARD_STATE_CHANGED;
            if (readerStateArr[i].cbAtr > 0) {
                info.atr.assign(readerStateArr[i].rgbAtr, readerStateArr[i].rgbAtr + readerStateArr[i].cbAtr);
            } else {
                info.atr.clear();
            }
        }

        updatedStates[name] = info;
    }

    readerStates_.swap(updatedStates);
}

void PCSCContext::EmitEvent(const std::string& eventType, const std::string& readerName,
                             DWORD state, const std::vector<uint8_t>& atr) {
    auto data = std::make_shared<EventData>(EventData{eventType, readerName, state, atr, context_});

    auto status = tsfn_.NonBlockingCall([data](Napi::Env env, Napi::Function callback) {
        auto ptr = data.get();

        Napi::Object event = Napi::Object::New(env);
        event.Set("type", Napi::String::New(env, ptr->eventType));
        event.Set("reader", Napi::String::New(env, ptr->readerName));
        event.Set("state", Napi::Number::New(env, ptr->state));

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
