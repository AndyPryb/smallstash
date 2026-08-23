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

test('PUT /vault then GET /vault round-trips the ciphertext', async () => {
  // Not real AES-GCM output - the backend never decrypts or validates this,
  // it's opaque base64 either way (see VaultBlob's doc comment). Random
  // bytes are enough to prove the round-trip.
  const ciphertextBase64 = crypto.randomBytes(256).toString('base64');

  const putRes = await apiRequest('/vault', {
    method: 'PUT',
    token,
    body: { ciphertextBase64 },
  });
  assert.equal(putRes.status, 200);
  assert.equal(putRes.body.ciphertextBase64, ciphertextBase64);

  const getRes = await apiRequest('/vault', { token });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.ciphertextBase64, ciphertextBase64);
  assert.equal(getRes.body.versionId, putRes.body.versionId);
});
