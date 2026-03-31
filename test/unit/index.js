import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MockCard,
  MockReader,
  MockContext,
  createMockOptions,
  createTestSetup,
  SCARD_PROTOCOL_T1,
} from "../helpers/mock.js";
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

describe("MockCard", () => {
  it("should create a mock card with protocol and ATR", () => {
    const atr = Buffer.from([0x3b, 0x8f, 0x80, 0x01]);
    const card = new MockCard(1, atr);

    assert.strictEqual(card.protocol, 1);
    assert.strictEqual(card.connected, true);
    assert(card.atr.equals(atr));
  });

  it("should disconnect card", () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    assert.strictEqual(card.connected, true);

    card.disconnect();
    assert.strictEqual(card.connected, false);
    assert.strictEqual(card.atr, null);
  });

  it("should transmit APDU and return configured response", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]), [
      {
        command: [0xff, 0xca, 0x00, 0x00, 0x00],
        response: [0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00],
      },
    ]);

    const response = await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
    assert(response.equals(Buffer.from([0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00])));
  });

  it("should return default success for unknown commands", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    const response = await card.transmit([0x00, 0xa4, 0x04, 0x00]);
    assert(response.equals(Buffer.from([0x90, 0x00])));
  });

  it("should throw when transmitting on disconnected card", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    card.disconnect();

    await assert.rejects(async () => card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]), {
      message: "Card is not connected",
    });
  });

  it("should reconnect card async", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    card.disconnect();
    assert.strictEqual(card.connected, false);

    await card.reconnect();
    assert.strictEqual(card.connected, true);
  });

  it("should update protocol after reconnect with different protocol", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    assert.strictEqual(card.protocol, 1);

    card.setReconnectProtocol(2);
    await card.reconnect();

    assert.strictEqual(card.protocol, 2, "card.protocol should be updated after reconnect");
  });

  it("should accept maxRecvLength option in transmit", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00], {
      maxRecvLength: 65536,
    });
    assert.strictEqual(card._lastTransmitOptions.maxRecvLength, 65536);
  });

  it("should use default options when none provided", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
    assert.deepStrictEqual(card._lastTransmitOptions, {});
  });
});

describe("MockReader", () => {
  it("should create reader without card", () => {
    const reader = new MockReader("Test Reader");

    assert.strictEqual(reader.name, "Test Reader");
    assert.strictEqual(reader.atr, null);
    assert.strictEqual(reader.state & 0x20, 0);
  });

  it("should create reader with card", () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    const reader = new MockReader("Test Reader", card);

    assert.strictEqual(reader.name, "Test Reader");
    assert(reader.atr.equals(Buffer.from([0x3b])));
    assert.strictEqual(reader.state & 0x20, 0x20);
  });

  it("should connect to card", async () => {
    const card = new MockCard(1, Buffer.from([0x3b]));
    const reader = new MockReader("Test Reader", card);

    const connectedCard = await reader.connect(2, 3);
    assert.strictEqual(connectedCard, card);
  });

  it("should throw when connecting without card", async () => {
    const reader = new MockReader("Test Reader");

    await assert.rejects(async () => reader.connect(), {
      message: "No card in reader",
    });
  });

  it("should insert and remove cards", () => {
    const reader = new MockReader("Test Reader");
    assert.strictEqual(reader.atr, null);

    const card = new MockCard(1, Buffer.from([0x3b]));
    reader.insertCard(card);
    assert(reader.atr.equals(Buffer.from([0x3b])));

    reader.removeCard();
    assert.strictEqual(reader.atr, null);
  });
});

describe("MockContext", () => {
  it("should create valid context", () => {
    const ctx = new MockContext();
    assert.strictEqual(ctx.isValid, true);
  });

  it("should close context", () => {
    const ctx = new MockContext();
    ctx.close();
    assert.strictEqual(ctx.isValid, false);
  });

  it("should connect to a reader's card", async () => {
    const ctx = new MockContext();
    const card = new MockCard(1, Buffer.from([0x3b]));
    const reader = new MockReader("Reader 1", card);
    ctx.addReader(reader);

    const connectedCard = await ctx.connect("Reader 1");
    assert.strictEqual(connectedCard, card);
  });

  it("should throw when connecting on closed context", async () => {
    const ctx = new MockContext();
    ctx.close();

    await assert.rejects(() => ctx.connect("Reader 1"), {
      message: "Context is not valid",
    });
  });
});

describe("MockContext Monitor", () => {
  it("should start and stop monitoring", () => {
    const context = new MockContext();

    context.startMonitor(() => {});

    context.stopMonitor();
  });

  it("should throw when starting already running monitor", () => {
    const context = new MockContext();
    context.startMonitor(() => {});

    assert.throws(() => context.startMonitor(() => {}), {
      message: "Monitor is already running",
    });

    context.stopMonitor();
  });

  it("should emit attached for existing readers on start", () => {
    const context = new MockContext();
    const reader = new MockReader("Test Reader");
    context.addReader(reader);

    /** @type {{ type: string; reader: string }[]} */
    const events = [];
    context.startMonitor((event) => events.push(event));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "attached");
    assert.strictEqual(events[0].reader, "Test Reader");

    context.stopMonitor();
  });

  it("should emit events when attaching/detaching readers", () => {
    const context = new MockContext();
    /** @type {{ type: string }[]} */
    const events = [];

    context.startMonitor((event) => events.push(event));

    const reader = new MockReader("Test Reader");
    context.attachReader(reader);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "attached");

    context.detachReader("Test Reader");

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].type, "detached");

    context.stopMonitor();
  });

  it("should emit changed events when inserting/removing cards", () => {
    const context = new MockContext();
    /** @type {{ type: string; atr?: Buffer | null }[]} */
    const events = [];

    const reader = new MockReader("Test Reader");
    context.addReader(reader);

    context.startMonitor((event) => events.push(event));
    events.length = 0;

    const card = new MockCard(1, Buffer.from([0x3b, 0x8f]));
    context.insertCard("Test Reader", card);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "changed");
    assert(events[0].atr.equals(Buffer.from([0x3b, 0x8f])));

    context.removeCard("Test Reader");

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].type, "changed");

    context.stopMonitor();
  });
});

describe("createTestSetup Helper", () => {
  it("should create a complete test setup with defaults", () => {
    const setup = createTestSetup();

    assert(setup.create, "Should have create factory");
    assert(setup.context, "Should have context");
    assert(setup.reader, "Should have reader");
    assert(setup.card, "Should have card");
    assert.strictEqual(setup.reader.name, "Test Reader");
  });

  it("should allow custom reader name", () => {
    const setup = createTestSetup({ readerName: "Custom Reader" });
    assert.strictEqual(setup.reader.name, "Custom Reader");
  });

  it("should allow custom card responses", async () => {
    const setup = createTestSetup({
      cardResponses: [
        {
          command: [0xff, 0xca, 0x00, 0x00, 0x00],
          response: [0x01, 0x02, 0x90, 0x00],
        },
      ],
    });

    const response = await setup.card.transmit(Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]));
    assert.deepStrictEqual(response, Buffer.from([0x01, 0x02, 0x90, 0x00]));
  });

  it("should emit events when created", async () => {
    const setup = createTestSetup();
    /** @type {unknown[]} */
    const events = [];

    const ctx = setup.create({
      onReaderAttached: (reader) => events.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(events.length, 1);
    ctx.close();
  });
});

describe("Context Integration", () => {
  it("should call onReaderAttached callback with reader object", async () => {
    const setup = createTestSetup({ readerName: "ACR122U" });
    /** @type {import('../../lib/types.js').Reader[]} */
    const events = [];

    const ctx = setup.create({
      onReaderAttached: (reader) => events.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, "ACR122U");
    assert.strictEqual(typeof events[0].connect, "function");
    assert.strictEqual(typeof events[0].transmit, "function");

    ctx.close();
  });

  it("should call onCardInserted callback with reader object", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f, 0x80, 0x01]), [
      {
        command: [0xff, 0xca, 0x00, 0x00, 0x00],
        response: [0x04, 0xa2, 0x90, 0x00],
      },
    ]);
    const mockReader = new MockReader("ACR122U", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const events = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: (reader) => events.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, "ACR122U");
    assert.strictEqual(events[0].connected, true);

    const response = await events[0].transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
    assert(response.equals(Buffer.from([0x04, 0xa2, 0x90, 0x00])));

    ctx.close();
  });

  it("should call onCardRemoved callback", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b]));
    const mockReader = new MockReader("ACR122U", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {string[]} */
    const events = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: () => events.push("inserted"),
      onCardRemoved: () => events.push("removed"),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    mockContext.removeCard("ACR122U");
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert(events.includes("inserted"));
    assert(events.includes("removed"));

    ctx.close();
  });

  it("should handle multiple readers", async () => {
    const mockContext = new MockContext();

    const reader1 = new MockReader("Reader 1", new MockCard(1, Buffer.from([0x3b])));
    const reader2 = new MockReader("Reader 2", new MockCard(2, Buffer.from([0x3c])));

    mockContext.addReader(reader1);
    mockContext.addReader(reader2);

    /** @type {string[]} */
    const readerEvents = [];
    /** @type {string[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onReaderAttached: (reader) => readerEvents.push(reader.name),
      onCardInserted: (reader) => cardEvents.push(reader.name),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(readerEvents.length, 2);
    assert(readerEvents.includes("Reader 1"));
    assert(readerEvents.includes("Reader 2"));

    assert.strictEqual(cardEvents.length, 2);
    assert(cardEvents.includes("Reader 1"));
    assert(cardEvents.includes("Reader 2"));

    ctx.close();
  });

  it("should call onReaderDetached callback", async () => {
    const mockContext = new MockContext();
    const reader = new MockReader("ACR122U");

    mockContext.addReader(reader);

    /** @type {string[]} */
    const events = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onReaderAttached: () => events.push("attached"),
      onReaderDetached: () => events.push("detached"),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    mockContext.detachReader("ACR122U");
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert(events.includes("attached"));
    assert(events.includes("detached"));

    ctx.close();
  });

  it("should track readers in context.readers map", async () => {
    const mockContext = new MockContext();

    const reader1 = new MockReader("Reader 1");
    const reader2 = new MockReader("Reader 2");
    mockContext.addReader(reader1);
    mockContext.addReader(reader2);

    const ctx = createContext({
      ...createMockOptions(mockContext),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(ctx.readers.size, 2);
    assert(ctx.readers.has("Reader 1"));
    assert(ctx.readers.has("Reader 2"));
    assert.strictEqual(ctx.readers.get("Reader 1").name, "Reader 1");

    ctx.close();
    assert.strictEqual(ctx.readers.size, 0);
  });

  it("should disconnect cards on close", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b]));
    const mockReader = new MockReader("ACR122U", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(cardEvents.length, 1);
    assert.strictEqual(cardEvents[0].connected, true);

    ctx.close();

    assert.strictEqual(cardEvents[0].connected, false);
  });

  it("should call onReaderChange for changed events", async () => {
    const mockContext = new MockContext();
    const mockReader = new MockReader("ACR122U");
    mockContext.addReader(mockReader);

    /** @type {{ reader: string; prevState: number }[]} */
    const stateChanges = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      autoConnect: false,
      onReaderChange: (reader, prevState) => stateChanges.push({ reader: reader.name, prevState }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const card = new MockCard(1, Buffer.from([0x3b]));
    mockContext.insertCard("ACR122U", card);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(stateChanges.length, 1);
    assert.strictEqual(stateChanges[0].reader, "ACR122U");

    ctx.close();
  });

  it("should not auto-connect when autoConnect is false", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b]));
    const mockReader = new MockReader("ACR122U", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      autoConnect: false,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(cardEvents.length, 0);
    assert.strictEqual(ctx.readers.size, 1);

    ctx.close();
  });
});

// https://github.com/tomkp/smartcard/issues/34
describe("Protocol Fallback", () => {
  it("should fallback to T=0 when dual protocol fails with unresponsive error", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
    const mockReader = new MockReader("Test Reader", mockCard);
    let connectCalls = 0;
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    const originalConnect = mockContext.connect.bind(mockContext);
    mockContext.connect = async function connect(readerName, _shareMode, protocol) {
      connectCalls++;
      if (protocol & SCARD_PROTOCOL_T1) {
        throw new Error("Card is unresponsive");
      }
      return originalConnect(readerName, _shareMode, protocol);
    };

    /** @type {unknown[]} */
    const cardEvents = [];
    /** @type {Error[]} */
    const errors = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: (reader) => cardEvents.push(reader),
      onError: (err) => errors.push(err),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(connectCalls, 2, "Should have called connect twice");
    assert.strictEqual(errors.length, 0, "Should not emit error");
    assert.strictEqual(cardEvents.length, 1, "Should emit card-inserted event");

    ctx.close();
  });

  it("should rethrow non-unresponsive errors without fallback", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
    const mockReader = new MockReader("Test Reader", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    mockContext.connect = async function connect() {
      throw new Error("Sharing violation");
    };

    /** @type {unknown[]} */
    const cardEvents = [];
    /** @type {Error[]} */
    const errors = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: (reader) => cardEvents.push(reader),
      onError: (err) => errors.push(err),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

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

// https://github.com/tomkp/smartcard/issues/78
describe("Package Exports (Issue #78)", () => {
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

// https://github.com/tomkp/smartcard/issues/82
describe("Auto GET RESPONSE (Issue #82)", () => {
  /**
   * @param {Array<{command: number[], response: number[]}>} cardResponses
   * @param {number[]} command
   * @param {import('../../lib/types.js').TransmitOptions} [options]
   */
  async function transmitViaReader(cardResponses, command, options) {
    const { create, card } = createTestSetup({ cardResponses });
    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];
    const ctx = create({ onCardInserted: (reader) => cardEvents.push(reader) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reader = cardEvents[0];
    try {
      return { response: await reader.transmit(command, options), card };
    } finally {
      ctx.close();
    }
  }

  it("should handle SW1=61 by sending GET RESPONSE", async () => {
    const { response, card } = await transmitViaReader(
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
    assert.strictEqual(card.transmitCount, 2);
    assert.strictEqual(response.length, 30);
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);
  });

  it("should handle SW1=6C by retrying with correct Le", async () => {
    const { response, card } = await transmitViaReader(
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
    assert.strictEqual(card.transmitCount, 2);
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);
  });

  it("should handle chained SW1=61 responses", async () => {
    const { response, card } = await transmitViaReader(
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
    assert.strictEqual(card.transmitCount, 3);
    assert.strictEqual(response.length, 26);
    assert.strictEqual(response[0], 0x01);
    assert.strictEqual(response[15], 0x10);
    assert.strictEqual(response[16], 0x11);
    assert.strictEqual(response[23], 0x18);
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);
  });

  it("should pass through normal responses unchanged", async () => {
    const { response, card } = await transmitViaReader(
      [{ command: [0xff, 0xca, 0x00, 0x00, 0x00], response: [0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00] }],
      [0xff, 0xca, 0x00, 0x00, 0x00],
      { autoGetResponse: true },
    );
    assert.strictEqual(card.transmitCount, 1);
    assert(response.equals(Buffer.from([0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00])));
  });

  it("should skip handling when autoGetResponse is false", async () => {
    const { response, card } = await transmitViaReader(
      [{ command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] }],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      { autoGetResponse: false },
    );
    assert.strictEqual(card.transmitCount, 1);
    assert(response.equals(Buffer.from([0x61, 0x1c])));
  });

  it("should skip handling when autoGetResponse is not specified", async () => {
    const { response, card } = await transmitViaReader(
      [{ command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] }],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      {},
    );
    assert.strictEqual(card.transmitCount, 1);
    assert(response.equals(Buffer.from([0x61, 0x1c])));
  });

  it("should pass through error status words", async () => {
    const { response, card } = await transmitViaReader(
      [{ command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x6a, 0x82] }],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      { autoGetResponse: true },
    );
    assert.strictEqual(card.transmitCount, 1);
    assert(response.equals(Buffer.from([0x6a, 0x82])));
  });

  it("should handle SW1=6C with empty original Le (4-byte command)", async () => {
    const { response, card } = await transmitViaReader(
      [
        { command: [0x00, 0xca, 0x9f, 0x17], response: [0x6c, 0x01] },
        { command: [0x00, 0xca, 0x9f, 0x17, 0x01], response: [0x03, 0x90, 0x00] },
      ],
      [0x00, 0xca, 0x9f, 0x17],
      { autoGetResponse: true },
    );
    assert.strictEqual(card.transmitCount, 2);
    assert(response.equals(Buffer.from([0x03, 0x90, 0x00])));
  });
});

// https://github.com/tomkp/smartcard/issues/105
describe("reader.transmit() autoGetResponse option (Issue #105)", () => {
  it("should handle SW1=61 when autoGetResponse option is passed to reader.transmit()", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
      {
        command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
        response: [0x61, 0x1c],
      },
      {
        command: [0x00, 0xc0, 0x00, 0x00, 0x1c],
        response: [
          0x6f, 0x1a, 0x84, 0x0e, 0x31, 0x50, 0x41, 0x59, 0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44, 0x44,
          0x46, 0x30, 0x31, 0xa5, 0x08, 0x88, 0x01, 0x01, 0x5f, 0x2d, 0x02, 0x65, 0x6e, 0x90, 0x00,
        ],
      },
    ]);
    const mockReader = new MockReader("Test Reader", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(cardEvents.length, 1, "Should have card-inserted event");
    const reader = cardEvents[0];

    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e], {
      autoGetResponse: true,
    });

    assert.strictEqual(mockCard.transmitCount, 2, "Should have sent 2 commands");
    assert.strictEqual(response.length, 30, "Response should be 30 bytes");
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);

    ctx.close();
  });

  it("should handle SW1=6C when autoGetResponse option is passed to reader.transmit()", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
      {
        command: [0x00, 0xb2, 0x01, 0x0c, 0x00],
        response: [0x6c, 0x10],
      },
      {
        command: [0x00, 0xb2, 0x01, 0x0c, 0x10],
        response: [
          0x70, 0x0e, 0x9f, 0x0a, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x9f, 0x09,
          0x02, 0x90, 0x00,
        ],
      },
    ]);
    const mockReader = new MockReader("Test Reader", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const reader = cardEvents[0];

    const response = await reader.transmit([0x00, 0xb2, 0x01, 0x0c, 0x00], {
      autoGetResponse: true,
    });

    assert.strictEqual(mockCard.transmitCount, 2, "Should have sent 2 commands");
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);

    ctx.close();
  });

  it("should return raw response when autoGetResponse is not specified", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
      {
        command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
        response: [0x61, 0x1c],
      },
    ]);
    const mockReader = new MockReader("Test Reader", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const reader = cardEvents[0];

    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e]);

    assert.strictEqual(mockCard.transmitCount, 1, "Should only transmit once");
    assert(response.equals(Buffer.from([0x61, 0x1c])), "Should return raw response");

    ctx.close();
  });

  it("should auto-handle SW1=61 when context-level autoGetResponse is set", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
      {
        command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
        response: [0x61, 0x1c],
      },
      {
        command: [0x00, 0xc0, 0x00, 0x00, 0x1c],
        response: [
          0x6f, 0x1a, 0x84, 0x0e, 0x31, 0x50, 0x41, 0x59, 0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44, 0x44,
          0x46, 0x30, 0x31, 0xa5, 0x08, 0x88, 0x01, 0x01, 0x5f, 0x2d, 0x02, 0x65, 0x6e, 0x90, 0x00,
        ],
      },
    ]);
    const mockReader = new MockReader("Test Reader", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      autoGetResponse: true,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const reader = cardEvents[0];

    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e]);

    assert.strictEqual(mockCard.transmitCount, 2, "Should have sent 2 commands");
    assert.strictEqual(response.length, 30, "Response should be 30 bytes");
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);

    ctx.close();
  });

  it("per-call autoGetResponse=false should override context-level default", async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
      {
        command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
        response: [0x61, 0x1c],
      },
    ]);
    const mockReader = new MockReader("Test Reader", mockCard);
    const mockContext = new MockContext();

    mockContext.addReader(mockReader);

    /** @type {import('../../lib/types.js').Reader[]} */
    const cardEvents = [];

    const ctx = createContext({
      ...createMockOptions(mockContext),
      autoGetResponse: true,
      onCardInserted: (reader) => cardEvents.push(reader),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const reader = cardEvents[0];

    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e], {
      autoGetResponse: false,
    });

    assert.strictEqual(mockCard.transmitCount, 1, "Should only transmit once");
    assert(response.equals(Buffer.from([0x61, 0x1c])), "Should return raw response");

    ctx.close();
  });
});
