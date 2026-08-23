import { randomBytes } from '../bytes.js';

/**
 * Recovery Key - the second, independent way to unwrap the Vault Key when the
 * Master Password is lost (docs/architecture.md §3, step 4).
 *
 * NOTE: the exact user-facing format is open question #5 in
 * docs/open-questions.md, which leans BIP39 word phrases. This module
 * implements a Crockford Base32 grouped code instead, as v1's answer - see
 * docs/decisions/0002-pwa-stack.md. If #5 is ever re-decided, it has to be
 * re-decided BEFORE real vaults exist: a recovery key the user has already
 * written down has to keep working forever, so this format is effectively
 * frozen the moment anyone relies on it.
 */

/**
 * 160 bits. Full-entropy random, so unlike the Master Password it needs no
 * memory-hard KDF to stretch it - see deriveRecoveryWrapKey below.
 */
const RECOVERY_KEY_BYTES = 20;

/**
 * Crockford Base32: no I, L, O, or U. Excluding them means a handwritten
 * recovery key can't be lost to an l/1 or O/0 mix-up, which matters for
 * something people are told to write on paper and file away for years.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP_SIZE = 4;

/** @typedef {{ bytes: Uint8Array, formatted: string }} RecoveryKey */

/** @returns {RecoveryKey} */
export function generateRecoveryKey() {
  const bytes = randomBytes(RECOVERY_KEY_BYTES);
  return { bytes, formatted: format(bytes) };
}

/**
 * Parse a recovery key the user typed back in. Tolerant on input - case,
 * spacing, dashes, and the classic I/L/O confusions are all normalised away,
 * because the alternative is a user who has the right key on paper and still
 * can't get into their vault.
 *
 * @param {string} input
 * @returns {Uint8Array} the raw 20 bytes
 * @throws if the code isn't a well-formed recovery key
 */
export function parseRecoveryKey(input) {
  const normalised = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

  const expectedChars = Math.ceil((RECOVERY_KEY_BYTES * 8) / 5);
  if (normalised.length !== expectedChars) {
    throw new Error(
      `Recovery key should be ${expectedChars} characters, got ${normalised.length}`,
    );
  }

  const bits = [];
  for (const char of normalised) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid character in recovery key: ${char}`);
    for (let i = 4; i >= 0; i--) bits.push((value >> i) & 1);
  }

  const bytes = new Uint8Array(RECOVERY_KEY_BYTES);
  for (let i = 0; i < RECOVERY_KEY_BYTES; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * Derive the AES key that wraps the Vault Key for recovery.
 *
 * HKDF, not Argon2id, and that difference is deliberate: a memory-hard KDF
 * exists to make guessing a *low-entropy* human-chosen secret expensive. The
 * recovery key is 160 random bits, so there is nothing to guess and nothing
 * for slowness to buy - HKDF just turns those bytes into a properly-formed
 * 256-bit AES key.
 *
 * @param {Uint8Array} recoveryKeyBytes
 * @param {Uint8Array} salt the same per-user KDF salt stored in the KEYS item
 * @returns {Promise<Uint8Array>} 32 raw bytes
 */
export async function deriveRecoveryWrapKey(recoveryKeyBytes, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    recoveryKeyBytes,
    'HKDF',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode('smallstash-recovery-wrap-v1'),
    },
    baseKey,
    256,
  );
  return new Uint8Array(derived);
}

/** @param {Uint8Array} bytes */
function format(bytes) {
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }

  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    // The final group is zero-padded on the right: 160 bits isn't a multiple
    // of 5, so the last symbol carries 3 real bits. parseRecoveryKey drops
    // that padding again by only reading RECOVERY_KEY_BYTES back out.
    let value = 0;
    for (let b = 0; b < 5; b++) value = (value << 1) | (bits[i + b] ?? 0);
    out += ALPHABET[value];
  }

  return out.match(new RegExp(`.{1,${GROUP_SIZE}}`, 'g')).join('-');
}
