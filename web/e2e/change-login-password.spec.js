import { test, expect } from './fixtures.js';
import { testUserEmail, testUserPassword, testUserMasterPassword } from './env.js';

/**
 * Reproduces the "null" bug reported 2026-08-25: submitting a new login
 * password that Cognito's own policy check rejects surfaces literally
 * "Password did not conform with policy: null" - AWS's own exception
 * message with an unfilled template slot, passed straight through by
 * `err.message ?? String(err)` in ChangeLoginPasswordForm.svelte. Confirmed
 * by grep beforehand that "did not conform with policy" appears nowhere in
 * this repo's source - it isn't a client-side string, so there's no
 * template here to fix; the available fix is a friendlier client-side
 * substitution for this specific exception.
 *
 * Deliberately only the REJECTED case - Cognito refuses the change, so the
 * account's real login password is untouched by this spec.
 */
test.describe('Change Login Password - negative case', () => {
  test('a policy-violating new password reproduces the reported error text', async ({ page }) => {
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
    // exact + this exact casing to disambiguate from the toolbar's toggle
    // button, "Change Login Password" (capital L) - a different string by
    // exact/case-sensitive match, not just a different element.
    await page.getByRole('button', { name: 'Change login password', exact: true }).click();

    const error = page.getByRole('alert');
    await expect(error).toBeVisible({ timeout: 15000 });
    const text = await error.textContent();

    // eslint-disable-next-line no-console -- deliberate: capturing the
    // exact live text for the bug report, not swallowing it.
    console.log(`[change-login-password bug repro] error text: ${JSON.stringify(text)}`);

    expect(text).toContain('did not conform with policy');
  });
});
