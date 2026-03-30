/**
 * Type definitions for the native PC/SC addon.
 *
 * This file contains only JSDoc typedefs — no runtime code.
 * Types are checked by `tsc --checkJs`.
 */

/**
 * Reader state information returned from waitForChange
 * @typedef {object} ReaderState
 * @property {string} name
 * @property {number} state
 * @property {boolean} changed
 * @property {Buffer | null} atr
 */

/**
 * Card status information
 * @typedef {object} CardStatus
 * @property {number} state
 * @property {number} protocol
 * @property {Buffer} atr
 */

/**
 * Options for card.transmit()
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
 * Represents a connected smart card
 * @typedef {object} Card
 * @property {number} protocol - The active protocol (T0, T1, or RAW)
 * @property {boolean} connected - Whether the card is still connected
 * @property {Buffer | null} atr - The card's ATR (Answer To Reset)
 * @property {(command: Buffer | number[], options?: TransmitOptions) => Promise<Buffer>} transmit
 * @property {(code: number, data?: Buffer | number[]) => Promise<Buffer>} control
 * @property {() => CardStatus} getStatus
 * @property {(disposition?: number) => void} disconnect
 * @property {(shareMode?: number, protocol?: number, initialization?: number) => Promise<number>} reconnect
 */

/**
 * Represents a smart card reader
 * @typedef {object} Reader
 * @property {string} name - The reader name
 * @property {number} state - Current reader state flags
 * @property {Buffer | null} atr - ATR of the card if present
 * @property {(shareMode?: number, protocol?: number) => Promise<Card>} connect
 */

/**
 * Low-level PC/SC context
 * @typedef {object} Context
 * @property {boolean} isValid - Whether the context is still valid
 * @property {() => Reader[]} listReaders
 * @property {(readers?: Reader[] | ReaderState[], timeout?: number) => Promise<ReaderState[] | null>} waitForChange
 * @property {() => void} cancel
 * @property {() => void} close
 */

/**
 * Monitor event from native ReaderMonitor
 * @typedef {object} MonitorEvent
 * @property {'reader-attached' | 'reader-detached' | 'card-inserted' | 'card-removed' | 'error'} type
 * @property {string} reader
 * @property {number} state
 * @property {Buffer | null} atr
 */

/**
 * Native PC/SC event monitor using ThreadSafeFunction
 * @typedef {object} ReaderMonitor
 * @property {boolean} isRunning - Whether the monitor is currently running
 * @property {(callback: (event: MonitorEvent) => void) => void} start
 * @property {() => void} stop
 */

/**
 * Partial reader info emitted in device events
 * @typedef {object} ReaderEventInfo
 * @property {string} name
 * @property {number} [state]
 * @property {Buffer | null} [atr]
 */

/**
 * Constructor for Context
 * @typedef {new () => Context} ContextConstructor
 */

/**
 * Constructor for ReaderMonitor
 * @typedef {new () => ReaderMonitor} ReaderMonitorConstructor
 */

/**
 * Options for Devices class constructor (for dependency injection)
 * @typedef {object} DevicesOptions
 * @property {ContextConstructor} [Context]
 * @property {ReaderMonitorConstructor} [ReaderMonitor]
 * @property {number} [SCARD_STATE_PRESENT]
 * @property {number} [SCARD_SHARE_SHARED]
 * @property {number} [SCARD_PROTOCOL_T0]
 * @property {number} [SCARD_PROTOCOL_T1]
 */

/**
 * Reader state tracked by the client
 * @typedef {object} ReaderInfo
 * @property {string} name
 * @property {number} state
 * @property {Buffer | null} atr
 * @property {Card | null} card
 */

/**
 * Options for createClient()
 * @typedef {object} ClientOptions
 * @property {(info: { name: string, state: number, atr: Buffer | null }) => void} [onReaderAttached]
 * @property {(info: { name: string }) => void} [onReaderDetached]
 * @property {(info: { name: string, card: Card, atr: Buffer | null }) => void} [onCardInserted]
 * @property {(info: { name: string, card: Card | null }) => void} [onCardRemoved]
 * @property {(error: Error) => void} [onError]
 * @property {boolean} [autoGetResponse]
 * @property {ContextConstructor} [Context]
 * @property {ReaderMonitorConstructor} [ReaderMonitor]
 * @property {number} [SCARD_STATE_PRESENT]
 * @property {number} [SCARD_SHARE_SHARED]
 * @property {number} [SCARD_PROTOCOL_T0]
 * @property {number} [SCARD_PROTOCOL_T1]
 */

/**
 * Native addon interface
 * @typedef {object} NativeAddon
 * @property {ContextConstructor} Context
 * @property {*} Reader
 * @property {*} Card
 * @property {ReaderMonitorConstructor} ReaderMonitor
 * @property {number} SCARD_SHARE_EXCLUSIVE
 * @property {number} SCARD_SHARE_SHARED
 * @property {number} SCARD_SHARE_DIRECT
 * @property {number} SCARD_PROTOCOL_T0
 * @property {number} SCARD_PROTOCOL_T1
 * @property {number} SCARD_PROTOCOL_RAW
 * @property {number} SCARD_PROTOCOL_UNDEFINED
 * @property {number} SCARD_LEAVE_CARD
 * @property {number} SCARD_RESET_CARD
 * @property {number} SCARD_UNPOWER_CARD
 * @property {number} SCARD_EJECT_CARD
 * @property {number} SCARD_STATE_UNAWARE
 * @property {number} SCARD_STATE_IGNORE
 * @property {number} SCARD_STATE_CHANGED
 * @property {number} SCARD_STATE_UNKNOWN
 * @property {number} SCARD_STATE_UNAVAILABLE
 * @property {number} SCARD_STATE_EMPTY
 * @property {number} SCARD_STATE_PRESENT
 * @property {number} SCARD_STATE_ATRMATCH
 * @property {number} SCARD_STATE_EXCLUSIVE
 * @property {number} SCARD_STATE_INUSE
 * @property {number} SCARD_STATE_MUTE
 */

export {};
