/**
 * Byte/string conversions. Kept in one place so the crypto modules never
 * hand-roll base64 or UTF-8 handling inline - a subtle bug here corrupts
 * ciphertext, and corrupted ciphertext means a permanently unreadable vault.
 */

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** @param {string} base64 @returns {Uint8Array} */
export function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {string} text @returns {Uint8Array} */
export function utf8(text) {
  return new TextEncoder().encode(text);
}

/** @param {Uint8Array} bytes @returns {string} */
export function fromUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

/** @param {number} length @returns {Uint8Array} */
export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Overwrite a byte array in place. Best-effort only: JS gives no guarantee
 * the value hasn't already been copied by the GC, and it does nothing for
 * `string` secrets, which are immutable and stay until collected. Worth
 * doing for key material anyway - it shortens the window, it just doesn't
 * close it.
 * @param {Uint8Array} bytes
 */
export function wipe(bytes) {
  bytes.fill(0);
}
