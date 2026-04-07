/**
 * Control codes and feature constants for PC/SC smart card operations
 */

import { toHex } from "./hex.js";

/**
 * Generate a control code (platform-specific)
 * @param {number} code
 * @returns {number}
 */
function platformControlCode(code) {
  if (process.platform === "win32") {
    // Windows: (FILE_DEVICE_SMARTCARD << 16) + (code << 2)
    // FILE_DEVICE_SMARTCARD = 0x31
    return (0x31 << 16) + (code << 2);
  } else {
    // macOS/Linux: 0x42000000 + code
    return 0x42000000 + code;
  }
}

// Common control codes
const ControlCode = Object.freeze({
  GET_FEATURE_REQUEST: platformControlCode(3400),
});

/**
 * Parse feature TLV response from ControlCode.GET_FEATURE_REQUEST
 * @param {Buffer} response
 * @returns {Map<number, number>}
 */
function parseFeatures(response) {
  const features = new Map();
  let offset = 0;

  while (offset + 2 <= response.length) {
    const tag = response[offset];
    const length = response[offset + 1];

    // Validate length doesn't exceed remaining buffer
    if (offset + 2 + length > response.length) {
      break;
    }

    if (length === 4) {
      // Big-endian control code
      const controlCode =
        (response[offset + 2] << 24) |
        (response[offset + 3] << 16) |
        (response[offset + 4] << 8) |
        response[offset + 5];
      features.set(tag, controlCode);
    }

    offset += 2 + length;
  }

  return features;
}

/** CCID feature tag constants (from CCID spec), grouped for namespace import. */
const Feature = Object.freeze({
  VERIFY_PIN_START: 0x01,
  VERIFY_PIN_FINISH: 0x02,
  MODIFY_PIN_START: 0x03,
  MODIFY_PIN_FINISH: 0x04,
  GET_KEY_PRESSED: 0x05,
  VERIFY_PIN_DIRECT: 0x06,
  MODIFY_PIN_DIRECT: 0x07,
  MCT_READER_DIRECT: 0x08,
  MCT_UNIVERSAL: 0x09,
  IFD_PIN_PROPERTIES: 0x0a,
  ABORT: 0x0b,
  SET_SPE_MESSAGE: 0x0c,
  VERIFY_PIN_DIRECT_APP_ID: 0x0d,
  MODIFY_PIN_DIRECT_APP_ID: 0x0e,
  WRITE_DISPLAY: 0x0f,
  GET_KEY: 0x10,
  IFD_DISPLAY_PROPERTIES: 0x11,
  GET_TLV_PROPERTIES: 0x12,
  CCID_ESC_COMMAND: 0x13,
});

/** @type {Map<number, string>} */
const FEATURE_NAMES = new Map(Object.entries(Feature).map(([name, value]) => [value, name]));

/**
 * Resolve a feature tag to its symbolic name.
 * @param {number} tag
 * @returns {string}
 */
function featureName(tag) {
  return FEATURE_NAMES.get(tag) ?? toHex(tag, 2);
}

/**
 * Parse feature TLV response and include symbolic names for debug output.
 * @param {Buffer} response
 * @returns {Array<{ tag: number; name: string; controlCode: number }>}
 */
function parseFeaturesDetails(response) {
  return [...parseFeatures(response).entries()].map(([tag, controlCode]) => ({
    tag,
    name: featureName(tag),
    controlCode,
  }));
}

export {
  platformControlCode,
  ControlCode,
  Feature,
  featureName,
  parseFeatures,
  parseFeaturesDetails,
};
