import { test, expect, expectNoCspViolations } from './fixtures.js';
import { testUserEmail, testUserPassword, testUserMasterPassword } from './env.js';

/**
 * docs/todo.md "PWA: offline access to key material" was implemented but
 * never run in a real browser - `context.setOffline(true)` is exactly what
 * makes that genuinely testable (Playwright docs flagged this specifically
 * as the motivating case for offline testing).
 */
test.describe('Offline unlock', () => {
  // CONFIRMED BUG (2026-08-25), not test flakiness - test.fail() marks this
  // as expected-to-fail so the suite stays meaningfully green/red: if this
  // ever starts passing, Playwright reports THAT as a failure (a nudge to
  // remove this annotation once the real bug is fixed), rather than the
  // fix going unnoticed.
  //
  // Root cause confirmed by reading vite.config.js, not guessed from the
  // symptom: the PWA's service worker precache glob is
  // `['**/*.{js,css,html,svg,woff2}']` - .json is never included, and
  // there's no `runtimeCaching` rule for `/config.json` either. So
  // config.js's `fetch('/config.json')` always goes to the network, with
  // zero offline fallback. Confirmed live: going offline and reloading
  // shows "Small Stash failed to load its configuration" - the app can't
  // finish booting offline, so it never even reaches the offline-unlock
  // code path this test is trying to exercise. docs/todo.md's "PWA:
  // offline access to key material" marks the *feature* as resolved
  // 2026-08-23 - that was true of the unlock logic itself
  // (session.js/cache/db.js), verified only by unit test at the time; this
  // is the first real-browser exercise of the full flow, and it doesn't
  // survive contact with an actual offline browser.
  //
  // Fix (not yet implemented, needs a decision - see docs/todo.md): add a
  // `runtimeCaching` entry for `/config.json` with a NetworkFirst
  // strategy, so a successful online load caches a fallback the SW can
  // serve when the network fails.
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
