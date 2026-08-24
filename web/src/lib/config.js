/**
 * Runtime config, fetched from `/config.json` once at app startup (see
 * main.js) instead of baked into the JS bundle at build time. Values here
 * are the same public identifiers documented in docs/todo.md "Live stack
 * outputs" - pool ID, client ID, API URL are not secret
 * (docs/architecture.md §5), so shipping them to the client at all is fine.
 *
 * Why runtime, not build-time: the previous approach (Vite `define`) baked
 * these into the bundle when `npm run build` ran, which meant a Cognito
 * pool/client recreate (new IDs) silently broke the *already-deployed*
 * bundle until someone remembered to rebuild - see docs/todo.md "PWA
 * build/deploy gotcha" for the incident this replaced. Now `config.json` is
 * generated fresh on every `cdk deploy` from the live stack's actual
 * resolved values (infra/'s `ConfigDeployment`, via `Source.jsonData`), so
 * the JS bundle itself never needs to change when those IDs do. Locally,
 * `vite.config.js`'s `runtimeConfigPlugin` serves/writes the same shape
 * from the repo-root `.env` for `npm run dev`/`npm run preview`.
 */

let loaded = null;

/** Call once, before any code reads `config.*` (see main.js). Idempotent -
 * safe to call more than once, only fetches on the first call. */
export async function loadConfig() {
  if (loaded) return loaded;
  const res = await fetch('/config.json');
  if (!res.ok) {
    throw new Error(`Failed to load /config.json: HTTP ${res.status}`);
  }
  loaded = await res.json();
  return loaded;
}

function get(name, jsonKey) {
  if (!loaded) {
    throw new Error(
      `Config not loaded yet - config.${name} was read before loadConfig() resolved (see main.js).`,
    );
  }
  const value = loaded[jsonKey];
  if (!value) {
    throw new Error(`Missing required config value "${jsonKey}" in /config.json.`);
  }
  return value;
}

export const config = {
  get region() {
    return get('region', 'region');
  },
  get userPoolId() {
    return get('userPoolId', 'userPoolId');
  },
  get clientId() {
    return get('clientId', 'clientId');
  },
  get apiBaseUrl() {
    return get('apiBaseUrl', 'apiBaseUrl');
  },
};
