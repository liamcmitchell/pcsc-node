import { describe, it } from "node:test";
import assert from "node:assert";
import {
  SCARD_CTL_CODE,
  CM_IOCTL_GET_FEATURE_REQUEST,
  FEATURE_VERIFY_PIN_DIRECT,
  FEATURE_MODIFY_PIN_DIRECT,
  FEATURE_IFD_PIN_PROPERTIES,
  FEATURE_GET_TLV_PROPERTIES,
  parseFeatures,
} from "../lib/control-codes.js";

describe("Control Code Constants", () => {
  it("SCARD_CTL_CODE should generate correct control codes", () => {
    const code = SCARD_CTL_CODE(3400);
    assert.strictEqual(typeof code, "number");
    assert(code > 0);
  });

  it("CM_IOCTL_GET_FEATURE_REQUEST should be defined", () => {
    assert.strictEqual(typeof CM_IOCTL_GET_FEATURE_REQUEST, "number");
    assert(CM_IOCTL_GET_FEATURE_REQUEST > 0);
  });

  it("FEATURE constants should have correct values", () => {
    assert.strictEqual(FEATURE_VERIFY_PIN_DIRECT, 0x06);
    assert.strictEqual(FEATURE_MODIFY_PIN_DIRECT, 0x07);
    assert.strictEqual(FEATURE_IFD_PIN_PROPERTIES, 0x0a);
    assert.strictEqual(FEATURE_GET_TLV_PROPERTIES, 0x12);
  });
});

describe("parseFeatures", () => {
  it("should return empty map for empty buffer", () => {
    const features = parseFeatures(Buffer.alloc(0));
    assert(features instanceof Map, "Should return a Map");
    assert.strictEqual(features.size, 0, "Map should be empty");
  });

  it("should parse single feature TLV", () => {
    const tlv = Buffer.from([0x06, 0x04, 0x42, 0x00, 0x0d, 0x48]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 1, "Should have one feature");
    assert(features.has(FEATURE_VERIFY_PIN_DIRECT), "Should have VERIFY_PIN_DIRECT");
    assert.strictEqual(features.get(FEATURE_VERIFY_PIN_DIRECT), 0x42000d48);
  });

  it("should parse multiple feature TLVs", () => {
    const tlv = Buffer.from([
      0x06, 0x04, 0x42, 0x00, 0x0d, 0x48, 0x07, 0x04, 0x42, 0x00, 0x0d, 0x4c,
    ]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 2, "Should have two features");
    assert.strictEqual(features.get(FEATURE_VERIFY_PIN_DIRECT), 0x42000d48);
    assert.strictEqual(features.get(FEATURE_MODIFY_PIN_DIRECT), 0x42000d4c);
  });

  it("should skip TLVs with non-4-byte length", () => {
    const tlv = Buffer.from([0x06, 0x02, 0x00, 0x00, 0x07, 0x04, 0x42, 0x00, 0x0d, 0x4c]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 1, "Should have one feature (skipped invalid)");
    assert(!features.has(FEATURE_VERIFY_PIN_DIRECT), "Should not have skipped feature");
    assert(features.has(FEATURE_MODIFY_PIN_DIRECT), "Should have valid feature");
  });

  it("should handle truncated buffer gracefully", () => {
    const tlv = Buffer.from([0x06, 0x04, 0x42]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 0, "Should return empty map for truncated buffer");
  });

  it("should handle buffer shorter than minimum TLV", () => {
    const tlv = Buffer.from([0x06, 0x04]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 0, "Should return empty map");
  });

  it("should parse real-world CCID response", () => {
    const tlv = Buffer.from([
      0x06, 0x04, 0x42, 0x33, 0x00, 0x06, 0x07, 0x04, 0x42, 0x33, 0x00, 0x07, 0x0a, 0x04, 0x42,
      0x33, 0x00, 0x0a, 0x12, 0x04, 0x42, 0x33, 0x00, 0x12,
    ]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 4, "Should have 4 features");
    assert.strictEqual(features.get(0x06), 0x42330006);
    assert.strictEqual(features.get(0x07), 0x42330007);
    assert.strictEqual(features.get(0x0a), 0x4233000a);
    assert.strictEqual(features.get(0x12), 0x42330012);
  });

  it("should not read beyond buffer with malformed length field", () => {
    const tlv = Buffer.from([0x06, 0xff, 0x42, 0x00, 0x0d, 0x48]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 0, "Should return empty map for malformed length");
  });

  it("should handle length that exactly exceeds remaining bytes", () => {
    const tlv = Buffer.from([0x06, 0x06, 0x42, 0x00, 0x0d, 0x48]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 0, "Should skip non-4 length entries");
  });
});
