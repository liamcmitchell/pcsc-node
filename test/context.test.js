import { describe, it } from "node:test";
import assert from "node:assert";
import { createMockNative, responseMap } from "./context.helpers.js";
import {
  SCARD_PROTOCOL_T1,
  SCARD_W_UNRESPONSIVE_CARD,
  SCARD_E_SHARING_VIOLATION,
} from "../lib/native.js";
import { Context } from "../lib/context.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startContext(options = {}) {
  const ctx = new Context(options);
  for (const eventName of ["reader", "attach", "detach", "change", "insert", "remove", "error"]) {
    const listener = options[eventName];
    if (listener) {
      ctx.on(eventName, listener);
    }
  }
  return ctx.start();
}

describe("Context Integration", () => {
  it("should call attach callback with reader object", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");
    /** @type {import('../lib/reader.js').Reader[]} */
    const events = [];

    const ctx = startContext({
      _nativeContext: mock,
      attach: (reader) => events.push(reader),
    });

    await delay(0);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, "ACR122U");
    assert.strictEqual(typeof events[0].connect, "function");
    assert.strictEqual(typeof events[0].transmit, "function");

    ctx.close();
  });

  it("should emit reader once and before attach for each reader instance", async () => {
    const mock = createMockNative();
    const sequence = [];
    const readerEvents = [];
    const attachEvents = [];

    const ctx = startContext({
      _nativeContext: mock,
      reader: (reader) => {
        sequence.push(`reader:${reader.name}`);
        readerEvents.push(reader);
      },
      attach: (reader) => {
        sequence.push(`attach:${reader.name}`);
        attachEvents.push(reader);
      },
    });

    mock.attachReader("ACR122U");
    await delay(0);
    mock.detachReader("ACR122U");
    await delay(0);
    mock.attachReader("ACR122U");
    await delay(0);

    assert.strictEqual(readerEvents.length, 1);
    assert.strictEqual(attachEvents.length, 2);
    assert.strictEqual(readerEvents[0], attachEvents[0]);
    assert.strictEqual(attachEvents[0], attachEvents[1]);
    assert.deepStrictEqual(sequence, ["reader:ACR122U", "attach:ACR122U", "attach:ACR122U"]);

    ctx.close();
  });

  it("should call insert callback with reader object", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b, 0x8f, 0x80, 0x01]),
      onTransmit: responseMap([
        { command: [0xff, 0xca, 0x00, 0x00, 0x00], response: [0x04, 0xa2, 0x90, 0x00] },
      ]),
    });

    /** @type {import('../lib/reader.js').Reader[]} */
    const events = [];

    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => events.push(reader),
    });

    await delay(0);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].name, "ACR122U");
    assert.strictEqual(events[0].connected, true);

    const response = await events[0].transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
    assert(response.equals(Buffer.from([0x04, 0xa2, 0x90, 0x00])));

    ctx.close();
  });

  it("should call remove callback", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    /** @type {string[]} */
    const events = [];

    const ctx = startContext({
      _nativeContext: mock,
      insert: () => events.push("inserted"),
      remove: () => events.push("removed"),
    });

    await delay(0);

    mock.removeCard("ACR122U");
    await delay(0);

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

    const ctx = startContext({
      _nativeContext: mock,
      attach: (reader) => readerEvents.push(reader.name),
      insert: (reader) => cardEvents.push(reader.name),
    });

    await delay(0);

    assert.strictEqual(readerEvents.length, 2);
    assert(readerEvents.includes("Reader 1"));
    assert(readerEvents.includes("Reader 2"));

    assert.strictEqual(cardEvents.length, 2);
    assert(cardEvents.includes("Reader 1"));
    assert(cardEvents.includes("Reader 2"));

    ctx.close();
  });

  it("should call detach callback", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");

    /** @type {string[]} */
    const events = [];

    const ctx = startContext({
      _nativeContext: mock,
      attach: () => events.push("attached"),
      detach: () => events.push("detached"),
    });

    await delay(0);

    mock.detachReader("ACR122U");
    await delay(0);

    assert(events.includes("attached"));
    assert(events.includes("detached"));

    ctx.close();
  });

  it("should continue processing events when a listener throws", async () => {
    const mock = createMockNative();
    const events = [];

    const ctx = startContext({
      _nativeContext: mock,
      attach: () => {
        events.push("attach");
        throw new Error("attach failed");
      },
      detach: () => {
        events.push("detach");
      },
      error: (err) => {
        events.push(`error:${err.message}`);
      },
    });

    mock.attachReader("ACR122U");
    await delay(0);
    mock.detachReader("ACR122U");
    await delay(0);

    assert(events.includes("attach"));
    assert(events.some((event) => event.startsWith("error:attach failed")));
    assert(events.includes("detach"));

    ctx.close();
  });

  it("should reuse the same reader object when detached and reattached", async () => {
    const mock = createMockNative();
    const attached = [];
    const readerAttachEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      attach: (reader) => {
        attached.push(reader);
        if (attached.length === 1) {
          reader.on("attach", (r) => readerAttachEvents.push(r));
        }
      },
    });

    mock.attachReader("ACR122U");
    await delay(0);
    mock.detachReader("ACR122U");
    await delay(0);
    mock.attachReader("ACR122U");
    await delay(0);

    assert.strictEqual(attached.length, 2);
    assert.strictEqual(attached[0], attached[1]);
    assert.strictEqual(ctx.readers.get("ACR122U"), attached[0]);
    assert.strictEqual(readerAttachEvents.length, 2);
    assert.strictEqual(readerAttachEvents[0], attached[0]);
    assert.strictEqual(readerAttachEvents[1], attached[0]);

    ctx.close();
  });

  it("should track readers in context.readers map", async () => {
    const mock = createMockNative();
    mock.attachReader("Reader 1");
    mock.attachReader("Reader 2");

    const ctx = startContext({ _nativeContext: mock });

    await delay(0);

    assert.strictEqual(ctx.readers.size, 2);
    assert(ctx.readers.has("Reader 1"));
    assert(ctx.readers.has("Reader 2"));
    assert.strictEqual(ctx.readers.get("Reader 1").name, "Reader 1");

    ctx.close();
    assert.strictEqual(ctx.readers.size, 0);
  });

  it("should keep readers empty immediately after start", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");

    const ctx = new Context({ _nativeContext: mock });
    ctx.start();

    assert.strictEqual(ctx.readers.size, 0);

    await ctx.getReaders();
    assert.strictEqual(ctx.readers.size, 1);

    ctx.close();
  });

  it("getReaders should auto-start monitoring", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");

    const ctx = new Context({ _nativeContext: mock, autoConnect: false });
    const readers = await ctx.getReaders();

    assert.strictEqual(readers.size, 1);
    assert.strictEqual(readers.get("ACR122U")?.name, "ACR122U");

    ctx.close();
  });

  it("should disconnect cards on close", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    /** @type {import('../lib/reader.js').Reader[]} */
    const cardEvents = [];

    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    assert.strictEqual(cardEvents.length, 1);
    assert.strictEqual(cardEvents[0].connected, true);

    ctx.close();

    assert.strictEqual(cardEvents[0].connected, false);
  });

  it("should call change for changed events", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");

    /** @type {{ reader: string; prevState: number }[]} */
    const stateChanges = [];

    const ctx = startContext({
      _nativeContext: mock,
      autoConnect: false,
      change: (reader, prevState) => stateChanges.push({ reader: reader.name, prevState }),
    });

    await delay(0);

    mock.insertCard("ACR122U", { atr: Buffer.from([0x3b]) });
    await delay(0);

    assert.strictEqual(stateChanges.length, 1);
    assert.strictEqual(stateChanges[0].reader, "ACR122U");

    ctx.close();
  });

  it("should fire insert but not connect when autoConnect is false", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    /** @type {import('../lib/reader.js').Reader[]} */
    const cardEvents = [];

    const ctx = startContext({
      _nativeContext: mock,
      autoConnect: false,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    assert.strictEqual(cardEvents.length, 1);
    assert.strictEqual(cardEvents[0].connected, false);
    assert.strictEqual(ctx.readers.size, 1);

    ctx.close();
  });

  it("getReaders should include initial auto-connect", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    const ctx = new Context({ _nativeContext: mock });
    const readers = await ctx.start().getReaders();

    assert.strictEqual(readers.size, 1);
    assert.strictEqual(readers.get("ACR122U")?.connected, true);

    ctx.close();
  });

  it("getReaders should resolve with initial readers when autoConnect is false", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });

    const ctx = new Context({ _nativeContext: mock, autoConnect: false });
    const readers = await ctx.start().getReaders();

    assert.strictEqual(readers.size, 1);
    assert.strictEqual(readers.get("ACR122U")?.connected, false);

    ctx.close();
  });

  it("should expose reader.protocol after connect", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]), protocol: SCARD_PROTOCOL_T1 });
    const cardEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    assert.strictEqual(cardEvents[0].protocol, SCARD_PROTOCOL_T1);
    ctx.close();
  });

  it("should call reader.control() when connected", async () => {
    const mock = createMockNative();
    let controlArgs;
    mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b]),
      onControl: async (code, data) => {
        controlArgs = { code, data };
        return Buffer.from([0x90, 0x00]);
      },
    });
    const cardEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    const result = await cardEvents[0].control(0x1234, Buffer.from([0x01]));
    assert.strictEqual(controlArgs.code, 0x1234);
    assert(result.equals(Buffer.from([0x90, 0x00])));
    ctx.close();
  });

  it("should throw from reader.control() when not connected", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");
    let reader;
    const ctx = startContext({
      _nativeContext: mock,
      attach: (r) => {
        reader = r;
      },
    });

    await delay(0);

    await assert.rejects(() => reader.control(0x1234), /Not connected/);
    ctx.close();
  });

  it("should call reader.reconnect() when connected", async () => {
    const mock = createMockNative();
    let reconnectCalled = false;
    mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b]),
      onReconnect: async () => {
        reconnectCalled = true;
      },
    });
    const cardEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    await cardEvents[0].reconnect();
    assert(reconnectCalled);
    ctx.close();
  });

  it("should throw from reader.reconnect() when not connected", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");
    let reader;
    const ctx = startContext({
      _nativeContext: mock,
      attach: (r) => {
        reader = r;
      },
    });

    await delay(0);

    await assert.rejects(() => reader.reconnect(), /Not connected/);
    ctx.close();
  });

  it("should not throw from reader.disconnect() when already disconnected", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");
    let reader;
    const ctx = startContext({
      _nativeContext: mock,
      attach: (r) => {
        reader = r;
      },
    });

    await delay(0);

    assert.doesNotThrow(() => reader.disconnect());
    ctx.close();
  });

  it("should emit remove when reader with connected card is detached", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", { atr: Buffer.from([0x3b]) });
    const events = [];
    const ctx = startContext({
      _nativeContext: mock,
      remove: () => events.push("removed"),
      detach: () => events.push("detached"),
    });

    await delay(0);

    mock.detachReader("ACR122U");
    await delay(0);

    assert.deepStrictEqual(events, ["removed", "detached"]);
    ctx.close();
  });

  it("should call error for error monitor events", async () => {
    const mock = createMockNative();
    const errors = [];
    const ctx = startContext({
      _nativeContext: mock,
      error: (err) => errors.push(err),
    });

    mock.emitError("Something went wrong");
    await delay(0);

    assert.strictEqual(errors.length, 1);
    assert(errors[0].message.includes("Something went wrong"));
    ctx.close();
  });

  it("should not throw from close() if reader.disconnect() throws", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b]),
      onDisconnect: () => {
        throw new Error("Disconnect failed");
      },
    });
    const cardEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    assert.strictEqual(cardEvents[0].connected, true);
    assert.doesNotThrow(() => ctx.close());
  });

  it("should not throw from close() if nativeContext.close() throws", async () => {
    const mock = createMockNative();
    mock.close = () => {
      throw new Error("Close failed");
    };
    const ctx = startContext({ _nativeContext: mock });
    assert.doesNotThrow(() => ctx.close());
  });

  it("should expose isValid on context", async () => {
    const mock = createMockNative();
    const ctx = startContext({ _nativeContext: mock });
    assert.strictEqual(ctx.isValid, true);
    ctx.close();
    assert.strictEqual(ctx.isValid, false);
  });

  it("should not throw from close() if stopMonitor() throws", async () => {
    const mock = createMockNative();
    mock.stopMonitor = () => {
      throw new Error("Stop failed");
    };
    const ctx = startContext({ _nativeContext: mock });
    assert.doesNotThrow(() => ctx.close());
  });

  it("should swallow disconnect errors when reader is detached while connected", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b]),
      onDisconnect: () => {
        throw new Error("Disconnect failed");
      },
    });
    const events = [];
    const ctx = startContext({
      _nativeContext: mock,
      remove: () => events.push("removed"),
      detach: () => events.push("detached"),
    });

    await delay(0);

    mock.detachReader("ACR122U");
    await delay(0);

    assert.deepStrictEqual(events, ["removed", "detached"]);
    ctx.close();
  });

  it("should ignore changed event for unknown reader", async () => {
    const mock = createMockNative();
    const ctx = startContext({ _nativeContext: mock });

    // Emit a changed event for a reader name never attached
    mock.emitChanged("Ghost Reader", 0x02, null);
    await delay(0);

    assert.strictEqual(ctx.readers.size, 0);
    ctx.close();
  });

  it("should throw from reader.transmit() when not connected", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U");
    let reader;
    const ctx = startContext({
      _nativeContext: mock,
      attach: (r) => {
        reader = r;
      },
    });

    await delay(0);

    await assert.rejects(() => reader.transmit([0xff, 0xca, 0x00, 0x00, 0x00]), /Not connected/);
    ctx.close();
  });

  it("should handle Buffer command with autoGetResponse", async () => {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b]),
      onTransmit: responseMap([
        { command: [0xff, 0xca, 0x00, 0x00, 0x00], response: [0x01, 0x90, 0x00] },
      ]),
    });
    const cardEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    const cmd = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
    const response = await cardEvents[0].transmit(cmd, { autoGetResponse: true });
    assert.strictEqual(nativeReader.transmitCount, 1);
    assert(response.equals(Buffer.from([0x01, 0x90, 0x00])));
    ctx.close();
  });

  it("should swallow disconnect errors when card is removed while connected", async () => {
    const mock = createMockNative();
    mock.attachReader("ACR122U", {
      atr: Buffer.from([0x3b]),
      onDisconnect: () => {
        throw new Error("Disconnect failed");
      },
    });
    const events = [];
    const ctx = startContext({
      _nativeContext: mock,
      remove: () => events.push("removed"),
    });

    await delay(0);

    mock.removeCard("ACR122U");
    await delay(0);

    assert.deepStrictEqual(events, ["removed"]);
    ctx.close();
  });
});

describe("Protocol Fallback", () => {
  it("should fallback to T=0 when dual protocol fails with unresponsive code", async () => {
    const mock = createMockNative();
    let connectCalls = 0;
    mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onConnect: async (shareMode, protocol) => {
        connectCalls++;
        if (protocol & SCARD_PROTOCOL_T1) {
          const error = new Error("Card failed initial protocol negotiation");
          error.code = SCARD_W_UNRESPONSIVE_CARD;
          throw error;
        }
      },
    });

    const cardEvents = [];
    const errors = [];

    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
      error: (err) => errors.push(err),
    });

    await delay(0);

    assert.strictEqual(connectCalls, 2, "Should have called connect twice");
    assert.strictEqual(errors.length, 0, "Should not emit error");
    assert.strictEqual(cardEvents.length, 1, "Should emit card-inserted event");

    ctx.close();
  });

  it("should rethrow non-unresponsive codes without fallback", async () => {
    const mock = createMockNative();
    mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onConnect: async () => {
        const error = new Error("Sharing violation");
        error.code = SCARD_E_SHARING_VIOLATION;
        throw error;
      },
    });

    const cardEvents = [];
    const errors = [];

    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
      error: (err) => errors.push(err),
    });

    await delay(0);

    assert.strictEqual(cardEvents.length, 0, "Should not emit card-inserted event");
    assert.strictEqual(errors.length, 1, "Should emit error");
    assert.strictEqual(errors[0].code, SCARD_E_SHARING_VIOLATION);
    assert(
      errors[0].message.includes("Sharing violation"),
      "Error should contain original message",
    );

    ctx.close();
  });
});

describe("Auto GET RESPONSE", () => {
  /**
   * @param {Array<{command: number[], response: number[]}>} cardResponses
   * @param {number[]} command
   * @param {import('../lib/reader.js').TransmitOptions} [options]
   */
  async function transmitViaReader(cardResponses, command, options) {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap(cardResponses),
    });
    const cardEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });
    await delay(0);
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

  it("should handle SW1=61 when autoGetResponse is not specified", async () => {
    const { response, nativeReader } = await transmitViaReader(
      [
        { command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] },
        { command: [0x00, 0xc0, 0x00, 0x00, 0x1c], response: [0x90, 0x00] },
      ],
      [0x00, 0xa4, 0x04, 0x00, 0x0e],
      {},
    );
    assert.strictEqual(nativeReader.transmitCount, 2);
    assert(response.equals(Buffer.from([0x90, 0x00])));
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
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

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
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    const reader = cardEvents[0];
    const response = await reader.transmit([0x00, 0xb2, 0x01, 0x0c, 0x00], {
      autoGetResponse: true,
    });

    assert.strictEqual(nativeReader.transmitCount, 2, "Should have sent 2 commands");
    assert.strictEqual(response[response.length - 2], 0x90);
    assert.strictEqual(response[response.length - 1], 0x00);

    ctx.close();
  });

  it("should auto-handle SW1=61 when autoGetResponse is not specified", async () => {
    const mock = createMockNative();
    const nativeReader = mock.attachReader("Test Reader", {
      atr: Buffer.from([0x3b, 0x8f]),
      onTransmit: responseMap([
        { command: [0x00, 0xa4, 0x04, 0x00, 0x0e], response: [0x61, 0x1c] },
        { command: [0x00, 0xc0, 0x00, 0x00, 0x1c], response: [0x90, 0x00] },
      ]),
    });

    const cardEvents = [];
    const ctx = startContext({
      _nativeContext: mock,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    const reader = cardEvents[0];
    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e]);

    assert.strictEqual(nativeReader.transmitCount, 2, "Should have sent 2 commands");
    assert(response.equals(Buffer.from([0x90, 0x00])), "Should return handled response");

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
    const ctx = startContext({
      _nativeContext: mock,
      autoGetResponse: true,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

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
    const ctx = startContext({
      _nativeContext: mock,
      autoGetResponse: true,
      insert: (reader) => cardEvents.push(reader),
    });

    await delay(0);

    const reader = cardEvents[0];
    const response = await reader.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e], {
      autoGetResponse: false,
    });

    assert.strictEqual(nativeReader.transmitCount, 1, "Should only transmit once");
    assert(response.equals(Buffer.from([0x61, 0x1c])), "Should return raw response");

    ctx.close();
  });
});
