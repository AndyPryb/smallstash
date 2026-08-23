/**
 * Argon2id output-agreement test. This is the single most important test in
 * the whole PWA: if hash-wasm's Argon2id output ever silently diverged from
 * the spec (a bad release, a bundler miscompiling the WASM, etc.), every
 * vault ever created would become permanently undecryptable - the derived
 * Master Key would simply be wrong, and there is no recovery from that short
 * of the Recovery Key flow. Two independent implementations agreeing, plus
 * agreement with a published RFC vector, is what makes that risk provable
 * rather than assumed.
 *
 * @noble/hashes is a devDependency only, used here and nowhere else in the
 * shipped app - hash-wasm (WASM, faster on-device) is what the running app
 * actually links against, per docs/decisions/0002-pwa-stack.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { argon2id as nobleArgon2id } from '@noble/hashes/argon2.js';
import { argon2id as wasmArgon2id } from 'hash-wasm';
import { deriveMasterKey, DEFAULT_KDF_PARAMS } from './kdf.js';

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

test('@noble/hashes matches the RFC 9106 §5.3 Argon2id test vector', () => {
  const output = nobleArgon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
    t: 3,
    m: 32,
    p: 4,
    dkLen: 32,
    key: new Uint8Array(8).fill(3),
    personalization: new Uint8Array(12).fill(4),
  });
  assert.equal(hex(output), '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
});

test('hash-wasm and @noble/hashes agree on smallStash production KDF params', async () => {
  const password = new TextEncoder().encode('correct horse battery staple');
  const salt = new Uint8Array(16).fill(0xab);
  const params = { memoryKib: 65536, iterations: 3, parallelism: 1, hashLength: 32 };

  const fromNoble = nobleArgon2id(password, salt, {
    t: params.iterations,
    m: params.memoryKib,
    p: params.parallelism,
    dkLen: params.hashLength,
  });

  const fromWasm = await wasmArgon2id({
    password,
    salt,
    memorySize: params.memoryKib,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    outputType: 'binary',
  });

  assert.equal(hex(fromWasm), hex(fromNoble));
});

test('deriveMasterKey (hash-wasm) matches @noble/hashes for the same inputs', async () => {
  const salt = new Uint8Array(16).fill(0x42);

  const viaApp = await deriveMasterKey('a test master password', salt, DEFAULT_KDF_PARAMS);

  const viaNoble = nobleArgon2id(new TextEncoder().encode('a test master password'), salt, {
    t: DEFAULT_KDF_PARAMS.kdfIterations,
    m: DEFAULT_KDF_PARAMS.kdfMemoryKib,
    p: DEFAULT_KDF_PARAMS.kdfParallelism,
    dkLen: 32,
  });

  assert.equal(hex(viaApp), hex(viaNoble));
});
