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
