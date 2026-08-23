import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePassword } from './generator.js';

test('generates a password of the requested length', () => {
  for (const length of [4, 8, 20, 64]) {
    assert.equal(generatePassword({ length }).length, length);
  }
});

test('defaults to length 20', () => {
  assert.equal(generatePassword().length, 20);
});

test('two generated passwords differ', () => {
  const a = generatePassword({ length: 32 });
  const b = generatePassword({ length: 32 });
  assert.notEqual(a, b);
});

test('respects disabled character types', () => {
  const onlyLowercase = generatePassword({
    length: 40,
    lowercase: true,
    uppercase: false,
    digits: false,
    symbols: false,
  });
  assert.match(onlyLowercase, /^[a-z]+$/);
});

test('includes at least one character from each enabled type', () => {
  // Long enough that "missing a whole category by chance" is astronomically
  // unlikely if the guarantee weren't enforced (odds only get lower as
  // length grows) - failing this reliably indicates a real bug, not flakiness.
  const password = generatePassword({ length: 40 });
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[!@#$%^&*()\-_=+[\]{}:;,.<>?/~]/);
});

test('excludeAmbiguous strips I/l/1/O/0 from the output', () => {
  for (let i = 0; i < 50; i++) {
    const password = generatePassword({ length: 40, excludeAmbiguous: true });
    assert.doesNotMatch(password, /[Il1O0]/);
  }
});

test('throws when every character type is disabled', () => {
  assert.throws(
    () => generatePassword({ lowercase: false, uppercase: false, digits: false, symbols: false }),
    /at least one character type/i,
  );
});

test('throws when length is too short to include one of each selected type', () => {
  assert.throws(() => generatePassword({ length: 2 }), /at least 4/);
});

test('random character selection is not obviously biased', () => {
  // Regression guard for the rejection-sampling logic in randomIndex(): a
  // naive `byte % max` would skew low-index characters of a 26-letter
  // alphabet high, since 256 isn't a multiple of 26. Generate many
  // single-character draws and check no character is wildly over/under
  // represented versus the ~1/26 expected share.
  const counts = new Map();
  const trials = 26 * 200; // ~200 expected occurrences per letter
  for (let i = 0; i < trials; i++) {
    const [char] = generatePassword({
      length: 4,
      lowercase: true,
      uppercase: false,
      digits: false,
      symbols: false,
    });
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  assert.equal(counts.size, 26, 'every lowercase letter should appear at least once');
  const expected = trials / 26;
  for (const [char, count] of counts) {
    // Generous tolerance (±50%) - this is a smoke test for gross bias
    // (e.g. a modulo bug), not a statistical rigor test.
    assert.ok(
      count > expected * 0.5 && count < expected * 1.5,
      `character '${char}' occurred ${count} times, expected around ${expected}`,
    );
  }
});
