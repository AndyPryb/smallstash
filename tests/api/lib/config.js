'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

// Test config lives in .env at the repo root, not here - see
// docs/todo.md "API testing approach" and .env.example for what each key
// means. Never hardcode any of these values in test source.
//
// Validated lazily via `required()` at the point of use, not eagerly here -
// the unauthenticated-request tests don't need TEST_USER_EMAIL/PASSWORD at
// all, and shouldn't fail to even start just because those are blank.
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env at the ` +
      'repo root and fill it in (see docs/todo.md "API testing approach").'
    );
  }
  return value;
}

module.exports = {
  get region() { return required('AWS_REGION'); },
  get userPoolId() { return required('COGNITO_USER_POOL_ID'); },
  get clientId() { return required('COGNITO_CLIENT_ID'); },
  get apiBaseUrl() { return required('API_BASE_URL'); },
  get testUserEmail() { return required('TEST_USER_EMAIL'); },
  get testUserPassword() { return required('TEST_USER_PASSWORD'); },
};
