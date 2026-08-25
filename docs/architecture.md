# smallStash — Architecture (living doc)

This is the current source of truth for architecture decisions. It supersedes
[smallStash-session-summary.md](smallStash-session-summary.md) where the two
disagree (notably: storage is now a **hybrid** S3 + DynamoDB, see
[ADR-0001](decisions/0001-storage-s3-vs-dynamodb.md)). The session summary is
kept as a historical record of how we got here. `smallStash-plan.md`,
referenced in the summary as an earlier, more detailed doc, was **not found**
in this repo — if you have it, merge anything useful from it into this file.

Project framing, always keep in view: **solo/personal pet project, aimed to
possibly grow into a small multi-user thing later — not enterprise.**
Optimize for near-zero idle cost and low operational burden over
scalability headroom we don't need yet.

**Current status (2026-08-23):** **first deploy is live**, and a **PWA
client scaffold now exists** in `web/` (Svelte 5 + Vite, plain SPA — see
[ADR-0002](decisions/0002-pwa-stack.md)). `SmallstashStack` is deployed to
account `060795901917`, region `eu-west-1` — Cognito pool, DynamoDB table,
S3 bucket, Lambda, and HTTP API all exist and are verified working (JWT
enforcement confirmed against the live API, not just the code). The PWA can
sign in via Cognito SRP, derive the Master Key (Argon2id via `hash-wasm`,
cross-checked against `@noble/hashes` + an RFC 9106 vector), unwrap the
Vault Key, and decrypt/edit/re-encrypt the vault against the live API.
S3 + CloudFront hosting for the built client now exists in `infra/`
(`SmallstashStack`'s `SiteBucket`/`SiteDistribution`, OAC-fronted, SPA
error-response fallback to `index.html`) but is **not deployed yet** — see
[docs/todo.md](todo.md) "PWA hosting". See §9b for what was
checked on the infra side, [docs/todo.md](todo.md) for the live stack
outputs and the PWA's remaining follow-on work, [CLAUDE.md](../CLAUDE.md)
for the always-current one-line version.

---

## 1. System overview

```
                         ┌─────────────────────────┐
  PWA (browser/Android)  │  Cognito User Pool       │  SRP auth, JWT issuance
  - Argon2id KDF          │  (email/password signup) │
  - AES-256-GCM encrypt   └───────────┬──────────────┘
  - IndexedDB cache             JWT (id/access token)
        │                             │
        ▼                             ▼
 ┌──────────────────────────────────────────────────┐
 │  API Gateway (HTTP API) — Cognito JWT authorizer  │
 └───────────────────────┬────────────────────────────┘
                          │ invoke (already-authenticated)
                          ▼
                 ┌──────────────────┐
                 │  Lambda (Java /  │
                 │  Micronaut)      │
                 └────┬────────┬────┘
                      │        │
          GetItem/PutItem      GetObject/PutObject
                      │        │
                      ▼        ▼
            ┌──────────────┐  ┌────────────────────┐
            │  DynamoDB    │  │  S3 (versioned)     │
            │  smallstash- │  │  smallstash-vaults  │
            │  users       │  │  vault.json.enc     │
            └──────────────┘  └────────────────────┘
```

The backend at every layer only ever handles ciphertext or non-secret
metadata (timestamps, KDF parameters, counters). Nothing server-side can
decrypt a vault — see §3 for the crypto model, unchanged from the session
summary.

## 2. Compute & API layer

- **Lambda**, Java + Micronaut, built with Maven. Usage pattern (~once every
  couple of days) means Lambda is effectively free and idle cost is zero,
  vs. EC2's fixed monthly charge for something mostly idle.
- **Cold start:** explicitly not using SnapStart or GraalVM native-image for
  now — a few-second cold start is acceptable given infrequent use. Revisit
  SnapStart later if it becomes annoying; note the caveats if we do (§6).
- **API Gateway: HTTP API** (not REST API) — **confirmed**. Reasons:
  - Native Cognito JWT authorizer — invalid/expired tokens are rejected
    before Lambda even runs, so `micronaut-security-jwt` in the function
    becomes optional defense-in-depth rather than a hard requirement.
  - Materially cheaper past the free tier: **$1.00/million requests** vs.
    REST API's $3.50/million. At this project's request volume the
    absolute cost difference is pennies, but HTTP API is also simpler to
    configure, so there's no real tradeoff to accept in exchange.
  - REST API's extra features (usage plans, request validation models,
    WAF integration, API keys) don't map to a need we have — those are
    enterprise-shaped features.

## 3. Encryption model (client-side only, zero-knowledge)

Unchanged from the session summary — reproduced here as the anchor fact
everything else in this doc has to respect:

1. Master password → **Argon2id** (memory-hard KDF) → Master Key.
2. Random **AES-256** Vault Key generated; encrypts actual vault contents.
3. Vault Key wrapped (encrypted) by Master Key for storage.
4. Separate random **Recovery Key** generated at signup, also wraps a copy
   of the Vault Key — lets the user recover access without the backend
   ever holding readable data.
5. Backend only ever stores/returns ciphertext and non-secret metadata.

**Implication for every storage decision below:** the backend cannot
inspect, index, search, or validate vault field contents no matter which
AWS service holds the bytes. See [ADR-0001](decisions/0001-storage-s3-vs-dynamodb.md)
for why this rules out "DynamoDB for flexible custom fields" as a
motivation — custom fields are a client-side JSON concern only.

## 4. Storage — hybrid S3 + DynamoDB

Full reasoning in [ADR-0001](decisions/0001-storage-s3-vs-dynamodb.md).
Summary:

### 4a. DynamoDB — `smallstash-users` table (on-demand billing)

| PK | SK | Attributes | Purpose |
|---|---|---|---|
| `USER#<cognito-sub>` | `PROFILE` | `createdAt`, `plan`, `storageBytesUsed` | app-level user metadata, not in Cognito attributes |
| `USER#<cognito-sub>` | `KEYS` | `kdfSalt`, `kdfMemoryKib`, `kdfIterations`, `kdfParallelism`, `wrappedVaultKeyByMaster`, `wrappedVaultKeyByRecovery`, `keyVersion` | read once per login, before/alongside the vault blob fetch |

Attribute names above are the real ones (`UserKeysItem`/`UserProfileItem`);
KDF params are three flat fields, not a nested `kdfParams` map. Of the
`PROFILE` fields, only `createdAt` is meaningful today — `plan` is
hardcoded `"free"` and `storageBytesUsed` is written as `0` and never
updated (see [todo.md](todo.md), "Profile feature").

Single-table design (PK/SK convention) leaves room to add
`SK = ENTRY#<id>` items later for per-entry sync without a new table or
migration of existing data.

**This item is the most safety-critical row in the system**, and its risk
profile is *asymmetric* with the vault blob below. The S3 blob is
versioned, so a bad write is recoverable; the `KEYS` item is a single
copy. Overwrite it with material derived from a different Master Password
and every S3 vault version — current and historical — becomes permanently
undecryptable ciphertext. Two controls exist because of this:

- **Point-in-time recovery** is enabled on the table (35 days, continuous).
  It is the only thing that can undo a destructive write here.
- **`PUT /keys` is a conditional write**
  (`attribute_not_exists(pk) OR keyVersion < :new`), so a stale or replayed
  request can't clobber newer key material — it gets HTTP 409 instead.
  `keyVersion` is unix-*seconds* minted client-side, and the client steps it
  past the stored value rather than trusting its own clock (a device whose
  clock lagged the last writer would otherwise be permanently unable to
  change its Master Password).

### 4b. S3 — vault bucket (versioning on)

```
s3://<cdk-generated-bucket-name>/users/{cognito-sub}/vault.json.enc
```

The bucket name is **CDK-generated, not `smallstash-vaults`** — S3 names
are globally unique across all of AWS, so the stack lets CDK pick one and
passes it to the Lambda via the `SMALLSTASH_VAULT_BUCKET` env var. The
current live value is in [todo.md](todo.md)'s "Live stack outputs"; it
changes on every full stack recreate.

One whole-vault encrypted blob per user, replacing the previous plan's
*two* S3 objects (the `keys.json` piece has moved to DynamoDB, §4a).
Versioning stays on for free rollback if a corrupt/malicious write ever
lands.

Two bounds on that versioning, both deliberate:

- **Lifecycle rule**: `NoncurrentVersionExpiration` at 90 days with
  `NewerNoncurrentVersions: 3`; incomplete multipart uploads abort after 7
  days. Without this, versioning grows storage without bound — every save
  keeps the previous blob forever.
- **512 KiB ceiling** per `PUT /vault` (`VaultController.MAX_CIPHERTEXT_BYTES`,
  with `micronaut.server.max-request-size=1MB` behind it). A realistic vault
  is single-digit KB, so this is ~100x headroom.

⚠️ **Read the lifecycle rule's semantics carefully — they are `AND`, not
`OR`.** S3 deletes a noncurrent version only when it is *both* older than
`NoncurrentDays` **and** has at least `NewerNoncurrentVersions` newer
noncurrent versions behind it. So this rule does **not** cap the version
*count* at 4. Inside any 90-day window, versions accumulate with no count
limit; the rule bounds long-term accumulation from normal use, not a burst.

What actually bounds a burst is the layered set, not this rule alone:
invite-gated signup (an attacker needs an account at all), the stage
throttle (10 rps), `reservedConcurrentExecutions(5)`, and the 512 KiB
per-write cap. Tightening the retention window is cheap if that ever feels
too loose — see [todo.md](todo.md).

Version rollback is an **operator-only** path: `GET /vault` never passes a
`versionId`, so the API always returns the current version and no client can
request an older one. Recovering one means reaching for
`aws s3api list-object-versions` by hand. This costs nothing in
confidentiality — every version is ciphertext either way.

**Why not move the vault blob into DynamoDB too:** a 400 KB per-item limit
would eventually force multi-item vaults as entry count grows, plus more
query/merge/IAM logic — real complexity with no concrete driver yet at
solo-user v1 scale. Revisit only if multi-device conflict resolution
becomes an observed problem.

### 4c. Login/read flow

1. Client authenticates via Cognito SRP → JWT.
2. Lambda: `DynamoDB GetItem(PK=USER#<sub>, SK=KEYS)` → salts/KDF
   params/wrapped keys (~5-10 ms).
3. Lambda: `S3 GetObject(users/{sub}/vault.json.enc)` → ciphertext blob.
4. Client derives Master Key locally (Argon2id, never leaves browser),
   unwraps Vault Key, decrypts vault in-browser.

## 5. Auth & multi-user

- **AWS Cognito User Pool**, self-service sign-up (email + password),
  **SRP flow** so the login password never crosses the wire even
  encrypted. Designed in from day 1 even though only one user exists
  today — retrofitting multi-tenancy later would mean re-keying all
  existing S3/DynamoDB data by a newly-invented user ID, which is exactly
  the kind of rework this decision avoids.
- **Sign-up is invite-gated.** Self-signup is still *enabled* on the pool,
  but a **PreSignUp Lambda trigger** rejects any registration that doesn't
  present the current invite code (passed as Cognito `validationData`, not
  a user attribute — nothing about it persists on the account). This
  closes the original hole: the pool id and client id are published in the
  PWA's `config.json` **by design** (they're identifiers, not credentials,
  and are embedded in the JS bundle regardless), so before the gate,
  anyone who found the CloudFront URL could register and consume AWS
  resources on this account. Hiding those IDs was never the fix — gating
  registration was.
  The code lives in `SMALLSTASH_INVITE_CODE` in the gitignored repo-root
  `.env`, read at synth time by `SmallstashStack.resolveInviteCode()`.
  **The synth hard-fails if it's unset** rather than falling back to a
  default that could ship by accident. `PreSignUp_AdminCreateUser` is let
  through untouched, so `admin-create-user` still works as a manual
  fallback — it already requires IAM credentials.
- **Cognito Free tier:** ~10,000 MAU forever (Essentials tier) — a
  personal-to-small-startup user base costs $0 on the auth side
  indefinitely.
- **Authorization model:** the Lambda execution role has broad read/write
  access to the S3 bucket and DynamoDB table (a single shared role — this
  is *not* per-caller scoped via Cognito Identity Pool + STS, which would
  be the "enterprise" approach). Instead, **the application code enforces
  authorization on every request** via `CurrentUser.subOf(authentication)`.

  Worth being precise about *how*, because it's stronger than a
  "compare and reject" check and an earlier version of this doc described
  it wrongly: there is **no comparison, because there is nothing to
  compare against**. Neither route takes a user identifier — `/vault` and
  `/keys` have no path or query parameter naming an owner. The S3 key
  (`users/{sub}/vault.json.enc`) and the DynamoDB partition key
  (`USER#{sub}`) are *derived entirely* from the verified JWT's `sub`
  claim, which is server-asserted and not client-controllable. A user
  cannot express a request for someone else's data in the first place, so
  there is no IDOR surface and no authorization branch that could be
  gotten wrong. Any future endpoint that *does* accept an identifier from
  the client would break this property and needs an explicit check.

  Two independent layers verify the token before that point: API
  Gateway's native Cognito JWT authorizer (so a bad token never reaches
  the Lambda) and `micronaut-security-jwt` in-Lambda. The second layer
  used to check only the *signature*, meaning it would accept any token
  the pool had ever signed; it now also validates `iss` and `aud`
  (`claims-validators.issuer`/`.audience`, fed from the stack's own
  `COGNITO_ISSUER`/`COGNITO_CLIENT_ID` env vars).
  Requiring an audience does more than it looks like: Cognito **access**
  tokens carry no `aud` claim (they use `client_id`), and Micronaut's
  `AudienceJwtClaimsValidator` rejects a token whose audience list is
  empty. So this implicitly enforces "must be an ID token issued to this
  client" — which is what the PWA sends (`session.js` uses `idToken`) —
  and covers the `token_use` concern without needing a custom validator.

  This is simpler to build and reason about at this project's scale;
  Identity-Pool-scoped IAM is worth adding only if this ever needs to
  satisfy a stricter multi-tenant compliance bar.
- **Cognito login password vs. vault Master Password — recommended:
  two fully independent secrets** (not the same secret derived two ways).
  Rationale: keeps blast radius separate — if the Cognito login path is
  ever phished, logged, or its password reset abused, it reveals nothing
  about the vault's Master Key. It also keeps "forgot my Cognito
  password" (a standard Cognito-managed email reset flow) completely
  decoupled from vault recovery, which must stay the deliberate,
  user-driven Recovery Key flow — conflating the two would either weaken
  vault security or complicate the reset UX. **Confirmed.** See
  [learning-notes/srp-authentication.md](learning-notes/srp-authentication.md)
  (gitignored, personal) for how the login side actually works mechanically.
- **App client: SRP-only**, no `ALLOW_USER_PASSWORD_AUTH` fallback — even
  for testing. Manual API testing against a real deployment goes through
  Cognito's **Hosted UI** (OAuth2 authorization-code grant), which does
  SRP internally, so this doesn't compromise testability (guide owed, see
  [todo.md](todo.md)).
- **Optional TOTP MFA** on the Cognito login step — cheap, adds a layer
  independent of the vault's own crypto. Not required, user's choice at
  signup.
  Making it **required is blocked, not merely pending** — worth knowing
  before anyone flips `Mfa.REQUIRED` thinking it's a one-liner.
  `MfaCodeForm.svelte` only *responds* to a challenge for an
  already-enrolled device; there is no enrolment flow in `web/` at all (no
  `associateSoftwareToken`/`verifySoftwareToken`/`setUserMfaPreference`).
  With TOTP as the only second factor, Cognito answers an un-enrolled
  user's first sign-in with an `MFA_SETUP` challenge that `signIn` has no
  callback for — so the flip would lock out every user, including the
  operator. [todo.md](todo.md) has the enrolment steps needed to unblock it.
- **Threat protection is on** (Cognito **Plus** tier,
  `standardThreatProtectionMode: FULL_FUNCTION`): compromised-credential
  detection checks the *login* password against known-breach corpora, and
  adaptive auth scores IP reputation and device signals, blocking or
  forcing step-up on high risk. This is what covers password spraying,
  which Cognito's own per-user lockout does not. `FULL_FUNCTION` acts
  rather than just logging; `AUDIT` is the log-only fallback if it ever
  proves too aggressive.
- **`preventUserExistenceErrors` is enabled**, so an unauthenticated
  `InitiateAuth` for an unknown address no longer returns
  `UserNotFoundException`. Before this it did — confirmed live — letting
  anyone test whether a given email had an account here.
- **Refresh tokens last 7 days**, not Cognito's 30-day default; that window
  is how long a stolen refresh token stays usable, and any use inside it
  slides it forward.
- **Brute-force protection is Cognito's, and it is not configurable.**
  After 5 failed password attempts Cognito locks the user for `2^(n-5)`
  seconds, escalating to a ~15 minute cap, resetting on a successful
  sign-in or 15 minutes of inactivity; the same escalation applies to
  failed MFA codes. Worth knowing what this does *not* cover: it's
  per-user, not per-IP, so it blunts credential stuffing against one
  account but not one password sprayed across many. Also note **AWS WAF
  cannot be attached to an API Gateway HTTP API (v2) at all** — only REST
  APIs, ALB, CloudFront, AppSync, and Cognito user pools — and WAF's
  account-takeover (`ATP`) and account-creation-fraud (`ACFP`) managed
  rule groups are explicitly *forbidden* on Cognito user pools, so the
  purpose-built anti-credential-stuffing rulesets aren't reachable here
  either. See [todo.md](todo.md)'s "Brute-force / IP-blocking research"
  for why fail2ban/CrowdSec-style tooling doesn't fit a serverless stack.
- **Master Key session caching (PWA, v1): in-memory only, never
  persisted.** The two-independent-secrets design means the Master
  Password is re-typed every session by default (nothing to reuse is
  ever stored) - real friction, re-litigated 2026-08-23 and deliberately
  kept rather than merging the two secrets Bitwarden-style (same
  password, two derivation paths). The friction fix instead: keep the
  derived Master Key in a plain JS variable for the life of an active
  session (cleared on tab close/inactivity timeout - **both implemented**,
  see `web/src/lib/session.js`'s `resetInactivityTimer`/`onAutoLock`, a
  15-minute default), never written to
  localStorage/IndexedDB/anything persistent - storing it there would
  turn a time-boxed-by-session secret into a standing one, undermining
  a chunk of what "never stored" was buying. A hardware-backed version
  that survives a full browser restart (WebAuthn platform authenticator
  + PRF/largeBlob extension) is a real, legitimate pattern other password
  managers use - deferred as v2, given inconsistent cross-browser support
  and meaningfully more engineering than this is worth before the PWA
  even exists.

### 5a. Browser-side hardening — the CSP, and why it matters most here

The zero-knowledge design deliberately puts the crown jewels in the
browser: Argon2id runs client-side, so the Master Password and derived
Vault Key are necessarily in page memory while a session is unlocked.
That's correct and unavoidable — there is no version of this architecture
where they aren't. The consequence is that **the browser is the one place
where a single vulnerability defeats everything else**. A script executing
in this origin doesn't need to break AES or Argon2id; it reads the key
straight out of memory, and every backend control becomes irrelevant.

That's why the in-memory residency is bounded (15-minute inactivity
auto-lock, `session.js`) and why a **CSP** is the highest-value remaining
control. It doesn't make XSS impossible; it makes the two usual delivery
paths — injected inline `<script>`, attacker-hosted JS — fail closed even
if some other bug lets untrusted input reach the DOM.

The policy is strict (no `'unsafe-inline'` anywhere, `object-src`/`base-uri`
`'none'`, `frame-ancestors 'none'`), which was verified as achievable
against the real build output rather than assumed: Vite emits no inline
script or style, there are no inline `style=""` attributes, and there are
no Svelte transitions — the usual reason a Svelte app needs
`'unsafe-inline'` in `style-src`.

Two things to know before touching it:

- **`'wasm-unsafe-eval'` in `script-src` is required**, because `hash-wasm`
  runs Argon2id as WebAssembly. Remove it and unlock fails in a way that
  looks like "wrong Master Password" rather than like a CSP problem.
- **It is `Report-Only` today**, i.e. documentation rather than protection,
  and there is no reporting endpoint — violations surface only in the
  devtools console. Flipping it to enforcing is tracked in
  [todo.md](todo.md).

Related, and equally part of "the browser is the crown jewel": the vault
entry `url` field is sanitised (`lib/url.js`) so a saved `javascript:` URL
can't execute on click, `{@html}` is used nowhere, and no key material is
ever written to `localStorage`/`sessionStorage`. Dependency updates are
automated (`.github/dependabot.yml`) because a compromised transitive npm
package is a more realistic path to that in-memory key than a novel XSS in
first-party code.

## 6. Cost model (why this stays cheap)

All figures assume the stated usage pattern: a handful of users, each
using the app roughly every couple of days, vault sizes in the KB-to-low-MB
range.

| Service | Pricing shape | Expected cost here |
|---|---|---|
| Lambda | 1M requests + 400,000 GB-s compute **free forever** | $0 |
| API Gateway (HTTP API) | $1.00/million requests after free tier | ~$0 |
| Cognito | ~10,000 MAU free (Essentials) forever | $0 |
| S3 | $0.023/GB-month storage; 5 GB free for 12 months (new accounts) | ~$0 (few KB-MB/user) |
| DynamoDB (on-demand) | $1.25/million WRU, $0.25/million RRU, $0.25/GB-month | ~$0 (dozens of requests/month) |

**Cost-abuse controls (the reason this stays ~$0 even under attack).** The
free-tier figures above describe *expected* usage; they say nothing about a
hostile one. Four bounds exist specifically so a bad actor can't turn this
account into someone else's compute budget:

| Control | Where | What it bounds |
|---|---|---|
| Invite-gated signup | PreSignUp Lambda trigger | who can get an account at all — the root cause |
| 512 KiB per `PUT /vault` + S3 lifecycle rule | `VaultController`, `SmallstashStack` | storage growth per user (~2 MB worst case) |
| `reservedConcurrentExecutions(5)` | Lambda | GB-seconds under a flood — throttling caps requests/sec, concurrency caps how many run *at once* |
| Stage throttle (10 rps / 20 burst) | HTTP API stage | request rate |

Note the account's two AWS Budgets ($15 monthly, $1 zero-spend) are
**notification-only and evaluate roughly 3x/day** — they are a smoke alarm,
not a circuit breaker. A **CloudWatch alarm** now covers fast detection
(Lambda invocations, Sum > 200/hour → SNS email, so minutes rather than
hours). The remaining gap is automatic *containment*: a Budgets Action
applying a Deny policy to the Lambda's **execution role** — not
`smallstash-deployer`, which is never in the live request path — is
designed but not built, see [todo.md](todo.md).

**Cognito tier:** the $0 line above no longer holds exactly. The pool is on
the **Plus** tier for Threat Protection, which is **$0.02/MAU with no free
tier** — roughly **$0.40/month at 20 users**. Deliberate and approved; it's
the one line item in this stack that is not literally zero.

**Why on-demand DynamoDB, not provisioned:** provisioned capacity has an
"Always Free" 25 WCU/25 RCU/25 GB tier that's tempting, but it requires
capacity planning for a workload that's inherently spiky and near-zero —
not worth the operational overhead here. On-demand has no per-request
minimum and rounds to effectively $0 at this traffic level, with zero
capacity management.

Net: the hybrid architecture doesn't meaningfully change the cost
picture versus S3-only — both land at "effectively free" for a personal
project — but it does improve login latency and sets up cleaner
multi-user metadata handling for later.

## 7. Infra-as-code — AWS CDK, Java (confirmed, built)

Reasoning: the backend is already Java/Maven, so CDK-in-Java keeps one
language across app and infra code — no context-switch to HCL (Terraform)
or YAML (SAM) for a solo maintainer. CDK also has first-class constructs
for exactly this stack (Lambda, HTTP API + Cognito authorizer, DynamoDB
table, S3 bucket with versioning).

Lives in `infra/` — a standalone Maven project (not a `<module>` of the
root `pom.xml`), since it's unrelated to the backend at build time; it
only references the backend's build **output** (`../target/smallstash-0.1.jar`),
never its source. Deploy account is dynamic (whichever credentials are
active); **region is pinned explicitly to `eu-west-1`** in `SmallstashApp`
(broadest EU service coverage, cheapest EU region — chosen over
`eu-central-1`/others, see chat history for the comparison; not yet
written up as a standalone doc).

Deploys run as a dedicated IAM user, `smallstash-deployer`
(`infra/scripts/create-deployer-user.sh`, run once from CloudShell as
root) — `PowerUserAccess` plus a custom policy scoping IAM role/policy
management to `smallstash-*`/`cdk-*` resource names, not root and not a
personal admin account. See [todo.md](todo.md) for the honest caveat on
how far that scoping actually goes.

## 8. Phased roadmap

**v1 (this doc's scope):**
- Cognito user pool (self sign-up, SRP), single-tenant-in-practice but
  multi-tenant-by-design.
- HTTP API + JWT authorizer → Lambda (Micronaut).
- DynamoDB `smallstash-users` table for profile + key metadata.
- S3 `smallstash-vaults` bucket for the whole-vault encrypted blob.
- PWA client: KeePass-inspired fields (Title/Username/Password/URL/
  Notes/Tags), client-side Argon2id + AES-256-GCM, IndexedDB cache of
  ciphertext **and** wrapped key material (both, per
  [ADR-0002](decisions/0002-pwa-stack.md) decision 4 — cache of
  ciphertext-only was the original plan, revised once "offline unlock
  needs the KEYS item too" was worked through). Scaffolded 2026-08-23 in
  `web/` — login + minimal vault CRUD working against the live API;
  signup UI, password generator, and offline-unlock UI still open, see
  [docs/todo.md](todo.md).
- Recovery Key generated at signup — **format decided for v1**: Crockford
  Base32 grouped code (`web/src/lib/crypto/recovery.js`), not BIP39; see
  [open-questions.md](open-questions.md) #5 for why and the freeze caveat
  once real vaults exist.

**v2+ (deferred, not designed yet):**
- TOTP field support.
- Optional password generator if not already pulled into v1 (open
  question #4 — low-risk, likely fine to include from the start).
- Per-entry DynamoDB storage + conflict resolution, if multi-device
  simultaneous edits prove to be a real problem.
- SnapStart, if cold starts become annoying in practice. Caveats to
  respect if/when this happens: don't generate salts/nonces/IVs during
  Lambda init (a resumed snapshot reuses frozen state across
  invocations — regenerate per-request instead); SnapStart only works on
  published Lambda versions, not `$LATEST`, so CI/CD needs a
  publish-version step.
- File attachments on vault entries — would push toward S3 for the
  attachment bytes regardless of what happens to per-entry metadata,
  since DynamoDB's 400 KB item limit doesn't fit arbitrary files.

## 9. Implementation status

Backend v1 storage + auth-scaffolding slice is built (this session):

- **Handler:** switched from the generated single-`MicronautRequestHandler`
  style to the api-proxy style — `micronaut-function-aws-api-proxy` routes
  API Gateway events to normal `@Controller` classes. Deployment handler
  string is the built-in `io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction`
  (HTTP API, payload format 2.0) — there's no custom handler class in the
  repo anymore, that class *is* the entry point.
- **`vault` package:** `VaultController` (`GET`/`PUT /vault`),
  `VaultRepository`/`S3VaultRepository`, `VaultBlob`/`VaultUploadRequest`
  DTOs, `VaultNotFoundException` → HTTP 404.
- **`keys` package:** `KeysController` (`GET`/`PUT /keys`),
  `UserKeysRepository`/`DynamoDbUserKeysRepository` (single-table design
  per ADR-0001: `UserKeysItem`/`UserProfileItem` beans, both mapped onto
  the same `smallstash-users` table via two `DynamoDbTable` handles),
  `UserKeys`/`UserProfile` DTOs, `UserKeysNotFoundException` → HTTP 404.
- **`security` package:** `CurrentUser.subOf(Authentication)` — one place
  that turns a verified JWT into the `sub` used as DynamoDB PK / S3 key
  prefix. Both controllers are `@Secured(IS_AUTHENTICATED)`.
- **`error` package:** shared `ResourceNotFoundException` → 404 mapping.
- **`config` package:** `StorageProperties` (bucket/table names from
  config), `AwsClientConfig` (the one manual bean — wraps the
  auto-configured `DynamoDbClient` in a `DynamoDbEnhancedClient`; S3Client
  and DynamoDbClient themselves come from `micronaut-aws-sdk-v2`'s
  classpath-driven auto-beans, no factory needed for those).
- **Tests:** `S3VaultRepositoryTest` / `DynamoDbUserKeysRepositoryTest`
  integration-test the repositories against real LocalStack S3/DynamoDB
  (via `micronaut-test-resources-localstack-s3`/`-dynamodb`), creating the
  bucket/table in `@BeforeEach` since test-resources only provisions the
  container, not app-specific resources. **`mvn test` needs Docker
  running** — this sandbox has no Docker, so these were verified by
  `mvn test-compile` (clean compile, all API usage type-checks) but not
  actually executed end-to-end. Run `mvn test` locally with Docker
  Desktop up before trusting them fully.
- **Security hardening (2026-08-24, Phase 0+1 of the security review — in
  the repo, NOT yet deployed):** `VaultController` enforces a 512 KiB
  ciphertext ceiling and maps malformed Base64 to 400 / oversized to 413
  (both previously an unhandled 500); `DynamoDbUserKeysRepository.saveKeys`
  is a conditional write with `KeyVersionConflictException` → 409. See
  §4a/§4b above and [todo.md](todo.md) for the full finding list.
- **The PWA client exists** (`web/`, see §9c and
  [ADR-0002](decisions/0002-pwa-stack.md)) — this section's original "no
  client to call these APIs from yet" is long stale. Signup uses the real
  self-service `SignUp` + `ConfirmSignUp` flow, now carrying an invite
  code in `validationData` (§5).
- **The manual test user is gone** — it lived in a pool that has since been
  destroyed and recreated. `.env`'s `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`
  are deliberately blank; recreate one only if `tests/api/` is needed again
  (see [todo.md](todo.md), "Manual test user"). `admin-create-user`
  bypasses email verification, which is fine for a one-off test account and
  wrong for real users.
- **Known gap:** `cognito.js`'s `signIn` *rejects* on Cognito's
  `NEW_PASSWORD_REQUIRED` challenge instead of driving a set-new-password
  step, so an `admin-create-user` account cannot complete first login
  through the PWA today. Doesn't affect the invite-code flow; it does mean
  the "admin-create as manual fallback" path isn't usable end-to-end.
- **Not built yet:** whether the `keys` write at signup should move to a
  Cognito post-confirmation trigger rather than an explicit client call.

### 9b. Infra (`infra/` — CDK, Java) — deployed 2026-08-23; unreleased changes pending

Deployed and live, but **the repo is ahead of the deployed stack**: the
Phase 0+1 security work (2026-08-24) is committed and synth-verified but
has never been `cdk deploy`'d. Anything marked "pending deploy" below
exists only in code.

`SmallstashStack` (`infra/src/main/java/andriy/prybaten/infra/`) defines,
as code, every AWS resource this project needs:

- Cognito User Pool — SRP-only client, optional TOTP MFA, strong password
  policy. Self-signup is enabled but **gated by a PreSignUp Lambda trigger
  checking an invite code** (§5) — *pending deploy*. Also *pending deploy*:
  **Plus tier + threat protection**, `preventUserExistenceErrors`, and a
  7-day refresh token.
- DynamoDB `smallstash-users` table (PAY_PER_REQUEST) with **point-in-time
  recovery** — *pending deploy*.
- S3 vault bucket (versioned, CDK-generated name — not hardcoded, since S3
  names are globally unique; passed to the Lambda via env var) with a
  **noncurrent-version lifecycle rule** — *pending deploy*.
- The backend Lambda itself, `Runtime.JAVA_25`, handler
  `io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction`,
  with `MICRONAUT_SECURITY_ENABLED`, `COGNITO_JWKS_URL`,
  `MICRONAUT_ENVIRONMENTS=lambda`, and the bucket/table names all wired
  automatically from the resources the same stack creates — not a
  manually-remembered post-deploy step. Plus
  `reservedConcurrentExecutions(5)` and a 30-day-retention log group —
  *both pending deploy*. Its IAM is least-privilege as of Phase 3
  (`s3:GetObject`/`PutObject` scoped to `users/*`, `dynamodb:GetItem`/
  `PutItem`, nothing else — notably no delete of any kind) — *pending
  deploy*.
- SNS topic `smallstash-alerts` + a CloudWatch alarm on Lambda invocations
  (Sum > 200/hour) — *pending deploy*. The email subscription only exists
  if `SMALLSTASH_ALERT_EMAIL` is set, and **AWS requires clicking a
  confirmation link before it delivers anything**.
- HTTP API with a native `HttpUserPoolAuthorizer`, explicit throttling
  (rate 10/s, burst 20 — cheap insurance given real usage is a handful of
  requests every few days; AWS's much higher account-level default stays
  in place regardless), CORS, and **access logging** to a 30-day log group
  (*pending deploy*) recording source IP / time / method / route / status /
  request id — deliberately no bodies.

- CloudFront `ResponseHeadersPolicy` on the site distribution — HSTS
  (1yr + subdomains), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, and a strict CSP — *pending deploy*.
  **The CSP currently ships as `Content-Security-Policy-Report-Only`**, so
  it logs violations and blocks nothing; see §5a and [todo.md](todo.md) for
  the flip-to-enforcing checklist.

⚠️ **Two deploy-time gotchas, both of which fail confusingly if missed:**

1. **`SMALLSTASH_INVITE_CODE` must be set in the repo-root `.env`** or the
   synth aborts with an explanatory `IllegalStateException`. This is
   intentional (§5) — the alternative is shipping an ungated or
   default-coded signup endpoint. `.env` is gitignored, so a fresh clone
   has to set it.
2. **All three data resources are `RemovalPolicy.DESTROY`**, not `RETAIN`
   as earlier versions of this doc claimed. That is a *deliberate,
   temporary* choice for the pre-production destroy/recreate loop, marked
   with an inline `!! MUST FLIP TO RETAIN BEFORE THE FIRST REAL SECRET !!`
   comment in `SmallstashStack.java`. **Flipping it is the gate on storing
   real secrets** — `cdk destroy` currently deletes every vault, and the
   DynamoDB `KEYS` item has no versioning to fall back on (§4a). See
   [todo.md](todo.md)'s security review for the exact change list.

CORS currently allows `http://localhost:5173` alongside the CloudFront
origin — fine for dev, tracked for removal before this is treated as
production.

**Deployed (2026-08-23):** `cdk bootstrap` + `cdk deploy` both run
(deployer always drives `deploy` themselves — the stack touches IAM, so
`cdk deploy` shows its own native confirmation prompt). 21/21 resources,
`CREATE_COMPLETE`. `infra/cdk.json`'s app command now runs
`mvn -DskipTests package` on the backend before every synth, so the
Lambda asset can't go stale/missing without a rebuild happening first —
no more manually remembering to `mvn package` before deploying.

Post-deploy checklist from [todo.md](todo.md) fully verified against the
live stack, not just asserted from the code: `MICRONAUT_SECURITY_ENABLED`
and `COGNITO_JWKS_URL` landed correctly on the Lambda, an unauthenticated
`GET /vault` returns 401 (not a leak, not a 500), DynamoDB/S3/Cognito all
healthy. Live outputs (endpoint URL, pool ID, bucket name) are in
[todo.md](todo.md).

## 10. Dependencies (Maven, current — from `pom.xml`)

```
com.amazonaws:aws-lambda-java-events
io.micronaut.aws:micronaut-aws-apigateway
io.micronaut.aws:micronaut-aws-lambda-events-serde
io.micronaut.aws:micronaut-function-aws
io.micronaut.aws:micronaut-function-aws-api-proxy
io.micronaut.aws:micronaut-aws-sdk-v2
io.micronaut.security:micronaut-security-jwt
io.micronaut.crac:micronaut-crac
io.micronaut.serde:micronaut-serde-jackson
software.amazon.awssdk:s3
software.amazon.awssdk:dynamodb-enhanced
ch.qos.logback:logback-classic (runtime)
io.micronaut.testresources:micronaut-test-resources-localstack-s3 (test)
io.micronaut.testresources:micronaut-test-resources-localstack-dynamodb (test)
```

`micronaut-aws-sdk-v2` auto-creates the `S3Client`/`DynamoDbClient` beans
(region, credentials, endpoint-override) from `aws.services.<name>.*`
config — the same property names the LocalStack test-resources modules
populate for local dev/test, so there's no manual env-branching code.
