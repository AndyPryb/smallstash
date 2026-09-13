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
 *
 * Offline fallback is handled here, in application code, rather than left
 * to the service worker's own runtime-caching rule (`vite.config.js` used
 * to have one for `/config.json`). Confirmed via
 * `web/e2e/offline-unlock.spec.js` (2026-09-13) that the SW rule alone
 * isn't enough: the very first page load - the one that calls
 * `loadConfig()` at boot, before the service worker has finished
 * installing/activating - is never controlled by the SW that's still
 * registering, so that first fetch never passes through its cache-writing
 * logic at all, and nothing is ever cached for a later offline reload to
 * fall back on. Writing the response into Cache Storage directly here
 * (available on `window`/`self` independent of whether a service worker is
 * controlling the page) closes that gap - it happens the moment the first
 * real online fetch succeeds, with no dependency on SW activation timing.
 */

const CACHE_NAME = 'smallstash-config';
const CONFIG_URL = '/config.json';

let loaded = null;

/**
 * Whether the most recent `loadConfig()` actually reached the network, or
 * fell back to the Cache Storage copy - `null` until the first call
 * resolves. Exists because `navigator.onLine` turns out not to be trustworthy
 * at boot: confirmed directly (2026-09-13) that after a service worker
 * satisfies a reload entirely from its own precache with zero network
 * activity, Chromium's `navigator.onLine` can still read `true` even though
 * the browser context is genuinely, verifiably offline - there's apparently
 * nothing on that page's lifetime to trigger the browser's own online/offline
 * determination. This flag reuses the `config.json` fetch every boot already
 * has to make anyway, so it's a real, active answer to "did we just reach the
 * server", not another guess - see App.svelte's use of it for `online`'s
 * initial value.
 * @returns {boolean | null}
 */
export function lastConfigLoadWasFromNetwork() {
  return loadedFromNetwork;
}

let loadedFromNetwork = null;

/** Call once, before any code reads `config.*` (see main.js). Idempotent -
 * safe to call more than once, only fetches on the first call. */
export async function loadConfig() {
  if (loaded) return loaded;
  loaded = await fetchAndCacheConfig();
  return loaded;
}

async function fetchAndCacheConfig() {
  let res;
  try {
    // no-store, not the default cache mode: confirmed directly (2026-09-13)
    // that /config.json ships no Cache-Control header, only Last-Modified -
    // enough for a browser's heuristic HTTP caching (RFC 7234 §4.2.2) to
    // serve a very recent fetch straight from local disk cache, with zero
    // network activity, even while genuinely offline. That silently defeats
    // lastConfigLoadWasFromNetwork() below (a "success" that never touched
    // the network reads identically to a real one) and risks running on a
    // stale config within that heuristic freshness window even when online.
    // no-store forces every call to actually hit the network, which is what
    // makes the exported network/cache signal trustworthy at all.
    res = await fetch(CONFIG_URL, { cache: 'no-store' });
  } catch (networkErr) {
    return fallbackToCacheOrThrow(networkErr);
  }
  if (!res.ok) {
    return fallbackToCacheOrThrow(new Error(`Failed to load /config.json: HTTP ${res.status}`));
  }
  loadedFromNetwork = true;
  await cacheConfigResponse(res);
  return res.json();
}

async function fallbackToCacheOrThrow(err) {
  const cached = await readCachedConfig();
  if (cached) {
    loadedFromNetwork = false;
    return cached;
  }
  throw err;
}

/** Best-effort only - a Cache Storage write failing (private browsing,
 * quota, unsupported browser) must never block a normal online boot. */
async function cacheConfigResponse(res) {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CONFIG_URL, res.clone());
  } catch {
    // Ignored deliberately - see doc comment above.
  }
}

async function readCachedConfig() {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(CONFIG_URL);
    return match ? await match.json() : null;
  } catch {
    return null;
  }
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
