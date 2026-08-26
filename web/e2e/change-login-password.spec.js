import { test, expect } from './fixtures.js';
import { testUserEmail, testUserPassword, testUserMasterPassword } from './env.js';

/**
 * Originally reproduced the "null" bug reported 2026-08-25: submitting a
 * new login password that Cognito's own policy check rejects surfaced
 * literally "Password did not conform with policy: null" - AWS's own
 * exception message with an unfilled template slot, passed straight
 * through by `err.message ?? String(err)` in ChangeLoginPasswordForm.svelte.
 * Confirmed by grep that "did not conform with policy" appears nowhere in
 * this repo's source - it isn't a client-side string, so there was no
 * template here to fix directly.
 *
 * FIX IMPLEMENTED (2026-08-25, web/src/lib/errors.js -
 * friendlyAuthErrorMessage, matched on InvalidPasswordException's
 * .code/.name): substitutes a real, useful message instead of exposing
 * AWS's raw text. Wired into ChangeLoginPasswordForm, SignupForm, and
 * ForgotPasswordForm - every place a new Cognito login password is
 * submitted.
 *
 * NOT YET DEPLOYED - this spec's assertions describe the fixed behaviour
 * and will fail against the live site until the next frontend redeploy
 * ships this change, same as security-headers.spec.js's CSP-enforcing
 * check.
 *
 * Deliberately only the REJECTED case - Cognito refuses the change, so the
 * account's real login password is untouched by this spec.
 */
test.describe('Change Login Password - negative case', () => {
  test('a policy-violating new password gets a friendly message, not Cognito\'s raw "null" text', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(testUserEmail());
    await page.getByLabel(/^Login password/i).fill(testUserPassword());
    await page.getByLabel(/^Master Password/i).fill(testUserMasterPassword());
    await page.getByRole('button', { name: 'Unlock vault' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'Change Login Password' }).click();
    await expect(page.getByRole('heading', { name: 'Change Login Password' })).toBeVisible();

    await page.getByLabel('Current login password').fill(testUserPassword());
    // Deliberately weak - ChangeLoginPasswordForm has no client-side
    // pattern check (unlike SignupForm), only a match check, so this
    // reaches Cognito's own InvalidPasswordException. Anchored regex, not a
    // plain string - 'New login password' is a substring of 'Confirm new
    // login password', same getByLabel-matches-the-whole-label quirk hit
    // elsewhere in this suite.
    await page.getByLabel(/^New login password/i).fill('weak');
    await page.getByLabel(/^Confirm new login password/i).fill('weak');
    // The submit button is "Update login password" - a genuinely different
    // string from the toolbar toggle that opened this panel ("Change Login
    // Password"), so this no longer relies on capitalisation alone to tell
    // the two apart the way it used to. Renamed 2026-08-26 precisely
    // because a casing-only distinction is one styling tweak away from
    // breaking silently, and the equivalent pair on the Master Password
    // panel was byte-identical with no way to disambiguate at all.
    await page.getByRole('button', { name: 'Update login password', exact: true }).click();

    const error = page.getByRole('alert');
    await expect(error).toBeVisible({ timeout: 15000 });
    const text = await error.textContent();

    // eslint-disable-next-line no-console -- deliberate: visible in CI/local
    // output for anyone re-running this before the fix is deployed.
    console.log(`[change-login-password] error text: ${JSON.stringify(text)}`);

    expect(text).not.toContain('did not conform with policy');
    expect(text).not.toMatch(/:\s*null\b/i);
    expect(text).toMatch(/too weak|data breach/i);
  });
});
