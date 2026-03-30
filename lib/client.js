/**
 * Callback-based PC/SC client API
 *
 * Replaces the EventEmitter-based Devices class with a simpler
 * callback-driven interface with built-in reader/card state.
 */

/** @typedef {import('./types.js').Card} Card */
/** @typedef {import('./types.js').ClientOptions} ClientOptions */
/** @typedef {import('./types.js').Context} Context */
/** @typedef {import('./types.js').ContextConstructor} ContextConstructor */
/** @typedef {import('./types.js').MonitorEvent} MonitorEvent */
/** @typedef {import('./types.js').Reader} Reader */
/** @typedef {import('./types.js').ReaderInfo} ReaderInfo */
/** @typedef {import('./types.js').ReaderMonitor} ReaderMonitor */
/** @typedef {import('./types.js').ReaderMonitorConstructor} ReaderMonitorConstructor */

import { wrapCard } from "./card-wrapper.js";
import * as native from "./native.js";

/**
 * Create a PC/SC client with callback-based event handling.
 *
 * @param {ClientOptions} [options]
 */
function createClient(options = {}) {
  const {
    onReaderAttached,
    onReaderDetached,
    onCardInserted,
    onCardRemoved,
    onError,
    autoGetResponse = false,
    Context = native.Context,
    ReaderMonitor = native.ReaderMonitor,
    SCARD_STATE_PRESENT = native.SCARD_STATE_PRESENT,
    SCARD_SHARE_SHARED = native.SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0 = native.SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1 = native.SCARD_PROTOCOL_T1,
  } = options;

  /** @type {ReaderMonitor | null} */
  let monitor = null;
  /** @type {Context | null} */
  let context = null;
  /** @type {boolean} */
  let running = false;
  /** @type {Map<string, ReaderInfo>} */
  const readers = new Map();
  /** @type {Promise<void>} */
  let eventQueue = Promise.resolve();

  /**
   * Handle events from native monitor.
   * Queues events to prevent race conditions when multiple events arrive concurrently.
   * @param {MonitorEvent} event
   */
  function handleEvent(event) {
    eventQueue = eventQueue.then(() => processEvent(event));
  }

  /**
   * Process a single event (called sequentially via queue).
   * @param {MonitorEvent} event
   * @returns {Promise<void>}
   */
  async function processEvent(event) {
    if (!running) return;

    const { type, reader: readerName, state, atr } = event;

    switch (type) {
      case "reader-attached":
        await handleReaderAttached(readerName, state, atr);
        break;
      case "reader-detached":
        handleReaderDetached(readerName);
        break;
      case "card-inserted":
        await handleCardInserted(readerName, state, atr);
        break;
      case "card-removed":
        handleCardRemoved(readerName);
        break;
      case "error":
        // readerName contains error message for error events
        onError?.(new Error(readerName));
        break;
    }
  }

  /**
   * @param {string} readerName
   * @param {number} state
   * @param {Buffer | null} atr
   * @returns {Promise<void>}
   */
  async function handleReaderAttached(readerName, state, atr) {
    /** @type {ReaderInfo} */
    const info = { name: readerName, state, atr, card: null };
    readers.set(readerName, info);

    onReaderAttached?.({ name: readerName, state, atr });

    // Check if card is already present
    if ((state & SCARD_STATE_PRESENT) !== 0) {
      await handleCardInserted(readerName, state, atr);
    }
  }

  /**
   * @param {string} readerName
   */
  function handleReaderDetached(readerName) {
    const info = readers.get(readerName);

    // If card was connected, emit card-removed first
    if (info?.card) {
      handleCardRemoved(readerName);
    }

    readers.delete(readerName);
    onReaderDetached?.({ name: readerName });
  }

  /**
   * @param {string} readerName
   * @param {number} eventState
   * @param {Buffer | null} atr
   * @returns {Promise<void>}
   */
  async function handleCardInserted(readerName, eventState, atr) {
    let info = readers.get(readerName);
    if (!info) {
      info = { name: readerName, state: eventState, atr, card: null };
      readers.set(readerName, info);
    }

    info.state = eventState;
    info.atr = atr;

    if (!running || !context || !context.isValid) return;

    // Try to connect to the card
    try {
      /** @type {Card} */
      let card;
      try {
        // First try with both T=0 and T=1 protocols
        card = await context.connect(
          readerName,
          SCARD_SHARE_SHARED,
          SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
        );
      } catch (error) {
        // If dual protocol fails with unresponsive card error,
        // fallback to T=0 only (https://github.com/tomkp/smartcard/issues/34)
        if (String(error).toLowerCase().includes("unresponsive")) {
          card = await context.connect(readerName, SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0);
        } else {
          throw error;
        }
      }

      // Wrap the native card to add autoGetResponse support
      card = wrapCard(card, autoGetResponse ? { autoGetResponse: true } : undefined);
      info.card = card;

      onCardInserted?.({ name: readerName, card, atr });
    } catch (err) {
      onError?.(/** @type {Error} */ (err));
    }
  }

  /**
   * @param {string} readerName
   */
  function handleCardRemoved(readerName) {
    const info = readers.get(readerName);
    if (!info) return;

    const card = info.card;
    info.card = null;

    if (card) {
      try {
        card.disconnect();
      } catch {
        // Ignore - card is already removed
      }
    }

    onCardRemoved?.({ name: readerName, card });
  }

  return {
    /**
     * Start monitoring for device changes.
     */
    start() {
      if (running) return;

      try {
        context = new Context();
        monitor = new ReaderMonitor();
        running = true;

        monitor.start((/** @type {MonitorEvent} */ event) => {
          handleEvent(event);
        });
      } catch (err) {
        onError?.(/** @type {Error} */ (err));
      }
    },

    /**
     * Stop monitoring and clean up.
     */
    stop() {
      running = false;

      if (monitor) {
        try {
          monitor.stop();
        } catch {
          // Ignore stop errors
        }
        monitor = null;
      }

      // Disconnect any connected cards
      for (const [, info] of readers) {
        if (info.card) {
          try {
            info.card.disconnect();
          } catch {
            // Ignore disconnect errors
          }
        }
      }
      readers.clear();

      if (context) {
        try {
          context.close();
        } catch {
          // Ignore close errors
        }
        context = null;
      }
    },

    /** @type {ReadonlyMap<string, ReaderInfo>} */
    get readers() {
      return readers;
    },

    /**
     * Get the card connected to a specific reader.
     * @param {string} readerName
     * @returns {Card | null}
     */
    getCard(readerName) {
      return readers.get(readerName)?.card ?? null;
    },

    /**
     * Get all currently connected cards.
     * @returns {ReadonlyMap<string, Card>}
     */
    getCards() {
      /** @type {Map<string, Card>} */
      const cards = new Map();
      for (const [readerName, info] of readers) {
        if (info.card) {
          cards.set(readerName, info.card);
        }
      }
      return cards;
    },

    /**
     * List currently known readers via the PC/SC context.
     * @returns {Reader[]}
     */
    listReaders() {
      if (!context || !context.isValid) return [];
      try {
        return context.listReaders();
      } catch {
        return [];
      }
    },
  };
}

export { createClient };
