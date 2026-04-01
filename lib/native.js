/**
 * Low-level native PC/SC bindings.
 */

/**
 * Instance shape of the native PC/SC context constructor (SCARDCONTEXT).
 * @typedef {object} NativeContext
 * @property {boolean} isValid
 * @property {(callback: (event: MonitorEvent) => void) => void} startMonitor
 * @property {() => void} stopMonitor
 * @property {() => void} close
 */

/**
 * Instance shape of the native PC/SC reader (SCARDHANDLE).
 * @typedef {object} NativeReader
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
 * @property {Buffer | null} atr
 * @property {NativeReader} [nativeReader]
 */

/**
 * Shape of the native addon module.
 * @typedef {object} NativeAddon
 * @property {new () => NativeContext} Context
 * @property {new () => NativeReader} Reader
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
  Context,
  Reader,
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
} = addon;

export {
  Context,
  Reader,
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
};
