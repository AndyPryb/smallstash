import { test, expect, expectNoCspViolations } from './fixtures.js';
import { testUserEmail, testUserPassword, testUserMasterPassword } from './env.js';

/**
 * The actual point of this whole E2E suite (docs/todo.md "Browser/E2E
 * testing with Playwright"): validate the CSP on an authenticated page,
 * where the one directive that matters most - 'wasm-unsafe-eval', guarding
 * hash-wasm's Argon2id - is reachable for the first time. Nothing in
 * login-negative.spec.js/signup-negative.spec.js exercises it; both stop
 * at the bare login/signup screens.
 *
 * If this spec fails on a CSP violation, the concrete symptom a user would
 * see is unlock silently failing in a way that looks exactly like "wrong
 * Master Password" - not an obvious CSP error. See architecture.md §5a.
 */
test.describe('Login - authenticated', () => {
  test('signs in, unlocks the vault, and the CSP allows Argon2id to run', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(testUserEmail());
    await page.getByLabel(/^Login password/i).fill(testUserPassword());
    await page.getByLabel(/^Master Password/i).fill(testUserMasterPassword());
    await page.getByRole('button', { name: 'Unlock vault' }).click();

    // Generous timeout: this round trip is Cognito SRP + GET /keys + GET
    // /vault + client-side Argon2id, not a single fast request.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Add entry' })).toBeVisible();

    // No stray error banner despite the successful unlock.
    await expect(page.getByRole('alert')).toHaveCount(0);

    await expectNoCspViolations(page);
  });
});
