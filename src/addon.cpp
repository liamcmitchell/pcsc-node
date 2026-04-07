#include <napi.h>
#include "pcsc_context.h"
#include "pcsc_reader.h"
#include "platform/pcsc.h"

static double PcscCode(LONG code) {
    return static_cast<double>(static_cast<DWORD>(code));
}

// Export PC/SC constants
void ExportConstants(Napi::Env env, Napi::Object exports) {
    // Share modes
    exports.Set("SCARD_SHARE_EXCLUSIVE", Napi::Number::New(env, SCARD_SHARE_EXCLUSIVE));
    exports.Set("SCARD_SHARE_SHARED", Napi::Number::New(env, SCARD_SHARE_SHARED));
    exports.Set("SCARD_SHARE_DIRECT", Napi::Number::New(env, SCARD_SHARE_DIRECT));

    // Protocols
    exports.Set("SCARD_PROTOCOL_T0", Napi::Number::New(env, SCARD_PROTOCOL_T0));
    exports.Set("SCARD_PROTOCOL_T1", Napi::Number::New(env, SCARD_PROTOCOL_T1));
    exports.Set("SCARD_PROTOCOL_RAW", Napi::Number::New(env, SCARD_PROTOCOL_RAW));
    exports.Set("SCARD_PROTOCOL_UNDEFINED", Napi::Number::New(env, SCARD_PROTOCOL_UNDEFINED));

    // Disposition
    exports.Set("SCARD_LEAVE_CARD", Napi::Number::New(env, SCARD_LEAVE_CARD));
    exports.Set("SCARD_RESET_CARD", Napi::Number::New(env, SCARD_RESET_CARD));
    exports.Set("SCARD_UNPOWER_CARD", Napi::Number::New(env, SCARD_UNPOWER_CARD));
    exports.Set("SCARD_EJECT_CARD", Napi::Number::New(env, SCARD_EJECT_CARD));

    // State flags
    exports.Set("SCARD_STATE_UNAWARE", Napi::Number::New(env, SCARD_STATE_UNAWARE));
    exports.Set("SCARD_STATE_IGNORE", Napi::Number::New(env, SCARD_STATE_IGNORE));
    exports.Set("SCARD_STATE_CHANGED", Napi::Number::New(env, SCARD_STATE_CHANGED));
    exports.Set("SCARD_STATE_UNKNOWN", Napi::Number::New(env, SCARD_STATE_UNKNOWN));
    exports.Set("SCARD_STATE_UNAVAILABLE", Napi::Number::New(env, SCARD_STATE_UNAVAILABLE));
    exports.Set("SCARD_STATE_EMPTY", Napi::Number::New(env, SCARD_STATE_EMPTY));
    exports.Set("SCARD_STATE_PRESENT", Napi::Number::New(env, SCARD_STATE_PRESENT));
    exports.Set("SCARD_STATE_ATRMATCH", Napi::Number::New(env, SCARD_STATE_ATRMATCH));
    exports.Set("SCARD_STATE_EXCLUSIVE", Napi::Number::New(env, SCARD_STATE_EXCLUSIVE));
    exports.Set("SCARD_STATE_INUSE", Napi::Number::New(env, SCARD_STATE_INUSE));
    exports.Set("SCARD_STATE_MUTE", Napi::Number::New(env, SCARD_STATE_MUTE));

    // Status and error codes
    exports.Set("SCARD_S_SUCCESS", Napi::Number::New(env, PcscCode(SCARD_S_SUCCESS)));
    exports.Set("SCARD_E_CANCELLED", Napi::Number::New(env, PcscCode(SCARD_E_CANCELLED)));
    exports.Set("SCARD_E_CANT_DISPOSE", Napi::Number::New(env, PcscCode(SCARD_E_CANT_DISPOSE)));
    exports.Set(
        "SCARD_E_INSUFFICIENT_BUFFER",
        Napi::Number::New(env, PcscCode(SCARD_E_INSUFFICIENT_BUFFER))
    );
    exports.Set("SCARD_E_INVALID_ATR", Napi::Number::New(env, PcscCode(SCARD_E_INVALID_ATR)));
    exports.Set("SCARD_E_INVALID_HANDLE", Napi::Number::New(env, PcscCode(SCARD_E_INVALID_HANDLE)));
    exports.Set(
        "SCARD_E_INVALID_PARAMETER",
        Napi::Number::New(env, PcscCode(SCARD_E_INVALID_PARAMETER))
    );
    exports.Set("SCARD_E_INVALID_TARGET", Napi::Number::New(env, PcscCode(SCARD_E_INVALID_TARGET)));
    exports.Set("SCARD_E_INVALID_VALUE", Napi::Number::New(env, PcscCode(SCARD_E_INVALID_VALUE)));
    exports.Set("SCARD_E_NO_MEMORY", Napi::Number::New(env, PcscCode(SCARD_E_NO_MEMORY)));
    exports.Set("SCARD_E_NO_SERVICE", Napi::Number::New(env, PcscCode(SCARD_E_NO_SERVICE)));
    exports.Set("SCARD_E_NO_SMARTCARD", Napi::Number::New(env, PcscCode(SCARD_E_NO_SMARTCARD)));
    exports.Set("SCARD_E_NOT_READY", Napi::Number::New(env, PcscCode(SCARD_E_NOT_READY)));
    exports.Set("SCARD_E_NOT_TRANSACTED", Napi::Number::New(env, PcscCode(SCARD_E_NOT_TRANSACTED)));
    exports.Set("SCARD_E_PCI_TOO_SMALL", Napi::Number::New(env, PcscCode(SCARD_E_PCI_TOO_SMALL)));
    exports.Set("SCARD_E_PROTO_MISMATCH", Napi::Number::New(env, PcscCode(SCARD_E_PROTO_MISMATCH)));
    exports.Set(
        "SCARD_E_READER_UNAVAILABLE",
        Napi::Number::New(env, PcscCode(SCARD_E_READER_UNAVAILABLE))
    );
    exports.Set("SCARD_E_SERVICE_STOPPED", Napi::Number::New(env, PcscCode(SCARD_E_SERVICE_STOPPED)));
    exports.Set(
        "SCARD_E_SHARING_VIOLATION",
        Napi::Number::New(env, PcscCode(SCARD_E_SHARING_VIOLATION))
    );
    exports.Set("SCARD_E_SYSTEM_CANCELLED", Napi::Number::New(env, PcscCode(SCARD_E_SYSTEM_CANCELLED)));
    exports.Set("SCARD_E_TIMEOUT", Napi::Number::New(env, PcscCode(SCARD_E_TIMEOUT)));
    exports.Set("SCARD_E_UNKNOWN_CARD", Napi::Number::New(env, PcscCode(SCARD_E_UNKNOWN_CARD)));
    exports.Set("SCARD_E_UNKNOWN_READER", Napi::Number::New(env, PcscCode(SCARD_E_UNKNOWN_READER)));
    exports.Set(
        "SCARD_E_NO_READERS_AVAILABLE",
        Napi::Number::New(env, PcscCode(SCARD_E_NO_READERS_AVAILABLE))
    );
    exports.Set("SCARD_F_COMM_ERROR", Napi::Number::New(env, PcscCode(SCARD_F_COMM_ERROR)));
    exports.Set("SCARD_F_INTERNAL_ERROR", Napi::Number::New(env, PcscCode(SCARD_F_INTERNAL_ERROR)));
    exports.Set("SCARD_W_REMOVED_CARD", Napi::Number::New(env, PcscCode(SCARD_W_REMOVED_CARD)));
    exports.Set("SCARD_W_RESET_CARD", Napi::Number::New(env, PcscCode(SCARD_W_RESET_CARD)));
    exports.Set("SCARD_W_UNPOWERED_CARD", Napi::Number::New(env, PcscCode(SCARD_W_UNPOWERED_CARD)));
    exports.Set(
        "SCARD_W_UNRESPONSIVE_CARD",
        Napi::Number::New(env, PcscCode(SCARD_W_UNRESPONSIVE_CARD))
    );
    exports.Set(
        "SCARD_W_UNSUPPORTED_CARD",
        Napi::Number::New(env, PcscCode(SCARD_W_UNSUPPORTED_CARD))
    );
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Initialize wrapper classes
    PCSCContext::Init(env, exports);
    PCSCReader::Init(env, exports);

    // Export constants
    ExportConstants(env, exports);

    return exports;
}

NODE_API_MODULE(addon, Init)
