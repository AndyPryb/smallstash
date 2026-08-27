/**
 * Human-readable file size, e.g. `formatFileSize(1536)` → `"1.5 KB"`.
 *
 * Decimal (KB = 1000 bytes), not binary (KiB = 1024) - matches what a
 * browser's own file picker and every OS file manager show a user, which is
 * the number they'll actually be comparing this against. The rest of this
 * app uses binary units in code/docs (`MAX_FILE_SIZE_BYTES`, `512 KiB`)
 * because those describe real memory/storage boundaries; this one is purely
 * user-facing display, a different audience with a different convention.
 */

const UNITS = ['bytes', 'KB', 'MB', 'GB'];

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} bytes`;

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < UNITS.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  // One decimal place, except when it would show a trailing ".0" - "12 MB"
  // reads better than "12.0 MB", but "1.5 MB" needs the digit.
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${UNITS[unitIndex]}`;
}
