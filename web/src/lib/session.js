import {
  signIn,
  signUp as cognitoSignUp,
  confirmSignUp as cognitoConfirmSignUp,
  submitMfaCode,
  MfaRequiredError,
} from './auth/cognito.js';

// Re-exported so callers (App.svelte) only need to import from session.js,
// not reach into auth/cognito.js directly for this one type check.
export { MfaRequiredError };
import { getKeys, putKeys, getVault, putVault } from './api/client.js';
import {
  createKeyMaterial,
  unlockWithMasterPassword,
  rewrapWithNewMasterPassword,
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
 * Remembers which account last signed in successfully on this device, so an
 * offline unlock attempt knows *whose* cached key material to reach for
 * without asking the user to somehow supply their Cognito sub. Email and sub
 * are both non-secret (architecture.md §5 - sub is already the public
 * DynamoDB PK / S3 key prefix), so localStorage is fine for this - nothing
 * here is usable without the Master Password, same as the IndexedDB cache
 * itself (see cache/db.js's header comment for the fuller version of this
 * argument).
 */
const LAST_ACCOUNT_KEY = 'smallstash:lastAccount';

function rememberAccount(email, sub) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify({ email, sub }));
  } catch {
    // Private browsing / storage disabled - offline unlock just won't have
    // an account to offer next time. Not fatal to the online flow.
  }
}

/** @returns {{ email: string, sub: string } | null} the last account that signed in on this device */
export function getLastAccount() {
  try {
    const raw = localStorage.getItem(LAST_ACCOUNT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Set when a signInAndUnlock() attempt is paused mid-flow by Cognito
 * demanding an MFA code (see auth/cognito.js's MfaRequiredError) - holds
 * everything completeMfaLogin() needs to finish that same attempt without
 * making the user re-enter their login password or Master Password. Cleared
 * only once the MFA code itself is accepted (see completeMfaLogin) - a wrong
 * code should let the user retry the code, not restart the whole login.
 * @type {{ cognitoUser: import('amazon-cognito-identity-js').CognitoUser, email: string, masterPassword: string } | null}
 */
let pendingMfa = null;

/**
 * Online path: sign in via Cognito SRP, fetch key material + vault from the
 * API, derive/unwrap, decrypt. Also refreshes the offline cache so a later
 * unlockOffline() has something current to work with.
 *
 * @param {string} email
 * @param {string} loginPassword Cognito password - independent of masterPassword
 * @param {string} masterPassword vault Master Password
 * @returns {Promise<object>} the decrypted vault document
 * @throws {MfaRequiredError} if the account has MFA enabled - catch this
 *   specifically, prompt for a code, then call completeMfaLogin(code)
 */
export async function signInAndUnlock(email, loginPassword, masterPassword) {
  let idToken, sub;
  try {
    ({ idToken, sub } = await authenticate(email, loginPassword));
  } catch (err) {
    if (err instanceof MfaRequiredError) {
      pendingMfa = { cognitoUser: err.cognitoUser, email, masterPassword };
    }
    throw err;
  }
  return finishOnlineUnlock(idToken, sub, masterPassword);
}

/**
 * Completes a signInAndUnlock() attempt that was paused by an
 * MfaRequiredError.
 *
 * @param {string} code the code from the user's authenticator app
 * @returns {Promise<object>} the decrypted vault document
 */
export async function completeMfaLogin(code) {
  if (!pendingMfa) throw new Error('No sign-in is currently waiting on an MFA code');
  const { cognitoUser, email, masterPassword } = pendingMfa;

  const { idToken } = await submitMfaCode(cognitoUser, code);
  // Only cleared on success - a wrong code should be retryable without
  // forcing the user back through email/login password/Master Password.
  pendingMfa = null;

  const sub = decodeSub(idToken);
  rememberAccount(email, sub);
  return finishOnlineUnlock(idToken, sub, masterPassword);
}

/** Abandon a pending MFA login (e.g. user clicks "cancel" on the code prompt). */
export function cancelMfaLogin() {
  pendingMfa = null;
}

/** @returns {boolean} whether a signInAndUnlock() attempt is waiting on an MFA code */
export function isMfaPending() {
  return pendingMfa !== null;
}

async function finishOnlineUnlock(idToken, sub, masterPassword) {
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
 * @returns {Promise<{ recoveryKey: string, vaultDocument: object }>}
 */
export async function initializeVault(idToken, sub, masterPassword) {
  const { userKeys, vaultKey, recoveryKey } = await createKeyMaterial(masterPassword);
  const vaultDocument = { entries: [] };

  await putKeys(idToken, userKeys);
  const ciphertextBase64 = await encryptVault(vaultKey, vaultDocument);
  const { versionId } = await putVault(idToken, ciphertextBase64);

  await cacheKeyMaterial(sub, userKeys);
  await cacheVault(sub, ciphertextBase64, versionId);

  active = { sub, idToken, vaultKey };
  return { recoveryKey, vaultDocument };
}

/**
 * Step 1 of self-service signup: register the Cognito login identity. Real
 * users go through this + confirmAccount, never admin-create-user (see
 * docs/architecture.md §9's note on why the manual test user isn't the real
 * flow). Cognito emails a verification code on success.
 *
 * @param {string} email
 * @param {string} loginPassword Cognito login password - independent of the
 *   Master Password, which isn't collected until step 3 (initializeVault)
 */
export function registerAccount(email, loginPassword) {
  return cognitoSignUp({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    email,
    password: loginPassword,
  });
}

/**
 * Step 2: confirm the emailed verification code. The account is usable
 * (can sign in) after this, but has no vault key material yet - the caller
 * must follow up with signUpAndInitializeVault or the user will hit
 * UserKeysNotFoundException on first login.
 *
 * @param {string} email
 * @param {string} code
 */
export function confirmAccount(email, code) {
  return cognitoConfirmSignUp({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    email,
    code,
  });
}

/**
 * Step 3: sign in to the just-confirmed account and mint its vault key
 * material in one call - the natural continuation of the signup flow, so
 * the UI doesn't need to juggle a raw idToken/sub between steps itself.
 *
 * @param {string} email
 * @param {string} loginPassword
 * @param {string} masterPassword
 * @returns {Promise<{ recoveryKey: string, vaultDocument: object }>}
 */
export async function signUpAndInitializeVault(email, loginPassword, masterPassword) {
  const { idToken, sub } = await authenticate(email, loginPassword);
  return initializeVault(idToken, sub, masterPassword);
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
 * Change the Master Password. Requires an online session (uploads new
 * wrapped-key material) and the *current* Recovery Key (rewrapWithNewMasterPassword
 * needs it to re-wrap that copy too, under the new salt - see crypto/vault.js).
 *
 * Re-derives from `currentMasterPassword` and requires it to actually unwrap
 * the stored Vault Key before proceeding, even though the active session
 * already holds the unwrapped key in memory - that's the whole point of
 * asking for it again here, rather than letting anyone at an
 * already-unlocked, unattended tab change it without knowing it.
 *
 * @param {string} currentMasterPassword
 * @param {string} newMasterPassword
 * @param {string} recoveryKeyInput the account's existing Recovery Key -
 *   unchanged by this operation, still valid afterwards (re-wrapped under a
 *   fresh salt, same recovery phrase)
 */
export async function changeMasterPassword(currentMasterPassword, newMasterPassword, recoveryKeyInput) {
  if (!active) throw new Error('No active session');
  if (!active.idToken) throw new Error('Cannot change Master Password while offline - reconnect and sign in again');

  const currentUserKeys = await getKeys(active.idToken);
  const verifiedVaultKey = await unlockWithMasterPassword(currentUserKeys, currentMasterPassword);
  wipe(verifiedVaultKey);

  const newUserKeys = await rewrapWithNewMasterPassword({
    vaultKey: active.vaultKey,
    newMasterPassword,
    recoveryKeyInput,
  });
  await putKeys(active.idToken, newUserKeys);
  await cacheKeyMaterial(active.sub, newUserKeys);
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
  rememberAccount(email, sub);
  return { idToken, sub };
}

/** Cognito ID tokens are JWTs; `sub` is a standard claim in the payload. */
function decodeSub(idToken) {
  const payload = idToken.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json).sub;
}
