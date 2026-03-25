/**
 * Card wrapper that adds autoGetResponse support to card.transmit()
 *
 * Wraps the native Card object to intercept transmit() calls and
 * automatically handle T=0 protocol status words when autoGetResponse is set.
 */

/** @typedef {import('./types.js').Card} Card */
/** @typedef {import('./types.js').CardStatus} CardStatus */
/** @typedef {import('./types.js').TransmitOptions} TransmitOptions */

import { transmitWithAutoResponse } from "./t0-handler.js";

/**
 * Wraps a native Card to add autoGetResponse support to transmit()
 */
class CardWrapper {
  /** @param {Card} nativeCard */
  constructor(nativeCard) {
    /** @private @type {Card} */
    this._nativeCard = nativeCard;
  }

  /** @returns {number} */
  get protocol() {
    return this._nativeCard.protocol;
  }

  /** @returns {boolean} */
  get connected() {
    return this._nativeCard.connected;
  }

  /** @returns {Buffer | null} */
  get atr() {
    return this._nativeCard.atr;
  }

  /**
   * @param {Buffer | number[]} command
   * @param {TransmitOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async transmit(command, options) {
    if (options?.autoGetResponse) {
      // Delegate to transmitWithAutoResponse for T=0 handling
      return transmitWithAutoResponse(this._nativeCard, command, options);
    }
    // Pass through to native transmit
    return this._nativeCard.transmit(command, options);
  }

  /**
   * @param {number} code
   * @param {Buffer | number[]} [data]
   * @returns {Promise<Buffer>}
   */
  control(code, data) {
    return this._nativeCard.control(code, data);
  }

  /** @returns {CardStatus} */
  getStatus() {
    return this._nativeCard.getStatus();
  }

  /** @param {number} [disposition] */
  disconnect(disposition) {
    return this._nativeCard.disconnect(disposition);
  }

  /**
   * @param {number} [shareMode]
   * @param {number} [protocol]
   * @param {number} [initialization]
   * @returns {Promise<number>}
   */
  async reconnect(shareMode, protocol, initialization) {
    return this._nativeCard.reconnect(shareMode, protocol, initialization);
  }
}

/**
 * Wrap a native card with autoGetResponse support
 * @param {Card} nativeCard
 * @returns {Card}
 */
function wrapCard(nativeCard) {
  return new CardWrapper(nativeCard);
}

export { CardWrapper, wrapCard };
