import { describe, it } from "node:test";
import assert from "node:assert";
import {
  platformControlCode,
  ControlCode,
  Feature,
  featureName,
  parseFeatures,
  parseFeaturesDetails,
} from "../lib/control-codes.js";

describe("Control Code Constants", () => {
  it("platformControlCode should generate correct control codes", () => {
    const code = platformControlCode(3400);
    assert.strictEqual(typeof code, "number");
    assert(code > 0);
  });

  it("platformControlCode should use Windows formula on win32", () => {
    const saved = /** @type {PropertyDescriptor} */ (
      Object.getOwnPropertyDescriptor(process, "platform")
    );
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      assert.strictEqual(platformControlCode(3400), (0x31 << 16) + (3400 << 2));
    } finally {
      Object.defineProperty(process, "platform", saved);
    }
  });

  it("ControlCode.GET_FEATURE_REQUEST should be defined", () => {
    assert.strictEqual(typeof ControlCode.GET_FEATURE_REQUEST, "number");
    assert(ControlCode.GET_FEATURE_REQUEST > 0);
  });

  it("Feature constants should have correct values", () => {
    assert.strictEqual(Feature.VERIFY_PIN_DIRECT, 0x06);
    assert.strictEqual(Feature.MODIFY_PIN_DIRECT, 0x07);
    assert.strictEqual(Feature.IFD_PIN_PROPERTIES, 0x0a);
    assert.strictEqual(Feature.GET_TLV_PROPERTIES, 0x12);
  });

  it("featureName should resolve known tags", () => {
    assert.strictEqual(featureName(Feature.VERIFY_PIN_DIRECT), "VERIFY_PIN_DIRECT");
    assert.strictEqual(featureName(Feature.GET_TLV_PROPERTIES), "GET_TLV_PROPERTIES");
  });

  it("featureName should hex-format unknown tags", () => {
    assert.strictEqual(featureName(0xff), "0xFF");
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
    assert(features.has(Feature.VERIFY_PIN_DIRECT), "Should have VERIFY_PIN_DIRECT");
    assert.strictEqual(features.get(Feature.VERIFY_PIN_DIRECT), 0x42000d48);
  });

  it("should parse multiple feature TLVs", () => {
    const tlv = Buffer.from([
      0x06, 0x04, 0x42, 0x00, 0x0d, 0x48, 0x07, 0x04, 0x42, 0x00, 0x0d, 0x4c,
    ]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 2, "Should have two features");
    assert.strictEqual(features.get(Feature.VERIFY_PIN_DIRECT), 0x42000d48);
    assert.strictEqual(features.get(Feature.MODIFY_PIN_DIRECT), 0x42000d4c);
  });

  it("should skip TLVs with non-4-byte length", () => {
    const tlv = Buffer.from([0x06, 0x02, 0x00, 0x00, 0x07, 0x04, 0x42, 0x00, 0x0d, 0x4c]);
    const features = parseFeatures(tlv);

    assert.strictEqual(features.size, 1, "Should have one feature (skipped invalid)");
    assert(!features.has(Feature.VERIFY_PIN_DIRECT), "Should not have skipped feature");
    assert(features.has(Feature.MODIFY_PIN_DIRECT), "Should have valid feature");
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

  it("parseFeaturesDetails should include tag names and control codes", () => {
    const tlv = Buffer.from([0x06, 0x04, 0x42, 0x00, 0x0d, 0x48]);
    const details = parseFeaturesDetails(tlv);

    assert.strictEqual(details.length, 1);
    assert.deepStrictEqual(details[0], {
      tag: Feature.VERIFY_PIN_DIRECT,
      name: "VERIFY_PIN_DIRECT",
      controlCode: 0x42000d48,
    });
  });

  it("parseFeaturesDetails should preserve unknown tags with hex names", () => {
    const tlv = Buffer.from([0x99, 0x04, 0x42, 0x00, 0x00, 0x01]);
    const detailed = parseFeaturesDetails(tlv);

    assert.strictEqual(detailed.length, 1);
    assert.strictEqual(detailed[0].tag, 0x99);
    assert.strictEqual(detailed[0].name, "0x99");
    assert.strictEqual(detailed[0].controlCode, 0x42000001);
  });
});
