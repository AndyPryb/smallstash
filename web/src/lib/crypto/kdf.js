import { argon2id } from 'hash-wasm';
import { utf8 } from '../bytes.js';

/**
 * Argon2id key derivation - the Master Password -> Master Key step from
 * docs/architecture.md §3. Runs in the browser and nowhere else; nothing in
 * this file may ever be called from, or have its inputs sent to, a server.
 *
 * WebCrypto has no native Argon2id, hence the WASM dependency (hash-wasm -
 * see docs/decisions/0002-pwa-stack.md for why this one). The WASM binary is
 * embedded as base64 inside the JS bundle, so there is no second network
 * fetch and this keeps working with no network at all.
 */

/**
 * Defaults for a *new* vault. Existing vaults always derive with the params
 * stored server-side alongside their salt, never with these - raising the
 * defaults later must not make already-encrypted vaults underivable.
 *
 * 64 MiB / t=3 / p=1 is above the OWASP Argon2id floor (19 MiB, t=2) with
 * headroom, and is what tests/api/keys.test.js already round-trips.
 */
export const DEFAULT_KDF_PARAMS = Object.freeze({
  kdfMemoryKib: 65536,
  kdfIterations: 3,
  kdfParallelism: 1,
});

/** Length of every key this app derives or generates: AES-256 -> 32 bytes. */
export const KEY_LENGTH = 32;

/**
 * @typedef {object} KdfParams
 * @property {number} kdfMemoryKib
 * @property {number} kdfIterations
 * @property {number} kdfParallelism
 */

/**
 * Derive the Master Key from the Master Password.
 *
 * @param {string} masterPassword the user's Master Password - NOT the Cognito
 *   login password. These are two independent secrets (architecture.md §5);
 *   never pass one where the other is expected.
 * @param {Uint8Array} salt per-user, from the server's KEYS item
 * @param {KdfParams} params
 * @returns {Promise<Uint8Array>} 32 raw bytes, caller-owned
 */
export async function deriveMasterKey(masterPassword, salt, params) {
  if (salt.length < 16) {
    throw new Error(`KDF salt must be at least 16 bytes, got ${salt.length}`);
  }
  return argon2id({
    password: utf8(masterPassword),
    salt,
    memorySize: params.kdfMemoryKib,
    iterations: params.kdfIterations,
    parallelism: params.kdfParallelism,
    hashLength: KEY_LENGTH,
    outputType: 'binary',
  });
}
