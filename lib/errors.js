/**
 * Base error class for PC/SC errors
 */
class PCSCError extends Error {
  /**
   * @param {string} message
   * @param {number} code
   */
  constructor(message, code) {
    super(message);
    this.name = "PCSCError";
    /** @readonly @type {number} */
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when a card is removed during an operation
 */
class CardRemovedError extends PCSCError {
  /** @param {string} [message] */
  constructor(message = "Card was removed") {
    super(message, 0x80100069);
    this.name = "CardRemovedError";
  }
}

/**
 * Error thrown when an operation times out
 */
class TimeoutError extends PCSCError {
  /** @param {string} [message] */
  constructor(message = "Operation timed out") {
    super(message, 0x8010000a);
    this.name = "TimeoutError";
  }
}

/**
 * Error thrown when no readers are available
 */
class NoReadersError extends PCSCError {
  /** @param {string} [message] */
  constructor(message = "No readers available") {
    super(message, 0x8010002e);
    this.name = "NoReadersError";
  }
}

/**
 * Error thrown when PC/SC service is not running
 */
class ServiceNotRunningError extends PCSCError {
  /** @param {string} [message] */
  constructor(message = "PC/SC service not running") {
    super(message, 0x8010001d);
    this.name = "ServiceNotRunningError";
  }
}

/**
 * Error thrown when there's a sharing violation
 */
class SharingViolationError extends PCSCError {
  /** @param {string} [message] */
  constructor(message = "Sharing violation - card is in use") {
    super(message, 0x8010000b);
    this.name = "SharingViolationError";
  }
}

/**
 * PC/SC error codes mapped to specific error classes
 * @type {Map<number, new (message?: string) => PCSCError>}
 */
const ERROR_CODE_MAP = new Map([
  [0x80100069, CardRemovedError], // SCARD_W_REMOVED_CARD
  [0x8010000a, TimeoutError], // SCARD_E_TIMEOUT
  [0x8010002e, NoReadersError], // SCARD_E_NO_READERS_AVAILABLE
  [0x8010001d, ServiceNotRunningError], // SCARD_E_NO_SERVICE
  [0x8010000b, SharingViolationError], // SCARD_E_SHARING_VIOLATION
]);

/**
 * Factory function to create the appropriate error class based on PC/SC error code
 * @param {string} message
 * @param {number} code
 * @returns {PCSCError}
 */
function createPCSCError(message, code) {
  const ErrorClass = ERROR_CODE_MAP.get(code);
  if (ErrorClass) {
    return new ErrorClass(message);
  }
  return new PCSCError(message, code);
}

export {
  PCSCError,
  CardRemovedError,
  TimeoutError,
  NoReadersError,
  ServiceNotRunningError,
  SharingViolationError,
  createPCSCError,
};
