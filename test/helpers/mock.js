/**
 * Mock PC/SC implementation for testing without hardware
 */

import { Devices } from "../../lib/devices.js";

/** @typedef {import('../../lib/types.js').Card} Card */
/** @typedef {import('../../lib/types.js').CardStatus} CardStatus */
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
    this._connectAttempts = 0;
  }

  get state() {
    return this._state;
  }

  get atr() {
    return this._card ? this._card.atr : null;
  }

  get connectAttempts() {
    return this._connectAttempts;
  }

  /**
   * @param {number} [_shareMode]
   * @param {number} [_protocol]
   * @returns {Promise<MockCard>}
   */
  async connect(_shareMode, _protocol) {
    this._connectAttempts++;
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
 * Create a mock-enabled Devices class
 * @param {{Context: new () => MockContext, ReaderMonitor: new () => MockReaderMonitor}} mockAddon
 * @returns {typeof Devices}
 */
function createMockDevices(mockAddon) {
  const { Context, ReaderMonitor } = mockAddon;

  class MockDevices extends Devices {
    constructor() {
      super({
        Context,
        ReaderMonitor,
        SCARD_STATE_PRESENT: 0x20,
        SCARD_SHARE_SHARED: 2,
        SCARD_PROTOCOL_T0: 1,
        SCARD_PROTOCOL_T1: 2,
      });
    }
  }

  return MockDevices;
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
 * Create a complete test setup with mock devices, context, monitor, reader, and card.
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

  const MockDevicesClass = createMockDevices({
    Context: function () {
      return context;
    },
    ReaderMonitor: function () {
      return monitor;
    },
  });

  const devices = new MockDevicesClass();

  return { devices, context, monitor, reader, card };
}

/**
 * A mock reader that fails with "unresponsive" error on dual protocol (T0|T1)
 * but succeeds when connecting with T0 only (simulates issue #34 fallback)
 */
class UnresponsiveDualProtocolReader extends MockReader {
  async connect(_shareMode, protocol) {
    this._connectAttempts++;
    if (!this._card) {
      throw new Error("No card in reader");
    }
    if (protocol === (SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1)) {
      throw new Error("Card is unresponsive");
    }
    return this._card;
  }
}

/**
 * A mock reader that always fails to connect
 */
class FailingMockReader extends MockReader {
  /**
   * @param {string} name
   * @param {MockCard | null} [card]
   * @param {string} [errorMessage]
   */
  constructor(name, card = null, errorMessage = "Connection failed") {
    super(name, card);
    this._errorMessage = errorMessage;
  }

  async connect(_shareMode, _protocol) {
    this._connectAttempts++;
    throw new Error(this._errorMessage);
  }
}

/**
 * A mock reader that delays before connecting
 */
class SlowMockReader extends MockReader {
  /**
   * @param {string} name
   * @param {MockCard | null} [card]
   * @param {number} [delay]
   */
  constructor(name, card = null, delay = 100) {
    super(name, card);
    this._delay = delay;
  }

  async connect(_shareMode, _protocol) {
    this._connectAttempts++;
    if (!this._card) {
      throw new Error("No card in reader");
    }
    await new Promise((resolve) => setTimeout(resolve, this._delay));
    return this._card;
  }
}

/**
 * A mock reader that fails on the first N connect attempts, then succeeds
 */
class IntermittentFailureMockReader extends MockReader {
  /**
   * @param {string} name
   * @param {MockCard | null} [card]
   * @param {number} [failureCount]
   * @param {string} [errorMessage]
   */
  constructor(
    name,
    card = null,
    failureCount = 1,
    errorMessage = "Temporary failure",
  ) {
    super(name, card);
    this._failureCount = failureCount;
    this._errorMessage = errorMessage;
  }

  async connect(_shareMode, _protocol) {
    this._connectAttempts++;
    if (!this._card) {
      throw new Error("No card in reader");
    }
    if (this._connectAttempts <= this._failureCount) {
      throw new Error(this._errorMessage);
    }
    return this._card;
  }
}

/**
 * A mock card that fails transmit after a certain number of commands
 */
class UnstableMockCard extends MockCard {
  /**
   * @param {number} protocol
   * @param {Buffer} atr
   * @param {Array<{command: Buffer | number[], response: Buffer | number[]}>} [responses]
   * @param {number} [failAfter]
   */
  constructor(protocol, atr, responses = [], failAfter = 3) {
    super(protocol, atr, responses);
    this._failAfter = failAfter;
  }

  async transmit(command, options = {}) {
    if (!this.connected) {
      throw new Error("Card is not connected");
    }

    if (this.transmitCount >= this._failAfter) {
      this.disconnect();
      throw new Error("Card was removed");
    }

    return super.transmit(command, options);
  }
}

export {
  MockCard,
  MockReader,
  MockContext,
  MockReaderMonitor,
  createMockDevices,
  createTestSetup,
  UnresponsiveDualProtocolReader,
  FailingMockReader,
  SlowMockReader,
  IntermittentFailureMockReader,
  UnstableMockCard,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
};
