/** @typedef {import('./types.js').NativeAddon} NativeAddon */

// @ts-ignore — native addon loaded at runtime
import { createRequire } from "module";
const _require = createRequire(import.meta.url);

// Load native addon
/** @type {NativeAddon} */
const addon = _require("../build/Release/smartcard_napi.node");

// Native classes
const Context = addon.Context;
const Reader = addon.Reader;
const Card = addon.Card;
const ReaderMonitor = addon.ReaderMonitor;

// Constants from native addon
const SCARD_SHARE_EXCLUSIVE = addon.SCARD_SHARE_EXCLUSIVE;
const SCARD_SHARE_SHARED = addon.SCARD_SHARE_SHARED;
const SCARD_SHARE_DIRECT = addon.SCARD_SHARE_DIRECT;

const SCARD_PROTOCOL_T0 = addon.SCARD_PROTOCOL_T0;
const SCARD_PROTOCOL_T1 = addon.SCARD_PROTOCOL_T1;
const SCARD_PROTOCOL_RAW = addon.SCARD_PROTOCOL_RAW;
const SCARD_PROTOCOL_UNDEFINED = addon.SCARD_PROTOCOL_UNDEFINED;

const SCARD_LEAVE_CARD = addon.SCARD_LEAVE_CARD;
const SCARD_RESET_CARD = addon.SCARD_RESET_CARD;
const SCARD_UNPOWER_CARD = addon.SCARD_UNPOWER_CARD;
const SCARD_EJECT_CARD = addon.SCARD_EJECT_CARD;

const SCARD_STATE_UNAWARE = addon.SCARD_STATE_UNAWARE;
const SCARD_STATE_IGNORE = addon.SCARD_STATE_IGNORE;
const SCARD_STATE_CHANGED = addon.SCARD_STATE_CHANGED;
const SCARD_STATE_UNKNOWN = addon.SCARD_STATE_UNKNOWN;
const SCARD_STATE_UNAVAILABLE = addon.SCARD_STATE_UNAVAILABLE;
const SCARD_STATE_EMPTY = addon.SCARD_STATE_EMPTY;
const SCARD_STATE_PRESENT = addon.SCARD_STATE_PRESENT;
const SCARD_STATE_ATRMATCH = addon.SCARD_STATE_ATRMATCH;
const SCARD_STATE_EXCLUSIVE = addon.SCARD_STATE_EXCLUSIVE;
const SCARD_STATE_INUSE = addon.SCARD_STATE_INUSE;
const SCARD_STATE_MUTE = addon.SCARD_STATE_MUTE;

export { Devices, isUnresponsiveCardError } from "./devices.js";

export {
  transmitWithAutoResponse,
  buildGetResponseCommand,
  correctLeInCommand,
} from "./t0-handler.js";

export { CardWrapper, wrapCard } from "./card-wrapper.js";

export {
  PCSCError,
  CardRemovedError,
  TimeoutError,
  NoReadersError,
  ServiceNotRunningError,
  SharingViolationError,
  createPCSCError,
} from "./errors.js";

export {
  SCARD_CTL_CODE,
  CM_IOCTL_GET_FEATURE_REQUEST,
  FEATURE_VERIFY_PIN_START,
  FEATURE_VERIFY_PIN_FINISH,
  FEATURE_MODIFY_PIN_START,
  FEATURE_MODIFY_PIN_FINISH,
  FEATURE_GET_KEY_PRESSED,
  FEATURE_VERIFY_PIN_DIRECT,
  FEATURE_MODIFY_PIN_DIRECT,
  FEATURE_MCT_READER_DIRECT,
  FEATURE_MCT_UNIVERSAL,
  FEATURE_IFD_PIN_PROPERTIES,
  FEATURE_ABORT,
  FEATURE_SET_SPE_MESSAGE,
  FEATURE_VERIFY_PIN_DIRECT_APP_ID,
  FEATURE_MODIFY_PIN_DIRECT_APP_ID,
  FEATURE_WRITE_DISPLAY,
  FEATURE_GET_KEY,
  FEATURE_IFD_DISPLAY_PROPERTIES,
  FEATURE_GET_TLV_PROPERTIES,
  FEATURE_CCID_ESC_COMMAND,
  parseFeatures,
} from "./control-codes.js";

export {
  // Native classes
  Context,
  Reader,
  Card,
  ReaderMonitor,

  // Share modes
  SCARD_SHARE_EXCLUSIVE,
  SCARD_SHARE_SHARED,
  SCARD_SHARE_DIRECT,

  // Protocols
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
  SCARD_PROTOCOL_RAW,
  SCARD_PROTOCOL_UNDEFINED,

  // Dispositions
  SCARD_LEAVE_CARD,
  SCARD_RESET_CARD,
  SCARD_UNPOWER_CARD,
  SCARD_EJECT_CARD,

  // States
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
