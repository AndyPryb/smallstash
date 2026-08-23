import { signIn } from './auth/cognito.js';
import { getKeys, putKeys, getVault, putVault } from './api/client.js';
import {
  createKeyMaterial,
  unlockWithMasterPassword,
  encryptVault,
  decryptVault,
} from './crypto/vault.js';
import { wipe } from './bytes.js';
import {
  cacheKeyMaterial,
  getCachedKeyMaterial,
  cacheVault,
  getCachedVault,
  isKeyMaterialStale,
} from './cache/db.js';
import { config } from './config.js';

/**
 * Ties the pieces together: Cognito login -> fetch/cache key material ->
 * derive Master Key -> unwrap Vault Key -> decrypt vault. This is the one
 * place allowed to hold the live Vault Key, and only in a module-level
 * variable - never localStorage/IndexedDB/anything persistent
 * (docs/architecture.md §5 "Master Key session caching").
 */

/** @type {{ sub: string, idToken: string, vaultKey: Uint8Array } | null} */
let active = null;

/**
 * Online path: sign in via Cognito SRP, fetch key material + vault from the
 * API, derive/unwrap, decrypt. Also refreshes the offline cache so a later
 * unlockOffline() has something current to work with.
 *
 * @param {string} email
 * @param {string} loginPassword Cognito password - independent of masterPassword
 * @param {string} masterPassword vault Master Password
 * @returns {Promise<object>} the decrypted vault document
 */
export async function signInAndUnlock(email, loginPassword, masterPassword) {
  const { idToken, sub } = await authenticate(email, loginPassword);

  const userKeys = await getKeys(idToken);
  await cacheKeyMaterial(sub, userKeys);

  const vaultKey = await unlockWithMasterPassword(userKeys, masterPassword);

  const { ciphertextBase64, versionId } = await getVault(idToken);
  await cacheVault(sub, ciphertextBase64, versionId);

  active = { sub, idToken, vaultKey };
  return decryptVault(vaultKey, ciphertextBase64);
}

/**
 * Offline path: no Cognito call, no API call - unlock entirely from what's
 * cached in IndexedDB. This only works if signInAndUnlock (or a prior
 * offline unlock) has already populated the cache on this device at least
 * once; there is no such thing as offline on a device that has never been
 * online for this account.
 *
 * @param {string} sub the Cognito sub to unlock for (known from a prior session)
 * @param {string} masterPassword
 * @returns {Promise<object>} the decrypted vault document
 */
export async function unlockOffline(sub, masterPassword) {
  const userKeys = await getCachedKeyMaterial(sub);
  const cachedVault = await getCachedVault(sub);
  if (!userKeys || !cachedVault) {
    throw new Error('No cached vault for this account on this device - go online at least once first');
  }

  const vaultKey = await unlockWithMasterPassword(userKeys, masterPassword);

  // active.idToken stays unset here (no network -> no fresh JWT); any write
  // attempt while in this state must re-authenticate first, not silently
  // fail against a stale/expired token.
  active = { sub, idToken: null, vaultKey };
  return decryptVault(vaultKey, cachedVault.ciphertextBase64);
}

/**
 * First-time setup for a brand-new account: mint key material, upload it,
 * upload an empty vault. Caller is responsible for showing the returned
 * Recovery Key to the user before this promise's caller returns control -
 * it is never stored anywhere, by us or by the server.
 *
 * @param {string} idToken from a just-completed signIn/confirmSignUp
 * @param {string} sub
 * @param {string} masterPassword
 * @returns {Promise<{ recoveryKey: string }>}
 */
export async function initializeVault(idToken, sub, masterPassword) {
  const { userKeys, vaultKey, recoveryKey } = await createKeyMaterial(masterPassword);

  await putKeys(idToken, userKeys);
  const ciphertextBase64 = await encryptVault(vaultKey, { entries: [] });
  const { versionId } = await putVault(idToken, ciphertextBase64);

  await cacheKeyMaterial(sub, userKeys);
  await cacheVault(sub, ciphertextBase64, versionId);

  active = { sub, idToken, vaultKey };
  return { recoveryKey };
}

/**
 * Re-encrypt and upload the current in-memory vault key material. Requires
 * an online session (a valid idToken) - offline sessions can view/edit
 * locally, but syncing needs network by definition.
 *
 * @param {object} vaultDocument
 */
export async function saveVault(vaultDocument) {
  if (!active) throw new Error('No active session');
  if (!active.idToken) throw new Error('Cannot save while offline - reconnect and sign in again');

  const ciphertextBase64 = await encryptVault(active.vaultKey, vaultDocument);
  const { versionId } = await putVault(active.idToken, ciphertextBase64);
  await cacheVault(active.sub, ciphertextBase64, versionId);
}

/**
 * Detects a stale offline cache after a Master Password change elsewhere
 * (docs/todo.md "Staleness handling") - call once back online, before
 * trusting a cached unlock.
 * @param {string} sub
 */
export async function refreshCacheIfStale(sub, idToken) {
  const cached = await getCachedKeyMaterial(sub);
  const fromServer = await getKeys(idToken);
  if (isKeyMaterialStale(cached, fromServer)) {
    await cacheKeyMaterial(sub, fromServer);
  }
  return fromServer;
}

/** Clear the in-memory Vault Key. Call on tab close / inactivity timeout / sign-out. */
export function clearSession() {
  if (active) wipe(active.vaultKey);
  active = null;
}

/** @returns {string | null} the current session's Cognito sub, or null if none */
export function currentSub() {
  return active?.sub ?? null;
}

async function authenticate(email, loginPassword) {
  const { idToken } = await signIn({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    email,
    password: loginPassword,
  });
  const sub = decodeSub(idToken);
  return { idToken, sub };
}

/** Cognito ID tokens are JWTs; `sub` is a standard claim in the payload. */
function decodeSub(idToken) {
  const payload = idToken.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json).sub;
}
