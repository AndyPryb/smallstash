import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizedUrl } from './url.js';

test('passes through http and https URLs unchanged', () => {
  assert.equal(normalizedUrl('https://example.com/x?y=1'), 'https://example.com/x?y=1');
  assert.equal(normalizedUrl('http://example.com'), 'http://example.com');
  assert.equal(normalizedUrl('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
});

test('assumes https for scheme-less input', () => {
  assert.equal(normalizedUrl('example.com'), 'https://example.com');
  assert.equal(normalizedUrl('example.com/path'), 'https://example.com/path');
});

test('never emits a javascript: URL', () => {
  // The one that matters: in this app a script running in-page can read the
  // Vault Key out of memory, so an entry that executes code defeats the whole
  // zero-knowledge model.
  for (const payload of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'jAvAsCrIpT:alert(document.cookie)',
    'javascript:/alert(1)',
    'javascript://example.com/%0aalert(1)',
  ]) {
    const result = normalizedUrl(payload);
    assert.ok(
      result.startsWith('https://'),
      `expected https:// prefix for ${payload}, got ${result}`,
    );
    assert.ok(
      !/^javascript:/i.test(result),
      `javascript: survived normalisation for ${payload}: ${result}`,
    );
  }
});

test('neutralises other dangerous schemes', () => {
  for (const payload of [
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.ok(
      normalizedUrl(payload).startsWith('https://'),
      `expected ${payload} to be neutralised`,
    );
  }
});

test('handles empty and non-string input without throwing', () => {
  assert.equal(normalizedUrl(''), '');
  assert.equal(normalizedUrl('   '), '');
  assert.equal(normalizedUrl(undefined), '');
  assert.equal(normalizedUrl(null), '');
});
