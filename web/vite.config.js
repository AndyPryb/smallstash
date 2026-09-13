import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Serves/writes a `config.json` shaped exactly like the one
// `SmallstashStack`'s `ConfigDeployment` generates for the real deployed
// site (see infra/) - src/lib/config.js fetches this at runtime instead of
// reading build-time constants, so a stack recreate (new Cognito pool/
// client/API IDs) never requires a frontend rebuild again. Here, for local
// dev/preview only, the same 4 values come from the repo-root .env instead
// of live stack outputs.
function runtimeConfigPlugin(env) {
  const payload = JSON.stringify({
    region: env.AWS_REGION ?? '',
    userPoolId: env.COGNITO_USER_POOL_ID ?? '',
    clientId: env.COGNITO_CLIENT_ID ?? '',
    apiBaseUrl: env.API_BASE_URL ?? '',
  });

  return {
    name: 'smallstash-runtime-config',
    // `npm run dev` - no dist/ exists yet, so serve it from a middleware
    // instead of a static file. Re-reads `env` captured at server start,
    // same as every other Vite dev value (restart to pick up .env edits).
    configureServer(server) {
      server.middlewares.use('/config.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(payload);
      });
    },
    // `npm run build` - write a real config.json into the build output so
    // `npm run preview` (serves dist/ as static files, no middleware) also
    // works locally. This copy is dev-only and never uploaded: infra/'s
    // SiteDeployment explicitly excludes config.json, so the real deploy
    // only ever gets the one ConfigDeployment writes from live stack
    // values.
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(repoRoot, 'web/dist');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, 'config.json'), payload);
    },
  };
}

// Plain SPA - deliberately NOT SvelteKit. See docs/decisions/0002-pwa-stack.md:
// SSR would create a place where frontend code executes on a server, and the
// frontend is exactly the code that touches the Master Password. A static
// build has no server to leak to.
export default defineConfig(({ mode }) => {
  // Share the repo-root .env with tests/api/ - same file, same four public
  // values (pool ID, client ID, API URL, region; see docs/architecture.md
  // §5 for why these aren't secret), no second copy to keep in sync. Only
  // used here for local dev/preview's config.json - the deployed site's
  // real values come from live CDK stack outputs instead, see
  // src/lib/config.js and infra/'s ConfigDeployment.
  const env = loadEnv(mode, repoRoot, '');

  return {
    plugins: [
      svelte(),
      runtimeConfigPlugin(env),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Small Stash',
          short_name: 'Small Stash',
          description: 'Zero-knowledge password manager',
          // Must track --ss-canvas in src/app.css and the theme-color meta
          // in index.html - these three are what an installed PWA paints
          // its window chrome and splash screen with, and a mismatch shows
          // up as a visible seam above the app on launch.
          theme_color: '#0f1317',
          background_color: '#0f1317',
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
          // config.json is deliberately NOT in globPatterns above - it's
          // .json, generated fresh per deploy (infra/'s ConfigDeployment),
          // not a static build asset with a content-hashed filename the
          // precache manifest can pin.
          //
          // A Workbox runtimeCaching rule used to live here instead of what
          // follows - removed 2026-09-13. It looked right (NetworkFirst,
          // confirmed present in the built sw.js, confirmed byte-identical
          // between local dist/ and the live deployed site) but still
          // failed a real end-to-end offline-unlock run: the very first
          // page load - the one where config.js's fetch('/config.json')
          // actually happens, at boot - is never controlled by the service
          // worker that's still installing/activating in the background, so
          // that first request never passed through this rule at all and
          // nothing was ever cached for a later offline reload to use.
          // Fixed at the source instead: `src/lib/config.js` now writes the
          // successful response into Cache Storage itself, directly, with
          // no dependency on SW activation timing - see its own doc comment
          // for the full explanation. See web/e2e/offline-unlock.spec.js
          // for the regression test.
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
    },

    server: {
      // Matches the CORS origin already allowed by the deployed HTTP API
      // (SmallstashStack) - dev works against the live backend with no infra change.
      port: 5173,
      strictPort: true,
    },
  };
});
