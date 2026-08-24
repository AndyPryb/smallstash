/**
 * session.js is the orchestration hub - Cognito auth + the API client +
 * crypto/vault.js + the IndexedDB cache all meet here, and it's the one
 * place allowed to hold the live Vault Key. It had zero test coverage
 * before this file, which is the wrong way around for the
 * highest-stakes module in the app.
 *
 * Real crypto (crypto/vault.js) and the real cache (cache/db.js, backed by
 * fake-indexeddb) are used as-is - only the network-touching boundaries
 * (Cognito auth, the HTTP API client, and config's env-var access, which
 * would throw outside a Vite context) are replaced with node:test's
 * built-in module mocking. That keeps these tests honest about what
 * session.js actually does with real key material while never touching a
 * real network or a real Cognito pool.
 *
 * Requires `node --experimental-test-module-mocks` (see package.json's
 * test script) - mock.module() is still an experimental Node API as of
 * this writing. Test-only; doesn't affect anything shipped to the browser.
 */
import 'fake-indexeddb/auto';
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createKeyMaterial, encryptVault, unlockWithMasterPassword, WrongSecretError } from './crypto/vault.js';
import { cacheKeyMaterial, cacheVault, getCachedKeyMaterial, getCachedVault } from './cache/db.js';

// --- localStorage polyfill --------------------------------------------
// Node has no native Web Storage. session.js's getLastAccount/
// rememberAccount only ever call getItem/setItem, so a minimal in-memory
// stand-in is enough.
class FakeLocalStorage {
  #data = new Map();
  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }
  setItem(key, value) {
    this.#data.set(key, String(value));
  }
  clear() {
    this.#data.clear();
  }
}
globalThis.localStorage = new FakeLocalStorage();

// --- module mocks --------------------------------------------------------
// Must be set up before session.js is imported - mock.module() intercepts
// future resolutions of the given specifier, including session.js's own
// static imports of these same files.
const { MfaRequiredError } = await import('./auth/cognito.js');

const cognitoMocks = {
  signIn: mock.fn(),
  signUp: mock.fn(),
  confirmSignUp: mock.fn(),
  submitMfaCode: mock.fn(),
  forgotPassword: mock.fn(),
  confirmForgotPassword: mock.fn(),
  changePassword: mock.fn(),
  MfaRequiredError,
};
mock.module('./auth/cognito.js', { namedExports: cognitoMocks });

const apiMocks = {
  getKeys: mock.fn(),
  putKeys: mock.fn(),
  getVault: mock.fn(),
  putVault: mock.fn(),
};
mock.module('./api/client.js', { namedExports: apiMocks });

mock.module('./config.js', {
  namedExports: {
    config: {
      region: 'eu-west-1',
      userPoolId: 'fake-pool',
      clientId: 'fake-client',
      apiBaseUrl: 'https://example.invalid',
    },
  },
});

const session = await import('./session.js');

// --- test helpers ----------------------------------------------------

/** A minimal unsigned JWT-shaped string - session.js's decodeSub() only
 * base64url-decodes the payload segment and reads `.sub`, it never verifies
 * a signature (that's the JWT authorizer's job server-side), so this is
 * enough to stand in for a real Cognito ID token in these tests. */
function fakeIdToken(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${payload}.`;
}

function randomSub() {
  return crypto.randomUUID();
}

/** Wires up all the mocks for a successful online sign-in against a freshly
 * minted (real crypto) account, so most tests can get to "unlocked" in one
 * call instead of repeating this setup. */
async function primeOnlineAccount({ masterPassword, sub = randomSub(), vaultDocument = { entries: [] } }) {
  const { userKeys, vaultKey, recoveryKey } = await createKeyMaterial(masterPassword);
  const ciphertextBase64 = await encryptVault(vaultKey, vaultDocument);

  // A plain marker object, not a real CognitoUser - session.js never calls
  // anything on it itself, just holds onto it and hands it back to
  // auth/cognito.js's (mocked) changePassword() later, so tests can assert
  // *which* instance changeLoginPassword forwards.
  const cognitoUser = { fakeCognitoUser: true };
  cognitoMocks.signIn.mock.mockImplementation(async () => ({ idToken: fakeIdToken(sub), cognitoUser }));
  apiMocks.getKeys.mock.mockImplementation(async () => userKeys);
  apiMocks.getVault.mock.mockImplementation(async () => ({ ciphertextBase64, versionId: 'v1' }));

  return { sub, userKeys, vaultKey, recoveryKey, vaultDocument, cognitoUser };
}

/** Populates the offline cache directly (bypassing any sign-in), for tests
 * of unlockOffline() itself. */
async function primeOfflineCache({ masterPassword, sub = randomSub(), vaultDocument = { entries: [] } }) {
  const { userKeys, vaultKey, recoveryKey } = await createKeyMaterial(masterPassword);
  const ciphertextBase64 = await encryptVault(vaultKey, vaultDocument);
  await cacheKeyMaterial(sub, userKeys);
  await cacheVault(sub, ciphertextBase64, 'v1');
  return { sub, userKeys, vaultKey, recoveryKey, vaultDocument };
}

beforeEach(() => {
  // Reset session.js's own module-level state...
  session.clearSession();
  session.cancelMfaLogin();
  // ...and every mock's call history/implementation, so one test's setup
  // can't leak into the next.
  for (const fn of [...Object.values(cognitoMocks), ...Object.values(apiMocks)]) {
    if (typeof fn?.mock?.resetCalls === 'function') {
      fn.mock.resetCalls();
      fn.mock.mockImplementation(() => {
        throw new Error('unexpected call - this test did not configure this mock');
      });
    }
  }
  localStorage.clear();
});

// --- signInAndUnlock ---------------------------------------------------

test('signInAndUnlock: happy path decrypts the real vault and unlocks the session', async () => {
  const email = 'person@example.com';
  const masterPassword = 'correct horse battery staple';
  const vaultDocument = {
    entries: [{ id: '1', title: 'Example', username: 'me', password: 'p', url: '', notes: '' }],
  };
  const { sub } = await primeOnlineAccount({ masterPassword, vaultDocument });

  const decrypted = await session.signInAndUnlock(email, 'login-password', masterPassword);

  assert.deepEqual(decrypted, vaultDocument);
  assert.equal(session.isUnlocked(), true);
  assert.equal(session.currentSub(), sub);
  assert.equal(session.isOfflineSession(), false);
  assert.deepEqual(session.getLastAccount(), { email, sub });
});

test('signInAndUnlock: wrong Master Password rejects and leaves no session', async () => {
  const email = 'person@example.com';
  await primeOnlineAccount({ masterPassword: 'the-real-password' });

  await assert.rejects(
    () => session.signInAndUnlock(email, 'login-password', 'a-completely-wrong-password'),
    WrongSecretError,
  );
  assert.equal(session.isUnlocked(), false);
});

test('signInAndUnlock: MFA-enrolled account rejects with MfaRequiredError and marks MFA pending', async () => {
  cognitoMocks.signIn.mock.mockImplementation(async () => {
    throw new MfaRequiredError({ fakeCognitoUser: true });
  });

  await assert.rejects(
    () => session.signInAndUnlock('person@example.com', 'login-password', 'master'),
    MfaRequiredError,
  );
  assert.equal(session.isMfaPending(), true);
  assert.equal(session.isUnlocked(), false);
});

// --- MFA completion ------------------------------------------------------

test('completeMfaLogin: finishes the paused sign-in without re-collecting passwords', async () => {
  const email = 'person@example.com';
  const masterPassword = 'a master password';
  const { sub } = await primeOnlineAccount({ masterPassword });

  cognitoMocks.signIn.mock.mockImplementation(async () => {
    throw new MfaRequiredError({ fakeCognitoUser: true });
  });
  await assert.rejects(() => session.signInAndUnlock(email, 'login-password', masterPassword), MfaRequiredError);
  assert.equal(session.isMfaPending(), true);

  cognitoMocks.submitMfaCode.mock.mockImplementation(async () => ({ idToken: fakeIdToken(sub) }));

  const decrypted = await session.completeMfaLogin('123456');

  assert.deepEqual(decrypted, { entries: [] });
  assert.equal(session.isMfaPending(), false);
  assert.equal(session.isUnlocked(), true);
  assert.deepEqual(session.getLastAccount(), { email, sub });
});

test('completeMfaLogin: a wrong code leaves the pending attempt intact for retry', async () => {
  cognitoMocks.signIn.mock.mockImplementation(async () => {
    throw new MfaRequiredError({ fakeCognitoUser: true });
  });
  await assert.rejects(
    () => session.signInAndUnlock('person@example.com', 'login-password', 'master'),
    MfaRequiredError,
  );

  cognitoMocks.submitMfaCode.mock.mockImplementation(async () => {
    throw new Error('Incorrect code');
  });
  await assert.rejects(() => session.completeMfaLogin('000000'), /Incorrect code/);

  // Unlike a completed attempt, a failed *code* doesn't discard the
  // in-progress login - the user should be able to just try again.
  assert.equal(session.isMfaPending(), true);
});

test('completeMfaLogin: rejects immediately if no MFA login is pending', async () => {
  await assert.rejects(() => session.completeMfaLogin('123456'), /no sign-in is currently waiting/i);
});

test('cancelMfaLogin: clears the pending attempt', async () => {
  cognitoMocks.signIn.mock.mockImplementation(async () => {
    throw new MfaRequiredError({ fakeCognitoUser: true });
  });
  await assert.rejects(
    () => session.signInAndUnlock('person@example.com', 'login-password', 'master'),
    MfaRequiredError,
  );
  assert.equal(session.isMfaPending(), true);

  session.cancelMfaLogin();

  assert.equal(session.isMfaPending(), false);
});

// --- offline unlock --------------------------------------------------

test('unlockOffline: unlocks from the cache with no network calls, and marks the session offline', async () => {
  const masterPassword = 'a master password';
  const { sub, vaultDocument } = await primeOfflineCache({ masterPassword });

  const decrypted = await session.unlockOffline(sub, masterPassword);

  assert.deepEqual(decrypted, vaultDocument);
  assert.equal(session.isUnlocked(), true);
  assert.equal(session.isOfflineSession(), true);
  assert.equal(cognitoMocks.signIn.mock.callCount(), 0);
  assert.equal(apiMocks.getKeys.mock.callCount(), 0);
});

test('unlockOffline: rejects when this device has never cached anything for that account', async () => {
  await assert.rejects(() => session.unlockOffline(randomSub(), 'anything'), /go online at least once first/);
});

test('unlockOffline: wrong Master Password rejects', async () => {
  const { sub } = await primeOfflineCache({ masterPassword: 'the-real-password' });

  await assert.rejects(() => session.unlockOffline(sub, 'wrong-password'), WrongSecretError);
});

test('saveVault: rejects while offline-unlocked, without attempting a network call', async () => {
  const masterPassword = 'a master password';
  const { sub } = await primeOfflineCache({ masterPassword });
  await session.unlockOffline(sub, masterPassword);

  await assert.rejects(() => session.saveVault({ entries: [] }), /cannot save while offline/i);
  assert.equal(apiMocks.putVault.mock.callCount(), 0);
});

// --- signup / initializeVault -----------------------------------------

test('initializeVault: mints key material, uploads it, and unlocks the new session', async () => {
  const sub = randomSub();
  apiMocks.putKeys.mock.mockImplementation(async () => undefined);
  apiMocks.putVault.mock.mockImplementation(async () => ({ versionId: 'v1' }));

  const { recoveryKey, vaultDocument } = await session.initializeVault(
    fakeIdToken(sub),
    sub,
    'a fresh master password',
  );

  assert.equal(typeof recoveryKey, 'string');
  assert.ok(recoveryKey.length > 0);
  assert.deepEqual(vaultDocument, { entries: [] });
  assert.equal(session.isUnlocked(), true);
  assert.equal(session.currentSub(), sub);
  assert.equal(apiMocks.putKeys.mock.callCount(), 1);
  assert.equal(apiMocks.putVault.mock.callCount(), 1);

  // The cache was populated too, so an offline unlock would work later.
  assert.notEqual(await getCachedKeyMaterial(sub), undefined);
  assert.notEqual(await getCachedVault(sub), undefined);
});

test('registerAccount/confirmAccount: delegate to Cognito with the configured pool/client', async () => {
  cognitoMocks.signUp.mock.mockImplementation(async () => ({}));
  cognitoMocks.confirmSignUp.mock.mockImplementation(async () => ({}));

  await session.registerAccount('person@example.com', 'a-login-password', 'an-invite-code');
  await session.confirmAccount('person@example.com', '123456');

  assert.deepEqual(cognitoMocks.signUp.mock.calls[0].arguments[0], {
    userPoolId: 'fake-pool',
    clientId: 'fake-client',
    email: 'person@example.com',
    password: 'a-login-password',
    inviteCode: 'an-invite-code',
  });
  assert.deepEqual(cognitoMocks.confirmSignUp.mock.calls[0].arguments[0], {
    userPoolId: 'fake-pool',
    clientId: 'fake-client',
    email: 'person@example.com',
    code: '123456',
  });
});

test('signUpAndInitializeVault: signs in then mints vault key material in one call', async () => {
  const sub = randomSub();
  cognitoMocks.signIn.mock.mockImplementation(async () => ({ idToken: fakeIdToken(sub) }));
  apiMocks.putKeys.mock.mockImplementation(async () => undefined);
  apiMocks.putVault.mock.mockImplementation(async () => ({ versionId: 'v1' }));

  const { recoveryKey, vaultDocument } = await session.signUpAndInitializeVault(
    'person@example.com',
    'login-password',
    'master-password',
  );

  assert.equal(typeof recoveryKey, 'string');
  assert.deepEqual(vaultDocument, { entries: [] });
  assert.equal(session.currentSub(), sub);
});

// --- saveVault (online) -------------------------------------------------

test('saveVault: rejects with no active session at all', async () => {
  await assert.rejects(() => session.saveVault({ entries: [] }), /no active session/i);
});

test('saveVault: encrypts, uploads, and refreshes the cache', async () => {
  const masterPassword = 'a master password';
  const { sub } = await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'login-password', masterPassword);

  apiMocks.putVault.mock.mockImplementation(async () => ({ versionId: 'v2' }));
  const newDocument = { entries: [{ id: 'x', title: 'New', username: '', password: '', url: '', notes: '' }] };

  await session.saveVault(newDocument);

  assert.equal(apiMocks.putVault.mock.callCount(), 1);
  const cachedVault = await getCachedVault(sub);
  assert.equal(cachedVault.versionId, 'v2');
});

// --- changeMasterPassword ------------------------------------------------

test('changeMasterPassword: rejects with no active session', async () => {
  await assert.rejects(
    () => session.changeMasterPassword('old', 'new-password', 'recovery'),
    /no active session/i,
  );
});

test('changeMasterPassword: rejects while offline-unlocked', async () => {
  const masterPassword = 'a master password';
  const { sub } = await primeOfflineCache({ masterPassword });
  await session.unlockOffline(sub, masterPassword);

  await assert.rejects(
    () => session.changeMasterPassword(masterPassword, 'new-password', 'recovery'),
    /cannot change master password while offline/i,
  );
});

test('changeMasterPassword: rejects a wrong current Master Password without changing anything', async () => {
  const masterPassword = 'the-real-password';
  await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'login-password', masterPassword);

  await assert.rejects(
    () => session.changeMasterPassword('totally-wrong', 'new-password-here', 'recovery'),
    WrongSecretError,
  );
  assert.equal(apiMocks.putKeys.mock.callCount(), 0);
});

test('changeMasterPassword: happy path re-wraps the same Vault Key under the new password', async () => {
  const masterPassword = 'the-real-password';
  const { vaultKey, recoveryKey } = await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'login-password', masterPassword);

  let uploadedKeys;
  apiMocks.putKeys.mock.mockImplementation(async (_token, keys) => {
    uploadedKeys = keys;
  });

  await session.changeMasterPassword(masterPassword, 'a brand new master password', recoveryKey);

  assert.ok(uploadedKeys, 'putKeys should have been called with the re-wrapped keys');
  const reUnlocked = await unlockWithMasterPassword(uploadedKeys, 'a brand new master password');
  assert.equal(Buffer.from(reUnlocked).toString('hex'), Buffer.from(vaultKey).toString('hex'));

  // The old password must no longer work against the newly uploaded keys.
  await assert.rejects(() => unlockWithMasterPassword(uploadedKeys, masterPassword), WrongSecretError);
});

// --- changeLoginPassword -------------------------------------------------

test('changeLoginPassword: rejects with no active session', async () => {
  await assert.rejects(() => session.changeLoginPassword('old', 'new'), /no active session/i);
});

test('changeLoginPassword: rejects while offline-unlocked', async () => {
  const masterPassword = 'a master password';
  const { sub } = await primeOfflineCache({ masterPassword });
  await session.unlockOffline(sub, masterPassword);

  await assert.rejects(
    () => session.changeLoginPassword('old', 'new'),
    /cannot change login password while offline/i,
  );
});

test('changeLoginPassword: happy path forwards to Cognito with the session\'s CognitoUser', async () => {
  const masterPassword = 'a master password';
  const { cognitoUser } = await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'old-login-password', masterPassword);

  let calledWith;
  cognitoMocks.changePassword.mock.mockImplementation(async (...args) => {
    calledWith = args;
  });

  await session.changeLoginPassword('old-login-password', 'new-login-password');

  assert.deepEqual(calledWith, [cognitoUser, 'old-login-password', 'new-login-password']);
});

test('changeLoginPassword: a Cognito rejection (e.g. wrong current password) propagates', async () => {
  const masterPassword = 'a master password';
  await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'old-login-password', masterPassword);

  cognitoMocks.changePassword.mock.mockImplementation(async () => {
    throw new Error('Incorrect username or password');
  });

  await assert.rejects(
    () => session.changeLoginPassword('wrong', 'new-login-password'),
    /incorrect username or password/i,
  );
});

// --- login password recovery (requestLoginPasswordReset / confirmLoginPasswordReset) ---

test('requestLoginPasswordReset: delegates to Cognito forgotPassword with the configured pool/client', async () => {
  cognitoMocks.forgotPassword.mock.mockImplementation(async () => {});

  await session.requestLoginPasswordReset('person@example.com');

  assert.equal(cognitoMocks.forgotPassword.mock.callCount(), 1);
  const [args] = cognitoMocks.forgotPassword.mock.calls[0].arguments;
  assert.deepEqual(args, { userPoolId: 'fake-pool', clientId: 'fake-client', email: 'person@example.com' });
});

test('confirmLoginPasswordReset: delegates to Cognito confirmForgotPassword, no vault key material touched', async () => {
  cognitoMocks.confirmForgotPassword.mock.mockImplementation(async () => {});

  await session.confirmLoginPasswordReset('person@example.com', '123456', 'brand-new-login-password');

  assert.equal(cognitoMocks.confirmForgotPassword.mock.callCount(), 1);
  const [args] = cognitoMocks.confirmForgotPassword.mock.calls[0].arguments;
  assert.deepEqual(args, {
    userPoolId: 'fake-pool',
    clientId: 'fake-client',
    email: 'person@example.com',
    code: '123456',
    newPassword: 'brand-new-login-password',
  });
  // Neither the vault key/API mocks nor a session were ever touched -
  // resetting the login password is independent of vault key material.
  assert.equal(apiMocks.getKeys.mock.callCount(), 0);
  assert.equal(session.isUnlocked(), false);
});

// --- session lifecycle -------------------------------------------------

test('clearSession: wipes the unlocked state', async () => {
  const masterPassword = 'a master password';
  await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'login-password', masterPassword);
  assert.equal(session.isUnlocked(), true);

  session.clearSession();

  assert.equal(session.isUnlocked(), false);
  assert.equal(session.currentSub(), null);
});

test('getLastAccount: returns null when nothing has ever signed in on this device', () => {
  assert.equal(session.getLastAccount(), null);
});

// --- inactivity auto-lock ------------------------------------------------

test('resetInactivityTimer: fires onAutoLock and clears the session after the timeout elapses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const masterPassword = 'a master password';
  await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'login-password', masterPassword);

  let fired = false;
  const unsubscribe = session.onAutoLock(() => {
    fired = true;
  });

  session.resetInactivityTimer(1000);
  t.mock.timers.tick(999);
  assert.equal(fired, false, 'should not fire before the timeout elapses');
  assert.equal(session.isUnlocked(), true);

  t.mock.timers.tick(1);
  assert.equal(fired, true, 'should fire once the timeout elapses');
  assert.equal(session.isUnlocked(), false);

  unsubscribe();
});

test('resetInactivityTimer: activity (another reset) postpones the lock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const masterPassword = 'a master password';
  await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'login-password', masterPassword);

  let fired = false;
  const unsubscribe = session.onAutoLock(() => {
    fired = true;
  });

  session.resetInactivityTimer(1000);
  t.mock.timers.tick(800);
  session.resetInactivityTimer(1000); // "activity" - restart the countdown
  t.mock.timers.tick(800);
  assert.equal(fired, false, 'the second reset should have pushed the deadline out');

  t.mock.timers.tick(200);
  assert.equal(fired, true);

  unsubscribe();
});

test('resetInactivityTimer: is a no-op when there is no active session', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(session.isUnlocked(), false);

  // Should not throw, and should not schedule anything that fires later.
  session.resetInactivityTimer(1000);
  t.mock.timers.tick(5000);
});

test('onAutoLock: unsubscribing stops the listener from being called', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const masterPassword = 'a master password';
  await primeOnlineAccount({ masterPassword });
  await session.signInAndUnlock('person@example.com', 'login-password', masterPassword);

  let callCount = 0;
  const unsubscribe = session.onAutoLock(() => {
    callCount++;
  });
  unsubscribe();

  session.resetInactivityTimer(1000);
  t.mock.timers.tick(1000);

  assert.equal(callCount, 0);
});
