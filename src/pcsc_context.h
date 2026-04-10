#pragma once

#include "platform/pcsc.h"
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <napi.h>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

class PCSCContext : public Napi::ObjectWrap<PCSCContext> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);

  PCSCContext(const Napi::CallbackInfo &info);
  ~PCSCContext();

  bool IsValid() const { return !closed_; }

private:
  static Napi::FunctionReference constructor;

  bool closed_;
  std::atomic<SCARDCONTEXT> cancelContext_;

  // Monitor state
  std::thread monitorThread_;
  std::atomic<bool> monitoring_;
  std::mutex sleepMutex_;
  std::condition_variable sleepCv_;
  Napi::ThreadSafeFunction tsfn_;

  struct ReaderInfo {
    DWORD lastState;
    std::vector<uint8_t> atr;
    bool announced;
    bool seenInScan;
  };
  std::unordered_map<std::string, ReaderInfo> readerStates_;

  // JavaScript-exposed methods
  Napi::Value StartMonitor(const Napi::CallbackInfo &info);
  Napi::Value StopMonitor(const Napi::CallbackInfo &info);
  Napi::Value Close(const Napi::CallbackInfo &info);
  Napi::Value GetIsValid(const Napi::CallbackInfo &info);

  // Internal monitoring methods
  void MonitorLoop();
  LONG MonitorReadersLoop(SCARDCONTEXT ctx, bool &readyEmitted,
                          bool &unreadyEmitted);
  void EmitEvent(const std::string &eventType, const std::string &readerName,
                 DWORD state, const std::vector<uint8_t> &atr, DWORD code = 0);
  void StopMonitorInternal();
};
