# smallStash API tests

Automated tests against the **deployed** smallStash API — no mocks, no
LocalStack. Replaces the abandoned Postman collection (see
`docs/todo.md` → "API testing approach" for why Postman didn't work:
its sandbox can't do real SRP).

Uses `amazon-cognito-identity-js` to perform real SRP authentication
against the live Cognito pool — the app client is SRP-only, so this is
the only auth path that actually works (no `admin-initiate-auth`
shortcut, no privileged AWS credentials involved). Doubles as an early
prototype of the PWA's own future auth code.

## Setup

```bash
cd tests/api
npm install
```

Config comes from `.env` at the **repo root** (not this folder) — copy
`.env.example` there if you haven't already, and fill in the pool/client/API
IDs from `docs/todo.md`'s "Live stack outputs" (cross-check they're still
current) plus `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` for the manual test
user described in `docs/todo.md`.

## Run

```bash
npm test
```

Runs with `--test-isolation=none` (single process, no child-process spawn)
— needed for compatibility in some sandboxed shells; harmless for a suite
this small either way.

## What's covered

- `unauthenticated.test.js` — no token on `GET`/`PUT` `/vault` and `/keys`
  → 401, proving the HTTP API's Cognito JWT authorizer rejects before the
  Lambda is even invoked.
- `keys.test.js` — real SRP sign-in, then `PUT /keys` → `GET /keys`
  round-trips the same wrapped-key material.
- `vault.test.js` — real SRP sign-in, then `PUT /vault` → `GET /vault`
  round-trips the same ciphertext (opaque random bytes — this suite tests
  the storage API, not real Argon2id/AES-GCM output, since the PWA client
  doesn't exist yet).

These tests write real data to the live stack under the manual test user's
`sub`. Fine for now (it's a throwaway test account, see `docs/todo.md`);
worth revisiting once real user data exists.
