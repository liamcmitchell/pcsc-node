/**
 * Unified PC/SC context with built-in reader/card monitoring.
 *
 * Creates a single SCARDCONTEXT, starts a background monitor, and
 * exposes Reader EventEmitters that own their SCARDHANDLE when connected.
 */

/** @typedef {import('./native.js').PCSCContextInstance} PCSCContextType */
/** @typedef {import('./native.js').PCSCReaderInstance} PCSCReaderType */
/** @typedef {import('./native.js').MonitorEvent} MonitorEvent */
/** @typedef {import('./index.js').ContextOptions} ContextOptions */
/** @typedef {import('./index.js').ContextEvents} ContextEvents */
/** @typedef {import('./index.js').GetReadersOptions} GetReadersOptions */

import { EventEmitter } from "node:events";
import { PCSCContext } from "./native.js";
import { ShareMode, Protocol, State } from "./constants.js";
import { Errors } from "./errors.js";
import { Reader } from "./reader.js";

/**
 * Internal test-only escape hatch for injecting a mock native context.
 * Kept out of the public API surface on purpose.
 * @param {ContextOptions} options
 * @returns {PCSCContextType | undefined}
 */
function getInjectedNativeContext(options) {
  return /** @type {ContextOptions & { _nativeContext?: PCSCContextType }} */ (
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
 *   - 'reader'  (reader) — reader object created (fires once per reader instance)
 *   - 'attach'  (reader) — reader became available
 *   - 'detach'  (reader) — reader removed
 *   - 'change'  (reader, prevState) — any reader state change
 *   - 'insert'  (reader) — card inserted (connected if autoConnect)
 *   - 'remove'  (reader) — card removed
 *   - 'error'   (err) — monitoring/operation errors
 *   - 'ready'   () — initial reader discovery complete
 *   - 'unready' (err) — monitor cannot resolve state (service down, etc.)
 *
 * Reader events mirror context events.
 * Connect errors are emitted on the reader if it has an 'error' listener,
 * otherwise on the context. If neither has a listener, the error is thrown.
 *
 * @extends {EventEmitter<ContextEvents>}
 */
class Context extends EventEmitter {
  /** @type {PCSCContextType} */
  #native;
  /** @type {Map<string, Reader>} */
  #readers = new Map();
  #running = false;
  /** @type {Promise<void>} */
  #eventQueue = Promise.resolve();
  /** @type {boolean} */
  #autoGetResponse;
  /** @type {boolean} */
  #autoConnect;
  /** @type {Promise<ReadonlyMap<string, Reader>>} */
  #readyPromise = Promise.resolve(this.#readers);
  /** @type {((readers: ReadonlyMap<string, Reader>) => void) | null} */
  #readyResolve = null;
  /** @type {boolean} */
  #isReady = false;
  /** @type {{ message: string; code?: number } | null} */
  #lastUnready = null;
  /** @type {AbortController} */
  #closeController = new AbortController();

  /**
   * @param {ContextOptions} [options]
   */
  constructor(options = {}) {
    super();
    const { autoGetResponse = true, autoConnect = true } = options;
    this.#autoGetResponse = autoGetResponse;
    this.#autoConnect = autoConnect;
    this.#native = getInjectedNativeContext(options) ?? new PCSCContext();
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
    if (this.#closeController.signal.aborted) {
      this.#closeController = new AbortController();
    }
    this.#isReady = false;
    this.#lastUnready = null;
    this.#createReadyPromise();

    this.#native.startMonitor((event) => this.#handleEvent(event));
    return this;
  }

  /**
   * Resolves with readers after initial startup events have been processed.
   * Starts monitoring if needed. If autoConnect is enabled, initial card
   * connections are included. By default this rejects after 5000ms if the
   * monitor does not become ready. Pass { timeoutMs: 0 } to disable timeout.
   * @param {GetReadersOptions} [options]
   * @returns {Promise<ReadonlyMap<string, Reader>>}
   */
  getReaders(options = {}) {
    this.start();

    const timeoutMs = Math.max(0, options.timeoutMs ?? 5000);

    if (this.#isReady) {
      return Promise.resolve(this.#readers);
    }

    if (timeoutMs <= 0) {
      return this.#readyPromise;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        this.#closeController.signal.removeEventListener("abort", onAbort);
      };

      const resolveIfPending = (readers) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(readers);
      };

      const rejectIfPending = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const onAbort = () => {
        rejectIfPending(new Error("Context closed before ready"));
      };

      this.#closeController.signal.addEventListener("abort", onAbort, { once: true });

      timer = setTimeout(() => {
        rejectIfPending(this.#createReadyTimeoutError(timeoutMs));
      }, timeoutMs);

      this.#readyPromise.then(resolveIfPending, rejectIfPending);
    });
  }

  close() {
    this.#running = false;
    this.#isReady = false;
    this.#closeController.abort();

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

    try {
      this.#native.close();
    } catch {
      // Ignore close errors
    }
  }

  /** @param {MonitorEvent} event */
  #handleEvent(event) {
    this.#eventQueue = this.#eventQueue
      .then(() => this.#processEvent(event))
      .catch((err) => this.#reportQueueError(err));
  }

  /** @param {unknown} err */
  #reportQueueError(err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this.listenerCount("error") === 0) {
      this.#throwUncaught(error);
      return;
    }
    try {
      this.emit("error", error);
    } catch (emitError) {
      this.#throwUncaught(emitError instanceof Error ? emitError : new Error(String(emitError)));
    }
  }

  /** @param {Error} err */
  #throwUncaught(err) {
    // Throw outside the promise chain so ordering continues while preserving
    // visibility through Node's global uncaughtException handler.
    setImmediate(() => {
      throw err;
    });
  }

  /** @param {MonitorEvent} event */
  async #processEvent(event) {
    if (!this.#running) return;

    const { type, name, state, atr } = event;

    switch (type) {
      case "attached": {
        const nativeReader = /** @type {PCSCReaderType} */ (event.nativeReader);
        let reader = this.#readers.get(name);
        let isNewReader = false;
        if (reader) {
          reader._rebindNative(nativeReader, state, atr);
        } else {
          reader = new Reader(name, state, atr, nativeReader, this.#autoGetResponse);
          this.#readers.set(name, reader);
          isNewReader = true;
        }
        if (isNewReader) {
          this.emit("reader", reader);
        }
        this.emit("attach", reader);
        reader.emit("attach", reader);

        // Card may already be present when reader is first seen
        if ((state & State.PRESENT) !== 0) {
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
          this.emit("detach", reader);
          reader.emit("detach", reader);
        }
        break;
      }

      case "changed": {
        const reader = this.#readers.get(name);
        if (!reader) return;

        const prevState = reader.state;
        reader._syncState(state, atr);
        this.emit("change", reader, prevState);
        reader.emit("change", reader, prevState);

        const wasPresent = (prevState & State.PRESENT) !== 0;
        const isPresent = (state & State.PRESENT) !== 0;

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
        {
          /** @type {Error & { code?: number }} */
          const err = new Error(name);
          if (typeof event.code === "number" && event.code !== 0) {
            err.code = event.code;
          }
          this.emit("error", err);
        }
        break;

      case "ready":
        this.#isReady = true;
        this.#lastUnready = null;
        this.emit("ready");
        if (this.#readyResolve) {
          this.#readyResolve(this.#readers);
          this.#readyResolve = null;
        }
        break;

      case "unready": {
        this.#isReady = false;

        /** @type {Error & { code?: number }} */
        const err = new Error(name || "PC/SC monitor is unready");
        if (typeof event.code === "number" && event.code !== 0) {
          err.code = event.code;
        }

        this.#lastUnready = {
          message: err.message,
          code: err.code,
        };

        if (!this.#readyResolve) {
          this.#createReadyPromise();
        }

        this.emit("unready", err);
        break;
      }
    }
  }

  #createReadyPromise() {
    this.#readyPromise = new Promise((resolve) => {
      this.#readyResolve = resolve;
    });
  }

  /** @param {number} timeoutMs */
  #createReadyTimeoutError(timeoutMs) {
    const suffix = this.#lastUnready
      ? ` Last unready reason: ${this.#lastUnready.message}.`
      : " No ready or unready event received yet.";

    /** @type {Error & { code?: number }} */
    const err = new Error(`PC/SC monitor did not become ready within ${timeoutMs}ms.${suffix}`);
    if (typeof this.#lastUnready?.code === "number") {
      err.code = this.#lastUnready.code;
    }
    return err;
  }

  /** @param {Reader} reader */
  async #connectReader(reader) {
    if (!this.#running || !this.#native.isValid) return;
    if (this.#autoConnect) {
      try {
        try {
          await reader.connect();
        } catch (error) {
          const code = /** @type {{ code?: unknown }} */ (error)?.code;
          // Fallback to T=0 only when PC/SC reports an unresponsive card.
          if (code === Errors.CARD_UNRESPONSIVE) {
            await reader.connect(ShareMode.SHARED, Protocol.T0);
          } else {
            throw error;
          }
        }
      } catch (err) {
        const code = /** @type {{ code?: unknown }} */ (err)?.code;
        // Card removed before or during connect — not an error worth surfacing.
        if (code === Errors.READER_UNAVAILABLE || code === Errors.NO_SMARTCARD) {
          return;
        }
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
