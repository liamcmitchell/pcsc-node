/**
 * Mock PC/SC implementation for testing without hardware
 */

import { createClient } from "../../lib/client.js";

/** @typedef {import('../../lib/types.js').Card} Card */
/** @typedef {import('../../lib/types.js').CardStatus} CardStatus */
/** @typedef {import('../../lib/types.js').ClientOptions} ClientOptions */
/** @typedef {import('../../lib/types.js').Context} Context */
/** @typedef {import('../../lib/types.js').MonitorEvent} MonitorEvent */
/** @typedef {import('../../lib/types.js').Reader} Reader */
/** @typedef {import('../../lib/types.js').TransmitOptions} TransmitOptions */

class MockCard {
  /**
   * @param {number} protocol
   * @param {Buffer} atr
   * @param {Array<{command: Buffer | number[], response: Buffer | number[]}>} [responses]
   * @param {{transmitDelay?: number, controlDelay?: number}} [options]
   */
  constructor(protocol, atr, responses = [], options = {}) {
    this._protocol = protocol;
    this._atr = atr;
    this._responses = responses;
    this._connected = true;
    this._transmitDelay = options.transmitDelay || 0;
    this._controlDelay = options.controlDelay || 0;
    this._transmitCount = 0;
    this._controlCount = 0;
    this._reconnectProtocol = null;
    /** @type {TransmitOptions} */
    this._lastTransmitOptions = {};
  }

  get protocol() {
    return this._protocol;
  }

  /** @param {number} protocol */
  setReconnectProtocol(protocol) {
    this._reconnectProtocol = protocol;
  }

  get transmitCount() {
    return this._transmitCount;
  }

  get controlCount() {
    return this._controlCount;
  }

  get connected() {
    return this._connected;
  }

  get atr() {
    return this._connected ? this._atr : null;
  }

  /**
   * @param {Buffer | number[]} command
   * @param {TransmitOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async transmit(command, options = {}) {
    if (!this._connected) {
      throw new Error("Card is not connected");
    }

    this._transmitCount++;
    this._lastTransmitOptions = options;

    if (this._transmitDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this._transmitDelay));
    }

    const cmdBuffer = Buffer.isBuffer(command) ? command : Buffer.from(command);

    for (const { command: cmd, response } of this._responses) {
      const cmdMatch = Buffer.isBuffer(cmd) ? cmd : Buffer.from(cmd);
      if (cmdBuffer.equals(cmdMatch)) {
        return Buffer.isBuffer(response) ? response : Buffer.from(response);
      }
    }

    return Buffer.from([0x90, 0x00]);
  }

  /**
   * @param {number} _code
   * @param {Buffer | number[]} [_data]
   * @returns {Promise<Buffer>}
   */
  async control(_code, _data) {
    if (!this._connected) {
      throw new Error("Card is not connected");
    }

    this._controlCount++;

    if (this._controlDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this._controlDelay));
    }

    return Buffer.from([0x90, 0x00]);
  }

  /** @returns {CardStatus} */
  getStatus() {
    if (!this._connected) {
      throw new Error("Card is not connected");
    }
    return {
      state: 0x34,
      protocol: this.protocol,
      atr: this._atr,
    };
  }

  disconnect() {
    this._connected = false;
  }

  /**
   * @param {number} [_shareMode]
   * @param {number} [_protocol]
   * @param {number} [_init]
   * @returns {Promise<number>}
   */
  async reconnect(_shareMode, _protocol, _init) {
    this._connected = true;
    if (this._reconnectProtocol !== null) {
      this._protocol = this._reconnectProtocol;
      this._reconnectProtocol = null;
    }
    return this._protocol;
  }
}

class MockReader {
  /**
   * @param {string} name
   * @param {MockCard | null} [card]
   */
  constructor(name, card = null) {
    this.name = name;
    this._card = card;
    this._state = card ? 0x122 : 0x12;
  }

  get state() {
    return this._state;
  }

  get atr() {
    return this._card ? this._card.atr : null;
  }

  /**
   * @param {number} [_shareMode]
   * @param {number} [_protocol]
   * @returns {Promise<MockCard>}
   */
  async connect(_shareMode, _protocol) {
    if (!this._card) {
      throw new Error("No card in reader");
    }
    return this._card;
  }

  /** @param {MockCard} card */
  insertCard(card) {
    this._card = card;
    this._state = 0x122;
  }

  removeCard() {
    if (this._card) {
      this._card.disconnect();
    }
    this._card = null;
    this._state = 0x12;
  }
}

class MockContext {
  constructor() {
    /** @type {MockReader[]} */
    this._readers = [];
    this._valid = true;
  }

  get isValid() {
    return this._valid;
  }

  /** @returns {MockReader[]} */
  listReaders() {
    if (!this._valid) {
      throw new Error("Context is not valid");
    }
    return [...this._readers];
  }

  async waitForChange(_readers, _timeout) {
    return null;
  }

  cancel() {}

  close() {
    this._valid = false;
  }

  /** @param {MockReader} reader */
  addReader(reader) {
    this._readers.push(reader);
  }

  /** @param {string} name */
  removeReader(name) {
    this._readers = this._readers.filter((r) => r.name !== name);
  }
}

class MockReaderMonitor {
  constructor() {
    this._running = false;
    /** @type {((event: MonitorEvent) => void) | null} */
    this._callback = null;
    /** @type {MockReader[]} */
    this._readers = [];
  }

  get isRunning() {
    return this._running;
  }

  /** @param {(event: MonitorEvent) => void} callback */
  start(callback) {
    if (this._running) {
      throw new Error("Monitor is already running");
    }
    this._callback = callback;
    this._running = true;

    for (const reader of this._readers) {
      this._emitEvent("reader-attached", reader.name, reader.state, reader.atr);
    }
  }

  stop() {
    this._running = false;
    this._callback = null;
  }

  /**
   * @param {MonitorEvent['type']} type
   * @param {string} readerName
   * @param {number} state
   * @param {Buffer | null} atr
   */
  _emitEvent(type, readerName, state, atr) {
    if (this._callback) {
      this._callback({ type, reader: readerName, state, atr });
    }
  }

  /** @param {MockReader} reader */
  attachReader(reader) {
    this._readers.push(reader);
    if (this._running) {
      this._emitEvent("reader-attached", reader.name, reader.state, reader.atr);
    }
  }

  /** @param {string} name */
  detachReader(name) {
    this._readers = this._readers.filter((r) => r.name !== name);
    if (this._running) {
      this._emitEvent("reader-detached", name, 0, null);
    }
  }

  /**
   * @param {string} readerName
   * @param {MockCard} card
   */
  insertCard(readerName, card) {
    const reader = this._readers.find((r) => r.name === readerName);
    if (reader) {
      reader.insertCard(card);
      if (this._running) {
        this._emitEvent("card-inserted", readerName, reader.state, card.atr);
      }
    }
  }

  /** @param {string} readerName */
  removeCard(readerName) {
    const reader = this._readers.find((r) => r.name === readerName);
    if (reader) {
      reader.removeCard();
      if (this._running) {
        this._emitEvent("card-removed", readerName, reader.state, null);
      }
    }
  }
}

/**
 * Create mock DI options for createClient.
 * @param {MockContext} context
 * @param {MockReaderMonitor} monitor
 * @returns {Partial<ClientOptions>}
 */
function createMockOptions(context, monitor) {
  return {
    Context: function () {
      return context;
    },
    ReaderMonitor: function () {
      return monitor;
    },
    SCARD_STATE_PRESENT: 0x20,
    SCARD_SHARE_SHARED: 2,
    SCARD_PROTOCOL_T0: 1,
    SCARD_PROTOCOL_T1: 2,
  };
}

const SCARD_PROTOCOL_T0 = 1;
const SCARD_PROTOCOL_T1 = 2;

/**
 * @typedef {object} TestSetupOptions
 * @property {string} [readerName]
 * @property {number} [cardProtocol]
 * @property {Buffer} [cardAtr]
 * @property {Array<{command: Buffer | number[], response: Buffer | number[]}>} [cardResponses]
 * @property {new (name: string, card: MockCard | null) => MockReader} [ReaderClass]
 */

/**
 * Create a complete test setup with mock context, monitor, reader, and card.
 * Returns a factory function to create clients with pre-configured mock DI.
 * @param {TestSetupOptions} [options]
 */
function createTestSetup(options = {}) {
  const {
    readerName = "Test Reader",
    cardProtocol = SCARD_PROTOCOL_T0,
    cardAtr = Buffer.from([0x3b, 0x8f]),
    cardResponses = [],
    ReaderClass = MockReader,
  } = options;

  const card = new MockCard(cardProtocol, cardAtr, cardResponses);
  const reader = new ReaderClass(readerName, card);
  const context = new MockContext();
  const monitor = new MockReaderMonitor();

  context.addReader(reader);
  monitor.attachReader(reader);

  const mockOptions = createMockOptions(context, monitor);

  /**
   * Create a client with pre-configured mock DI.
   * @param {Partial<ClientOptions>} [clientOptions]
   */
  function client(clientOptions = {}) {
    return createClient({
      ...mockOptions,
      ...clientOptions,
    });
  }

  return { client, context, monitor, reader, card };
}

export {
  MockCard,
  MockReader,
  MockContext,
  MockReaderMonitor,
  createMockOptions,
  createTestSetup,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
};
