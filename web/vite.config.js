import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Plain SPA - deliberately NOT SvelteKit. See docs/decisions/0002-pwa-stack.md:
// SSR would create a place where frontend code executes on a server, and the
// frontend is exactly the code that touches the Master Password. A static
// build has no server to leak to.
export default defineConfig(({ mode }) => {
  // Share the repo-root .env with tests/api/ - same file, same four public
  // values (pool ID, client ID, API URL, region; see docs/architecture.md
  // §5 for why these aren't secret), no second copy to keep in sync.
  //
  // Vite's default (import.meta.env) only bundles VITE_-prefixed vars, which
  // would mean duplicating every value here under a second name just to
  // expose it. Instead, loadEnv() with an empty prefix reads every var in
  // .env (not just VITE_-prefixed ones), and the `define` block below
  // whitelists exactly these 4 names into the client bundle. That explicit
  // whitelist - not the VITE_ prefix convention - is what keeps
  // TEST_USER_PASSWORD (and anything else in .env) out of shipped JS.
  const env = loadEnv(mode, repoRoot, '');

  return {
    plugins: [
      svelte(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'smallStash',
          short_name: 'smallStash',
          description: 'Zero-knowledge password manager',
          theme_color: '#1b1f24',
          background_color: '#1b1f24',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          // App shell only. Vault ciphertext and wrapped key material are cached
          // by us in IndexedDB (see lib/cache/db.js), not by the service worker -
          // we need explicit control over what is stored and when it goes stale,
          // which an HTTP cache can't give us. API responses are never cached
          // here; a stale 200 for /keys would be a correctness bug, not a perf win.
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          navigateFallback: 'index.html',
        },
        devOptions: { enabled: false },
      }),
    ],

    define: {
      // amazon-cognito-identity-js pulls in buffer@4.9.2, a browserify-era
      // package that expects a Node-style `global`. Without this the SRP
      // path throws at runtime (not build time), so it fails on the login
      // screen rather than in CI.
      global: 'globalThis',

      // The whitelist described above - only these 4 vars from .env reach
      // the client. Read via import.meta.env.VITE_* in src/lib/config.js so
      // every other env access in the app still goes through Vite's normal
      // (safe-by-default) mechanism; only this one call site is special.
      'import.meta.env.VITE_AWS_REGION': JSON.stringify(env.AWS_REGION ?? ''),
      'import.meta.env.VITE_COGNITO_USER_POOL_ID': JSON.stringify(env.COGNITO_USER_POOL_ID ?? ''),
      'import.meta.env.VITE_COGNITO_CLIENT_ID': JSON.stringify(env.COGNITO_CLIENT_ID ?? ''),
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.API_BASE_URL ?? ''),
    },

    server: {
      // Matches the CORS origin already allowed by the deployed HTTP API
      // (SmallstashStack) - dev works against the live backend with no infra change.
      port: 5173,
      strictPort: true,
    },
  };
});
