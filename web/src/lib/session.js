import {
  signIn,
  signUp as cognitoSignUp,
  confirmSignUp as cognitoConfirmSignUp,
  forgotPassword as cognitoForgotPassword,
  confirmForgotPassword as cognitoConfirmForgotPassword,
  changePassword as cognitoChangePassword,
} from './auth/cognito.js';
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

/** @type {{ sub: string, idToken: string, vaultKey: Uint8Array, cognitoUser: import('amazon-cognito-identity-js').CognitoUser | null } | null} */
let active = null;

/**
 * Auto-lock: clears the in-memory Vault Key after a period of no user
 * activity, per architecture.md §5 ("cleared on tab close / inactivity
 * timeout"). Tab close already achieves this for free - `active` is a plain
 * JS variable, so closing/reloading the tab destroys it along with
 * everything else in memory. This is the other half: a *left open* tab.
 *
 * Lives here rather than as a raw timer in App.svelte so the "what counts as
 * activity, how long is the timeout" policy stays in one place regardless of
 * which UI component happens to be mounted - App.svelte's job is only to
 * forward DOM activity events into resetInactivityTimer() and react to the
 * onAutoLock callback by clearing whatever it's displaying.
 */
const DEFAULT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** @type {ReturnType<typeof setTimeout> | null} */
let inactivityTimer = null;

/** @type {Set<() => void>} */
const autoLockListeners = new Set();

/**
 * @param {() => void} listener called when the timer fires and the session
 *   has just been cleared - typically used to drop whatever vault document
 *   is currently on screen and show a "locked, sign in again" state.
 * @returns {() => void} unsubscribe
 */
export function onAutoLock(listener) {
  autoLockListeners.add(listener);
  return () => autoLockListeners.delete(listener);
}

/**
 * (Re)starts the inactivity countdown. Call on every detected user activity
 * (mouse/keyboard/touch/scroll) - cheap no-op if there's no active session
 * to protect, so callers don't need to check isUnlocked() themselves first.
 * @param {number} [timeoutMs]
 */
export function resetInactivityTimer(timeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS) {
  if (!active) return;
  if (inactivityTimer !== null) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    clearSession();
    for (const listener of autoLockListeners) listener();
  }, timeoutMs);
}

function stopInactivityTimer() {
  if (inactivityTimer !== null) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

/**
 * @param {string} sub @param {string | null} idToken @param {Uint8Array} vaultKey
 * @param {import('amazon-cognito-identity-js').CognitoUser | null} [cognitoUser]
 *   null for an offline unlock (no Cognito session at all) - see
 *   changeLoginPassword, the one thing that needs this.
 */
function setActive(sub, idToken, vaultKey, cognitoUser = null) {
  active = { sub, idToken, vaultKey, cognitoUser };
  resetInactivityTimer();
}

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
  const { idToken, sub, cognitoUser } = await authenticate(email, loginPassword);
  return finishOnlineUnlock(idToken, sub, masterPassword, cognitoUser);
}

async function finishOnlineUnlock(idToken, sub, masterPassword, cognitoUser) {
  const userKeys = await getKeys(idToken);
  await cacheKeyMaterial(sub, userKeys);

  const vaultKey = await unlockWithMasterPassword(userKeys, masterPassword);

  const { ciphertextBase64, versionId } = await getVault(idToken);
  await cacheVault(sub, ciphertextBase64, versionId);

  setActive(sub, idToken, vaultKey, cognitoUser);
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
  setActive(sub, null, vaultKey);
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
 * @param {import('amazon-cognito-identity-js').CognitoUser | null} [cognitoUser]
 * @returns {Promise<{ recoveryKey: string, vaultDocument: object }>}
 */
export async function initializeVault(idToken, sub, masterPassword, cognitoUser = null) {
  const { userKeys, vaultKey, recoveryKey } = await createKeyMaterial(masterPassword);
  const vaultDocument = { entries: [] };

  await putKeys(idToken, userKeys);
  const ciphertextBase64 = await encryptVault(vaultKey, vaultDocument);
  const { versionId } = await putVault(idToken, ciphertextBase64);

  await cacheKeyMaterial(sub, userKeys);
  await cacheVault(sub, ciphertextBase64, versionId);

  setActive(sub, idToken, vaultKey, cognitoUser);
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
 * @param {string} inviteCode checked by the PreSignUp Lambda trigger; a wrong
 *   one rejects the sign-up outright, so no account is created
 */
export function registerAccount(email, loginPassword, inviteCode) {
  return cognitoSignUp({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    email,
    password: loginPassword,
    inviteCode,
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
  const { idToken, sub, cognitoUser } = await authenticate(email, loginPassword);
  return initializeVault(idToken, sub, masterPassword, cognitoUser);
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
    // Just fetched above, so this is the authoritative stored version - the
    // backend rejects a PUT whose keyVersion isn't strictly greater.
    previousKeyVersion: currentUserKeys.keyVersion,
  });
  await putKeys(active.idToken, newUserKeys);
  await cacheKeyMaterial(active.sub, newUserKeys);
}

/**
 * Change the Cognito *login* password - the account sign-in password, kept
 * deliberately independent from the vault Master Password (see
 * changeMasterPassword above, architecture.md §5). Requires an online
 * session: Cognito's ChangePassword API needs the CognitoUser instance
 * retained since sign-in (never persisted - same module-level-only
 * lifetime as everything else in `active`), not just the current password.
 *
 * @param {string} currentLoginPassword
 * @param {string} newLoginPassword
 */
export async function changeLoginPassword(currentLoginPassword, newLoginPassword) {
  if (!active) throw new Error('No active session');
  if (!active.cognitoUser) {
    throw new Error('Cannot change login password while offline - reconnect and sign in again');
  }
  await cognitoChangePassword(active.cognitoUser, currentLoginPassword, newLoginPassword);
}

/**
 * Step 1 of the Cognito login-password recovery flow ("forgot password") -
 * for a user who is signed out and doesn't remember their login password.
 * Distinct from the vault's Recovery Key, which recovers the Master
 * Password instead (architecture.md §5) - this never touches vault crypto.
 * No active session needed. Cognito emails a verification code; follow up
 * with confirmLoginPasswordReset.
 *
 * @param {string} email
 */
export function requestLoginPasswordReset(email) {
  return cognitoForgotPassword({ userPoolId: config.userPoolId, clientId: config.clientId, email });
}

/**
 * Step 2: complete the reset with the emailed code and a new login
 * password. The account's vault key material is untouched by this - the
 * login password and the wrapped Vault Key are independent secrets, so
 * resetting one never requires re-deriving or re-wrapping the other.
 *
 * @param {string} email
 * @param {string} code the emailed verification code
 * @param {string} newLoginPassword
 */
export function confirmLoginPasswordReset(email, code, newLoginPassword) {
  return cognitoConfirmForgotPassword({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    email,
    code,
    newPassword: newLoginPassword,
  });
}

/**
 * Detects a stale offline cache after a Master Password change elsewhere
 * (docs/todo.md "Staleness handling") - call once back online, before
 * trusting a cached unlock.
 *
 * NOT currently called from anywhere in the UI - finishOnlineUnlock()
 * already unconditionally overwrites the cache with the freshest KEYS item
 * on every normal online sign-in, which covers the main "went stale, came
 * back online, signed in again" case for free. This function is for a
 * narrower gap that isn't wired up yet: proactively catching a Master
 * Password change made on a *different* device while *this* device's
 * session stays open the whole time, without a fresh re-login here to
 * trigger the natural refresh above.
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
  stopInactivityTimer();
}

/** @returns {boolean} whether there is a currently-unlocked session */
export function isUnlocked() {
  return active !== null;
}

/**
 * @returns {boolean} whether the current session was unlocked via
 *   unlockOffline() rather than a real Cognito sign-in - no idToken means
 *   saveVault() will reject, so UI can warn about this *before* an edit gets
 *   made and lost, not just after saveVault() throws.
 */
export function isOfflineSession() {
  return active !== null && active.idToken === null;
}

/** @returns {string | null} the current session's Cognito sub, or null if none */
export function currentSub() {
  return active?.sub ?? null;
}

async function authenticate(email, loginPassword) {
  const { idToken, cognitoUser } = await signIn({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    email,
    password: loginPassword,
  });
  const sub = decodeSub(idToken);
  rememberAccount(email, sub);
  return { idToken, sub, cognitoUser };
}

/** Cognito ID tokens are JWTs; `sub` is a standard claim in the payload. */
function decodeSub(idToken) {
  const payload = idToken.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json).sub;
}
