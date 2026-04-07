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
export { ShareMode, Protocol, Disposition, State } from "./constants.js";

import { toHex } from "./hex.js";
import { Protocol, State } from "./constants.js";

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
