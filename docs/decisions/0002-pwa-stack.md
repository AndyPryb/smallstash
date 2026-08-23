# ADR-0002: PWA client stack, key library, repo layout, and offline key cache

**Status:** Accepted and scaffolded — see `web/` for what's built.
**Date:** 2026-08-23
**Context doc:** [open-questions.md](../open-questions.md) #7–#9, [architecture.md](../architecture.md) §5/§8

## Context

No PWA client existed yet. Three open questions were blocking the kickoff
(open-questions.md #7–#9), plus one unresolved design gap
([todo.md](../todo.md) "PWA: offline access to key material").

## Decision 1: Frontend framework — Svelte 5 + Vite, plain SPA (no SvelteKit)

Chosen over React/Vue by the AI agent per the user's explicit "your
choice" — no prior fluency in any of them to defer to.

**Deliberately a static SPA, not SvelteKit (or Next.js/Nuxt, had React/Vue
been chosen instead).** SvelteKit defaults to server-side rendering: a
`+page.server.js` file is normal, idiomatic SvelteKit, and it runs on a
server. The zero-knowledge invariant (architecture.md §3) requires that
Argon2id derivation and AES-256-GCM encrypt/decrypt happen **only** in the
browser. SSR doesn't just risk violating that by accident — it introduces
the one thing needed for the violation to become possible at all: frontend
code running somewhere that isn't the user's browser. A static SPA build
(plain HTML/JS/CSS, servable from S3/CloudFront, no live rendering server)
removes that structurally rather than relying on discipline never to add a
server load function.

Side effects, not the deciding factor but real: smallest bundle/runtime
overhead of the mainstream options (helps first-load and offline-cache
size), least new-concept overhead for someone coming from Java/Micronaut
(component state is plain variables via runes, no hooks-rules class of
bugs), and Vite's dev-server default port (5173) already matches the CORS
origin `SmallstashStack` allows today — dev works against the live API
with zero infra change.

## Decision 2: WASM Argon2id library — `hash-wasm`, cross-checked by `@noble/hashes`

Freshness check performed 2026-08-23 (see chat log for full figures):

| | last commit | weekly downloads |
|---|---|---|
| `hash-wasm` 4.12.0 | 2024-11 (~21mo dormant) | 1.29M |
| `argon2-browser` 1.18.0 | 2021-11 (~4.8yr, effectively dead) | 23k |
| `@noble/hashes` 2.3.0 | 2 days before this check | 74M |

`argon2-browser` ruled out — no commit in nearly 5 years. `hash-wasm` is
dormant but not abandoned (not archived, has had multi-year gaps before and
returned, 1.29M weekly downloads means breakage is noticed fast); chosen for
the shipped app because it's WASM (materially faster than pure-JS Argon2id
at real cost parameters, which matters most on the phone this PWA targets)
and its WASM binary is inlined as base64 in the JS bundle — no second
network fetch, so it keeps working fully offline.

`@noble/hashes` (audited, actively maintained, ships `argon2.js` as of a
recent release) is added as a **devDependency only**, used exclusively in
`web/src/lib/crypto/kdf.test.js` to cross-check `hash-wasm`'s output against
both `@noble/hashes` and a published RFC 9106 §5.3 test vector. Rationale:
if Argon2id output ever silently diverged (bad release, bundler miscompiling
the WASM), every existing vault becomes permanently undecryptable — the
derived Master Key would simply be wrong. Two independent implementations
agreeing, plus agreement with a spec vector, makes that risk provable by a
test run rather than assumed. All 3 tests pass as of this ADR.

## Decision 3: Repo structure — monorepo, PWA lives in `web/`

Confirmed per the existing lean (open-questions.md #9). `web/` sits next to
`src/` (backend) and `infra/` at the repo root — own `package.json`,
independent of the root Maven build, same pattern `infra/` already
established as a sibling project in the same repo.

`web/vite.config.js` sets `envDir: '..'` so it reads the same root `.env`
`tests/api/` already uses, rather than a second copy. Vite inlines any
`VITE_`-prefixed var into the shipped client bundle, so `.env`/`.env.example`
now carry `VITE_AWS_REGION`/`VITE_COGNITO_USER_POOL_ID`/`VITE_COGNITO_CLIENT_ID`/
`VITE_API_BASE_URL` duplicating the unprefixed test values — safe, since
those four are already public (documented in `docs/todo.md`). Nothing secret
(`TEST_USER_PASSWORD`) gets a `VITE_` prefix, ever.

## Decision 4: Offline key material cache — yes, cache it in IndexedDB

Resolves the open gap in [todo.md](../todo.md) "PWA: offline access to key
material". Without this, "offline-capable" only half-worked: a cached vault
ciphertext blob is useless without the KEYS item (salt, KDF params, wrapped
Vault Key) to unlock it, and fetching that needs `GET /keys` — network plus
a valid JWT.

**What's cached, in `web/src/lib/cache/db.js` (IndexedDB, via `idb`):**
salt, KDF params, both wrapped Vault Key copies, and the vault ciphertext —
one IndexedDB record per Cognito `sub`. **What's never cached:** the derived
Master Key or the unwrapped Vault Key (stays in-memory-only per
architecture.md §5, cleared on tab close/sign-out).

**Why this doesn't weaken the zero-knowledge guarantee:** every value cached
here is either a public KDF parameter or ciphertext (a key wrapped by
another key) — exactly what the server already stores and already sends
over the wire on every login. Caching it on-device exposes nothing that the
server-side copy doesn't already expose; unwrapping it still requires the
Master Password or Recovery Key, neither of which ever touches this cache.
The one new risk is device-loss/theft of an *already-unlocked* session,
which is a general device-security concern, not something this cache
introduces.

**Staleness:** `isKeyMaterialStale()` compares cached vs. server `keyVersion`
- a Master Password change elsewhere bumps `keyVersion`, so a stale
cache is detected (and refreshed) the next time the device is online,
instead of silently unlocking against outdated wrapped keys.

## Consequences

- `web/` is a new independently-versioned `package.json` (Vite + Svelte +
  `vite-plugin-pwa`), doesn't touch the Maven build.
- `web/src/lib/` is layered: `crypto/` (KDF, AES-GCM, recovery key, all
  offline-testable, zero AWS SDK imports), `auth/` (Cognito SRP only, zero
  crypto imports — keeps the two independent secrets structurally separate,
  not just by convention), `api/` (thin fetch wrapper), `cache/` (IndexedDB),
  `session.js` (ties them together, the one place allowed to hold the live
  Vault Key).
- `npm test` in `web/` runs 22 Node-native tests (`node --test`) covering
  KDF cross-agreement, AES-GCM round-trip/tamper/reuse, Recovery Key
  encode/decode, and the full create/unlock/rewrap/encrypt/decrypt vault
  flow — all passing as of this ADR. `npm run build` produces a working
  static bundle (~56 KB gzipped JS) with a generated service worker and
  manifest.
- Login/signup UI, password generator (open question #6), and BIP39 vs.
  Crockford-Base32 recovery format (open question #5 — this ADR's
  `web/src/lib/crypto/recovery.js` ships Crockford Base32 as the v1 answer;
  see that file's header comment on why re-deciding it later requires care)
  are still open follow-on work, not blocked by this ADR.

## Alternatives considered

- **React or Vue** for the framework — no fluency-based reason to prefer
  either over Svelte here; Svelte's smaller runtime and lower
  ceremony broke the tie. Documented so a future session doesn't need to
  re-litigate without a stated reason.
- **`argon2-browser`** — rejected, effectively unmaintained (~4.8yr since
  last commit).
- **Separate repo for the PWA** — rejected per the existing monorepo lean;
  no independent-deploy-cadence need exists yet.
- **Not caching key material offline** (leave the gap as-is) — rejected;
  it would leave "offline support" advertised but non-functional beyond a
  single browser session.
