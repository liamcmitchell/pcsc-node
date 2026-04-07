#pragma once

#include <napi.h>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <unordered_map>
#include "platform/pcsc.h"

class PCSCContext : public Napi::ObjectWrap<PCSCContext> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    PCSCContext(const Napi::CallbackInfo& info);
    ~PCSCContext();

    SCARDCONTEXT GetContext() const { return context_; }
    bool IsValid() const { return valid_; }

private:
    static Napi::FunctionReference constructor;

    SCARDCONTEXT context_;
    bool valid_;

    // Monitor state
    std::thread monitorThread_;
    std::atomic<bool> monitoring_;
    Napi::ThreadSafeFunction tsfn_;

    struct ReaderInfo {
        DWORD lastState;
        std::vector<uint8_t> atr;
        bool announced;
        bool seenInScan;
    };
    std::unordered_map<std::string, ReaderInfo> readerStates_;

    // JavaScript-exposed methods
    Napi::Value StartMonitor(const Napi::CallbackInfo& info);
    Napi::Value StopMonitor(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);
    Napi::Value GetIsValid(const Napi::CallbackInfo& info);

    // Internal monitoring methods
    void MonitorLoop();
    void EmitEvent(const std::string& eventType, const std::string& readerName,
                   DWORD state, const std::vector<uint8_t>& atr, DWORD code = 0);
    void StopMonitorInternal();
};
