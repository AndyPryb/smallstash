/**
 * config.js fetches /config.json once at startup instead of reading
 * build-time constants (see docs/todo.md "PWA build/deploy gotcha" for why -
 * a stack recreate used to silently break an already-deployed bundle).
 * These tests replace the global `fetch` rather than mocking a module, since
 * config.js's whole job is wrapping that one network call.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// config.js caches its result in module-level state after the first
// successful load, so each test needs its own fresh module instance -
// re-importing the same specifier would just return the cached module.
let moduleCounter = 0;
async function freshConfigModule() {
  moduleCounter += 1;
  return import(`./config.js?test=${moduleCounter}`);
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});

test('config.* throws if read before loadConfig() resolves', async () => {
  const { config } = await freshConfigModule();
  assert.throws(() => config.userPoolId, /not loaded yet/);
});

test('loadConfig() fetches /config.json and config.* reads the result', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, '/config.json');
    return {
      ok: true,
      json: async () => ({
        region: 'eu-west-1',
        userPoolId: 'eu-west-1_fake',
        clientId: 'fake-client',
        apiBaseUrl: 'https://example.invalid',
      }),
    };
  };

  const { loadConfig, config } = await freshConfigModule();
  await loadConfig();

  assert.equal(config.region, 'eu-west-1');
  assert.equal(config.userPoolId, 'eu-west-1_fake');
  assert.equal(config.clientId, 'fake-client');
  assert.equal(config.apiBaseUrl, 'https://example.invalid');

  globalThis.fetch = originalFetch;
});

test('loadConfig() only fetches once, even if called again', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        region: 'eu-west-1',
        userPoolId: 'eu-west-1_fake',
        clientId: 'fake-client',
        apiBaseUrl: 'https://example.invalid',
      }),
    };
  };

  const { loadConfig } = await freshConfigModule();
  await loadConfig();
  await loadConfig();
  assert.equal(calls, 1);

  globalThis.fetch = originalFetch;
});

test('loadConfig() rejects on a non-OK response', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404 });

  const { loadConfig } = await freshConfigModule();
  await assert.rejects(() => loadConfig(), /404/);

  globalThis.fetch = originalFetch;
});

test('loadConfig() rejects if the fetched JSON is missing a required key', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ region: 'eu-west-1' }), // missing the other 3
  });

  const { loadConfig, config } = await freshConfigModule();
  await loadConfig();
  assert.throws(() => config.userPoolId, /Missing required config value/);

  globalThis.fetch = originalFetch;
});

/**
 * Minimal fake Cache Storage - just enough of `caches.open()`/`.put()`/
 * `.match()` for config.js's own usage. `.clone()` on the fake Response is
 * a no-op (returns the same object) since these responses aren't real
 * streams, so calling `.json()` on both the original and the "clone" is
 * safe, unlike a real Response.
 */
function makeFakeCaches() {
  const store = new Map();
  return {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name);
      return {
        async put(url, response) {
          entries.set(url, response);
        },
        async match(url) {
          return entries.get(url);
        },
      };
    },
  };
}

function fakeJsonResponse(body) {
  return {
    ok: true,
    json: async () => body,
    clone() {
      return this;
    },
  };
}

const REAL_CONFIG = {
  region: 'eu-west-1',
  userPoolId: 'eu-west-1_fake',
  clientId: 'fake-client',
  apiBaseUrl: 'https://example.invalid',
};

let originalCaches;
beforeEach(() => {
  originalCaches = globalThis.caches;
});

/**
 * The actual bug (2026-09-13, found by web/e2e/offline-unlock.spec.js): a
 * Workbox service-worker runtimeCaching rule for /config.json looked
 * correct but never actually populated its cache, because the very first
 * page load - the one where this fetch happens, at boot - is never
 * controlled by a service worker that's still installing. This test
 * reproduces that exact shape at the unit level: one "page load" (module
 * instance) succeeds online and should cache the response *without relying
 * on a service worker at all*; a second, independent "page load" sharing
 * the same underlying Cache Storage then fails on the network (simulating
 * offline) and must still resolve, from that cache.
 */
test('loadConfig() caches a successful response and a later instance falls back to it when offline', async () => {
  globalThis.caches = makeFakeCaches();

  globalThis.fetch = async () => fakeJsonResponse(REAL_CONFIG);
  const online = await freshConfigModule();
  await online.loadConfig();

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch'); // what a real offline fetch() rejects with
  };
  const offline = await freshConfigModule();
  await offline.loadConfig();

  assert.equal(offline.config.region, REAL_CONFIG.region);
  assert.equal(offline.config.userPoolId, REAL_CONFIG.userPoolId);
  assert.equal(offline.config.clientId, REAL_CONFIG.clientId);
  assert.equal(offline.config.apiBaseUrl, REAL_CONFIG.apiBaseUrl);

  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
});

test('loadConfig() still rejects on a network failure with nothing cached yet', async () => {
  globalThis.caches = makeFakeCaches();
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const { loadConfig } = await freshConfigModule();
  await assert.rejects(() => loadConfig(), /Failed to fetch/);

  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
});

test('lastConfigLoadWasFromNetwork() is null before the first load, true after a real network success', async () => {
  globalThis.fetch = async () => fakeJsonResponse(REAL_CONFIG);

  const { loadConfig, lastConfigLoadWasFromNetwork } = await freshConfigModule();
  assert.equal(lastConfigLoadWasFromNetwork(), null);
  await loadConfig();
  assert.equal(lastConfigLoadWasFromNetwork(), true);

  globalThis.fetch = originalFetch;
});

test('lastConfigLoadWasFromNetwork() is false when the result came from the offline cache fallback', async () => {
  globalThis.caches = makeFakeCaches();

  globalThis.fetch = async () => fakeJsonResponse(REAL_CONFIG);
  const online = await freshConfigModule();
  await online.loadConfig();

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const offline = await freshConfigModule();
  await offline.loadConfig();
  assert.equal(offline.lastConfigLoadWasFromNetwork(), false);

  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
});

test('loadConfig() prefers a fresh online response over a stale cached one', async () => {
  globalThis.caches = makeFakeCaches();

  globalThis.fetch = async () => fakeJsonResponse(REAL_CONFIG);
  const first = await freshConfigModule();
  await first.loadConfig();

  const updated = { ...REAL_CONFIG, apiBaseUrl: 'https://updated.invalid' };
  globalThis.fetch = async () => fakeJsonResponse(updated);
  const second = await freshConfigModule();
  await second.loadConfig();

  assert.equal(second.config.apiBaseUrl, 'https://updated.invalid');

  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
});
