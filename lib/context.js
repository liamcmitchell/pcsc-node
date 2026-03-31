/**
 * Unified PC/SC context with built-in reader/card monitoring.
 *
 * Creates a single SCARDCONTEXT, starts a background monitor, and
 * exposes Reader objects that own their SCARDHANDLE when connected.
 */

/** @typedef {import('./types.js').CardStatus} CardStatus */
/** @typedef {import('./types.js').Context} Context */
/** @typedef {import('./types.js').ContextOptions} ContextOptions */
/** @typedef {import('./types.js').Reader} Reader */
/** @typedef {import('./types.js').TransmitOptions} TransmitOptions */
/** @typedef {import('./native.js').NativeContext} NativeContext */
/** @typedef {import('./native.js').NativeReader} NativeReader */

import {
  Context,
  SCARD_STATE_PRESENT,
  SCARD_SHARE_SHARED,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
} from "./native.js";

/**
 * Create a PC/SC context with reader/card monitoring.
 *
 * Monitoring starts immediately. Call `context.close()` to stop.
 *
 * @param {ContextOptions} [options]
 * @returns {Context}
 */
function createContext(options = {}) {
  const {
    onReaderAttached,
    onReaderDetached,
    onCardInserted,
    onCardRemoved,
    onReaderChange,
    onError,
    autoGetResponse = false,
    autoConnect = true,
  } = options;

  // _nativeContext is an intentionally undocumented escape hatch for testing
  const nativeContext =
    /** @type {{ _nativeContext?: NativeContext }} */ (options)._nativeContext ?? new Context();

  /** @type {Map<string, Reader>} */
  const readers = new Map();
  let running = true;
  /** @type {Promise<void>} */
  let eventQueue = Promise.resolve();

  /**
   * Create a Reader object that wraps state and card operations.
   * @param {string} name
   * @param {number} state
   * @param {Buffer | null} atr
   * @param {NativeReader} nativeReader
   * @returns {Reader}
   */
  function createReader(name, state, atr, nativeReader) {
    /** @type {Reader} */
    const reader = {
      name,
      state,
      atr,
      get connected() {
        return nativeReader.connected;
      },
      get protocol() {
        return nativeReader.protocol;
      },

      async connect(shareMode, preferredProtocols) {
        shareMode ??= SCARD_SHARE_SHARED;
        preferredProtocols ??= SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;
        await nativeReader.connect(shareMode, preferredProtocols);
      },

      async transmit(command, options) {
        if (!nativeReader.connected) throw new Error("Not connected");
        if (!(options?.autoGetResponse ?? autoGetResponse)) {
          return nativeReader.transmit(command, options);
        }
        const cmdBuffer = Buffer.isBuffer(command) ? command : Buffer.from(command);
        let response = await nativeReader.transmit(cmdBuffer, options);
        // ISO/IEC 7816-4 T=0 status word handling:
        // SW1=61 (more data available) → send GET RESPONSE (00 C0 00 00 Le)
        // SW1=6C (wrong Le) → retry original command with corrected Le
        // https://en.wikipedia.org/wiki/Smart_card_application_protocol_data_unit
        /** @type {Buffer[]} */
        const collectedData = [];
        while (response.length >= 2) {
          const sw1 = response[response.length - 2];
          const sw2 = response[response.length - 1];
          if (sw1 === 0x61) {
            if (response.length > 2) collectedData.push(response.subarray(0, -2));
            response = await nativeReader.transmit(
              Buffer.from([0x00, 0xc0, 0x00, 0x00, sw2]),
              options,
            );
          } else if (sw1 === 0x6c) {
            let corrected;
            if (cmdBuffer.length < 5) {
              corrected = Buffer.concat([cmdBuffer, Buffer.from([sw2])]);
            } else {
              corrected = Buffer.from(cmdBuffer);
              corrected[corrected.length - 1] = sw2;
            }
            response = await nativeReader.transmit(corrected, options);
          } else {
            break;
          }
        }
        if (collectedData.length > 0) {
          collectedData.push(response);
          return Buffer.concat(collectedData);
        }
        return response;
      },

      async control(code, data) {
        if (!nativeReader.connected) throw new Error("Not connected");
        return nativeReader.control(code, data);
      },

      disconnect(disposition) {
        if (!nativeReader.connected) return;
        nativeReader.disconnect(disposition);
      },

      async reconnect(shareMode, protocol, initialization) {
        if (!nativeReader.connected) throw new Error("Not connected");
        await nativeReader.reconnect(shareMode, protocol, initialization);
      },
    };

    return reader;
  }

  /**
   * Queue event processing to prevent race conditions.
   * @param {import('./native.js').MonitorEvent} event
   */
  function handleEvent(event) {
    eventQueue = eventQueue.then(() => processEvent(event));
  }

  /**
   * Process a single monitor event.
   * @param {import('./native.js').MonitorEvent} event
   */
  async function processEvent(event) {
    if (!running) return;

    const { type, reader: readerName, state, atr } = event;

    switch (type) {
      case "attached": {
        const reader = createReader(
          readerName,
          state,
          atr,
          /** @type {NativeReader} */ (event.nativeReader),
        );
        readers.set(readerName, reader);
        onReaderAttached?.(reader);

        // Card may already be present when reader is first seen
        if ((state & SCARD_STATE_PRESENT) !== 0) {
          await connectReader(reader);
        }
        break;
      }

      case "detached": {
        const reader = readers.get(readerName);
        if (reader) {
          if (reader.connected) {
            try {
              reader.disconnect();
            } catch {
              // Ignore — reader is gone
            }
            onCardRemoved?.(reader);
          }
          readers.delete(readerName);
          onReaderDetached?.(reader);
        }
        break;
      }

      case "changed": {
        let reader = readers.get(readerName);
        if (!reader) return;

        const prevState = reader.state;
        reader.state = state;
        reader.atr = atr;
        onReaderChange?.(reader, prevState);

        const wasPresent = (prevState & SCARD_STATE_PRESENT) !== 0;
        const isPresent = (state & SCARD_STATE_PRESENT) !== 0;

        if (!wasPresent && isPresent) {
          await connectReader(reader);
        } else if (wasPresent && !isPresent) {
          if (reader.connected) {
            try {
              reader.disconnect();
            } catch {
              // Ignore — card is gone
            }
          }
          onCardRemoved?.(reader);
        }
        break;
      }

      case "error":
        onError?.(new Error(readerName));
        break;
    }
  }

  /**
   * Attempt to connect to the card in a reader.
   * @param {Reader} reader
   */
  async function connectReader(reader) {
    if (!autoConnect || !running || !nativeContext.isValid) return;
    try {
      try {
        await reader.connect();
      } catch (error) {
        // Fallback to T=0 only if dual-protocol fails with "unresponsive"
        if (String(error).toLowerCase().includes("unresponsive")) {
          await reader.connect(SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0);
        } else {
          throw error;
        }
      }
      onCardInserted?.(reader);
    } catch (err) {
      onError?.(/** @type {Error} */ (err));
    }
  }

  // Start monitoring immediately
  nativeContext.startMonitor(handleEvent);

  return {
    get isValid() {
      return nativeContext.isValid;
    },

    get readers() {
      return /** @type {ReadonlyMap<string, Reader>} */ (readers);
    },

    close() {
      running = false;

      try {
        nativeContext.stopMonitor();
      } catch {
        // Ignore stop errors
      }

      for (const reader of readers.values()) {
        if (reader.connected) {
          try {
            reader.disconnect();
          } catch {
            // Ignore disconnect errors
          }
        }
      }
      readers.clear();

      try {
        nativeContext.close();
      } catch {
        // Ignore close errors
      }
    },
  };
}

export { createContext };
