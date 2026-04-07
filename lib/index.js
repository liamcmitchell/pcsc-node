export { Context } from "./context.js";
export { Reader } from "./reader.js";

export { Errors } from "./errors.js";

export {
  platformControlCode,
  ControlCode,
  Feature,
  featureName,
  parseFeatures,
  parseFeaturesDetails,
} from "./control-codes.js";

export { StatusWord, parseResponse, statusWordName } from "./status-words.js";
import { toHex } from "./hex.js";

import {
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
} from "./native.js";

export const ShareMode = Object.freeze({
  EXCLUSIVE: SCARD_SHARE_EXCLUSIVE,
  SHARED: SCARD_SHARE_SHARED,
  DIRECT: SCARD_SHARE_DIRECT,
});

export const Protocol = Object.freeze({
  T0: SCARD_PROTOCOL_T0,
  T1: SCARD_PROTOCOL_T1,
  RAW: SCARD_PROTOCOL_RAW,
  UNDEFINED: SCARD_PROTOCOL_UNDEFINED,
});

export const Disposition = Object.freeze({
  LEAVE: SCARD_LEAVE_CARD,
  RESET: SCARD_RESET_CARD,
  UNPOWER: SCARD_UNPOWER_CARD,
  EJECT: SCARD_EJECT_CARD,
});

export const State = Object.freeze({
  UNAWARE: SCARD_STATE_UNAWARE,
  IGNORE: SCARD_STATE_IGNORE,
  CHANGED: SCARD_STATE_CHANGED,
  UNKNOWN: SCARD_STATE_UNKNOWN,
  UNAVAILABLE: SCARD_STATE_UNAVAILABLE,
  EMPTY: SCARD_STATE_EMPTY,
  PRESENT: SCARD_STATE_PRESENT,
  ATRMATCH: SCARD_STATE_ATRMATCH,
  EXCLUSIVE: SCARD_STATE_EXCLUSIVE,
  INUSE: SCARD_STATE_INUSE,
  MUTE: SCARD_STATE_MUTE,
});

/** @type {Map<number, string>} */
const PROTOCOL_NAMES = new Map([
  [Protocol.T0, "T=0"],
  [Protocol.T1, "T=1"],
  [Protocol.RAW, "RAW"],
  [Protocol.UNDEFINED, "UNDEFINED"],
]);

/**
 * Resolve protocol value to a human-readable name.
 * @param {number} protocol
 * @returns {string}
 */
export function protocolName(protocol) {
  return PROTOCOL_NAMES.get(protocol) ?? toHex(protocol, 2);
}

/**
 * Resolve state bitmask to all active state flag names.
 * @param {number} flags
 * @returns {string[]}
 */
export function stateNames(flags) {
  if (flags === State.UNAWARE) return ["UNAWARE"];
  return Object.entries(State)
    .filter(([, value]) => value !== 0 && (flags & value) !== 0)
    .map(([name]) => name);
}
