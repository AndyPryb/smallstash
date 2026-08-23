import { openDB } from 'idb';

/**
 * Offline cache, IndexedDB-backed - resolves docs/todo.md "PWA: offline
 * access to key material".
 *
 * WHAT THIS SOLVES: docs/architecture.md already caches the vault
 * *ciphertext* offline, but unlocking that ciphertext needs the KEYS item
 * (salt, KDF params, wrapped Vault Key) too - and that came from a network
 * call (GET /keys). So without this file, "offline" only half-worked: you
 * could re-open a previously-loaded vault, but only until you closed the tab,
 * because next time there'd be ciphertext with nothing to unlock it with, and
 * no network to go fetch it.
 *
 * WHY THIS IS SAFE: everything stored here is exactly what the server
 * already stores and already sends over the wire on every login - a salt (not
 * secret), KDF cost parameters (not secret), and the Vault Key *wrapped*
 * (still encrypted) by the Master Key or Recovery Key. None of it is usable
 * without the Master Password or Recovery Key, neither of which is ever
 * written here. Caching it locally exposes nothing that the server-side copy
 * doesn't already. The one new risk this adds is a *device* one, not a
 * crypto one - a lost/stolen unlocked device - which is a device-security
 * problem, not something smallStash's threat model changes.
 *
 * NEVER add to this file: the derived Master Key, the unwrapped Vault Key, or
 * plaintext vault contents. Those stay in-memory-only per architecture.md §5
 * ("Master Key session persistence").
 */

const DB_NAME = 'smallstash';
const DB_VERSION = 1;
const KEY_MATERIAL_STORE = 'keyMaterial';
const VAULT_STORE = 'vaultCiphertext';

/** @returns {Promise<import('idb').IDBPDatabase>} */
function db() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore(KEY_MATERIAL_STORE); // keyed by cognito sub
      database.createObjectStore(VAULT_STORE); // keyed by cognito sub
    },
  });
}

/**
 * @param {string} sub Cognito sub - the same identity used server-side as
 *   DynamoDB PK / S3 key prefix (docs/architecture.md §5)
 * @param {import('../crypto/vault.js').UserKeys} userKeys
 */
export async function cacheKeyMaterial(sub, userKeys) {
  const database = await db();
  await database.put(KEY_MATERIAL_STORE, { ...userKeys, cachedAt: Date.now() }, sub);
}

/**
 * @param {string} sub
 * @returns {Promise<(import('../crypto/vault.js').UserKeys & { cachedAt: number }) | undefined>}
 */
export async function getCachedKeyMaterial(sub) {
  const database = await db();
  return database.get(KEY_MATERIAL_STORE, sub);
}

/**
 * @param {string} sub
 * @param {string} ciphertextBase64
 * @param {string} versionId
 */
export async function cacheVault(sub, ciphertextBase64, versionId) {
  const database = await db();
  await database.put(VAULT_STORE, { ciphertextBase64, versionId, cachedAt: Date.now() }, sub);
}

/**
 * @param {string} sub
 * @returns {Promise<{ ciphertextBase64: string, versionId: string, cachedAt: number } | undefined>}
 */
export async function getCachedVault(sub) {
  const database = await db();
  return database.get(VAULT_STORE, sub);
}

/**
 * Called after a successful Master Password change: the freshly-fetched
 * keyVersion becomes the new source of truth, and a stale cache pointing at
 * old wrapped keys must not silently keep being used on this or any other
 * device (see docs/todo.md "Staleness handling").
 *
 * @param {import('../crypto/vault.js').UserKeys} cached
 * @param {import('../crypto/vault.js').UserKeys} fromServer
 * @returns {boolean} true if the cache is stale and must be refreshed before unlock
 */
export function isKeyMaterialStale(cached, fromServer) {
  return !cached || cached.keyVersion !== fromServer.keyVersion;
}

/**
 * Wipe everything cached for a user.
 *
 * NOT called from sign-out - deliberately. Offline unlock only works because
 * this cache survives across sign-outs (that's the whole point: sign out,
 * close the browser, come back later with no network, still get in). Calling
 * this on sign-out would quietly break offline unlock the very next time it
 * was needed. Reserve this for a real "forget this device"/"wipe local data"
 * action, if one is ever built - not currently wired into any UI.
 */
export async function clearCache(sub) {
  const database = await db();
  await database.delete(KEY_MATERIAL_STORE, sub);
  await database.delete(VAULT_STORE, sub);
}
