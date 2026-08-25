import test from 'node:test';
import assert from 'node:assert/strict';

import { friendlyAuthErrorMessage } from './errors.js';

test('substitutes a friendly message for InvalidPasswordException by code', () => {
  const err = new Error('Password did not conform with policy: null');
  err.code = 'InvalidPasswordException';
  err.name = 'InvalidPasswordException';

  const message = friendlyAuthErrorMessage(err);

  assert.ok(!message.includes('null'), `expected no raw "null" leakage, got: ${message}`);
  assert.match(message, /too weak|data breach/i);
});

test('matches on .name too, not only .code', () => {
  const err = new Error('Password did not conform with policy: null');
  err.name = 'InvalidPasswordException';
  // .code deliberately absent - the Cognito client library sets both, but
  // this guards against relying on only one of them.

  assert.match(friendlyAuthErrorMessage(err), /too weak|data breach/i);
});

test('leaves other Cognito errors untouched', () => {
  const err = new Error('Incorrect username or password.');
  err.code = 'NotAuthorizedException';
  err.name = 'NotAuthorizedException';

  assert.equal(friendlyAuthErrorMessage(err), 'Incorrect username or password.');
});

test('falls back to String(err) for an error with no message', () => {
  const err = { code: 'SomeException' };
  assert.equal(friendlyAuthErrorMessage(err), String(err));
});

test('handles non-error values without throwing', () => {
  assert.equal(friendlyAuthErrorMessage('a plain string'), 'a plain string');
  assert.equal(friendlyAuthErrorMessage(null), 'null');
  assert.equal(friendlyAuthErrorMessage(undefined), 'undefined');
});
