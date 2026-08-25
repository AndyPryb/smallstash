# Browser/E2E tests (Playwright)

Harness set up 2026-08-24; specs not written yet - deliberately deferred
until the security review is deployed, see
[docs/todo.md](../../docs/todo.md) "Browser/E2E testing with Playwright"
for the full decision and priority list. Short version, in order:

1. **Validate the CSP, then flip it to enforcing.** Must run against the
   real deployed CloudFront URL (`PLAYWRIGHT_BASE_URL=https://...`), not
   `npm run dev` - Vite sends no CSP header at all, so local dev looks fine
   regardless of how broken the policy is. Assert zero console CSP
   violations across every flow, particularly `'wasm-unsafe-eval'`
   (hash-wasm's Argon2id) - which is only exercised *after* a successful
   login, never on the bare login screen.
2. **A test account** (`admin-create-user` +
   `admin-set-user-password --permanent`, stored in the repo-root `.env`'s
   `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`) so authenticated flows are
   reachable without a real inbox.
3. **Everything only ever verified by unit test + build**: MFA, offline
   unlock (`context.setOffline(true)`), the 15-minute inactivity auto-lock,
   change-Master-Password, the password generator's clipboard behaviour,
   invite-code signup (both accepted and rejected codes), and the 409
   conflict on a stale `PUT /keys`.

## Running

```bash
# From web/
npx playwright test                                  # against nothing yet - no specs exist
PLAYWRIGHT_BASE_URL=https://<cloudfront-domain> npx playwright test   # once specs exist
```

No install step needed on this machine - an existing Playwright Chromium
cache (`~/AppData/Local/ms-playwright`) is reused; `npx playwright install`
would only be needed on a fresh machine/CI runner.
