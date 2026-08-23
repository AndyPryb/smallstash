import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, open } from './aesgcm.js';
import { randomBytes, utf8, fromUtf8 } from '../bytes.js';

test('seal/open round-trips plaintext', async () => {
  const key = randomBytes(32);
  const plaintext = utf8('the master key never leaves the browser');

  const sealed = await seal(key, plaintext);
  const opened = await open(key, sealed);

  assert.equal(fromUtf8(opened), fromUtf8(plaintext));
});

test('open rejects the wrong key', async () => {
  const sealed = await seal(randomBytes(32), utf8('secret'));
  await assert.rejects(() => open(randomBytes(32), sealed));
});

test('open rejects a tampered blob', async () => {
  const key = randomBytes(32);
  const sealed = await seal(key, utf8('secret'));
  sealed[sealed.length - 1] ^= 0xff; // flip a bit in the GCM tag
  await assert.rejects(() => open(key, sealed));
});

test('two seals of the same plaintext under the same key produce different IVs/ciphertext', async () => {
  const key = randomBytes(32);
  const plaintext = utf8('same input twice');

  const a = await seal(key, plaintext);
  const b = await seal(key, plaintext);

  assert.notEqual(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});

test('open rejects a blob with an unsupported version byte', async () => {
  const key = randomBytes(32);
  const sealed = await seal(key, utf8('x'));
  sealed[0] = 0x02;
  await assert.rejects(() => open(key, sealed), /Unsupported encryption format version/);
});
