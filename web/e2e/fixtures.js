import { test as base, expect } from '@playwright/test';

/**
 * Shared fixture for every E2E spec - wraps Playwright's built-in `page`
 * fixture to also collect CSP violations and console errors on every test,
 * with no per-test boilerplate.
 *
 * CSP violation capture uses the `securitypolicyviolation` DOM event, not
 * console-message scraping. That event fires for BOTH enforcing and
 * Report-Only policies (`event.disposition` distinguishes them) - the
 * authoritative signal, and exactly what the "flip to enforcing" decision
 * in docs/todo.md needs: a report-only violation here is a violation that
 * would have been a real block once the header is renamed.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    // Registered via addInitScript so it's present before any app script on
    // the page runs, not just after this call returns.
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push({
          directive: e.violatedDirective,
          blockedURI: e.blockedURI,
          disposition: e.disposition, // 'report' under Report-Only, 'enforce' once flipped
        });
      });
    });

    page.consoleErrors = consoleErrors;
    /** @returns {Promise<Array<{directive: string, blockedURI: string, disposition: string}>>} */
    page.getCspViolations = () => page.evaluate(() => window.__cspViolations || []);

    await use(page);
  },
});

export { expect };

/**
 * Asserts zero CSP violations were recorded on `page` so far (report-only
 * or otherwise) - the standard assertion nearly every spec in this suite
 * should end with, since "the app functions with a clean CSP" is the whole
 * point of this test suite existing (see docs/todo.md).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function expectNoCspViolations(page) {
  const violations = await page.getCspViolations();
  expect(violations, `CSP violations recorded: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
}
