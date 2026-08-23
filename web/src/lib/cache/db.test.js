// Node has no native IndexedDB - fake-indexeddb provides a spec-compliant
// in-memory implementation, exactly for testing code (like this file, via
// the `idb` wrapper) that depends on it without a real browser. Must be
// imported before db.js so the global indexedDB/IDBKeyRange exist by the
// time openDB() is first called.
import 'fake-indexeddb/auto';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheKeyMaterial,
  getCachedKeyMaterial,
  cacheVault,
  getCachedVault,
  isKeyMaterialStale,
  clearCache,
} from './db.js';

// Every test uses its own random sub - db.js always opens the same
// 'smallstash' database, and fake-indexeddb persists it for the whole
// process, so distinct subs keep tests from interfering with each other
// (same reasoning as using fresh random inputs in the crypto tests).
function randomSub() {
  return crypto.randomUUID();
}

const SAMPLE_USER_KEYS = Object.freeze({
  kdfSalt: 'c2FsdA==',
  kdfMemoryKib: 65536,
  kdfIterations: 3,
  kdfParallelism: 1,
  wrappedVaultKeyByMaster: 'd3JhcHBlZC1ieS1tYXN0ZXI=',
  wrappedVaultKeyByRecovery: 'd3JhcHBlZC1ieS1yZWNvdmVyeQ==',
  keyVersion: 1,
});

test('cacheKeyMaterial/getCachedKeyMaterial round-trips and adds cachedAt', async () => {
  const sub = randomSub();
  await cacheKeyMaterial(sub, SAMPLE_USER_KEYS);

  const cached = await getCachedKeyMaterial(sub);

  assert.equal(cached.kdfSalt, SAMPLE_USER_KEYS.kdfSalt);
  assert.equal(cached.keyVersion, SAMPLE_USER_KEYS.keyVersion);
  assert.equal(typeof cached.cachedAt, 'number');
});

test('getCachedKeyMaterial returns undefined for a sub that was never cached', async () => {
  assert.equal(await getCachedKeyMaterial(randomSub()), undefined);
});

test('cacheVault/getCachedVault round-trips', async () => {
  const sub = randomSub();
  await cacheVault(sub, 'Y2lwaGVydGV4dA==', 'v1');

  const cached = await getCachedVault(sub);

  assert.equal(cached.ciphertextBase64, 'Y2lwaGVydGV4dA==');
  assert.equal(cached.versionId, 'v1');
  assert.equal(typeof cached.cachedAt, 'number');
});

test('getCachedVault returns undefined for a sub that was never cached', async () => {
  assert.equal(await getCachedVault(randomSub()), undefined);
});

test('caching twice for the same sub overwrites rather than duplicates', async () => {
  const sub = randomSub();
  await cacheVault(sub, 'first', 'v1');
  await cacheVault(sub, 'second', 'v2');

  const cached = await getCachedVault(sub);
  assert.equal(cached.ciphertextBase64, 'second');
  assert.equal(cached.versionId, 'v2');
});

test('isKeyMaterialStale is true when there is no cached copy at all', () => {
  assert.equal(isKeyMaterialStale(undefined, { keyVersion: 5 }), true);
  assert.equal(isKeyMaterialStale(null, { keyVersion: 5 }), true);
});

test('isKeyMaterialStale is true when keyVersion differs', () => {
  assert.equal(isKeyMaterialStale({ keyVersion: 1 }, { keyVersion: 2 }), true);
});

test('isKeyMaterialStale is false when keyVersion matches', () => {
  assert.equal(isKeyMaterialStale({ keyVersion: 7 }, { keyVersion: 7 }), false);
});

test('clearCache removes both stores for the given sub only', async () => {
  const sub = randomSub();
  const otherSub = randomSub();
  await cacheKeyMaterial(sub, SAMPLE_USER_KEYS);
  await cacheVault(sub, 'ciphertext', 'v1');
  await cacheKeyMaterial(otherSub, SAMPLE_USER_KEYS);

  await clearCache(sub);

  assert.equal(await getCachedKeyMaterial(sub), undefined);
  assert.equal(await getCachedVault(sub), undefined);
  // A different account's cache is untouched.
  assert.notEqual(await getCachedKeyMaterial(otherSub), undefined);
});
