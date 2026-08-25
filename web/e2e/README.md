# Browser/E2E tests (Playwright)

See [docs/todo.md](../../docs/todo.md) "Browser/E2E testing with
Playwright" for the full decision record. Status and running order below.

## Status

- [x] **Harness** (2026-08-24) - config, fixtures, running against the
      live deployed CloudFront site (not `npm run dev` - the CSP is a
      CloudFront response header, Vite's dev server sends none of it).
- [x] **Pre-login negative cases** (2026-08-25) - `security-headers.spec.js`,
      `login-negative.spec.js`, `signup-negative.spec.js`. **13/13 passing
      against the live site**, verified real (not assumed): a first run
      caught real Playwright-locator bugs, not app bugs - `getByLabel`
      matches by substring against the *whole* label text including the
      `<small>` hint, and the Master Password field's own hint mentions
      "your login password", so a bare `'Login password'` string matched
      both fields. Fixed with anchored regexes (`/^Login password/i`), no
      app changes needed.
- [ ] **Registration (in progress)** - real self-service signup through
      the browser, not `admin-create-user` (this suite is scoped to only
      interact with the app through the browser, matching how a real user
      would). Needs the human in the loop for the emailed confirmation
      code - a spec can fill the signup form and submit, but can't read
      the test account's inbox.
- [ ] **Logged-in cases** - MFA, offline unlock (`context.setOffline(true)`),
      the 15-minute inactivity auto-lock, change-Master-Password (also
      where the `null`-in-error-message bug reported 2026-08-25 lives -
      see docs/todo.md), the password generator's clipboard behaviour, and
      the 409 conflict on a stale `PUT /keys`.
- [ ] **The actual point of this whole suite**: assert zero CSP violations
      across every authenticated flow, particularly around
      `'wasm-unsafe-eval'` (hash-wasm's Argon2id) - only exercised *after*
      login, never on the bare login screen the pre-login specs cover.
      Then flip the CSP header from `Report-Only` to enforcing.
- [ ] **Password reset** - needs interaction beyond the app (an emailed
      reset code), same shape as the registration step above.

## Running

```bash
# From web/ - defaults to the current deployed CloudFront URL
npx playwright test
# Or override explicitly, e.g. after a stack recreate changes the domain:
PLAYWRIGHT_BASE_URL=https://<cloudfront-domain> npx playwright test
```

No install step needed on this machine - an existing Playwright Chromium
cache (`~/AppData/Local/ms-playwright`) is reused; `npx playwright install`
would only be needed on a fresh machine/CI runner.
