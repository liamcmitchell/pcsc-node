/**
 * Mock PC/SC implementation for testing without hardware.
 *
 * Usage:
 *   const mock = createMockNative();
 *   const nativeReader = mock.attachReader('Reader 1', { atr: Buffer.from([0x3b]) });
 *   nativeReader.onTransmit = responseMap([{ command: [...], response: [...] }]);
 *   const ctx = new Context({ _nativeContext: mock })
 *     .on('insert', (reader) => { ... })
 *     .start();
 */

/** @typedef {import('../lib/native.js').NativeContext} NativeContext */
/** @typedef {import('../lib/native.js').NativeReader} NativeReader */

import { SCARD_STATE_PRESENT, SCARD_PROTOCOL_T0, SCARD_PROTOCOL_T1 } from "../lib/native.js";

/**
 * Create a response-map based transmit handler.
 * Returns [0x90, 0x00] for unrecognized commands.
 *
 * @param {Array<{command: Buffer | number[], response: Buffer | number[]}>} responses
 * @returns {(command: Buffer | number[], options?: object) => Promise<Buffer>}
 */
function responseMap(responses) {
  return async (command) => {
    const cmdBuf = Buffer.isBuffer(command) ? command : Buffer.from(command);
    for (const { command: cmd, response } of responses) {
      const match = Buffer.isBuffer(cmd) ? cmd : Buffer.from(cmd);
      if (cmdBuf.equals(match)) {
        return Buffer.isBuffer(response) ? response : Buffer.from(response);
      }
    }
    return Buffer.from([0x90, 0x00]);
  };
}

/**
 * Create a mock NativeReader with overridable callbacks.
 *
 * The `on*` properties are mutable and can be replaced after creation to
 * control reader behaviour in tests.
 *
 * @param {string} name
 * @param {object} [opts]
 * @param {Buffer | null} [opts.atr]
 * @param {number} [opts.protocol]
 * @param {(shareMode?: number, protocols?: number) => Promise<void>} [opts.onConnect]
 * @param {(command: Buffer | number[], options?: object) => Promise<Buffer>} [opts.onTransmit]
 * @param {(code: number, data?: Buffer | number[]) => Promise<Buffer>} [opts.onControl]
 * @param {(disposition?: number) => void} [opts.onDisconnect]
 * @param {(shareMode?: number, protocol?: number, init?: number) => Promise<void>} [opts.onReconnect]
 */
function createMockNativeReader(name, opts = {}) {
  const {
    atr = null,
    protocol = SCARD_PROTOCOL_T0,
    onConnect = async () => {},
    onTransmit = async () => Buffer.from([0x90, 0x00]),
    onControl = async () => Buffer.alloc(0),
    onDisconnect = () => {},
    onReconnect = async () => {},
  } = opts;

  let _connected = false;
  let _protocol = 0;
  let _atr = atr;
  let _cardProtocol = protocol;

  const reader = {
    name,
    get connected() {
      return _connected;
    },
    get protocol() {
      return _protocol;
    },
    get atr() {
      return _atr;
    },

    transmitCount: 0,

    onConnect,
    onTransmit,
    onControl,
    onDisconnect,
    onReconnect,

    async connect(shareMode, protocols) {
      await reader.onConnect(shareMode, protocols);
      _connected = true;
      _protocol = _cardProtocol;
    },

    async transmit(command, options) {
      reader.transmitCount++;
      return reader.onTransmit(command, options);
    },

    async control(code, data) {
      return reader.onControl(code, data);
    },

    disconnect(disposition) {
      reader.onDisconnect(disposition);
      _connected = false;
      _protocol = 0;
    },

    async reconnect(shareMode, protocol, init) {
      await reader.onReconnect(shareMode, protocol, init);
    },

    // Internal — used by mock.insertCard / mock.removeCard
    _setAtr(newAtr) {
      _atr = newAtr;
    },
    _setProtocol(p) {
      _cardProtocol = p;
    },
  };

  return reader;
}

/**
 * Create a mock NativeContext for testing without hardware.
 *
 * Implements the NativeContext interface (isValid, startMonitor, stopMonitor, close)
 * plus test-control methods for managing readers and cards.
 */
function createMockNative() {
  let closed = false;
  /** @type {((event: any) => void) | null} */
  let monitorCallback = null;

  /** @type {Map<string, { nativeReader: ReturnType<typeof createMockNativeReader>, state: number }>} */
  const readers = new Map();

  function emit(event) {
    monitorCallback?.(event);
  }

  return {
    get isValid() {
      return !closed;
    },

    startMonitor(callback) {
      monitorCallback = callback;
      for (const [name, data] of readers) {
        callback({
          type: "attached",
          name,
          state: data.state,
          atr: data.nativeReader.atr,
          nativeReader: data.nativeReader,
        });
      }
    },

    stopMonitor() {
      monitorCallback = null;
    },

    close() {
      closed = true;
    },

    /**
     * Attach a reader, optionally with a card already present.
     * Provide `opts.atr` to start with a card inserted.
     * Returns the mock NativeReader so callbacks can be overridden.
     *
     * @param {string} name
     * @param {Parameters<typeof createMockNativeReader>[1]} [opts]
     */
    attachReader(name, opts = {}) {
      const hasCard = !!opts.atr;
      const state = hasCard ? 0x02 | SCARD_STATE_PRESENT : 0x02;
      const nativeReader = createMockNativeReader(name, opts);
      readers.set(name, { nativeReader, state });
      emit({ type: "attached", name, state, atr: nativeReader.atr, nativeReader });
      return nativeReader;
    },

    /**
     * Detach a reader (emits a 'detached' event).
     * @param {string} name
     */
    detachReader(name) {
      readers.delete(name);
      emit({ type: "detached", name, state: 0, atr: null });
    },

    /**
     * Insert a card into an attached reader (emits a 'changed' event).
     * Can update reader callbacks at the same time.
     *
     * @param {string} name
     * @param {Parameters<typeof createMockNativeReader>[1]} [opts]
     */
    insertCard(name, opts = {}) {
      const data = readers.get(name);
      if (!data) return;
      const {
        atr = null,
        protocol = SCARD_PROTOCOL_T0,
        onConnect,
        onTransmit,
        onControl,
        onDisconnect,
        onReconnect,
      } = opts;
      const nr = data.nativeReader;
      nr._setAtr(atr);
      nr._setProtocol(protocol);
      if (onConnect) nr.onConnect = onConnect;
      if (onTransmit) nr.onTransmit = onTransmit;
      if (onControl) nr.onControl = onControl;
      if (onDisconnect) nr.onDisconnect = onDisconnect;
      if (onReconnect) nr.onReconnect = onReconnect;
      data.state = 0x02 | SCARD_STATE_PRESENT;
      emit({ type: "changed", name, state: data.state, atr });
    },

    /**
     * Remove a card from an attached reader (emits a 'changed' event).
     * @param {string} name
     */
    removeCard(name) {
      const data = readers.get(name);
      if (!data) return;
      data.nativeReader._setAtr(null);
      data.state = 0x02;
      emit({ type: "changed", name, state: data.state, atr: null });
    },

    /**
     * Emit an error monitor event.
     * @param {string} message
     */
    emitError(message) {
      emit({ type: "error", name: message, state: 0, atr: null });
    },

    /**
     * Emit a 'changed' event for any reader name (even one not in the registry).
     * @param {string} name
     * @param {number} state
     * @param {Buffer | null} atr
     */
    emitChanged(name, state, atr) {
      emit({ type: "changed", name, state, atr });
    },
  };
}

export { createMockNative, responseMap };
