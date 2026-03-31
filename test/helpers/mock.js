/**
 * Mock PC/SC implementation for testing without hardware
 */

import { createContext } from "../../lib/context.js";

/** @typedef {import('../../lib/types.js').CardStatus} CardStatus */
/** @typedef {import('../../lib/types.js').ContextOptions} ContextOptions */
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
   * @returns {Promise<void>}
   */
  async reconnect(_shareMode, _protocol, _init) {
    this._connected = true;
    if (this._reconnectProtocol !== null) {
      this._protocol = this._reconnectProtocol;
      this._reconnectProtocol = null;
    }
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
    this._monitoring = false;
    /** @type {((event: { type: string; reader: string; state: number; atr: Buffer | null }) => void) | null} */
    this._callback = null;
  }

  get isValid() {
    return this._valid;
  }

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

  /**
   * Create a mock NativeReader for the given reader name.
   * The mock reader delegates connect() back to this.connect()
   * so tests can override connect behavior on the context.
   * @param {string} readerName
   * @returns {{ name: string; connected: boolean; protocol: number; atr: Buffer | null; connect: Function; transmit: Function; control: Function; disconnect: Function; reconnect: Function }}
   */
  _createNativeReader(readerName) {
    const self = this;
    /** @type {MockCard | null} */
    let card = null;

    const nativeReader = {
      name: readerName,
      _connected: false,
      _protocol: 0,

      get connected() {
        return nativeReader._connected;
      },
      get protocol() {
        return nativeReader._protocol;
      },
      get atr() {
        return card ? card.atr : null;
      },

      /**
       * @param {number} [shareMode]
       * @param {number} [protocols]
       * @returns {Promise<void>}
       */
      async connect(shareMode, protocols) {
        card = await self.connect(readerName, shareMode, protocols);
        nativeReader._connected = true;
        nativeReader._protocol = card.protocol;
      },

      /**
       * @param {Buffer | number[]} command
       * @param {TransmitOptions} [options]
       * @returns {Promise<Buffer>}
       */
      async transmit(command, options) {
        if (!nativeReader._connected || !card) throw new Error("Card is not connected");
        return card.transmit(command, options);
      },

      /**
       * @param {number} code
       * @param {Buffer | number[]} [data]
       * @returns {Promise<Buffer>}
       */
      async control(code, data) {
        if (!nativeReader._connected || !card) throw new Error("Card is not connected");
        return card.control(code, data);
      },

      /** @param {number} [disposition] */
      disconnect(_disposition) {
        if (!nativeReader._connected) return;
        if (card) card.disconnect();
        nativeReader._connected = false;
        nativeReader._protocol = 0;
        card = null;
      },

      /**
       * @param {number} [shareMode]
       * @param {number} [protocol]
       * @param {number} [init]
       * @returns {Promise<void>}
       */
      async reconnect(shareMode, protocol, init) {
        if (!nativeReader._connected || !card) throw new Error("Card is not connected");
        await card.reconnect(shareMode, protocol, init);
        nativeReader._protocol = card.protocol;
      },
    };

    return nativeReader;
  }

  /**
   * @param {string} readerName
   * @param {number} [_shareMode]
   * @param {number} [_protocol]
   * @returns {Promise<MockCard>}
   */
  async connect(readerName, _shareMode, _protocol) {
    if (!this._valid) {
      throw new Error("Context is not valid");
    }
    const reader = this._readers.find((r) => r.name === readerName);
    if (!reader) {
      throw new Error(`Reader not found: ${readerName}`);
    }
    return reader.connect(_shareMode, _protocol);
  }

  /** @param {(event: { type: string; reader: string; state: number; atr: Buffer | null }) => void} callback */
  startMonitor(callback) {
    if (this._monitoring) {
      throw new Error("Monitor is already running");
    }
    this._callback = callback;
    this._monitoring = true;

    for (const reader of this._readers) {
      this._emitEvent("attached", reader.name, reader.state, reader.atr);
    }
  }

  stopMonitor() {
    this._monitoring = false;
    this._callback = null;
  }

  /**
   * @param {string} type
   * @param {string} readerName
   * @param {number} state
   * @param {Buffer | null} atr
   */
  _emitEvent(type, readerName, state, atr) {
    if (this._callback) {
      /** @type {Record<string, unknown>} */
      const event = { type, reader: readerName, state, atr };
      if (type === "attached") {
        event.nativeReader = this._createNativeReader(readerName);
      }
      this._callback(/** @type {any} */ (event));
    }
  }

  /** @param {MockReader} reader */
  attachReader(reader) {
    this._readers.push(reader);
    if (this._monitoring) {
      this._emitEvent("attached", reader.name, reader.state, reader.atr);
    }
  }

  /** @param {string} name */
  detachReader(name) {
    this._readers = this._readers.filter((r) => r.name !== name);
    if (this._monitoring) {
      this._emitEvent("detached", name, 0, null);
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
      if (this._monitoring) {
        this._emitEvent("changed", readerName, reader.state, card.atr);
      }
    }
  }

  /** @param {string} readerName */
  removeCard(readerName) {
    const reader = this._readers.find((r) => r.name === readerName);
    if (reader) {
      reader.removeCard();
      if (this._monitoring) {
        this._emitEvent("changed", readerName, reader.state, null);
      }
    }
  }
}

/**
 * Create mock DI options for createContext.
 * @param {MockContext} context
 * @returns {Record<string, unknown>}
 */
function createMockOptions(context) {
  return {
    Context: function () {
      return context;
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
 * Create a complete test setup with mock context, reader, and card.
 * Returns a factory function to create contexts with pre-configured mock DI.
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

  context.addReader(reader);

  const mockOptions = createMockOptions(context);

  /**
   * Create a context with pre-configured mock DI.
   * @param {Partial<ContextOptions>} [contextOptions]
   */
  function create(contextOptions = {}) {
    return createContext({
      ...mockOptions,
      ...contextOptions,
    });
  }

  return { create, context, reader, card };
}

export {
  MockCard,
  MockReader,
  MockContext,
  createMockOptions,
  createTestSetup,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
};
