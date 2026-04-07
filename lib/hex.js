/**
 * Format an integer as uppercase hexadecimal with a 0x prefix.
 * @param {number} value
 * @param {number} [minWidth=0]
 * @returns {string}
 */
function toHex(value, minWidth = 0) {
  if (!Number.isFinite(value)) return String(value);
  const integer = Math.trunc(value);
  const normalized = integer < 0 ? integer >>> 0 : integer;
  const hex = normalized.toString(16).toUpperCase().padStart(minWidth, "0");
  return `0x${hex}`;
}

export { toHex };
