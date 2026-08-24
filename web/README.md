# smallStash PWA client

The zero-knowledge boundary lives here. Argon2id key derivation and
AES-256-GCM encrypt/decrypt happen **only** in `src/lib/crypto/` — nowhere
else in this app, and never on any server. See
[docs/architecture.md §3](../docs/architecture.md#3-encryption-model-client-side-only-zero-knowledge)
and [ADR-0002](../docs/decisions/0002-pwa-stack.md) for why this is a plain
Svelte SPA (no SvelteKit/SSR) and why the other stack choices landed where
they did.

## Setup

```bash
cd web
npm install
```

Config (`AWS_REGION`/`COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID`/
`API_BASE_URL`) is **fetched at runtime from `/config.json`**, not baked
into the JS bundle — see `src/lib/config.js`. This means a Cognito/API
stack recreate never requires a frontend rebuild: `infra/`'s
`SmallstashStack` regenerates `config.json` from the live stack's actual
values on every `cdk deploy` (`ConfigDeployment`, a `BucketDeployment`
using `Source.jsonData`).

For **local dev/preview only**, `vite.config.js`'s `runtimeConfigPlugin`
serves/writes the same shape from `.env` at the **repo root** (not this
folder) — the exact same file and same four values `tests/api/` already
uses. Copy `.env.example` there if you haven't already, and fill in those
four (see `docs/todo.md`'s "Live stack outputs", cross-check they're still
current). Everything else in `.env` (like `TEST_USER_PASSWORD`) never
reaches `/config.json` or shipped JS — only those four names are read.

## Run

```bash
npm run dev       # http://localhost:5173, live-reloads, talks to the real deployed API
npm run build     # production build -> dist/ (static files, no server needed to host them)
npm run preview   # serve the dist/ build locally, to sanity-check the built output
npm test          # 84 tests, node's built-in test runner, no browser needed
```

`npm test` runs with `--experimental-test-module-mocks` (see `package.json`) -
needed for `session.test.js`'s use of `node:test`'s `mock.module()`, which is
still an experimental Node API. Test-only; doesn't affect anything shipped
to the browser.

There is no local backend to run against — `web/` always talks to the
**live deployed** API (same as `tests/api/`). There's nothing to mock: the
backend only ever sees ciphertext, so hitting the real thing during dev
doesn't risk anything a mock would protect against.

## Layout

```
src/lib/crypto/   Argon2id KDF, AES-256-GCM seal/open, Recovery Key
                  encode/decode, and the vault-level create/unlock/rewrap/
                  encrypt/decrypt flow. Zero AWS SDK imports - fully
                  testable offline, and kept that way on purpose so this
                  code can never accidentally depend on being online.
src/lib/auth/     Cognito SRP login/signup only. Zero crypto imports - the
                  Cognito login password and vault Master Password are two
                  independent secrets (architecture.md §5); this file
                  layout keeps that boundary structural, not just a
                  comment.
src/lib/api/      Thin fetch wrapper for GET/PUT /vault and /keys.
src/lib/cache/    IndexedDB cache (via `idb`) of vault ciphertext + wrapped
                  key material, for offline unlock. See ADR-0002 decision 4
                  for why caching wrapped key material locally doesn't
                  weaken zero-knowledge.
src/lib/session.js  Ties the above together. The one place allowed to hold
                  the live (unwrapped) Vault Key - in a module-level
                  variable only, never persisted (architecture.md §5).
src/lib/components/  Svelte UI components.
```

## What's covered by `npm test`

- `crypto/kdf.test.js` — the most important test in this project: verifies
  `hash-wasm`'s Argon2id output against a published RFC 9106 test vector
  *and* against an independent implementation (`@noble/hashes`, dev-only
  dependency). If these ever diverge, every existing vault would become
  permanently undecryptable — this is what makes that risk provable rather
  than assumed.
- `crypto/aesgcm.test.js` — seal/open round-trip, wrong-key rejection,
  tamper detection, IV uniqueness, version-byte handling.
- `crypto/recovery.test.js` — Crockford Base32 encode/decode, I/L/O/U
  confusable-character tolerance, HKDF wrap-key derivation.
- `crypto/vault.test.js` — the full flow: create key material, unlock via
  Master Password, unlock via Recovery Key, change Master Password
  (re-wrap), encrypt/decrypt a vault document.
- `generator.test.js` — character-set/length options, a distribution smoke
  test guarding against a regression to naive modulo bias.
- `bytes.test.js` / `policy.test.js` — the small pure-function modules
  (base64/UTF-8 round-trips, `wipe()`, Master Password length policy).
- `cache/db.test.js` — the IndexedDB-backed offline cache, using
  `fake-indexeddb` (dev-only dependency) so it runs in plain Node with no
  browser: put/get round-trips, staleness detection, per-account clearing.
- `session.test.js` — the orchestration hub (Cognito auth + the API client +
  crypto + the cache all meet here) got zero coverage until now, which was
  backwards for the highest-stakes module in the app. Uses real crypto and
  the real (fake-indexeddb-backed) cache throughout; only the
  network-touching boundaries (`auth/cognito.js`, `api/client.js`,
  `config.js`) are replaced via `node:test`'s `mock.module()`. Covers the
  full sign-in/MFA/offline-unlock/signup/save/change-Master-Password flows
  (happy paths and the actual failure modes - wrong password, wrong MFA
  code, offline write rejection, no active session) plus the inactivity
  auto-lock timer (via `node:test`'s fake timers - no real 15-minute wait).
- `config.test.js` — the runtime `/config.json` fetch (see "Setup" above):
  throws if read before `loadConfig()` resolves, only fetches once, and
  rejects on a non-OK response or a response missing a required key. Mocks
  `globalThis.fetch` directly rather than a module, since that one network
  call is config.js's whole job.

**Not covered, and a real gap:** no Svelte *component* tests exist (`App.svelte`,
the forms, `EntryListItem.svelte`, etc.) - only the `lib/` logic underneath
them. The current test setup is plain `node:test` with no DOM; component
testing would need new infrastructure (e.g. Vitest + `@testing-library/svelte`
+ jsdom/happy-dom, or Playwright component testing) - a deliberate choice to
flag rather than bolt on unprompted. See `docs/todo.md`.

## What's not built yet

See `docs/todo.md` → "PWA kickoff scaffold" for the current list (signup
UI, password generator, offline-unlock UI, MFA UI, hosting for the built
output, etc.).
