import { test, expect, expectNoCspViolations } from './fixtures.js';
import { testUserEmail, testUserPassword, testUserMasterPassword } from './env.js';

/**
 * docs/todo.md "PWA: offline access to key material" was implemented but
 * never run in a real browser - `context.setOffline(true)` is exactly what
 * makes that genuinely testable (Playwright docs flagged this specifically
 * as the motivating case for offline testing).
 */
test.describe('Offline unlock', () => {
  // CONFIRMED BUG (2026-08-25) - see docs/todo.md "PWA: offline access to
  // key material". Root cause: the PWA's service worker precache glob is
  // `['**/*.{js,css,html,svg,woff2}']` - .json is never included, and there
  // was no `runtimeCaching` rule for `/config.json` either, so it always
  // hit the network with zero offline fallback and the app couldn't finish
  // booting offline at all.
  //
  // FIX IMPLEMENTED (2026-08-25, vite.config.js - a NetworkFirst
  // runtimeCaching rule for /config.json) and verified working at the
  // mechanism level via a standalone script against `npm run preview`:
  // offline fetch('/config.json') now returns 200 from cache, and the
  // "failed to load its configuration" error no longer appears.
  //
  // test.fail() STAYS for now, deliberately: this suite's default target
  // is the live deployed site, which doesn't have this fix until the next
  // `cdk deploy`/frontend redeploy. This exact spec could not be used to
  // confirm the fix end-to-end locally either - CORS blocks
  // localhost:4173 from reaching the real API (only the CloudFront origin
  // is allowed), so a local run fails earlier, on the online step, for an
  // unrelated reason. Remove test.fail() only after this passes for real
  // against the live URL post-deploy.
  test.fail();
  test('a device with a prior online sign-in can unlock while offline', async ({ page, context }) => {
    // Online sign-in first - this is what populates the IndexedDB cache
    // (salt, KDF params, both wrapped Vault Key copies) that offline
    // unlock reads from (cache/db.js).
    await page.goto('/');
    await page.getByLabel('Email').fill(testUserEmail());
    await page.getByLabel(/^Login password/i).fill(testUserPassword());
    await page.getByLabel(/^Master Password/i).fill(testUserMasterPassword());
    await page.getByRole('button', { name: 'Unlock vault' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 20000 });

    // Sign out and reload so the app starts fresh - offline unlock reads
    // getLastAccount() from localStorage, which survives sign-out
    // deliberately (session.js), then decides showOffline based on
    // navigator.onLine.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await context.setOffline(true);
    await page.reload();

    await expect(page.getByText("You're offline")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(testUserEmail())).toBeVisible();

    await page.getByLabel(/^Master Password/i).fill(testUserMasterPassword());
    await page.getByRole('button', { name: 'Unlock vault' }).click();

    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Add entry' })).toBeVisible();
    // The dedicated banner from VaultView.svelte confirming this is known
    // to be an offline session, not a false "everything's normal" view.
    await expect(page.getByText("You're viewing an offline copy")).toBeVisible();

    await expectNoCspViolations(page);

    await context.setOffline(false);
  });
});
