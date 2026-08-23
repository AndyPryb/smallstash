/**
 * Runtime config, from Vite env vars (import.meta.env). Values here are the
 * same public identifiers documented in docs/todo.md "Live stack outputs" -
 * pool ID, client ID, API URL are not secret (docs/architecture.md §5), so
 * baking them into the built bundle is fine. Never add anything secret to a
 * VITE_-prefixed var: Vite inlines every one of them into the shipped JS.
 *
 * vite.config.js sets envDir: '..', so these come from the repo-root .env -
 * the same file tests/api/ already reads, prefixed with VITE_.
 */

function required(name) {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env at the repo ` +
        'root, fill it in, and add the VITE_-prefixed values (see web/README.md).',
    );
  }
  return value;
}

export const config = {
  get region() {
    return required('VITE_AWS_REGION');
  },
  get userPoolId() {
    return required('VITE_COGNITO_USER_POOL_ID');
  },
  get clientId() {
    return required('VITE_COGNITO_CLIENT_ID');
  },
  get apiBaseUrl() {
    return required('VITE_API_BASE_URL');
  },
};
