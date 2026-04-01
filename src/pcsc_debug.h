#pragma once

#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <string>
#include "platform/pcsc.h"

// Returns true if PCSC_DEBUG env var is set to a truthy value.
// Evaluated once at program startup.
inline bool PcscDebugEnabled() {
    static const bool enabled = []() {
        const char* v = std::getenv("PCSC_DEBUG");
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
    bits.push_back((state & SCARD_STATE_UNAWARE)     ? 'U' : '-');
    bits.push_back((state & SCARD_STATE_IGNORE)      ? 'I' : '-');
    bits.push_back((state & SCARD_STATE_CHANGED)     ? 'C' : '-');
    bits.push_back((state & SCARD_STATE_UNKNOWN)     ? 'N' : '-');
    bits.push_back((state & SCARD_STATE_UNAVAILABLE) ? 'V' : '-');
    bits.push_back((state & SCARD_STATE_EMPTY)       ? 'E' : '-');
    bits.push_back((state & SCARD_STATE_PRESENT)     ? 'P' : '-');
    bits.push_back((state & SCARD_STATE_ATRMATCH)    ? 'A' : '-');
    bits.push_back((state & SCARD_STATE_EXCLUSIVE)   ? 'X' : '-');
    bits.push_back((state & SCARD_STATE_INUSE)       ? 'S' : '-');
    bits.push_back((state & SCARD_STATE_MUTE)        ? 'M' : '-');
    return bits;
}

// Log a PCSC API call. hint is optional context (e.g. reader name or call-site label).
inline void LogPcscCall(const char* fn, const std::string& hint = "") {
    if (!PcscDebugEnabled()) return;
    if (hint.empty())
        std::fprintf(stderr, "[pcsc] %s\n", fn);
    else
        std::fprintf(stderr, "[pcsc] %s %s\n", fn, hint.c_str());
}

// Log raw reader state bits returned by SCardGetStatusChange.
inline void LogPcscState(const std::string& readerName, DWORD state) {
    if (!PcscDebugEnabled()) return;
    std::fprintf(stderr, "[pcsc] %s %s\n", FormatStateBits(state).c_str(), readerName.c_str());
}

// Log a JS monitor event being emitted.
inline void LogPcscEvent(const std::string& eventType, const std::string& readerName) {
    if (!PcscDebugEnabled()) return;
    std::fprintf(stderr, "[pcsc] event %-8s %s\n", eventType.c_str(), readerName.c_str());
}
