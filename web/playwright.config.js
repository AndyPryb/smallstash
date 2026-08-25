import { defineConfig, devices } from '@playwright/test';

/**
 * Browser/E2E config - see docs/todo.md "Browser/E2E testing with
 * Playwright" for the full decision record and what this has to cover
 * (CSP validation, MFA, offline unlock, invite-code signup, the 409
 * conflict path, etc.). Deliberately separate from web/'s node:test suite
 * (`npm test`) - this drives a real browser against a real deployed URL or
 * a served build, not pure lib/ logic.
 *
 * Nothing is targeted here yet: this file only proves the harness itself
 * works (an existing Playwright Chromium cache on this machine is reused,
 * no download) ahead of writing the actual specs once the security review
 * is deployed.
 */
export default defineConfig({
  testDir: './e2e',

  // `channel: 'chrome'` was considered and deliberately NOT used - it
  // depends on a real Chrome install existing on whatever machine runs this
  // (CI would need a separate step). The bundled Chromium project below is
  // what actually keeps this portable; the local cache reuse observed here
  // is a one-time convenience, not something the config depends on.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // baseURL is intentionally unset here - CSP is a CloudFront response
  // header (see architecture.md sec 5a), so `npm run dev`'s Vite server
  // sends none of it. Specs that need the real header (the CSP validation
  // pass) must point PLAYWRIGHT_BASE_URL at the deployed CloudFront URL, or
  // at a local static server that replays the same header against
  // web/dist - not at Vite dev.
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: 'retain-on-failure',
  },
});
