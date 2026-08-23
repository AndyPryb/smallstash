'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { apiRequest } = require('./lib/client');

// No token on any of these - confirms the HTTP API's Cognito JWT authorizer
// rejects requests before they ever reach the Lambda, not just that the
// Lambda itself would reject them.

test('GET /vault with no token returns 401', async () => {
  const { status } = await apiRequest('/vault');
  assert.equal(status, 401);
});

test('PUT /vault with no token returns 401', async () => {
  const { status } = await apiRequest('/vault', {
    method: 'PUT',
    body: { ciphertextBase64: 'AA==' },
  });
  assert.equal(status, 401);
});

test('GET /keys with no token returns 401', async () => {
  const { status } = await apiRequest('/keys');
  assert.equal(status, 401);
});

test('PUT /keys with no token returns 401', async () => {
  const { status } = await apiRequest('/keys', {
    method: 'PUT',
    body: {
      kdfSalt: 'AA==',
      kdfMemoryKib: 65536,
      kdfIterations: 3,
      kdfParallelism: 1,
      wrappedVaultKeyByMaster: 'AA==',
      wrappedVaultKeyByRecovery: 'AA==',
      keyVersion: 1,
    },
  });
  assert.equal(status, 401);
});
