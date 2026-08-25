import { defineConfig, devices } from '@playwright/test';

/**
 * Browser/E2E config - see docs/todo.md "Browser/E2E testing with
 * Playwright" and web/e2e/README.md for the decision record and priority
 * list. Drives a real browser against the deployed CloudFront site, not
 * `npm run dev` - the CSP is a CloudFront response header, so Vite's dev
 * server sends none of it and would make every test misleadingly "pass".
 */
export default defineConfig({
  testDir: './e2e',

  // Bundled Chromium project, not `channel: 'chrome'` - portable to a fresh
  // machine/CI runner with just `npx playwright install chromium`, doesn't
  // quietly depend on a specific local browser install.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  use: {
    // The live deployed site. Overridable because the stack's CloudFront
    // domain changes on every full destroy/recreate (see docs/todo.md
    // "Live stack outputs") - hardcoding it here would silently start
    // testing a dead URL after the next teardown.
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://ds9wv7ctss47x.cloudfront.net',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Serial, not parallel: several specs share one live Cognito pool (the
  // invite code, and later the one shared test account) - concurrent runs
  // risk racing each other (e.g. two tests colliding on the same account's
  // MFA/session state). Not worth the speed for a suite this size.
  fullyParallel: false,
  workers: 1,

  reporter: [['list']],
});
