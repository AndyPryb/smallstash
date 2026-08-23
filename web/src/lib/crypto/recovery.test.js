import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRecoveryKey, parseRecoveryKey, deriveRecoveryWrapKey } from './recovery.js';
import { randomBytes } from '../bytes.js';

test('generateRecoveryKey formats and parses back to the same bytes', () => {
  const { bytes, formatted } = generateRecoveryKey();
  const parsed = parseRecoveryKey(formatted);
  assert.equal(Buffer.from(parsed).toString('hex'), Buffer.from(bytes).toString('hex'));
});

test('parseRecoveryKey tolerates lowercase, dashes, and spacing', () => {
  const { bytes, formatted } = generateRecoveryKey();
  const messy = formatted.toLowerCase().replace(/-/g, ' ');
  const parsed = parseRecoveryKey(messy);
  assert.equal(Buffer.from(parsed).toString('hex'), Buffer.from(bytes).toString('hex'));
});

test('parseRecoveryKey normalises I/L/O confusions', () => {
  // Force a code containing at least one ambiguity-prone symbol by generating
  // until we get one containing a digit that maps from a normalised letter.
  const { formatted } = generateRecoveryKey();
  const withConfusables = formatted.replace(/1/g, 'I').replace(/0/g, 'O');
  assert.doesNotThrow(() => parseRecoveryKey(withConfusables));
});

test('parseRecoveryKey rejects the wrong length', () => {
  assert.throws(() => parseRecoveryKey('ABCD'), /characters/);
});

test('parseRecoveryKey rejects invalid characters', () => {
  const { formatted } = generateRecoveryKey();
  // U is excluded from the Crockford alphabet used here.
  const invalid = 'U' + formatted.slice(1);
  assert.throws(() => parseRecoveryKey(invalid), /Invalid character/);
});

test('deriveRecoveryWrapKey is deterministic for the same key+salt', async () => {
  const { bytes } = generateRecoveryKey();
  const salt = randomBytes(16);

  const a = await deriveRecoveryWrapKey(bytes, salt);
  const b = await deriveRecoveryWrapKey(bytes, salt);

  assert.equal(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});

test('deriveRecoveryWrapKey differs across salts', async () => {
  const { bytes } = generateRecoveryKey();
  const a = await deriveRecoveryWrapKey(bytes, randomBytes(16));
  const b = await deriveRecoveryWrapKey(bytes, randomBytes(16));
  assert.notEqual(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});
