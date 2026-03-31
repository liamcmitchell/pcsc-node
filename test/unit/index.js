import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createMockNative, responseMap, SCARD_PROTOCOL_T1 } from "../helpers/mock.js";
import { createContext } from "../../lib/context.js";
import {
  PCSCError,
  CardRemovedError,
  TimeoutError,
  NoReadersError,
  ServiceNotRunningError,
  SharingViolationError,
  createPCSCError,
} from "../../lib/errors.js";
import {
  SCARD_CTL_CODE,
  CM_IOCTL_GET_FEATURE_REQUEST,
  FEATURE_VERIFY_PIN_DIRECT,
  FEATURE_MODIFY_PIN_DIRECT,
  FEATURE_IFD_PIN_PROPERTIES,
  FEATURE_GET_TLV_PROPERTIES,
  parseFeatures,
} from "../../lib/control-codes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Context Integration", () => {
  it("should call onReaderAttached callback with reader object", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");
    /** @type {import('../../lib/types.js').Reader[]} */
    const events = [];

    const ctx = createContext({
      _nativeContext: mock,
      onReaderAttached: (reader) => events.push(reader),
    });

    await delay(10);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, "ACR122U");
    assert.strictEqual(typeof events[0].connect, "function");
    assert.strictEqual(typeof events[0].transmit, "function");

    ctx.close();
  });

  it("should call onCardInserted callback with reader object", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b, 0x8f, 0x80, 0x01]),
      onTransmit: responseMap([
        { command: [0xff, 0xca, 0x00, 0x00, 0x00], response: [0x04, 0xa2, 0x90, 0x00] },
      ]),
    });

    /** @type {import('../../lib/types.js').Reader[]} */
    const events = [];

    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => events.push(reader),
    });

    await delay(50);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, "ACR122U");
    assert.strictEqual(events[0].connected, true);

    const response = await events[0].transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
    assert(response.equals(Buffer.from([0x04, 0xa2, 0x90, 0x00])));

    ctx.close();
  });

  it("should call onCardRemoved callback", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    /** @type {string[]} */
    const events = [];

    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: () => events.push("inserted"),
      onCardRemoved: () => events.push("removed"),
    });

    await delay(50);

    mock.removeCard("ACR122U");
    await delay(50);

    assert(events.includes("inserted"));
    assert(events.includes("removed"));

    ctx.close();
  });

  it("should handle multiple readers", async () => {
    const mock = createMockNative();
    mock.attachReader("Reader 1", { atr: Buffer.from([0x3b]) });
    mock.attachReader("Reader 2", { atr: Buffer.from([0x3c]) });

    /** @type {string[]} */
    const readerEvents = [];
    /** @type {string[]} */
    const cardEvents = [];

    const ctx = createContext({
      _nativeContext: mock,
      onReaderAttached: (reader) => readerEvents.push(reader.name),
      onCardInserted: (reader) => cardEvents.push(reader.name),
    });

    await delay(100);

    assert.strictEqual(readerEvents.length, 2);
    assert(readerEvents.includes("Reader 1"));
    assert(readerEvents.includes("Reader 2"));

    assert.strictEqual(cardEvents.length, 2);
    assert(cardEvents.includes("Reader 1"));
    assert(cardEvents.includes("Reader 2"));

    ctx.close();
  });

  it("should call onReaderDetached callback", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");

    /** @type {string[]} */
    const events = [];

    const ctx = createContext({
      _nativeContext: mock,
      onReaderAttached: () => events.push("attached"),
      onReaderDetached: () => events.push("detached"),
    });

    await delay(10);

    mock.detachReader("ACR122U");
    await delay(10);

    assert(events.includes("attached"));
    assert(events.includes("detached"));

    ctx.close();
  });

  it("should track readers in context.readers map", async () => {
    const mock = createMockNative();
    mock.attachReader("Reader 1");
    mock.attachReader("Reader 2");

    const ctx = createContext({ _nativeContext: mock });

    await delay(10);

    assert.strictEqual(ctx.readers.size, 2);
    assert(ctx.readers.has("Reader 1"));
    assert(ctx.readers.has("Reader 2"));
    assert.strictEqual(ctx.readers.get("Reader 1").name, "Reader 1");

    ctx.close();
    assert.strictEqual(ctx.readers.size, 0);
  });

  it("should disconnect cards on close", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await delay(50);

    assert.strictEqual(cardEvents.length, 1);
    assert.strictEqual(cardEvents[0].connected, true);

    ctx.close();

    assert.strictEqual(cardEvents[0].connected, false);
  });

  it("should call onReaderChange for changed events", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");

    /** @type {{ reader: string; prevState: number }[]} */
    const stateChanges = [];

    const ctx = createContext({
      _nativeContext: mock,
      autoConnect: false,
      onReaderChange: (reader, prevState) => stateChanges.push({ reader: reader.name, prevState }),
    });

    await delay(10);

    mock.insertCard("ACR122U", { atr: Buffer.from([0x3b]) });
    await delay(50);

    assert.strictEqual(stateChanges.length, 1);
    assert.strictEqual(stateChanges[0].reader, "ACR122U");

    ctx.close();
  });

  it("should not auto-connect when autoConnect is false", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      _nativeContext: mock,
      autoConnect: false,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await delay(50);

    assert.strictEqual(cardEvents.length, 0);
    assert.strictEqual(ctx.readers.size, 1);

    ctx.close();
  });
});

describe("Protocol Fallback", () => {
  it("should fallback to T=0 when dual protocol fails with unresponsive error", async () => {
    const mock = createMockNative();
    let connectCalls = 0;
    mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onConnect: async (shareMode, protocol) => {
        connectCalls++;
        if (protocol & SCARD_PROTOCOL_T1) throw new Error("Card is unresponsive");
      },
    });

    const cardEvents = [];
    const errors = [];

    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => cardEvents.push(reader),
      onError: (err) => errors.push(err),
    });

    await delay(50);

    assert.strictEqual(connectCalls, 2, "Should have called connect twice");
    assert.strictEqual(errors.length, 0, "Should not emit error");
    assert.strictEqual(cardEvents.length, 1, "Should emit card-inserted event");

    ctx.close();
  });

  it("should rethrow non-unresponsive errors without fallback", async () => {
    const mock = createMockNative();
    mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onConnect: async () => {
        throw new Error("Sharing violation");
      },
    });

    const cardEvents = [];
    const errors = [];

    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => cardEvents.push(reader),
      onError: (err) => errors.push(err),
    });

    await delay(50);

    assert.strictEqual(cardEvents.length, 0, "Should not emit card-inserted event");
    assert.strictEqual(errors.length, 1, "Should emit error");
    assert(
      errors[0].message.includes("Sharing violation"),
      "Error should contain original message",
    );

    ctx.close();
  });
});

describe("Error Classes", () => {
  it("PCSCError should have code property", () => {
    const err = new PCSCError("Test error", 0x80100001);
    assert.strictEqual(err.code, 0x80100001);
    assert.strictEqual(err.name, "PCSCError");
    assert.strictEqual(err.message, "Test error");
  });

  it("CardRemovedError should have correct code", () => {
    const err = new CardRemovedError();
    assert.strictEqual(err.code, 0x80100069);
    assert.strictEqual(err.name, "CardRemovedError");
    assert(err instanceof PCSCError);
  });

  it("TimeoutError should have correct code", () => {
    const err = new TimeoutError();
    assert.strictEqual(err.code, 0x8010000a);
    assert.strictEqual(err.name, "TimeoutError");
    assert(err instanceof PCSCError);
  });

  it("NoReadersError should have correct code", () => {
    const err = new NoReadersError();
    assert.strictEqual(err.code, 0x8010002e);
    assert.strictEqual(err.name, "NoReadersError");
    assert(err instanceof PCSCError);
  });

  it("ServiceNotRunningError should have correct code", () => {
    const err = new ServiceNotRunningError();
    assert.strictEqual(err.code, 0x8010001d);
    assert.strictEqual(err.name, "ServiceNotRunningError");
    assert(err instanceof PCSCError);
  });

  it("SharingViolationError should have correct code", () => {
    const err = new SharingViolationError();
    assert.strictEqual(err.code, 0x8010000b);
    assert.strictEqual(err.name, "SharingViolationError");
    assert(err instanceof PCSCError);
  });

  it("createPCSCError should return CardRemovedError for 0x80100069", () => {
    const err = createPCSCError("Card was removed", 0x80100069);
    assert(err instanceof CardRemovedError);
    assert.strictEqual(err.code, 0x80100069);
  });

  it("createPCSCError should return TimeoutError for 0x8010000A", () => {
    const err = createPCSCError("Timeout", 0x8010000a);
    assert(err instanceof TimeoutError);
    assert.strictEqual(err.code, 0x8010000a);
  });

  it("createPCSCError should return NoReadersError for 0x8010002E", () => {
    const err = createPCSCError("No readers", 0x8010002e);
    assert(err instanceof NoReadersError);
    assert.strictEqual(err.code, 0x8010002e);
  });

  it("createPCSCError should return ServiceNotRunningError for 0x8010001D", () => {
    const err = createPCSCError("Service not running", 0x8010001d);
    assert(err instanceof ServiceNotRunningError);
    assert.strictEqual(err.code, 0x8010001d);
  });

  it("createPCSCError should return SharingViolationError for 0x8010000B", () => {
    const err = createPCSCError("Sharing violation", 0x8010000b);
    assert(err instanceof SharingViolationError);
    assert.strictEqual(err.code, 0x8010000b);
  });

  it("createPCSCError should return PCSCError for unknown codes", () => {
    const err = createPCSCError("Unknown error", 0x80100099);
    assert(err instanceof PCSCError);
    assert(!(err instanceof CardRemovedError));
    assert.strictEqual(err.code, 0x80100099);
  });
});

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

describe("Package Exports", () => {
  const packageJsonPath = resolve(__dirname, "../../package.json");

  it("should have exports field with main and native entries", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    assert(packageJson.exports, "exports field should exist");
    assert.strictEqual(
      packageJson.exports["."],
      "./lib/index.js",
      'exports["."] should point to lib/index.js',
    );
    assert.strictEqual(
      packageJson.exports["./native"],
      "./lib/native.js",
      'exports["./native"] should point to lib/native.js',
    );
  });

  it("should have type: module for ESM", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    assert.strictEqual(packageJson.type, "module", 'type should be "module" for ESM');
  });
});

describe("Auto GET RESPONSE", () => {
  /**
   * @param {Array<{command: number[], response: number[]}>} cardResponses
   * @param {number[]} command
   * @param {import('../../lib/types.js').TransmitOptions} [options]
   */
  async function transmitViaReader(cardResponses, command, options) {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap(cardResponses),
    });
    const cardEvents = [];
    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => cardEvents.push(reader),
    });
    await delay(50);
    const reader = cardEvents[0];
    try {
      return { response: await reader.transmit(command, options), nativeReader };
    } finally {
      ctx.close();
    }
  }

  it("should handle SW1=61 by sending GET RESPONSE", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [
        { command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] },
        {
          command: [0x00, 0xc0, 0x00, 0x00, 0x1c],
          response: [
            0x6f, 0x1a, 0x84, 0x0e, 0x31, 0x50, 0x41, 0x59, 0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44,
            0x44, 0x46, 0x30, 0x31, 0xa5, 0x08, 0x88, 0x01, 0x01, 0x5f, 0x2d, 0x02, 0x65, 0x6e,
            0x90, 0x00,
          ],
        },
      ],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      { autoGetResponse: true },
    );
    assert.strictEqual(nativeReader.transmitCount, 2);
    assert.strictEqual(response.length, 30);
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);
  });

  it("should handle SW1=6C by retrying with correct Le", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [
        { command: [0x00, 0xb2, 0x01, 0x0c, 0x00], response: [0x6c, 0x10] },
        {
          command: [0x00, 0xb2, 0x01, 0x0c, 0x10],
          response: [
            0x70, 0x0e, 0x9f, 0x0a, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x9f,
            0x09, 0x02, 0x90, 0x00,
          ],
        },
      ],
      [0x00, 0xb2, 0x01, 0x0c, 0x00],
      { autoGetResponse: true },
    );
    assert.strictEqual(nativeReader.transmitCount, 2);
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);
  });

  it("should handle chained SW1=61 responses", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [
        { command: [0x00, 0xca, 0x00, 0x00, 0x00], response: [0x61, 0x10] },
        {
          command: [0x00, 0xc0, 0x00, 0x00, 0x10],
          response: [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
            0x0f, 0x10, 0x61, 0x08,
          ],
        },
        {
          command: [0x00, 0xc0, 0x00, 0x00, 0x08],
          response: [0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x90, 0x00],
        },
      ],
      [0x00, 0xca, 0x00, 0x00, 0x00],
      { autoGetResponse: true },
    );
    assert.strictEqual(nativeReader.transmitCount, 3);
    assert.strictEqual(response.length, 26);
    assert.strictEqual(response[0], 0x01);
    assert.strictEqual(response[15], 0x10);
    assert.strictEqual(response[16], 0x11);
    assert.strictEqual(response[23], 0x18);
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);
  });

  it("should pass through normal responses unchanged", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [{ command: [0xff, 0xca, 0x00, 0x00, 0x00], response: [0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00] }],
      [0xff, 0xca, 0x00, 0x00, 0x00],
      { autoGetResponse: true },
    );
    assert.strictEqual(nativeReader.transmitCount, 1);
    assert(response.equals(Buffer.from([0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00])));
  });

  it("should skip handling when autoGetResponse is false", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [{ command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] }],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      { autoGetResponse: false },
    );
    assert.strictEqual(nativeReader.transmitCount, 1);
    assert(response.equals(Buffer.from([0x61, 0x1c])));
  });

  it("should skip handling when autoGetResponse is not specified", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [{ command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] }],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      {},
    );
    assert.strictEqual(nativeReader.transmitCount, 1);
    assert(response.equals(Buffer.from([0x61, 0x1c])));
  });

  it("should pass through error status words", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [{ command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x6a, 0x82] }],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      { autoGetResponse: true },
    );
    assert.strictEqual(nativeReader.transmitCount, 1);
    assert(response.equals(Buffer.from([0x6a, 0x82])));
  });

  it("should handle SW1=6C with empty original Le (4-byte command)", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [
        { command: [0x00, 0xca, 0x9f, 0x17], response: [0x6c, 0x01] },
        { command: [0x00, 0xca, 0x9f, 0x17, 0x01], response: [0x03, 0x90, 0x00] },
      ],
      [0x00, 0xca, 0x9f, 0x17],
      { autoGetResponse: true },
    );
    assert.strictEqual(nativeReader.transmitCount, 2);
    assert(response.equals(Buffer.from([0x03, 0x90, 0x00])));
  });
});

describe("reader.transmit() autoGetResponse option", () => {
  it("should handle SW1=61 when autoGetResponse option is passed to reader.transmit()", async () => {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap([
        { command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] },
        {
          command: [0x00, 0xc0, 0x00, 0x00, 0x1c],
          response: [
            0x6f, 0x1a, 0x84, 0x0e, 0x31, 0x50, 0x41, 0x59, 0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44,
            0x44, 0x46, 0x30, 0x31, 0xa5, 0x08, 0x88, 0x01, 0x01, 0x5f, 0x2d, 0x02, 0x65, 0x6e,
            0x90, 0x00,
          ],
        },
      ]),
    });

    const cardEvents = [];
    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await delay(50);

    assert.strictEqual(cardEvents.length, 1, "Should have card-inserted event");
    const reader = cardEvents[0];

    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e], {
      autoGetResponse: true,
    });

    assert.strictEqual(nativeReader.transmitCount, 2, "Should have sent 2 commands");
    assert.strictEqual(response.length, 30, "Response should be 30 bytes");
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);

    ctx.close();
  });

  it("should handle SW1=6C when autoGetResponse option is passed to reader.transmit()", async () => {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap([
        { command: [0x00, 0xb2, 0x01, 0x0c, 0x00], response: [0x6c, 0x10] },
        {
          command: [0x00, 0xb2, 0x01, 0x0c, 0x10],
          response: [
            0x70, 0x0e, 0x9f, 0x0a, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x9f,
            0x09, 0x02, 0x90, 0x00,
          ],
        },
      ]),
    });

    const cardEvents = [];
    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await delay(50);

    const reader = cardEvents[0];
    const response = await reader.transmit([0x00, 0xb2, 0x01, 0x0c, 0x00], {
      autoGetResponse: true,
    });

    assert.strictEqual(nativeReader.transmitCount, 2, "Should have sent 2 commands");
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);

    ctx.close();
  });

  it("should return raw response when autoGetResponse is not specified", async () => {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap([
        { command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] },
      ]),
    });

    const cardEvents = [];
    const ctx = createContext({
      _nativeContext: mock,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await delay(50);

    const reader = cardEvents[0];
    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e]);

    assert.strictEqual(nativeReader.transmitCount, 1, "Should only transmit once");
    assert(response.equals(Buffer.from([0x61, 0x1c])), "Should return raw response");

    ctx.close();
  });

  it("should auto-handle SW1=61 when context-level autoGetResponse is set", async () => {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap([
        { command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] },
        {
          command: [0x00, 0xc0, 0x00, 0x00, 0x1c],
          response: [
            0x6f, 0x1a, 0x84, 0x0e, 0x31, 0x50, 0x41, 0x59, 0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44,
            0x44, 0x46, 0x30, 0x31, 0xa5, 0x08, 0x88, 0x01, 0x01, 0x5f, 0x2d, 0x02, 0x65, 0x6e,
            0x90, 0x00,
          ],
        },
      ]),
    });

    const cardEvents = [];
    const ctx = createContext({
      _nativeContext: mock,
      autoGetResponse: true,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await delay(50);

    const reader = cardEvents[0];
    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e]);

    assert.strictEqual(nativeReader.transmitCount, 2, "Should have sent 2 commands");
    assert.strictEqual(response.length, 30, "Response should be 30 bytes");
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);

    ctx.close();
  });

  it("per-call autoGetResponse=false should override context-level default", async () => {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap([
        { command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] },
      ]),
    });

    const cardEvents = [];
    const ctx = createContext({
      _nativeContext: mock,
      autoGetResponse: true,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await delay(50);

    const reader = cardEvents[0];
    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e], {
      autoGetResponse: false,
    });

    assert.strictEqual(nativeReader.transmitCount, 1, "Should only transmit once");
    assert(response.equals(Buffer.from([0x61, 0x1c])), "Should return raw response");

    ctx.close();
  });
});
