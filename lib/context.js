/**
 * Unified PC/SC context with built-in reader/card monitoring.
 *
 * Creates a single SCARDCONTEXT, starts a background monitor, and
 * exposes Reader EventEmitters that own their SCARDHANDLE when connected.
 */

/** @typedef {import('./native.js').NativeContext} NativeContextType */
/** @typedef {import('./native.js').NativeReader} NativeReaderType */
/** @typedef {import('./native.js').MonitorEvent} MonitorEvent */

import { EventEmitter } from "node:events";
import {
  Context as NativeContext,
  SCARD_STATE_PRESENT,
  SCARD_SHARE_SHARED,
  SCARD_PROTOCOL_T0,
} from "./native.js";
import { Reader } from "./reader.js";

/**
 * Options for Context
 * @typedef {object} ContextOptions
 * @property {boolean} [autoGetResponse] - Auto-handle T=0 GET RESPONSE / Le correction
 * @property {boolean} [autoConnect] - Automatically connect when card is inserted (default: true)
 */

/**
 * Events emitted by the PC/SC context.
 * @typedef {object} ContextEvents
 * @property {[reader: Reader]} attach
 * @property {[reader: Reader]} detach
 * @property {[reader: Reader, prevState: number]} change
 * @property {[reader: Reader]} insert
 * @property {[reader: Reader]} remove
 * @property {[err: Error]} error
 * @property {[]} ready
 */

/**
 * Internal test-only escape hatch for injecting a mock native context.
 * Kept out of the public API surface on purpose.
 * @param {ContextOptions} options
 * @returns {NativeContextType | undefined}
 */
function getInjectedNativeContext(options) {
  return /** @type {ContextOptions & { _nativeContext?: NativeContextType }} */ (
    options
  )._nativeContext;
}

/**
 * PC/SC context — one per application. Extends EventEmitter.
 *
 * Call `start()` to begin monitoring readers and cards.
 * Call `close()` to stop monitoring and release resources.
 *
 * Context events:
 *   - 'attach'  (reader) — new reader detected
 *   - 'detach'  (reader) — reader removed
 *   - 'change'  (reader, prevState) — any reader state change
 *   - 'insert'  (reader) — card inserted (connected if autoConnect)
 *   - 'remove'  (reader) — card removed
 *   - 'error'   (err) — unhandled error during monitoring
 *
 * Reader events mirror context events.
 * Connect errors are emitted on the reader if it has an 'error' listener,
 * otherwise on the context. If neither has a listener, the error is thrown.
 *
 * @extends {EventEmitter<ContextEvents>}
 */
class Context extends EventEmitter {
  /** @type {NativeContextType} */
  #native;
  /** @type {Map<string, Reader>} */
  #readers = new Map();
  /** @type {Map<string, Reader>} */
  #readerCache = new Map();
  #running = false;
  /** @type {Promise<void>} */
  #eventQueue = Promise.resolve();
  /** @type {boolean} */
  #autoGetResponse;
  /** @type {boolean} */
  #autoConnect;
  /** @type {Promise<Context>} */
  #readyPromise = Promise.resolve(this);
  /** @type {((ctx: Context) => void) | null} */
  #readyResolve = null;
  /** @type {boolean} */
  #readyEmitted = false;

  /**
   * @param {ContextOptions} [options]
   */
  constructor(options = {}) {
    super();
    const { autoGetResponse = false, autoConnect = true } = options;
    this.#autoGetResponse = autoGetResponse;
    this.#autoConnect = autoConnect;
    this.#native = getInjectedNativeContext(options) ?? new NativeContext();
  }

  get isValid() {
    return this.#native.isValid;
  }

  get readers() {
    return /** @type {ReadonlyMap<string, Reader>} */ (this.#readers);
  }

  /**
   * Start monitoring for reader and card events.
   * @returns {this}
   */
  start() {
    if (this.#running) return this;

    this.#running = true;
    this.#readyEmitted = false;
    this.#readyPromise = new Promise((resolve) => {
      this.#readyResolve = resolve;
    });

    this.#native.startMonitor((event) => this.#handleEvent(event));
    return this;
  }

  /**
   * Resolves when initial startup events have been processed.
   * If autoConnect is enabled, initial card connections are included.
   * @returns {Promise<Context>}
   */
  whenReady() {
    return this.#readyPromise;
  }

  close() {
    this.#running = false;

    if (!this.#readyEmitted && this.#readyResolve) {
      this.#readyEmitted = true;
      this.#readyResolve(this);
      this.#readyResolve = null;
    }

    try {
      this.#native.stopMonitor();
    } catch {
      // Ignore stop errors
    }

    for (const reader of this.#readers.values()) {
      if (reader.connected) {
        try {
          reader.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
    }
    this.#readers.clear();
    this.#readerCache.clear();

    try {
      this.#native.close();
    } catch {
      // Ignore close errors
    }
  }

  /** @param {MonitorEvent} event */
  #handleEvent(event) {
    this.#eventQueue = this.#eventQueue.then(() => this.#processEvent(event));
  }

  /** @param {MonitorEvent} event */
  async #processEvent(event) {
    if (!this.#running) return;

    const { type, name, state, atr } = event;

    switch (type) {
      case "attached": {
        const nativeReader = /** @type {NativeReaderType} */ (event.nativeReader);
        let reader = this.#readerCache.get(name);
        if (reader) {
          reader._rebindNative(nativeReader, state, atr);
        } else {
          reader = new Reader(name, state, atr, nativeReader, this.#autoGetResponse);
          this.#readerCache.set(name, reader);
        }
        this.#readers.set(name, reader);
        this.emit("attach", reader);
        reader.emit("attach", reader);

        // Card may already be present when reader is first seen
        if ((state & SCARD_STATE_PRESENT) !== 0) {
          await this.#connectReader(reader);
        }
        break;
      }

      case "detached": {
        const reader = this.#readers.get(name);
        if (reader) {
          if (reader.connected) {
            try {
              reader.disconnect();
            } catch {
              // Ignore — reader is gone
            }
            this.emit("remove", reader);
            reader.emit("remove", reader);
          }
          reader._markDetached();
          this.#readers.delete(name);
          this.emit("detach", reader);
          reader.emit("detach", reader);
        }
        break;
      }

      case "changed": {
        const reader = this.#readers.get(name);
        if (!reader) return;

        const prevState = reader.state;
        reader.state = state;
        reader.atr = atr;
        this.emit("change", reader, prevState);
        reader.emit("change", reader, prevState);

        const wasPresent = (prevState & SCARD_STATE_PRESENT) !== 0;
        const isPresent = (state & SCARD_STATE_PRESENT) !== 0;

        if (!wasPresent && isPresent) {
          await this.#connectReader(reader);
        } else if (wasPresent && !isPresent) {
          if (reader.connected) {
            try {
              reader.disconnect();
            } catch {
              // Ignore — card is gone
            }
          }
          this.emit("remove", reader);
          reader.emit("remove", reader);
        }
        break;
      }

      case "error":
        this.emit("error", new Error(name));
        break;

      case "ready":
        this.#readyEmitted = true;
        this.emit("ready");
        if (this.#readyResolve) {
          this.#readyResolve(this);
          this.#readyResolve = null;
        }
        break;
    }
  }

  /** @param {Reader} reader */
  async #connectReader(reader) {
    if (!this.#running || !this.#native.isValid) return;
    if (this.#autoConnect) {
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
      } catch (err) {
        this.#emitError(reader, /** @type {Error} */ (err));
        return;
      }
    }
    this.emit("insert", reader);
    reader.emit("insert", reader);
  }

  /**
   * Emit an error on the reader (if it has a listener), otherwise on the context.
   * @param {Reader} reader
   * @param {Error} err
   */
  #emitError(reader, err) {
    if (reader.listenerCount("error") > 0) {
      reader.emit("error", err);
    } else {
      this.emit("error", err);
    }
  }
}

export { Context };
