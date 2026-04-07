/**
 * APDU status word helpers.
 */

import { toHex } from "./hex.js";

/** Common APDU status words used in examples and typical flows. */
const StatusWord = Object.freeze({
  OK: 0x9000,
  WRONG_LENGTH: 0x6700,
  LOGICAL_CHANNEL_NOT_SUPPORTED: 0x6881,
  SECURITY_STATUS_NOT_SATISFIED: 0x6982,
  CONDITIONS_NOT_SATISFIED: 0x6985,
  FILE_OR_APPLICATION_NOT_FOUND: 0x6a82,
  INSTRUCTION_NOT_SUPPORTED: 0x6d00,
});

/** @type {Map<number, string>} */
const STATUS_WORD_NAMES = new Map([
  [StatusWord.OK, "ok"],
  [StatusWord.WRONG_LENGTH, "wrong length"],
  [StatusWord.LOGICAL_CHANNEL_NOT_SUPPORTED, "logical channel not supported"],
  [StatusWord.SECURITY_STATUS_NOT_SATISFIED, "security status not satisfied"],
  [StatusWord.CONDITIONS_NOT_SATISFIED, "conditions of use not satisfied"],
  [StatusWord.FILE_OR_APPLICATION_NOT_FOUND, "file or application not found"],
  [StatusWord.INSTRUCTION_NOT_SUPPORTED, "instruction not supported"],
]);

/**
 * Parse status words from an APDU response.
 * @param {Buffer | Uint8Array} response
 * @returns {{ sw1: number; sw2: number; sw: number; data: Buffer | Uint8Array }}
 */
function parseResponse(response) {
  if (response.length < 2) {
    throw new Error("APDU response must include at least SW1 and SW2 bytes");
  }
  const sw1 = response[response.length - 2];
  const sw2 = response[response.length - 1];
  const sw = (sw1 << 8) | sw2;
  const data = response.subarray(0, -2);
  return { sw1, sw2, sw, data };
}

/**
 * Resolve a human-readable label for a common status word.
 * @param {number} statusWord
 * @returns {string}
 */
function statusWordName(statusWord) {
  return STATUS_WORD_NAMES.get(statusWord) ?? toHex(statusWord, 4);
}

export { StatusWord, parseResponse, statusWordName };
