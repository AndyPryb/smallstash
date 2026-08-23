import { randomBytes } from '../bytes.js';

/**
 * AES-256-GCM via WebCrypto. Every encrypted blob this app produces - wrapped
 * keys and the vault itself - uses this one sealed format:
 *
 *     [0] version (1 byte, currently 0x01)
 *     [1..13) IV (12 bytes, freshly random per encryption)
 *     [13..]  ciphertext || GCM tag (16 bytes)
 *
 * The leading version byte exists so the format can change later without
 * guessing at what old blobs are - a password manager has to stay able to
 * read everything it has ever written.
 */

const FORMAT_VERSION = 1;
const IV_LENGTH = 12; // 96 bits, the GCM-recommended size
const MIN_SEALED_LENGTH = 1 + IV_LENGTH + 16; // version + IV + bare tag

/**
 * IV reuse under the same key is the one catastrophic misuse of GCM (it leaks
 * plaintext XORs and can expose the authentication key), so the IV is
 * generated here on every call and is never a parameter.
 *
 * @param {Uint8Array} keyBytes 32 raw bytes
 * @param {Uint8Array} plaintext
 * @returns {Promise<Uint8Array>} sealed blob in the format above
 */
export async function seal(keyBytes, plaintext) {
  const key = await importKey(keyBytes);
  const iv = randomBytes(IV_LENGTH);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );

  const sealed = new Uint8Array(1 + IV_LENGTH + ciphertext.length);
  sealed[0] = FORMAT_VERSION;
  sealed.set(iv, 1);
  sealed.set(ciphertext, 1 + IV_LENGTH);
  return sealed;
}

/**
 * @param {Uint8Array} keyBytes 32 raw bytes
 * @param {Uint8Array} sealed
 * @returns {Promise<Uint8Array>} plaintext
 * @throws if the key is wrong or the blob was tampered with - GCM
 *   authenticates, so a wrong Master Password surfaces here as a failed
 *   decrypt rather than as silent garbage.
 */
export async function open(keyBytes, sealed) {
  if (sealed.length < MIN_SEALED_LENGTH) {
    throw new Error('Encrypted blob is truncated or not in smallStash format');
  }
  if (sealed[0] !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported encryption format version ${sealed[0]} - this vault was ` +
        'written by a newer version of smallStash',
    );
  }

  const key = await importKey(keyBytes);
  const iv = sealed.subarray(1, 1 + IV_LENGTH);
  const ciphertext = sealed.subarray(1 + IV_LENGTH);

  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
  );
}

/**
 * `extractable: false` - once raw bytes become a CryptoKey they can no longer
 * be read back out of it, so an accidental log/serialize of this object
 * cannot leak the key.
 * @param {Uint8Array} keyBytes
 */
function importKey(keyBytes) {
  if (keyBytes.length !== 32) {
    throw new Error(`AES-256 key must be 32 bytes, got ${keyBytes.length}`);
  }
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
