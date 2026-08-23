import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Plain SPA - deliberately NOT SvelteKit. See docs/decisions/0002-pwa-stack.md:
// SSR would create a place where frontend code executes on a server, and the
// frontend is exactly the code that touches the Master Password. A static
// build has no server to leak to.
export default defineConfig({
  // Share the repo-root .env with tests/api/ rather than keeping a second
  // copy here. Only VITE_-prefixed vars are exposed to (and baked into) the
  // client bundle - TEST_USER_PASSWORD stays out precisely because it has no
  // prefix. Never add a VITE_ prefix to anything secret.
  envDir: '..',

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

  // amazon-cognito-identity-js pulls in buffer@4.9.2, a browserify-era package
  // that expects a Node-style `global`. Without this the SRP path throws at
  // runtime (not build time), so it fails on the login screen rather than in CI.
  define: {
    global: 'globalThis',
  },

  server: {
    // Matches the CORS origin already allowed by the deployed HTTP API
    // (SmallstashStack) - dev works against the live backend with no infra change.
    port: 5173,
    strictPort: true,
  },
});
