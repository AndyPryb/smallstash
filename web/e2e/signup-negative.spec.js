import { test, expect, expectNoCspViolations } from './fixtures.js';
import { inviteCode } from './env.js';

/**
 * Signup-form negative cases - none of these produce a real account (client
 * -side validation stops most before any network call; the wrong-invite
 * -code case is rejected server-side by the PreSignUp trigger before
 * Cognito creates anything).
 */
test.describe('Signup - negative cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await expect(page.getByLabel('Invite code')).toBeVisible();
  });

  /** Fills every field with values that pass client-side validation, so only the one deliberately-wrong field under test causes a failure. */
  async function fillValidBaseline(page, overrides = {}) {
    const values = {
      inviteCode: inviteCode(),
      email: `e2e-negative-${Date.now()}@example.com`,
      loginPassword: 'Correct-Horse9!',
      confirmLoginPassword: 'Correct-Horse9!',
      masterPassword: 'a valid master password',
      confirmMasterPassword: 'a valid master password',
      ...overrides,
    };
    await page.getByLabel('Invite code').fill(values.inviteCode);
    await page.getByLabel('Email').fill(values.email);
    // Anchored regexes, not plain strings/`exact: true` - see the comment in
    // login-negative.spec.js. Here it's worse: `exact: true` against the
    // wrong full name (label + button + hint all concatenated) matches
    // nothing at all and just times out, rather than the clearer
    // strict-mode-violation a bare substring produces.
    await page.getByLabel(/^Login password/i).fill(values.loginPassword);
    await page.getByLabel(/^Confirm login password/i).fill(values.confirmLoginPassword);
    await page.getByLabel(/^Master Password/i).fill(values.masterPassword);
    await page.getByLabel(/^Confirm Master Password/i).fill(values.confirmMasterPassword);
  }

  test('wrong invite code is rejected by the PreSignUp trigger', async ({ page }) => {
    await fillValidBaseline(page, { inviteCode: 'definitely-the-wrong-code' });
    await page.getByRole('button', { name: 'Create account' }).click();

    const error = page.getByRole('alert');
    await expect(error).toBeVisible({ timeout: 15000 });
    await expect(error).toContainText('invite code is not valid');

    await expectNoCspViolations(page);
  });

  test('mismatched login passwords are caught client-side', async ({ page }) => {
    await fillValidBaseline(page, { confirmLoginPassword: 'Something-Else9!' });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('Login passwords do not match');
  });

  test('a login password failing the strength pattern is caught client-side', async ({ page }) => {
    await fillValidBaseline(page, { loginPassword: 'alllowercase', confirmLoginPassword: 'alllowercase' });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('12+ characters');
  });

  test('mismatched Master Passwords are caught client-side', async ({ page }) => {
    await fillValidBaseline(page, { confirmMasterPassword: 'a different master password' });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('Master Passwords do not match');
  });

  test('a too-short Master Password is caught client-side', async ({ page }) => {
    await fillValidBaseline(page, { masterPassword: 'abc', confirmMasterPassword: 'abc' });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('at least');
  });

  test('Master Password equal to login password is rejected', async ({ page }) => {
    const same = 'Shared-Value9!';
    await fillValidBaseline(page, {
      loginPassword: same,
      confirmLoginPassword: same,
      masterPassword: same,
      confirmMasterPassword: same,
    });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('different Master Password');
  });

  test('none of the client-side validation failures produce a CSP violation', async ({ page }) => {
    await fillValidBaseline(page, { confirmMasterPassword: 'mismatch' });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expectNoCspViolations(page);
  });
});
