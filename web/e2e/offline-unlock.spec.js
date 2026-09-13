import { test, expect, expectNoCspViolations } from './fixtures.js';
import { testUserEmail, testUserPassword, testUserMasterPassword } from './env.js';

/**
 * docs/todo.md "PWA: offline access to key material" was implemented but
 * never run in a real browser - `context.setOffline(true)` is exactly what
 * makes that genuinely testable (Playwright docs flagged this specifically
 * as the motivating case for offline testing).
 */
test.describe('Offline unlock', () => {
  // Long history worth keeping, since this feature took three real bugs to
  // actually work - each one only surfaced by running this exact spec
  // against the live site, not by code review or unit tests:
  //
  // 1. CONFIRMED BUG (2026-08-25) - the service worker's precache glob
  //    never included `/config.json`, and there was no runtime-caching rule
  //    for it either, so it always hit the network with zero offline
  //    fallback and the app couldn't finish booting offline at all.
  // 2. "FIXED" (2026-08-25) with a Workbox `runtimeCaching` NetworkFirst
  //    rule - looked right, confirmed present in the live sw.js, but still
  //    failed for real (2026-09-13): the very first page load, the one
  //    where config.js's fetch happens at boot, is never controlled by a
  //    service worker that's still installing, so that first fetch never
  //    passed through the rule and nothing was ever cached.
  // 3. Fixed properly (2026-09-13) by having config.js cache the response
  //    itself, directly via the Cache Storage API - no dependency on SW
  //    activation timing (see config.js's own doc comment). That exposed a
  //    second bug: navigator.onLine can read `true` at boot even when
  //    genuinely offline, if the SW satisfies the reload from precache with
  //    no network activity to fail. Fixed by having config.js expose
  //    whether its last load actually reached the network
  //    (lastConfigLoadWasFromNetwork()), reusing the boot-time fetch as an
  //    active connectivity probe - which in turn needed `{ cache: 'no-store'
  //    }` on that fetch, since config.json ships no Cache-Control header
  //    and a browser's own HTTP heuristic caching (RFC 7234 §4.2.2) was
  //    silently serving the "offline" reload's fetch from disk cache,
  //    faking a network success.
  //
  // Confirmed passing for real against the live deployed site (2026-09-13),
  // not assumed from source - this is what finally justified removing the
  // `test.fail()` that lived here through all three attempts above.
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
    // The add-entry form is collapsed behind the "New entry" toolbar button
    // now (it used to be permanently expanded), so the button - not the
    // form's heading - is what proves the vault view rendered.
    await expect(page.getByRole('button', { name: 'New entry' })).toBeVisible();
    // The dedicated banner from VaultView.svelte confirming this is known
    // to be an offline session, not a false "everything's normal" view.
    await expect(page.getByText("You're viewing an offline copy")).toBeVisible();

    await expectNoCspViolations(page);

    await context.setOffline(false);
  });
});
