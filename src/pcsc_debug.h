#pragma once

#include "platform/pcsc.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <string>

// Returns true if PCSC_DEBUG env var is set to a truthy value.
// Evaluated once at program startup.
inline bool PcscDebugEnabled() {
  static const bool enabled = []() {
    const char *v = std::getenv("PCSC_DEBUG");
    return v != nullptr && *v != '\0' && std::strcmp(v, "0") != 0;
  }();
  return enabled;
}

// Render reader state flags in a compact fixed-order bitmap string.
//   U = UNAWARE
//   I = IGNORE
//   C = CHANGED
//   N = UNKNOWN
//   V = UNAVAILABLE
//   E = EMPTY
//   P = PRESENT
//   A = ATRMATCH
//   X = EXCLUSIVE
//   S = INUSE
//   M = MUTE
inline std::string FormatStateBits(DWORD state) {
  std::string bits;
  bits.reserve(11);
  bits.push_back((state & SCARD_STATE_UNAWARE) ? 'U' : '-');
  bits.push_back((state & SCARD_STATE_IGNORE) ? 'I' : '-');
  bits.push_back((state & SCARD_STATE_CHANGED) ? 'C' : '-');
  bits.push_back((state & SCARD_STATE_UNKNOWN) ? 'N' : '-');
  bits.push_back((state & SCARD_STATE_UNAVAILABLE) ? 'V' : '-');
  bits.push_back((state & SCARD_STATE_EMPTY) ? 'E' : '-');
  bits.push_back((state & SCARD_STATE_PRESENT) ? 'P' : '-');
  bits.push_back((state & SCARD_STATE_ATRMATCH) ? 'A' : '-');
  bits.push_back((state & SCARD_STATE_EXCLUSIVE) ? 'X' : '-');
  bits.push_back((state & SCARD_STATE_INUSE) ? 'S' : '-');
  bits.push_back((state & SCARD_STATE_MUTE) ? 'M' : '-');
  return bits;
}

// Format local wall-clock time as HH:MM:SS.mmm.
inline std::string PcscTimestamp() {
  using clock = std::chrono::system_clock;
  const auto now = clock::now();
  const auto tt = clock::to_time_t(now);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      now.time_since_epoch()) %
                  1000;

  std::tm tm{};
#ifdef _WIN32
  localtime_s(&tm, &tt);
#else
  localtime_r(&tt, &tm);
#endif

  char buf[16];
  std::snprintf(buf, sizeof(buf), "%02d:%02d:%02d.%03d", tm.tm_hour, tm.tm_min,
                tm.tm_sec, static_cast<int>(ms.count()));
  return std::string(buf);
}

// Log a PCSC API call. hint is optional context (e.g. reader name or call-site
// label).
inline void LogPcscCall(const char *fn, const std::string &hint = "") {
  if (!PcscDebugEnabled())
    return;
  if (hint.empty())
    std::fprintf(stderr, "%s %s\n", PcscTimestamp().c_str(), fn);
  else
    std::fprintf(stderr, "%s %s %s\n", PcscTimestamp().c_str(), fn,
                 hint.c_str());
}

// Log completion of a PCSC async call with its result and elapsed time.
inline void LogPcscResult(const char *fn, const std::string &hint, LONG result,
                          long long elapsedMs) {
  if (!PcscDebugEnabled())
    return;
  if (hint.empty()) {
    std::fprintf(stderr, "%s done %-14s rc=0x%08lX t=%lldms\n",
                 PcscTimestamp().c_str(), fn,
                 static_cast<unsigned long>(result), elapsedMs);
  } else {
    std::fprintf(stderr, "%s done %-14s rc=0x%08lX t=%lldms %s\n",
                 PcscTimestamp().c_str(), fn,
                 static_cast<unsigned long>(result), elapsedMs, hint.c_str());
  }
}

// Log raw reader state bits returned by SCardGetStatusChange.
inline void LogPcscState(const std::string &readerName, DWORD state) {
  if (!PcscDebugEnabled())
    return;
  std::fprintf(stderr, "%s %s %s\n", PcscTimestamp().c_str(),
               FormatStateBits(state).c_str(), readerName.c_str());
}

// Log a JS monitor event being emitted.
inline void LogPcscEvent(const std::string &eventType,
                         const std::string &readerName) {
  if (!PcscDebugEnabled())
    return;
  std::fprintf(stderr, "%s event %-8s %s\n", PcscTimestamp().c_str(),
               eventType.c_str(), readerName.c_str());
}

// Log a generic debug message.
inline void LogPcscDebug(const char *msg, LONG code = 0) {
  if (!PcscDebugEnabled())
    return;
  if (code != 0)
    std::fprintf(stderr, "%s debug %s (0x%08lX)\n", PcscTimestamp().c_str(),
                 msg, static_cast<unsigned long>(static_cast<DWORD>(code)));
  else
    std::fprintf(stderr, "%s debug %s\n", PcscTimestamp().c_str(), msg);
}
