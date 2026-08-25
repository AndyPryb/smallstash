import { test, expect, expectNoCspViolations } from './fixtures.js';

/**
 * Verifies the CloudFront response-headers policy (SmallstashStack.java,
 * "Security headers + CSP" section) is actually live on the deployed site,
 * not just present in the CDK source.
 */
test.describe('CloudFront security headers', () => {
  test('HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy are present', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response.headers();

    expect(headers['strict-transport-security']).toContain('max-age=31536000');
    expect(headers['strict-transport-security'].toLowerCase()).toContain('includesubdomains');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });

  test('CSP is present as Report-Only, not yet enforcing', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response.headers();

    // Whichever of these two is present tells us the current rollout state
    // - see docs/todo.md "Flip the CSP from report-only to enforcing".
    // This assertion is deliberately strict about *which* header exists:
    // if this starts failing because the enforcing header appeared instead,
    // that's the flip having happened, not a bug - update the assertion at
    // the same time as the flip, don't just loosen it.
    expect(headers['content-security-policy-report-only']).toBeTruthy();
    expect(headers['content-security-policy']).toBeUndefined();

    const csp = headers['content-security-policy-report-only'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test('the bare login screen loads with zero CSP violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Small Stash' })).toBeVisible();
    await expectNoCspViolations(page);
  });
});
