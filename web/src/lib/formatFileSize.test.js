import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFileSize } from './formatFileSize.js';

test('formats sub-1000-byte sizes as bytes', () => {
  assert.equal(formatFileSize(0), '0 bytes');
  assert.equal(formatFileSize(1), '1 bytes');
  assert.equal(formatFileSize(999), '999 bytes');
});

test('formats KB with one decimal place when not a whole number', () => {
  assert.equal(formatFileSize(1000), '1 KB');
  assert.equal(formatFileSize(1500), '1.5 KB');
  assert.equal(formatFileSize(999_000), '999 KB');
});

test('formats MB and GB the same way', () => {
  assert.equal(formatFileSize(1_000_000), '1 MB');
  assert.equal(formatFileSize(25_000_000), '25 MB');
  assert.equal(formatFileSize(1_000_000_000), '1 GB');
});

test('rounds rather than truncates', () => {
  // 1949 bytes -> 1.949 KB -> rounds to 1.9, not 1.94 or 1
  assert.equal(formatFileSize(1949), '1.9 KB');
});

test('never shows a trailing ".0"', () => {
  assert.equal(formatFileSize(2_000_000), '2 MB');
});

test('handles invalid input without throwing', () => {
  assert.equal(formatFileSize(-5), '—');
  assert.equal(formatFileSize(NaN), '—');
  assert.equal(formatFileSize(Infinity), '—');
});
