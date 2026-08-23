import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_MASTER_PASSWORD_LENGTH, validateMasterPassword } from './policy.js';

test('rejects an empty Master Password', () => {
  assert.match(validateMasterPassword(''), /required/i);
});

test('rejects a Master Password shorter than the minimum', () => {
  const tooShort = 'a'.repeat(MIN_MASTER_PASSWORD_LENGTH - 1);
  assert.match(validateMasterPassword(tooShort), new RegExp(`at least ${MIN_MASTER_PASSWORD_LENGTH}`));
});

test('accepts a Master Password exactly at the minimum length', () => {
  const exact = 'a'.repeat(MIN_MASTER_PASSWORD_LENGTH);
  assert.equal(validateMasterPassword(exact), null);
});

test('accepts a Master Password longer than the minimum', () => {
  assert.equal(validateMasterPassword('a'.repeat(MIN_MASTER_PASSWORD_LENGTH + 20)), null);
});

test('does not enforce any character-class requirements (unlike the login password policy)', () => {
  // Deliberately looser than Cognito's login-password policy - digits-only,
  // letters-only, etc. should all be accepted as long as the length floor
  // is met. See policy.js's header comment for why.
  assert.equal(validateMasterPassword('1'.repeat(MIN_MASTER_PASSWORD_LENGTH)), null);
});
