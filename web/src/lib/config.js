/**
 * Runtime config, read via import.meta.env.VITE_*. Values here are the same
 * public identifiers documented in docs/todo.md "Live stack outputs" - pool
 * ID, client ID, API URL are not secret (docs/architecture.md §5), so baking
 * them into the built bundle is fine.
 *
 * These names are NOT Vite's normal VITE_-prefixed convention picking them
 * up automatically - vite.config.js reads the plain (unprefixed)
 * AWS_REGION/COGNITO_USER_POOL_ID/COGNITO_CLIENT_ID/API_BASE_URL from the
 * repo-root .env (the same file tests/api/ uses, no duplicate copy) and
 * explicitly whitelists just those 4 into import.meta.env.VITE_* via
 * `define`. That whitelist, not the VITE_ prefix, is what keeps everything
 * else in .env (e.g. TEST_USER_PASSWORD) out of the shipped bundle - see
 * vite.config.js for the actual list.
 */

// `import.meta.env.VITE_X` (static property access) is what vite.config.js's
// `define` block can textually replace at build time - a dynamic/bracketed
// lookup like `import.meta.env[name]` would NOT be replaced, and would
// silently read undefined at runtime instead. Each getter below spells out
// its own static access for exactly that reason - don't refactor this into
// a name-driven loop.
function required(value, name) {
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env at the repo ` +
        'root and fill it in (see web/README.md).',
    );
  }
  return value;
}

export const config = {
  get region() {
    return required(import.meta.env.VITE_AWS_REGION, 'AWS_REGION');
  },
  get userPoolId() {
    return required(import.meta.env.VITE_COGNITO_USER_POOL_ID, 'COGNITO_USER_POOL_ID');
  },
  get clientId() {
    return required(import.meta.env.VITE_COGNITO_CLIENT_ID, 'COGNITO_CLIENT_ID');
  },
  get apiBaseUrl() {
    return required(import.meta.env.VITE_API_BASE_URL, 'API_BASE_URL');
  },
};
