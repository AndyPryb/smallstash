'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('./lib/config');
const { signIn } = require('./lib/auth');
const { apiRequest } = require('./lib/client');

let token;

test.before(async () => {
  const session = await signIn({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    email: config.testUserEmail,
    password: config.testUserPassword,
  });
  token = session.idToken;
});

test('PUT /keys then GET /keys round-trips the same wrapped-key material', async () => {
  const payload = {
    kdfSalt: crypto.randomBytes(16).toString('base64'),
    kdfMemoryKib: 65536,
    kdfIterations: 3,
    kdfParallelism: 1,
    wrappedVaultKeyByMaster: crypto.randomBytes(48).toString('base64'),
    wrappedVaultKeyByRecovery: crypto.randomBytes(48).toString('base64'),
    // Unique per run so this test doesn't depend on (or clobber meaning
    // from) whatever a previous run left behind. keyVersion is an `int`
    // backend-side (UserKeys.java) - Date.now() (ms epoch) overflows a
    // 32-bit int, so use Unix seconds instead (fine until year 2038).
    keyVersion: Math.floor(Date.now() / 1000),
  };

  const putRes = await apiRequest('/keys', { method: 'PUT', token, body: payload });
  assert.equal(putRes.status, 204);

  const getRes = await apiRequest('/keys', { token });
  assert.equal(getRes.status, 200);
  assert.deepEqual(getRes.body, payload);
});
