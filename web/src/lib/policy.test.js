import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_MASTER_PASSWORD_LENGTH,
  validateMasterPassword,
  validateLoginPassword,
  LOGIN_PASSWORD_RULES,
  MASTER_PASSWORD_RULES,
} from './policy.js';

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

/**
 * Login password policy. These exist because the rules moved out of a single
 * regex in SignupForm and into individually testable entries - which is what
 * lets the UI show a live checklist. The risk that introduces is the
 * checklist and the submit-time rejection disagreeing, so what's tested here
 * is specifically that they're the same rules.
 */

test('validateLoginPassword accepts a password meeting every rule', () => {
  assert.equal(validateLoginPassword('Correct-Horse9!'), null);
});

test('validateLoginPassword rejects one that is long enough but missing a class', () => {
  // 12+ chars, upper, lower, digit - but no symbol.
  assert.match(validateLoginPassword('Abcdefghij12'), /12\+ characters/);
});

test('validateLoginPassword rejects one with every class but too short', () => {
  assert.match(validateLoginPassword('Ab1!def'), /12\+ characters/);
});

test('validateLoginPassword agrees with LOGIN_PASSWORD_RULES on every case', () => {
  // The invariant the live checklist depends on: "every rule ticked" and
  // "the form accepts it" must never disagree.
  const cases = ['', 'short', 'Abcdefghij12', 'abcdefghij12!', 'ABCDEFGHIJ12!', 'Correct-Horse9!', 'Aa1!'.repeat(3)];
  for (const candidate of cases) {
    const allRulesMet = LOGIN_PASSWORD_RULES.every((rule) => rule.test(candidate));
    assert.equal(
      validateLoginPassword(candidate) === null,
      allRulesMet,
      `disagreement on ${JSON.stringify(candidate)}`,
    );
  }
});

test('LOGIN_PASSWORD_RULES each fail in isolation for a password missing only that class', () => {
  // One password per rule, satisfying everything except that rule - proves
  // no rule is dead or accidentally testing the same thing as another.
  const missingOnly = {
    'At least 12 characters': 'Ab1!efgh',
    'An uppercase letter (A-Z)': 'abcdefghij1!',
    'A lowercase letter (a-z)': 'ABCDEFGHIJ1!',
    'A number (0-9)': 'Abcdefghijk!',
    'A symbol (! ? # $ …)': 'Abcdefghij12',
  };
  for (const rule of LOGIN_PASSWORD_RULES) {
    const candidate = missingOnly[rule.label];
    assert.ok(candidate, `no fixture for rule ${JSON.stringify(rule.label)} - rules changed?`);
    assert.equal(rule.test(candidate), false, `expected ${JSON.stringify(rule.label)} to fail`);
    for (const other of LOGIN_PASSWORD_RULES) {
      if (other === rule) continue;
      assert.equal(other.test(candidate), true, `${JSON.stringify(other.label)} should pass for ${candidate}`);
    }
  }
});

test('MASTER_PASSWORD_RULES matches validateMasterPassword at the length boundary', () => {
  const tooShort = 'a'.repeat(MIN_MASTER_PASSWORD_LENGTH - 1);
  const exact = 'a'.repeat(MIN_MASTER_PASSWORD_LENGTH);
  assert.equal(
    MASTER_PASSWORD_RULES.every((r) => r.test(tooShort)),
    false,
  );
  assert.equal(
    MASTER_PASSWORD_RULES.every((r) => r.test(exact)),
    true,
  );
  assert.equal(validateMasterPassword(exact), null);
});
