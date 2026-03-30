/**
 * Low-level native PC/SC bindings.
 *
 * Use this module when you need direct access to the native
 * Context, Reader, Card, and ReaderMonitor classes.
 */

/** @typedef {import('./types.js').NativeAddon} NativeAddon */

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
  Card,
  ReaderMonitor,
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
  Card,
  ReaderMonitor,
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
