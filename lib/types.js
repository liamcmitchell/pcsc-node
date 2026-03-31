/**
 * Type definitions for the PC/SC addon.
 *
 * This file contains only JSDoc typedefs — no runtime code.
 * Types are checked by `tsc --checkJs`.
 */

/**
 * Card status information
 * @typedef {object} CardStatus
 * @property {number} state
 * @property {number} protocol
 * @property {Buffer} atr
 */

/**
 * Options for reader.transmit()
 * @typedef {object} TransmitOptions
 * @property {number} [maxRecvLength]
 *   Maximum receive buffer size in bytes.
 *   Default: 258 (standard APDU: 256 data + 2 status bytes)
 *   Maximum: 262144 (256KB for extended APDUs)
 * @property {boolean} [autoGetResponse]
 *   Automatically handle T=0 protocol status words:
 *   - SW1=61: Send GET RESPONSE to retrieve remaining data
 *   - SW1=6C: Retry with corrected Le value
 *   Default: false (raw responses returned)
 */

/**
 * PC/SC reader — a stateful object owned by the Context.
 *
 * Tracks reader state (name, state flags, ATR) and owns the SCARDHANDLE
 * when connected. Card operations are methods on the reader itself.
 *
 * @typedef {object} Reader
 * @property {string} name - The reader name
 * @property {number} state - Current state flags (SCARD_STATE_*)
 * @property {Buffer | null} atr - ATR of the card if present
 * @property {boolean} connected - Whether a card session is active
 * @property {number | null} protocol - Active protocol when connected (T0, T1, RAW), null when disconnected
 * @property {(shareMode?: number, preferredProtocols?: number) => Promise<void>} connect - Connect to the card in this reader
 * @property {(command: Buffer | number[], options?: TransmitOptions) => Promise<Buffer>} transmit - Send APDU to connected card
 * @property {(code: number, data?: Buffer | number[]) => Promise<Buffer>} control - Send control command to reader
 * @property {() => CardStatus} getStatus - Get card status (state, protocol, ATR)
 * @property {(disposition?: number) => void} disconnect - Disconnect from card
 * @property {(shareMode?: number, protocol?: number, initialization?: number) => Promise<number>} reconnect - Reconnect to card
 */

/**
 * PC/SC context — one per application.
 *
 * Owns a single SCARDCONTEXT, manages Reader objects, and runs a
 * background monitor thread for state change detection.
 *
 * @typedef {object} Context
 * @property {boolean} isValid - Whether the context is still valid
 * @property {ReadonlyMap<string, Reader>} readers - Currently known readers
 * @property {() => void} close - Release context and stop monitoring
 */

/**
 * Options for Context constructor
 * @typedef {object} ContextOptions
 * @property {(reader: Reader) => void} [onReaderAttached] - New reader detected
 * @property {(reader: Reader) => void} [onReaderDetached] - Reader removed
 * @property {(reader: Reader) => void} [onCardInserted] - Card inserted (reader has card present)
 * @property {(reader: Reader) => void} [onCardRemoved] - Card removed
 * @property {(reader: Reader, prevState: number) => void} [onReaderChange] - Any state change (reader has new state, prevState is old)
 * @property {(error: Error) => void} [onError] - Error during monitoring
 * @property {boolean} [autoGetResponse] - Auto-handle T=0 GET RESPONSE / Le correction
 * @property {boolean} [autoConnect] - Automatically connect when card is inserted (default: true)
 */

export {};
