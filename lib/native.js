/**
 * Low-level native PC/SC bindings.
 */

/**
 * Instance shape of the native PC/SC context constructor (SCARDCONTEXT).
 * @typedef {object} PCSCContextInstance
 * @property {boolean} isValid
 * @property {(callback: (event: MonitorEvent) => void) => void} startMonitor
 * @property {() => void} stopMonitor
 * @property {() => void} close
 */

/**
 * Instance shape of the native PC/SC reader (SCARDHANDLE).
 * @typedef {object} PCSCReaderInstance
 * @property {string} name
 * @property {number} protocol
 * @property {boolean} connected
 * @property {Buffer | null} atr
 * @property {(shareMode?: number, preferredProtocols?: number) => Promise<void>} connect
 * @property {(command: Buffer | number[], options?: { maxRecvLength?: number }) => Promise<Buffer>} transmit
 * @property {(code: number, data?: Buffer | number[]) => Promise<Buffer>} control
 * @property {(disposition?: number) => void} disconnect
 * @property {(shareMode?: number, preferredProtocols?: number, initialization?: number) => Promise<void>} reconnect
 */

/**
 * Monitor event emitted by the native Context.
 * @typedef {object} MonitorEvent
 * @property {"attached" | "detached" | "changed" | "error" | "ready"} type
 * @property {string} name
 * @property {number} state
 * @property {number} [code]
 * @property {Buffer | null} atr
 * @property {PCSCReaderInstance} [nativeReader]
 */

/**
 * Shape of the native addon module.
 * @typedef {object} NativeAddon
 * @property {new () => PCSCContextInstance} PCSCContext
 * @property {new () => PCSCReaderInstance} PCSCReader
 * @property {number} SCARD_SHARE_EXCLUSIVE
 * @property {number} SCARD_SHARE_SHARED
 * @property {number} SCARD_SHARE_DIRECT
 * @property {number} SCARD_PROTOCOL_T0
 * @property {number} SCARD_PROTOCOL_T1
 * @property {number} SCARD_PROTOCOL_RAW
 * @property {number} SCARD_PROTOCOL_UNDEFINED
 * @property {number} SCARD_LEAVE_CARD
 * @property {number} SCARD_RESET_CARD
 * @property {number} SCARD_UNPOWER_CARD
 * @property {number} SCARD_EJECT_CARD
 * @property {number} SCARD_STATE_UNAWARE
 * @property {number} SCARD_STATE_IGNORE
 * @property {number} SCARD_STATE_CHANGED
 * @property {number} SCARD_STATE_UNKNOWN
 * @property {number} SCARD_STATE_UNAVAILABLE
 * @property {number} SCARD_STATE_EMPTY
 * @property {number} SCARD_STATE_PRESENT
 * @property {number} SCARD_STATE_ATRMATCH
 * @property {number} SCARD_STATE_EXCLUSIVE
 * @property {number} SCARD_STATE_INUSE
 * @property {number} SCARD_STATE_MUTE
 * @property {number} SCARD_S_SUCCESS
 * @property {number} SCARD_E_CANCELLED
 * @property {number} SCARD_E_CANT_DISPOSE
 * @property {number} SCARD_E_INSUFFICIENT_BUFFER
 * @property {number} SCARD_E_INVALID_ATR
 * @property {number} SCARD_E_INVALID_HANDLE
 * @property {number} SCARD_E_INVALID_PARAMETER
 * @property {number} SCARD_E_INVALID_TARGET
 * @property {number} SCARD_E_INVALID_VALUE
 * @property {number} SCARD_E_NO_MEMORY
 * @property {number} SCARD_E_NO_SERVICE
 * @property {number} SCARD_E_NO_SMARTCARD
 * @property {number} SCARD_E_NOT_READY
 * @property {number} SCARD_E_NOT_TRANSACTED
 * @property {number} SCARD_E_PCI_TOO_SMALL
 * @property {number} SCARD_E_PROTO_MISMATCH
 * @property {number} SCARD_E_READER_UNAVAILABLE
 * @property {number} SCARD_E_SERVICE_STOPPED
 * @property {number} SCARD_E_SHARING_VIOLATION
 * @property {number} SCARD_E_SYSTEM_CANCELLED
 * @property {number} SCARD_E_TIMEOUT
 * @property {number} SCARD_E_UNKNOWN_CARD
 * @property {number} SCARD_E_UNKNOWN_READER
 * @property {number} SCARD_E_NO_READERS_AVAILABLE
 * @property {number} SCARD_F_COMM_ERROR
 * @property {number} SCARD_F_INTERNAL_ERROR
 * @property {number} SCARD_W_REMOVED_CARD
 * @property {number} SCARD_W_RESET_CARD
 * @property {number} SCARD_W_UNPOWERED_CARD
 * @property {number} SCARD_W_UNRESPONSIVE_CARD
 * @property {number} SCARD_W_UNSUPPORTED_CARD
 */

// @ts-ignore — native addon loaded at runtime
import { createRequire } from "module";
const _require = createRequire(import.meta.url);

/** @type {NativeAddon} */
let addon;
try {
  addon = _require("../build/Release/smartcard_napi.node");
} catch (err) {
  throw new Error(
    "Failed to load the native PC/SC addon. " +
      "Run `npm run rebuild` or `node-gyp rebuild` to compile it. " +
      "On Linux, install libpcsclite-dev first.",
    { cause: err },
  );
}

const {
  PCSCContext,
  PCSCReader,
  SCARD_SHARE_EXCLUSIVE,
  SCARD_SHARE_SHARED,
  SCARD_SHARE_DIRECT,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
  SCARD_PROTOCOL_RAW,
  SCARD_PROTOCOL_UNDEFINED,
  SCARD_LEAVE_CARD,
  SCARD_RESET_CARD,
  SCARD_UNPOWER_CARD,
  SCARD_EJECT_CARD,
  SCARD_STATE_UNAWARE,
  SCARD_STATE_IGNORE,
  SCARD_STATE_CHANGED,
  SCARD_STATE_UNKNOWN,
  SCARD_STATE_UNAVAILABLE,
  SCARD_STATE_EMPTY,
  SCARD_STATE_PRESENT,
  SCARD_STATE_ATRMATCH,
  SCARD_STATE_EXCLUSIVE,
  SCARD_STATE_INUSE,
  SCARD_STATE_MUTE,
  SCARD_S_SUCCESS,
  SCARD_E_CANCELLED,
  SCARD_E_CANT_DISPOSE,
  SCARD_E_INSUFFICIENT_BUFFER,
  SCARD_E_INVALID_ATR,
  SCARD_E_INVALID_HANDLE,
  SCARD_E_INVALID_PARAMETER,
  SCARD_E_INVALID_TARGET,
  SCARD_E_INVALID_VALUE,
  SCARD_E_NO_MEMORY,
  SCARD_E_NO_SERVICE,
  SCARD_E_NO_SMARTCARD,
  SCARD_E_NOT_READY,
  SCARD_E_NOT_TRANSACTED,
  SCARD_E_PCI_TOO_SMALL,
  SCARD_E_PROTO_MISMATCH,
  SCARD_E_READER_UNAVAILABLE,
  SCARD_E_SERVICE_STOPPED,
  SCARD_E_SHARING_VIOLATION,
  SCARD_E_SYSTEM_CANCELLED,
  SCARD_E_TIMEOUT,
  SCARD_E_UNKNOWN_CARD,
  SCARD_E_UNKNOWN_READER,
  SCARD_E_NO_READERS_AVAILABLE,
  SCARD_F_COMM_ERROR,
  SCARD_F_INTERNAL_ERROR,
  SCARD_W_REMOVED_CARD,
  SCARD_W_RESET_CARD,
  SCARD_W_UNPOWERED_CARD,
  SCARD_W_UNRESPONSIVE_CARD,
  SCARD_W_UNSUPPORTED_CARD,
} = addon;

export {
  PCSCContext,
  PCSCReader,
  SCARD_SHARE_EXCLUSIVE,
  SCARD_SHARE_SHARED,
  SCARD_SHARE_DIRECT,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
  SCARD_PROTOCOL_RAW,
  SCARD_PROTOCOL_UNDEFINED,
  SCARD_LEAVE_CARD,
  SCARD_RESET_CARD,
  SCARD_UNPOWER_CARD,
  SCARD_EJECT_CARD,
  SCARD_STATE_UNAWARE,
  SCARD_STATE_IGNORE,
  SCARD_STATE_CHANGED,
  SCARD_STATE_UNKNOWN,
  SCARD_STATE_UNAVAILABLE,
  SCARD_STATE_EMPTY,
  SCARD_STATE_PRESENT,
  SCARD_STATE_ATRMATCH,
  SCARD_STATE_EXCLUSIVE,
  SCARD_STATE_INUSE,
  SCARD_STATE_MUTE,
  SCARD_S_SUCCESS,
  SCARD_E_CANCELLED,
  SCARD_E_CANT_DISPOSE,
  SCARD_E_INSUFFICIENT_BUFFER,
  SCARD_E_INVALID_ATR,
  SCARD_E_INVALID_HANDLE,
  SCARD_E_INVALID_PARAMETER,
  SCARD_E_INVALID_TARGET,
  SCARD_E_INVALID_VALUE,
  SCARD_E_NO_MEMORY,
  SCARD_E_NO_SERVICE,
  SCARD_E_NO_SMARTCARD,
  SCARD_E_NOT_READY,
  SCARD_E_NOT_TRANSACTED,
  SCARD_E_PCI_TOO_SMALL,
  SCARD_E_PROTO_MISMATCH,
  SCARD_E_READER_UNAVAILABLE,
  SCARD_E_SERVICE_STOPPED,
  SCARD_E_SHARING_VIOLATION,
  SCARD_E_SYSTEM_CANCELLED,
  SCARD_E_TIMEOUT,
  SCARD_E_UNKNOWN_CARD,
  SCARD_E_UNKNOWN_READER,
  SCARD_E_NO_READERS_AVAILABLE,
  SCARD_F_COMM_ERROR,
  SCARD_F_INTERNAL_ERROR,
  SCARD_W_REMOVED_CARD,
  SCARD_W_RESET_CARD,
  SCARD_W_UNPOWERED_CARD,
  SCARD_W_UNRESPONSIVE_CARD,
  SCARD_W_UNSUPPORTED_CARD,
};
