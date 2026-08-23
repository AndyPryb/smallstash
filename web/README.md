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

Config comes from `.env` at the **repo root** (not this folder) — the exact
same file and same four values (`AWS_REGION`/`COGNITO_USER_POOL_ID`/
`COGNITO_CLIENT_ID`/`API_BASE_URL`) `tests/api/` already uses, no
`VITE_`-prefixed duplicates needed. Copy `.env.example` there if you haven't
already, and fill in those four (see `docs/todo.md`'s "Live stack outputs",
cross-check they're still current). `vite.config.js` explicitly whitelists
just those four names into the client bundle via `define` — everything else
in `.env` (like `TEST_USER_PASSWORD`) never reaches shipped JS.

## Run

```bash
npm run dev       # http://localhost:5173, live-reloads, talks to the real deployed API
npm run build     # production build -> dist/ (static files, no server needed to host them)
npm run preview   # serve the dist/ build locally, to sanity-check the built output
npm test          # 22 tests, node's built-in test runner, no browser needed
```

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

## What's not built yet

See `docs/todo.md` → "PWA kickoff scaffold" for the current list (signup
UI, password generator, offline-unlock UI, MFA UI, hosting for the built
output, etc.).
