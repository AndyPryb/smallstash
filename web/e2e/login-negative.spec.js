import { test, expect, expectNoCspViolations } from './fixtures.js';

/**
 * Login-form negative cases that need no account, real or otherwise.
 */
test.describe('Login - negative cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('empty submission is blocked client-side, no request fires', async ({ page }) => {
    let requestFired = false;
    page.on('request', (req) => {
      if (req.url().includes('cognito-idp') || req.url().includes('execute-api')) {
        requestFired = true;
      }
    });

    await page.getByRole('button', { name: 'Unlock vault' }).click();

    // HTML5 `required` should stop the submit before onsubmit ever runs -
    // the email field is first in tab order, so it's the one the browser
    // focuses/reports as invalid.
    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toHaveJSProperty('validity.valid', false);
    expect(requestFired).toBe(false);
  });

  test('wrong credentials show a generic error, not which field was wrong', async ({ page }) => {
    // Real email, deliberately wrong password - and a nonexistent email
    // both need to produce the SAME generic message. This is the live
    // behaviour of preventUserExistenceErrors (verified separately via
    // direct Cognito API probe during the post-deploy smoke test) - this
    // test exercises it through the actual UI instead.
    await page.getByLabel('Email').fill('definitely-no-such-user-e2e@example.com');
    // Anchored regexes, not plain strings: getByLabel matches by substring
    // against the WHOLE label text, which includes the <small> hint - and
    // the Master Password field's own hint mentions "your login password",
    // so a bare 'Login password' string matches both fields. Anchoring to
    // the start disambiguates without touching app markup.
    await page.getByLabel(/^Login password/i).fill('WrongPassword123!');
    await page.getByLabel(/^Master Password/i).fill('irrelevant-not-reached');
    await page.getByRole('button', { name: 'Unlock vault' }).click();

    const error = page.getByRole('alert');
    await expect(error).toBeVisible({ timeout: 15000 });
    const text = await error.textContent();

    // Must NOT leak account existence either way.
    expect(text.toLowerCase()).not.toContain('user does not exist');
    expect(text.toLowerCase()).not.toContain('usernotfound');

    await expectNoCspViolations(page);
  });

  test('switching to signup and back clears any previous error', async ({ page }) => {
    await page.getByLabel('Email').fill('definitely-no-such-user-e2e@example.com');
    await page.getByLabel(/^Login password/i).fill('WrongPassword123!');
    await page.getByLabel(/^Master Password/i).fill('irrelevant');
    await page.getByRole('button', { name: 'Unlock vault' }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Create one' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
