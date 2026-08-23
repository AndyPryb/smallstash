import test from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, fromBase64, utf8, fromUtf8, randomBytes, wipe } from './bytes.js';

test('toBase64/fromBase64 round-trips arbitrary bytes', () => {
  const original = new Uint8Array([0, 1, 2, 127, 128, 255, 254, 16, 32, 200]);
  const roundTripped = fromBase64(toBase64(original));
  assert.deepEqual([...roundTripped], [...original]);
});

test('toBase64/fromBase64 round-trips an empty array', () => {
  const roundTripped = fromBase64(toBase64(new Uint8Array(0)));
  assert.equal(roundTripped.length, 0);
});

test('utf8/fromUtf8 round-trips ASCII and multi-byte text', () => {
  const text = 'hello, world - café, 日本語, emoji: 🔒';
  assert.equal(fromUtf8(utf8(text)), text);
});

test('utf8 produces the expected byte length for known multi-byte characters', () => {
  // 'é' is 2 bytes in UTF-8, '🔒' is 4 bytes (surrogate pair in UTF-16, single
  // 4-byte sequence in UTF-8) - a quick sanity check that this isn't
  // accidentally doing a UTF-16-per-code-unit encoding instead.
  assert.equal(utf8('é').length, 2);
  assert.equal(utf8('🔒').length, 4);
});

test('randomBytes returns the requested length', () => {
  for (const length of [0, 1, 16, 32, 64]) {
    assert.equal(randomBytes(length).length, length);
  }
});

test('randomBytes is not deterministic', () => {
  const a = randomBytes(32);
  const b = randomBytes(32);
  assert.notEqual(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});

test('wipe zeroes every byte in place', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  wipe(bytes);
  assert.deepEqual([...bytes], [0, 0, 0, 0, 0]);
});

test('wipe mutates the original array (not a copy)', () => {
  const bytes = randomBytes(16);
  const sameReference = bytes;
  wipe(bytes);
  assert.deepEqual([...sameReference], new Array(16).fill(0));
});
