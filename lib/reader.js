/**
 * PC/SC Reader — a stateful EventEmitter owned by the Context.
 *
 * Tracks reader state (name, state flags, ATR) and owns the SCARDHANDLE
 * when connected. Card operations are methods on the reader itself.
 */

/** @typedef {import('./native.js').PCSCReaderInstance} PCSCReader */

import { EventEmitter } from "node:events";
import { ShareMode, Protocol } from "./constants.js";

/**
 * Events emitted by a Reader.
 * @typedef {object} ReaderEvents
 * @property {[reader: Reader]} attach
 * @property {[reader: Reader]} detach
 * @property {[reader: Reader, prevState: number]} change
 * @property {[reader: Reader]} insert
 * @property {[reader: Reader]} remove
 * @property {[err: Error]} error
 */

/**
 * PC/SC reader — a stateful EventEmitter owned by the Context.
 *
 * Reader events:
 *   - 'attach'  (reader) — this reader became available
 *   - 'detach'  (reader) — this reader was removed
 *   - 'change'  (reader, prevState) — state flags changed
 *   - 'insert'  (reader) — card inserted (connected when autoConnect is true)
 *   - 'remove'  (reader) — card removed
 *   - 'error'   (err) — reader-targeted operation error
 *
 * @extends {EventEmitter<ReaderEvents>}
 */
class Reader extends EventEmitter {
  /** @type {string} */
  name;
  /** @type {number} */
  #state;
  /** @type {Buffer | null} */
  #atr;
  /** @type {PCSCReader} */
  #native;
  /** @type {boolean} */
  #autoGetResponse;
  /** @type {boolean} */
  #attached;

  /**
   * @param {string} name
   * @param {number} state
   * @param {Buffer | null} atr
   * @param {PCSCReader} native
   * @param {boolean} autoGetResponse
   */
  constructor(name, state, atr, native, autoGetResponse) {
    super();
    this.name = name;
    this.#state = state;
    this.#atr = atr;
    this.#native = native;
    this.#autoGetResponse = autoGetResponse;
    this.#attached = true;
  }

  /** Reader state flags reported by PC/SC. */
  get state() {
    return this.#state;
  }

  /** ATR of the current card, or null when no card is present. */
  get atr() {
    return this.#atr;
  }

  /** Whether the reader is currently attached/available. */
  get attached() {
    return this.#attached;
  }

  /**
   * Internal: swap underlying native reader after detach/reattach.
   * @param {PCSCReader} native
   * @param {number} state
   * @param {Buffer | null} atr
   */
  _rebindNative(native, state, atr) {
    this.#native = native;
    this.#state = state;
    this.#atr = atr;
    this.#attached = true;
  }

  /**
   * Internal: update reader state and ATR from monitor events.
   * @param {number} state
   * @param {Buffer | null} atr
   */
  _syncState(state, atr) {
    this.#state = state;
    this.#atr = atr;
  }

  /**
   * Internal: mark reader as detached while preserving object identity.
   */
  _markDetached() {
    this.#state = 0;
    this.#atr = null;
    this.#attached = false;
  }

  /** Whether a card session is active. */
  get connected() {
    return this.#native.connected;
  }

  /** Active protocol (SCARD_PROTOCOL_T0, T1, RAW, or UNDEFINED when disconnected). */
  get protocol() {
    return this.#native.protocol;
  }

  /**
   * Connect to the card in this reader.
   * @param {number} [shareMode]
   * @param {number} [preferredProtocols]
   */
  async connect(shareMode, preferredProtocols) {
    shareMode ??= ShareMode.SHARED;
    preferredProtocols ??= Protocol.T0 | Protocol.T1;
    await this.#native.connect(shareMode, preferredProtocols);
  }

  /**
   * Send an APDU to the connected card.
   * @param {Buffer | number[]} command
   * @param {number} [maxRecvLength]
   *   Maximum receive buffer size in bytes.
   *   Default: 258 (standard APDU: 256 data + 2 status bytes)
   *   Maximum: 262144 (256KB for extended APDUs)
   * @param {boolean} [autoGetResponse]
   *   Automatically handle T=0 protocol status words:
   *   - SW1=61: Send GET RESPONSE to retrieve remaining data
   *   - SW1=6C: Retry with corrected Le value
   *   Default: true
   * @returns {Promise<Buffer>}
   */
  async transmit(command, maxRecvLength, autoGetResponse) {
    if (!this.#native.connected) throw new Error("Not connected");
    const cmdBuffer = Buffer.isBuffer(command) ? command : Buffer.from(command);
    if (!(autoGetResponse ?? this.#autoGetResponse)) {
      return this.#native.transmit(cmdBuffer, maxRecvLength);
    }
    let response = await this.#native.transmit(cmdBuffer, maxRecvLength);
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
        response = await this.#native.transmit(
          Buffer.from([0x00, 0xc0, 0x00, 0x00, sw2]),
          maxRecvLength,
        );
      } else if (sw1 === 0x6c) {
        let corrected;
        if (cmdBuffer.length < 5) {
          corrected = Buffer.concat([cmdBuffer, Buffer.from([sw2])]);
        } else {
          corrected = Buffer.from(cmdBuffer);
          corrected[corrected.length - 1] = sw2;
        }
        response = await this.#native.transmit(corrected, maxRecvLength);
      } else {
        break;
      }
    }
    if (collectedData.length > 0) {
      collectedData.push(response);
      return Buffer.concat(collectedData);
    }
    return response;
  }

  /**
   * Send a control command to the reader.
   * @param {number} code
   * @param {Buffer | number[]} [data]
   * @returns {Promise<Buffer>}
   */
  async control(code, data) {
    if (!this.#native.connected) throw new Error("Not connected");
    return this.#native.control(code, data);
  }

  /**
   * Disconnect from the card. No-op if already disconnected.
   * @param {number} [disposition]
   */
  disconnect(disposition) {
    if (!this.#native.connected) return;
    this.#native.disconnect(disposition);
  }

  /**
   * Reconnect to the card.
   * @param {number} [shareMode]
   * @param {number} [protocol]
   * @param {number} [initialization]
   */
  async reconnect(shareMode, protocol, initialization) {
    if (!this.#native.connected) throw new Error("Not connected");
    await this.#native.reconnect(shareMode, protocol, initialization);
  }
}

export { Reader };
