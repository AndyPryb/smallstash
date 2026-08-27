# File storage for smallStash — analysis and plan

**Status:** proposal, nothing implemented. Written 2026-08-27, decisions
recorded 2026-08-27 (next session) after the user answered the open
questions, §3a's spike run and resolved the same day.

⚠️ **Correction, stated plainly rather than buried**: the first version of
this document claimed "no API Gateway authorizer at all" and built the §3a
Lambda-count recommendation on that. **That claim was wrong.** The stack
already has `HttpUserPoolAuthorizer` set as `HttpApi`'s `.defaultAuthorizer()`
(`SmallstashStack.java`, live and deployed) — every request is validated
against Cognito by API Gateway before any Lambda runs, with the in-Lambda
`micronaut-security-jwt` check kept deliberately as defense-in-depth on top.
§3a below is rewritten with the spike's actual finding; the old reasoning is
not preserved since it was built on a false premise.

**All ten original questions plus §3a are now decided**: two Lambdas, sharing
a new `common` Maven module. Nothing left blocking Phase 0 - the module
restructuring in §3a is the recommended first concrete step, done and
verified before any files-specific code is written.

Goal, in the requester's words: store PDFs, digital-signature files, private
keys, and occasionally photos, and be able to reach them anywhere knowing only
the Cognito credentials and the Master Password — without breaking anything
that works today.

---

## 0. Decisions, as answered

| # | Question | Decision |
|---|---|---|
| 1 | Per-file size cap | **25 MB** |
| 2 | Per-user total quota | **~500 MB** |
| 3 | Allowed file types | **Anything** |
| 4 | Attached to an entry, or standalone? | **Standalone.** Own "Files" tab in the UI, separate from "Secrets" |
| 5 | Deletion: immediate or eventual? | **Immediate** |
| 6 | Same bucket as the vault, or separate? | **Separate bucket** |
| 7 | Offline file access? | **No** — export covers the "I need it without a connection" case |
| 8 | Does plaintext export include files? | **Yes** — export gets extended to also save files, unencrypted, to the device. User's responsibility from that point on |
| 9 | Is `cdk destroy` required to build this? | **No** — confirmed below, §7 |
| 10 | Chunked/streaming encryption now or later? | **Later** — deferred, explained below |
| — | One shared Lambda, or a dedicated one for files? | **Decided: two Lambdas**, sharing a new `common` Maven module (§3a) |

Everything below explains and justifies these, and works out what they imply
for the architecture. Two decisions changed the shape of the plan
significantly from the first draft: **standalone documents** (→ files get
their own encrypted index, not a few extra fields on `vaultDocument`) and
**a separate, unversioned bucket** (→ deletion is genuinely simpler here than
in the vault, not just permitted).

---

## 1. What exists today (read from the code, not from memory)

| Piece | Current state |
|---|---|
| Vault storage | **One** ciphertext blob per user: `users/<sub>/vault.json.enc` (`S3VaultRepository`) |
| Vault size cap | `VaultController.MAX_CIPHERTEXT_BYTES` = **512 KiB**, mirrored client-side in `policy.js` |
| HTTP body cap | `micronaut.server.max-request-size=1MB` (`application.properties`) |
| Vault bucket | Versioned, `S3_MANAGED` encryption, `BLOCK_ALL` public access, `autoDeleteObjects`, `DESTROY` |
| Vault bucket lifecycle | One rule, `ExpireOldVaultVersions`: noncurrent 90 days, keep 3, abort incomplete MPU after 7 days |
| Vault bucket CORS | **None configured** — no browser can talk to S3 directly today |
| Auth | **`HttpUserPoolAuthorizer` is `HttpApi`'s `.defaultAuthorizer()`** - API Gateway validates every request against Cognito before any Lambda runs. `micronaut-security-jwt` (`COGNITO_JWKS_URL`/`ISSUER`/`CLIENT_ID`) re-checks in-Lambda too, deliberately, as defense-in-depth. `@Secured(IS_AUTHENTICATED)` + `CurrentUser` read whichever `Authentication` results either way |
| Lambda IAM | `s3:GetObject`, `s3:PutObject` on `<vault-bucket>/users/*` only; `dynamodb:GetItem`, `PutItem`. **No `s3:DeleteObject` — deliberately removed** so a compromised Lambda cannot destroy the vault's version history |
| API routes | Only `/vault` and `/keys`, each `GET` + `PUT` |
| API CORS | `GET, PUT, OPTIONS`; headers `Authorization`, `Content-Type` |
| Throttle | 10 rps / 20 burst on the stage |
| Lambda | 512 MB, 30 s timeout, no reserved concurrency (**account-wide concurrency ceiling in this region is 10**, confirmed in earlier work) |
| CSP `connect-src` | `'self'` + Cognito + `*.execute-api.<region>.amazonaws.com` — **no S3 origin** |
| Crypto envelope | `aesgcm.js` `seal`/`open`: `[version:1][iv:12][ciphertext‖tag]`, AES-256-GCM, versioned |
| Key hierarchy | Master Password →Argon2id→ Master Key →wraps→ **Vault Key** →encrypts→ vault doc. Recovery Key →HKDF→ wrap key →wraps→ same Vault Key |
| Offline cache | `cache/db.js`, two IndexedDB stores: key material, vault ciphertext |
| Quota hook | `UserProfile.storageBytesUsed` **exists in the model and is unused** |
| Save-to-disk | `saveFile.js` (built for export) — picker on desktop, `<a download>` elsewhere. **Reused as-is for file downloads and for the extended export (§0.8)** |

Two things in that table matter more than the rest, and both survive into
the decided design unchanged:

1. **`storageBytesUsed` already exists.** Quota enforcement was dropped from
   Phase 1 on the reasoning that per-user storage was bounded to ~2 MB by
   construction. Files invalidate that reasoning entirely — quota comes back,
   now against the agreed ~500 MB (§6).
2. **The API Gateway authorizer is what actually decides §3a** — not its
   absence (an earlier draft of this document had that backwards; corrected
   at the top). Because `HttpUserPoolAuthorizer` already validates every
   request before any Lambda runs, a second Lambda would inherit that
   protection automatically and need no security code of its own. See §3a
   for the full finding.

---

## 2. Why the 512 KiB cap forces files out of the vault blob

The cap is on the **whole vault**, one blob per user. A single phone photo is
2–5 MB — several times the entire budget for everything the user owns.
Raising the cap isn't a fix either: the blob is read and rewritten whole on
every save, so a large vault would re-upload megabytes on every password
change.

Files must be **separate objects**. Given the "standalone documents" decision
(§0.4), they don't even need a foothold in the vault blob — see §4.

---

## 3. Upload path: why not through the Lambda

Verified rather than assumed: **Lambda's synchronous invocation payload
limit is 6 MB**, and **API Gateway's payload limit is 10 MB**. Micronaut here
is configured to 1 MB on top of that, and JSON+Base64 inflates bytes by
~33%. Routing file bytes through the API gives an effective ceiling around
**4 MB at absolute best, ~700 KB as currently configured** — below a single
photo — while paying Lambda duration per megabyte and pushing large bodies
through a 10 rps-throttled stage.

**The browser must talk to S3 directly, via presigned URLs.** The backend's
job is minting short-lived, tightly-scoped credentials — it never carries
file bytes.

### Presigned POST over PUT — and a fact worth knowing about both

⚠️ **Superseded during Phase 1 implementation - see §10's "Phase 1" record
for the full story.** This comparison and the decision below it were sound
*given the assumption that AWS SDK v2 could generate a presigned POST at
all* - it turns out it can't (no `S3Presigner` support exists for POST
policies in this SDK). What actually shipped is presigned **PUT**, with size
enforcement moved to commit-time instead of prevented up front. Left as
written below rather than rewritten, so the reasoning that led to the
original choice - which was correct reasoning, just built on a premise that
didn't hold - stays visible rather than silently vanishing.

| | Presigned `PUT` | **Presigned `POST` (policy)** | Multipart upload |
|---|---|---|---|
| Size enforcement server-side | ❌ none | ✅ `content-length-range` in the signed policy | ✅ per part |
| Complexity in client | lowest | low (`FormData`) | high |
| Good beyond ~100 MB | no | no | yes |

**Presigned POST**, agreed: it's the only simple option where the *server*
bounds the uploaded size — the client cannot lie about how big the file is,
because S3 itself enforces the signed policy. Multipart is deferred until
there's a reason to exceed the per-file cap.

**Neither is single-use by design.** Checked against AWS's own docs: a
presigned URL/POST stays valid and reusable for its full lifetime — "used
once" is not a property AWS gives you, and building it yourself is real
work not worth doing here. The actual boundary is a **short TTL - agreed at
5 minutes**, comfortably enough for one upload of up to 25 MB even on a slow
connection; nothing here should be described as single-use even informally,
since it isn't.

### 3a. One Lambda, or two? - decided 2026-08-27: two, sharing a `common` module

The spike (below) removed the original objection to splitting - there is no
security-critical code that a second Lambda would need to duplicate. Given
that, **the user's preference stands: two Lambdas.** The remaining question
was how to structure the build so nothing is copy-pasted even where it
overlaps (the JWT defense-in-depth dependency/config), and the answer is a
shared Maven module - proposed below, not yet built.

#### The spike's finding (why splitting is safe to begin with)

Rather than trust training-data memory or AWS's docs alone, the actual
`micronaut-function-aws-api-proxy-5.1.0.jar` this project depends on was
decompiled directly (`javap -v` on the class file) - about as strong a form
of evidence as is available short of an end-to-end deploy test.

The jar contains `io.micronaut.function.aws.proxy.security.
MicronautLambdaAuthenticationFetcher`, registered `@Singleton
@Requires(classes = AuthenticationFetcher.class)` - active purely by being
on the classpath, no configuration needed. Its bytecode:

```
event.getRequestContext().getAuthorizer().getJwt().getClaims()
  -> new HashMap<>(claims)
  -> Authentication.build(claims.get("sub"), claims)
```

- exactly the shape `HttpUserPoolAuthorizer` (already `HttpApi`'s
`.defaultAuthorizer()`, live and deployed - see the correction at the top of
this document) produces on every request. `CurrentUser.subOf(Authentication)`
is `authentication.getName()` - exactly the first argument to that
`Authentication.build(...)` call. **No change needed to `CurrentUser`,
`VaultController`, or `KeysController`** for a second Lambda to authenticate
correctly, and `.defaultAuthorizer()` being set at the **API level** means it
already applies to routes added later via `addRoutes(...)` too.

#### What's actually shared between the two Lambdas, precisely

Worth being exact here rather than hand-wavy about "duplication," because
the honest answer is that very little of the *defense-in-depth* piece was
ever bespoke code to begin with:

- **The JWT-checking logic itself is entirely inside `micronaut-security-jwt`**,
  a third-party library. There is no custom validation code to duplicate -
  both Lambdas would declare the same dependency and set the same three
  properties (`COGNITO_JWKS_URL`/`ISSUER`/`CLIENT_ID`).
- **Those property *values* already come from the same CDK objects** -
  `userPool.getUserPoolProviderUrl()` / `userPoolClient.getUserPoolClientId()`
  - for the existing Lambda's environment. A second Lambda's environment
  built the same way, from the same CDK variables, cannot drift from the
  first at the value level; there is nothing hand-retyped to get out of sync.
- **What genuinely is project-specific, reusable code**: `CurrentUser` (the
  one place that turns `Authentication` into the Cognito `sub`), and
  potentially shared error-handling scaffolding
  (`ResourceNotFoundExceptionHandler`'s pattern, if the files Lambda needs an
  equivalent). *This* is what the shared module is for - not the JWT check
  itself, which was never really at risk of drifting.
- **What a shared Maven **parent POM** (distinct from a shared module)
  actually buys, and it's the more important piece**: consistent dependency
  *versions*. Two independently-maintained `pom.xml` files could drift to
  different `micronaut-security-jwt` versions over time, and JWT validation
  behaviour is exactly the kind of thing that's bad to have silently diverge
  between two Lambdas serving the same users. A shared parent's
  `<dependencyManagement>` (already partially in place - both `pom.xml` and
  `infra/pom.xml` presumably pin the same `micronaut.version` today,
  independently) makes that impossible by construction rather than by
  discipline.

#### Proposed module layout

```
/pom.xml                 NEW - aggregator, packaging=pom, <modules>: common, vault-lambda, files-lambda
                          <dependencyManagement> pins shared versions (micronaut.version, AWS SDK, etc.)
/common/                 NEW - CurrentUser, shared error-handling scaffolding, nothing AWS-resource-specific
/vault-lambda/            MOVED from today's src/main/java - unchanged behaviour, depends on common
/files-lambda/            NEW - FilesController etc., depends on common
```

**This physically relocates the current `src/main/java` tree** into
`vault-lambda/`, and changes the build output from `target/smallstash-0.1.jar`
to `vault-lambda/target/….jar` + `files-lambda/target/….jar`. Three places
reference the old single-artifact shape and need updating together, not
independently:

1. `infra/cdk.json`'s app command (`mvnw -f ..\pom.xml -q -DskipTests
   package`) - **stays a single command** if the root becomes an aggregator,
   since `mvn package` at an aggregator root builds every module in one
   invocation. Nothing about the *invocation* changes, only what it produces.
2. `SmallstashStack.java`'s `Function` construct(s) - the code asset path
   changes from one jar to two, one per `Function`.
3. `CLAUDE.md`'s dev cheat-sheet, which currently states
   `mvn -DskipTests package` "produces `target/smallstash-0.1.jar`" - this
   line becomes wrong the moment the restructuring lands and must be updated
   in the same change, not left stale.

**Recommendation: do this restructuring as its own first step, verified with
a synth (and a full `mvn package` + `npm test`-equivalent local build) that
proves the *existing* vault/keys Lambda is byte-for-byte unchanged in
behaviour before any files-specific code is written.** A refactor with no
behaviour change, checked before new functionality goes on top of it - the
same incremental, verify-before-building-on-it pattern the security review
phases used. Real work, but mechanical and low-risk if sequenced this way;
risky only if files-specific code and the restructuring land in the same
change and something breaks with two things to suspect at once.

#### A genuine security upside of splitting, beyond isolation-in-the-abstract

Worth stating plainly since it strengthens the case for two Lambdas rather
than just conceding the preference: **each Lambda gets its own IAM
execution role** in CDK by default. Split, the files Lambda's role needs
`s3:GetObject`/`PutObject`/`PutObjectTagging`/`DeleteObject` on the **files**
bucket only - it would have **zero** permissions to the vault bucket or the
DynamoDB `smallstash-users` table, full stop, not just "scoped narrowly
within a shared role." A single shared Lambda's one role would necessarily
be the *union* of both permission sets. This is real least-privilege
improvement, not just organisational tidiness - a bug or compromise in
files-serving code literally cannot read or write vault data, at the IAM
layer, regardless of anything the application code does or fails to do.

## 4. Data model: a standalone files index, not vault fields

Because files are standalone (§0.4) rather than attached to entries, they
don't belong inside `vaultDocument` at all. Proposed: a **second encrypted
blob**, `users/<sub>/files-index.json.enc`, in the **new files bucket**,
fetched and stored via `GET`/`PUT` exactly like `vault.json.enc` — a
deliberate near-copy of `S3VaultRepository`/`VaultController`, not a new
pattern to audit from scratch.

```
{
  "files": [
    { "id", "name", "mimeType", "sizeBytes", "wrappedDek", "createdAt" }
  ]
}
```

**This means the existing vault blob is never touched by this feature.**
`VaultController`, `S3VaultRepository`, and the 512 KiB cap all stay exactly
as they are today — the strongest form of "keep what already works."

### Crypto

```
Vault Key ──wraps──> per-file DEK ──encrypts──> file bytes
     │
     └──encrypts──> files-index.json (holds the wrapped DEK + metadata)
```

- DEK = 32 random bytes, sealed with the **Vault Key** via the existing
  `aesgcm.js` `seal()`.
- File bytes sealed with the DEK, same versioned envelope — files and vault
  share one audited format.

**Wrapped by the Vault Key, not the Master Key — load-bearing.** Changing
the Master Password only re-wraps the Vault Key (`rewrapWithNewMasterPassword`);
if DEKs hang off it too, a password change touches nothing about files at
all. If they hung off the Master Key instead, every file's DEK would need
re-wrapping on every password change — slower, and non-atomic across two
buckets. The same property gives the Recovery Key access to files for free,
with no extra wrapping.

**What the backend still learns** (zero-knowledge posture unchanged, stated
plainly): object **sizes**, counts, and upload times, plus which `sub` owns
them. Filenames and contents stay encrypted inside the index and the file
object respectively.

### Whole-file vs. chunked encryption (§0.10, explained - and a clarification)

**This is only about *how* the browser performs the encryption, not
*whether* it does.** Every file is fully client-side AES-256-GCM'd before
upload, using the per-file DEK described above, exactly like every other
secret in this app - that part is not deferred, not optional, and not
affected by anything in this section.

What *is* deferred is a choice of technique for very large files. WebCrypto's
`AES-GCM` call needs the entire plaintext in memory at once - peak memory
during encryption is roughly **2×** the file size (plaintext buffer +
ciphertext buffer). At the agreed 25 MB cap that's entirely comfortable on a
phone: `crypto.subtle.encrypt()` runs once, on the whole file, in the
browser, before a single byte leaves it - the same one-call shape as
`aesgcm.js`'s existing `seal()`. It would *not* be comfortable at, say,
200 MB, which is the case **chunked/streaming encryption** (processing the
file in pieces via a chunked AEAD construction, instead of one call over the
whole thing) would exist to fix. Unnecessary at today's cap, so deferred -
and the envelope's version byte leaves room to add it later without breaking
anything already written.

---

## 5. Proposed API and flow

All on the **same** Lambda and API Gateway HTTP API (§3a), against the
**new, separate bucket**:

```
GET    /files-index          -> the encrypted index blob            mirrors GET /vault
PUT    /files-index          -> replace the encrypted index blob    mirrors PUT /vault
POST   /files                -> { fileId, upload: { url, fields } } presigned POST + quota check
POST   /files/{id}/commit    -> { }                                 marks the object durable
DELETE /files/{id}           -> { }                                 immediate delete, see §6
```

**Upload:** client generates a DEK → encrypts the file → asks `POST /files`
for a presigned POST (declaring ciphertext length, checked against the quota)
→ uploads straight to S3 → adds metadata + wrapped DEK to the local index →
`PUT /files-index` → calls `commit`.

**The orphan window, still worth designing for:** between "object uploaded"
and "index saved" there's a gap where an S3 object exists that nothing
references. Recommended: **tag + lifecycle** — upload with tag
`state=pending`; `commit` re-tags to `state=live`; a lifecycle rule expires
`state=pending` objects after ~1 day. Self-healing, no server-side state to
reconcile, and needs only `s3:PutObjectTagging`.

---

## 6. Deletion — simpler than first thought, because the bucket is separate

The **vault** bucket's Lambda has no `s3:DeleteObject`, removed deliberately
because on a *versioned* bucket that permission includes
`DeleteObjectVersion` — the ability to destroy the vault's only rollback
path. That reasoning doesn't transfer to the new bucket, because of a
decision made together with it:

**The files bucket should be unversioned.** Files are immutable-by-id (a new
upload always gets a new `fileId`; there's no legitimate "overwrite" case),
and "deletion immediate" (§0.5) is a *goal*, not something to work around —
versioning would actively fight it, since a versioned delete leaves the
content recoverable rather than gone. On an unversioned bucket,
`s3:DeleteObject` just deletes the object. No `DeleteObjectVersion` question
even arises, and no exception to the vault bucket's deliberate posture is
needed — it's a different bucket with a different, equally deliberate,
posture.

**IAM: grant `s3:DeleteObject` scoped to `<files-bucket>/users/*/files/*`**
only — not the index blob's key, which is only ever `PUT` (overwritten),
same as the vault. Narrow, and the whole grant lives in a bucket that holds
nothing the vault-bucket restriction was protecting in the first place.

---

## 7. Cost, quota, and abuse

At the agreed ~500 MB/user quota: **$0.023/GB-month** × 0.5 GB ≈
**$0.0115/user/month** in storage — trivial at this app's scale (a handful
of trusted users). Requests are negligible. The number that can actually
surprise is **egress** — S3→internet, if files are downloaded repeatedly
across devices. The existing `smallstash-app` $10 budget action is a
backstop, not a control tuned for this; worth watching once files are live,
not worth over-engineering before they are.

**Quota enforcement**: `UserProfile.storageBytesUsed`, unused today, gets
used — checked at `POST /files` before minting an upload, kept honest by the
presigned POST's `content-length-range` (a client can't upload more than it
declared and got signed for).

**Later optimisation, not v1:** serve downloads through the existing
CloudFront distribution instead of S3 directly — CloudFront's free egress
allowance is generous, and it would remove the need to expose an S3 origin
to the browser at all. Worth it only if egress ever shows up on a bill.

---

## 8. Infra changes required

1. **New S3 bucket** (`FilesBucket`), **unversioned** (§6), `S3_MANAGED`
   encryption, `BLOCK_ALL` public access, its own `removalPolicy`/
   `autoDeleteObjects` — see §0.9 below on why this needs no `cdk destroy`.
2. **CORS on the new bucket** — the vault bucket has none today and doesn't
   need it; the files bucket does, since the browser uploads to it directly.
   Needs the CloudFront origin, methods `GET`/`POST`/`PUT`, `ExposeHeaders`
   for `ETag`.
3. **CSP `connect-src` gains the new bucket's S3 origin.** Currently `'self'`
   + Cognito + execute-api only. **Without this the upload fails looking
   like a network error, not a policy error** — the same trap class as the
   existing `'wasm-unsafe-eval'` comment in the stack; this deserves the same
   kind of inline warning when it's added.
4. **Lifecycle rule** on the new bucket for the pending-tag expiry (§5).
   Nothing to add to the vault bucket's existing rule — it's untouched.
5. **A second `Function` construct** (`FilesFunction`), built from
   `files-lambda`'s jar (§3a), with **its own execution role** - CDK creates
   one per `Function` by default, not shared. That role gets
   `s3:GetObject`/`PutObject`/`PutObjectTagging` on `users/*` and
   `s3:DeleteObject` on `users/*/files/*`, **all scoped to the new bucket
   only**. It gets **no** DynamoDB permissions at all - the files index is an
   S3 blob (§4), not a table row - and **no** access whatsoever to the vault
   bucket. The existing Lambda's role and the vault bucket's IAM statement
   are **completely untouched** by this feature.
6. **API routes** for `/files-index`, `/files`, `/files/{id}/commit`,
   `/files/{id}`, each wired to a `HttpLambdaIntegration` pointed at the
   *new* Lambda, plus `POST`/`DELETE` added to the API's CORS methods
   (currently `GET, PUT, OPTIONS`). No authorizer wiring needed per route -
   `.defaultAuthorizer()` already covers routes added via `addRoutes(...)`
   regardless of which Lambda they integrate with (§3a).
7. **Maven build restructuring** (§3a) - the aggregator/`common`/
   `vault-lambda`/`files-lambda` module layout, done and verified as its own
   step before any of the above. `SmallstashStack.java`'s Lambda `Function`
   code asset path(s) update from one jar to two as part of this step.

### §0.9 — does this need `cdk destroy`? No.

A new bucket, new IAM statements on the existing role, and new routes are
**all additive** CloudFormation changes. `cdk deploy` creates them alongside
what already exists, the same way the export/reorder frontend work shipped
without touching infra at all. Destroy is only forced when an *existing*
resource's immutable property changes (e.g. flipping the vault bucket's own
versioning) — nothing proposed here does that. If a future revision of this
plan ever did require it, that would be flagged explicitly and separately,
not folded into a routine deploy.

---

## 9. Frontend changes required

- `crypto/files.js`: DEK generation, wrap/unwrap via the existing `seal`/
  `open` — no new crypto primitives, just the existing envelope applied
  again.
- `api/filesIndex.js` / `api/files.js`: `GET`/`PUT` for the index (mirrors
  `api/client.js`'s vault calls almost exactly); mint/commit/delete calls;
  direct `fetch` to S3 for the actual bytes (not through `apiRequest`, which
  assumes JSON against the API base URL).
- **New "Files" tab**, alongside "Secrets" (§0.4) — its own list, upload,
  download, delete UI. A document is a different affordance from a password
  field and shouldn't be squeezed into `EntryListItem`.
- **Download reuses `saveFile.js` as-is** — the export work already built
  the picker-or-download layer, and it already does the right thing on
  Android without any change here.
- **Export gets extended** (§0.8): `buildExportArtifacts` already returns a
  *list* specifically so "CSV + N files" would be additive — this is that
  moment. The writer will need to switch from a single save dialog to a
  directory picker (desktop) or sequential downloads (Android, since
  `showSaveFilePicker` isn't available there either way).
- **No offline store for file bytes** (§0.7) — only the index needs caching
  alongside the vault, and that's optional polish, not a requirement, since
  offline file access was explicitly declined.

---

## 10. Suggested phasing

| Phase | Content | Deployable alone? | Status |
|---|---|---|---|
| 0 | ADR recording the storage decision | — | not started |
| 0.5 | **Maven restructuring** (§3a): aggregator + `common` + `vault-lambda`, **zero behaviour change** to the existing vault/keys Lambda | yes — a refactor, not a feature | ✅ **done 2026-08-27**, on `feature/file-storage`, uncommitted |
| 1 | Infra: new bucket, CORS, CSP, lifecycle, `files-lambda` module + second `Function` + role. Backend: `/files-index`, `/files` mint + commit + delete + quota | yes — testable via `curl`, no UI change | ✅ **done 2026-08-27**, on `feature/file-storage`, uncommitted - **one significant deviation from the original design, see below** |
| 2 | Client crypto + upload/download plumbing, no UI polish | yes | ✅ **done 2026-08-27**, on `feature/file-storage`, uncommitted - **found and closed a real Phase 1 gap (no download route existed) before writing any download code** |
| 3 | UI: "Files" tab — list, upload, download, delete | yes | ✅ **done 2026-08-27**, on `feature/file-storage`, uncommitted |
| 4 | Extend export to include files | yes | not started |

Phase 0.5 exists specifically so a build-structure change and new
functionality are never landing in the same step - if something breaks after
0.5, there is exactly one thing it can be. Phase 1 stays deployable and
testable on its own after that, keeping infra separate from UI work - same
reasoning that made export ship before files at all.

**Phase 0.5 scope note**: `files-lambda` itself was deliberately **not**
created in this step, despite being drawn in §3a's module layout - it has no
code yet, and creating an empty module now would mean either an odd
no-source placeholder or wiring a second `Function` into `SmallstashStack.java`
pointed at nothing, which is explicitly Phase 1 scope (new bucket, second
role, new routes). Phase 0.5 stayed a pure `common` + `vault-lambda`
extraction so it could be verified in complete isolation.

### Phase 0.5 - what was actually done and verified

- `git mv pom.xml vault-lambda/pom.xml`, `git mv src vault-lambda/src`, then
  `git mv` the three shared files (`CurrentUser`,
  `ResourceNotFoundException[Handler]`) into `common/` - full history
  preserved on every moved file, confirmed via `git status` showing `R`
  (rename), not delete+add, on all 22 relocated files.
- New root `pom.xml`: reactor aggregator, `packaging=pom`, `<modules>common,
  vault-lambda</modules>`. Deliberately **not** the Java parent of either
  child - each child still parents directly to `micronaut-parent`, exactly
  as `vault-lambda` did before this change, to keep that module's diff to
  "renamed artifactId + one new dependency" rather than restructuring its
  inheritance chain too.
- New `common/pom.xml`: dependency set (`micronaut-security`, `micronaut-http`,
  `micronaut-http-server`) determined by compiling and reading the actual
  errors, not guessed from memory - `jakarta.inject-api` was tried explicitly
  first and dropped once the build proved it arrives transitively (no managed
  version for it exists in `micronaut-parent`'s BOM, and it wasn't needed).
- **Verification, strongest available short of a real deploy**:
  - `common`'s built jar contains the generated `$ResourceNotFoundExceptionHandler
    $Definition[.$Exec]` classes and the `BeanDefinitionReference` metadata
    file - proof Micronaut's annotation processing actually ran in the new
    module, not just that it compiled.
  - The full class-name list inside the final shaded `vault-lambda-0.1.jar`
    diffs as **byte-for-byte identical** (21,266 classes, zero-line diff)
    against a `target/smallstash-0.1.jar` built immediately before the
    restructuring started, from the same unmodified source.
  - Three individual class files - `CurrentUser.class` (moved module),
    `ResourceNotFoundExceptionHandler.class` (moved module, its bean
    metadata generated by a different module's build now), and
    `VaultController.class` (untouched, different module) - hashed
    **identical** (`sha256sum`) between the before and after jars.
  - A local CDK synth (`CDK_OUTDIR=cdk.out ../mvnw compile exec:java`, no AWS
    calls) succeeded from a clean `mvn clean package`, and the synthesized
    `BackendFunction`'s `Handler`/`Runtime`/`MemorySize`/`Timeout`/env-var
    keys are unchanged from the live-deployed configuration recorded
    elsewhere in this repo's docs - only the `Code`'s S3 asset hash differs,
    which is expected (new zip, same class bytes inside it).
- `SmallstashStack.java`'s `Code.fromAsset` updated from
  `../target/smallstash-0.1.jar` to `../vault-lambda/target/vault-lambda-0.1.jar`.
- `CLAUDE.md` updated in the same change (repo map + dev cheat-sheet) rather
  than left stale, per the sequencing note in §8.
- **Correction (2026-08-27, post-Phase-4)**: this section originally said
  `mvn test` hadn't been run because "Docker isn't available in this
  environment," checked via `docker info`. **That check was a false
  negative** - the `docker` CLI simply isn't on this shell's `PATH`, which
  isn't the same thing as the Docker engine being unreachable. Running
  `./mvnw test` directly (the correct check, not attempted until prompted
  to reconsider) shows Micronaut's test-resources service reaches the real
  engine fine: both pre-existing LocalStack tests below passed,
  `Tests run: 5, Failures: 0, Errors: 0, Skipped: 0`. Left here rather than
  silently rewritten, since the same wrong claim was repeated in Phase 1
  below and is corrected there too.
- **Not yet done**: an actual `cdk deploy`. Per standing project rules this
  needs explicit confirmation, every time, regardless of how much local
  verification precedes it - not requested yet, so not done.

### Phase 1 - what was actually done, and a significant correction

⚠️ **The single most important thing to know about this phase**: the plan's
upload mechanism (§3, "presigned POST") turned out not to be buildable as
designed. **AWS SDK v2's `S3Presigner` has no presigned-POST support at
all** - confirmed by listing every class in
`software.amazon.awssdk.services.s3.presigner.model` (only
Get/Put/Head/Delete/multipart-step presign requests exist; no
`PostObjectPresignRequest` or equivalent), not assumed from memory or from
the SDK v1 behaviour the original plan may have been implicitly modelled on.
Hand-rolling AWS's raw POST-policy signing (base64 JSON policy, SigV4
signing-key derivation, an `x-amz-security-token` field required for the
Lambda's temporary role credentials) was deliberately **not** attempted -
that is exactly the class of security-sensitive code that's easy to get
subtly wrong, security-critical enough that "not offered by the SDK" is
reason enough on its own not to reimplement it by hand, regardless of how
available LocalStack verification happened to be at the time.

**Used instead: presigned `PUT`**, which the SDK does support, with the
`state=pending` tag still carried as a signed header (`x-amz-tagging`) so
the orphan-cleanup tag-then-lifecycle design (§5) survives unaffected. What's
genuinely lost: a presigned PUT's SigV4 signature does not cover
`Content-Length`, so - unlike POST-policy's `content-length-range` - nothing
stops an oversized body from being *accepted* by S3 in the first place.
**Compensating control**: `FilesController.commit` re-checks the actual
uploaded size via `HeadObject` and the user's real total usage (via
`FilesUsageService`, see below), and deletes-and-rejects if either is over
limit. This is real enforcement, just *after* the fact rather than *before*
it - a briefly oversized object can exist in S3 between upload and commit,
where the original design would have refused it outright at the signature
level. Full reasoning is in `FilesController`'s class Javadoc, not just
here, since that's where someone touching the code next will actually see
it.

**A second, smaller deviation, also driven by the "zero DynamoDB access"
decision (§8.5) rather than contradicting it**: the plan named
`UserProfile.storageBytesUsed` as the quota mechanism, but that's a DynamoDB
field, and `files-lambda` has no DynamoDB permissions at all. Resolved by
computing usage **live**, via `s3:ListBucket` over each user's `files/`
prefix, summing object sizes - no ledger to keep in sync, self-correcting
after every delete, at the cost of one new IAM action
(`s3:ListBucket`, bucket-scoped with an `s3:prefix` condition) not in the
original §8 enumeration. `FilesUsageService`'s Javadoc carries the same
reasoning.

**What else was built, mirroring vault-lambda's patterns deliberately
rather than inventing new ones**:

- `files-lambda/` module: `FilesStorageProperties` (one bucket-name
  property, no users-table - mirrors `StorageProperties` minus what this
  Lambda doesn't have), `FilesAwsClientConfig` (`@Factory` producing the one
  bean `micronaut-aws-sdk-v2` doesn't create automatically - `S3Presigner`,
  built *from* the already-configured `S3Client` bean's own
  `serviceClientConfiguration()` rather than re-deriving
  region/credentials/endpoint-override independently, which is what
  guarantees the presigner and the client agree in every environment,
  including LocalStack in tests, by construction rather than by keeping two
  configuration paths in sync by hand).
- `FilesIndexBlob`/`FilesIndexUploadRequest`/`FilesIndexNotFoundException`/
  `FilesIndexRepository`/`S3FilesIndexRepository`/`FilesIndexController` -
  a close mirror of `vault.VaultBlob`/`VaultUploadRequest`/
  `VaultNotFoundException`/`VaultRepository`/`S3VaultRepository`/
  `VaultController`, minus the `versionId` field (the files bucket is
  unversioned, so S3 never returns one to carry) and with a smaller size cap
  (64 KiB - this blob is metadata only, never file bytes, so there's no
  reason for it to approach the vault's own 512 KiB).
- `FilesController` - `POST /files` (mint), `POST /files/{id}/commit`,
  `DELETE /files/{id}`. Delete is unconditional and idempotent (no
  existence check first - deleting something already gone is still success),
  matching S3's own `DeleteObject` semantics rather than adding a 404 case
  that doesn't need to exist.
- `FilesUsageService` - the live-usage calculator described above.

**Infra, one genuine ordering puzzle worth recording** (so it doesn't need
re-solving if this file is ever touched again): the CSP string needs
`filesBucket.getBucketRegionalDomainName()`, but is built *before*
`Distribution` exists, while `filesBucket`'s own CORS rule needs
`allowedOrigins`, which needs `Distribution`'s domain name, which doesn't
exist until *after* the CSP-consuming `Distribution` is constructed - a real
circular dependency as originally laid out. Resolved by splitting
construction from configuration: `filesBucket` is created early (alongside
`vaultBucket`, well before the CSP), with **no CORS rule at construction
time**; the CORS rule is attached later, once `allowedOrigins` exists, via
`Bucket`'s `addCorsRule(...)` mutator (confirmed to exist by inspecting the
CDK jar, not assumed) rather than the immutable `.cors(...)` builder
property. `getBucketRegionalDomainName()` never depended on `Distribution`
in the first place, so this only needed splitting one thing (CORS), not the
whole bucket.

Otherwise as specified in §8: `FilesFunction` is a genuinely separate
`Function` with its own execution role (confirmed via the synthesized
template - its inline policy references only `FilesBucket`'s ARN, with no
DynamoDB statement and no reference to `VaultBucket` anywhere); new routes
for `/files-index`, `/files`, `/files/{fileId}/commit`, `/files/{fileId}`
needed **no per-route authorizer wiring at all** - confirmed in the
synthesized template, every one of them shows `AuthorizationType: JWT` with
an `AuthorizerId` set, purely from `HttpApi`'s existing
`.defaultAuthorizer(...)`, exactly as the §3a spike predicted; API-level
CORS methods gained `POST`/`DELETE`; the CSP gained the files bucket's
regional domain.

**Verification, same standard as Phase 0.5**:

- All three backend modules (`common`, `vault-lambda`, `files-lambda`)
  build cleanly together via one `mvn clean package` at the aggregator root.
- `vault-lambda`'s shaded jar's class list is still **byte-for-byte
  identical** (21,266 entries, zero-line diff) to the Phase 0.5 baseline -
  confirming Phase 1's additions didn't disturb it, the same check repeated
  rather than assumed to still hold.
- `files-lambda`'s shaded jar contains the Lambda entry point class, both
  controllers' generated bean definitions, and the `S3Presigner` factory
  bean's generated definition - annotation processing genuinely ran, not
  just "it compiled."
- A clean local CDK synth (`CDK_OUTDIR=cdk.out`, no AWS calls) succeeded,
  and the synthesized template was read directly (not trusted from the CDK
  source) to confirm: `FilesBucket` unversioned with the correct
  CORS/lifecycle configuration; `FilesFunction`'s handler/runtime/memory/
  timeout/env-vars; `FilesFunctionServiceRoleDefaultPolicy` containing
  exactly the three intended statements and nothing else; every new route's
  authorizer wiring; the API's CORS methods; and the CSP string.
  `BackendFunction`'s own inline policy was independently re-checked and
  confirmed to still contain exactly its original two statements - proof
  Phase 1 didn't touch it.

**Correction (2026-08-27, post-Phase-4)**: same wrong "Docker unavailable"
claim as Phase 0.5's - `./mvnw test` does run and pass here. What was
actually true, and a real gap distinct from Docker: `files-lambda` had zero
test files - not blocked by anything, never written. `mvn test` reported "No
tests to run" for it, and the 5 passing tests above were entirely the
pre-existing `vault-lambda` ones, unaffected by anything Phase 1 added.

### Phase 1 addendum (2026-08-27) - closing the files-lambda test gap

Three new `@MicronautTest`-backed integration test classes in
`files-lambda`, deliberately matching `vault-lambda`'s existing pattern
(`@Inject` the real bean, real LocalStack via Micronaut's test-resources
service, no mocking) rather than inventing a new testing style for this
module:

- **`S3FilesIndexRepositoryTest`** - get/put round-trip, a second `put`
  overwriting rather than appending, and the not-found case. A near-copy of
  `S3VaultRepositoryTest`, matching how the repository under test is itself
  a deliberate near-copy of `S3VaultRepository`.
- **`FilesUsageServiceTest`** - summation across multiple objects, that a
  `state=pending` object still counts (the method's own documented reason
  for not filtering by tag), and - the case that matters most for a
  per-user quota - that one user's usage **never** includes another user's
  objects under a different prefix.
- **`FilesControllerTest`** - `mint`'s size-cap pre-check (zero/negative and
  over-cap declared sizes), that `mint` hands back the `x-amz-tagging:
  state=pending` header actually signed into the presigned URL, `commit`'s
  real `HeadObject`-based enforcement exercised with **a genuine 26 MiB
  object** (not just asserted from reading the source) confirming both the
  rejection *and* that the oversized object is actually deleted (a second
  `commit` sees 404, not still-too-large), the tag flip to `live` on a
  successful commit, and `delete`'s idempotency.

**Deliberately not exercised with real bytes**: the ~500 MiB user quota's
overflow branch. Reproducing it for real would mean actually storing that
much data in LocalStack per test run - genuine but impractical weight for a
fast suite. Named as a gap rather than silently left uncovered;
`FilesUsageServiceTest`'s summation/prefix-scoping coverage is the closest
practical substitute, since the quota check itself is simple arithmetic
(`currentUsage + declared > cap`) built directly on that summation.

**Verified**: `./mvnw test` **20/20** across the reactor (5 pre-existing
`vault-lambda`, 15 new `files-lambda`), `BUILD SUCCESS`.

**Not yet done**: no `cdk deploy` (needs explicit per-instance confirmation
regardless of local verification, per standing project rules - not
requested yet).

### Phase 2 - what was actually done, and a Phase 1 gap it uncovered

⚠️ **A real gap in Phase 1, found before it caused a problem**: starting
download plumbing surfaced that Phase 1 never added a way to fetch file
bytes at all. `FilesBucket` is `BLOCK_ALL` public access, so nothing let a
browser read an object directly - `§5`'s original route list never included
a download endpoint, and Phase 1 was implemented faithfully to that list.
**Fixed as part of Phase 2, in the backend**: a new `GET /files/{fileId}/url`
route on `FilesController`, presigning a `GetObject` (mirroring the existing
`mint`'s `presignPutObject` shape almost exactly) with the same 5-minute TTL
as upload. Rebuilt and re-verified with the same rigor as the rest of
Phase 1 - `files-lambda` compiles clean, and the synthesized template
confirms the new route carries `AuthorizationType: JWT` with an
`AuthorizerId` set, same as every other route.

**What was built, client-side**:

- `crypto/files.js` - `generateFileKey`/`wrapFileKey`/`unwrapFileKey` (DEK
  lifecycle, wrapped by the Vault Key per §4) and
  `encryptFile`/`decryptFile`/`encryptFilesIndex`/`decryptFilesIndex`, all
  built on the *existing* `seal`/`open` envelope from `crypto/aesgcm.js` -
  no new crypto primitives, exactly as §9 called for. One deliberate
  difference from `crypto/vault.js`'s equivalents: `encryptFile`/
  `decryptFile` work on raw `Uint8Array` ciphertext, not base64 - file bytes
  go straight into a `fetch` `PUT` body to S3, never through a JSON envelope,
  so base64-encoding them would cost ~33% extra bytes and peak memory for no
  reason. `MAX_FILE_SIZE_BYTES` mirrors `FilesController`'s constant of the
  same name - client-side pre-check only, matching the existing
  `MAX_VAULT_CIPHERTEXT_BYTES`/`VaultController` relationship; the server
  commit-time check is the real enforcement (see Phase 1's note on why).
- `api/filesIndex.js` - `getFilesIndex`/`putFilesIndex`, mirroring
  `getVault`/`putVault` in `api/client.js`. One deliberate difference:
  `getFilesIndex` returns `null` on a 404 rather than throwing - unlike a
  missing vault (an error condition; the vault is proactively created at
  signup), a user having no files yet is the normal state for most users,
  and this way every caller doesn't have to special-case
  `ApiError.status === 404` itself.
- `api/files.js` - `mintFileUpload`/`commitFileUpload`/`deleteFile`/
  `getFileDownloadUrl` are ordinary JSON calls through the existing
  `apiRequest` wrapper (same `HttpApi`, same wrapper, no reason for a
  second one - `client.js`'s method-type JSDoc was widened from `'GET'|'PUT'`
  to include `'POST'|'DELETE'` since these are the first callers of either).
  `uploadFileBytes`/`downloadFileBytes` are different in kind, not just
  detail, and deliberately bypass `apiRequest`: they talk straight to a
  presigned S3 URL with no `Authorization` header (the signature *is* the
  authorization) and a raw binary body/response, never JSON.
- `session.js` gained `listFiles`/`uploadFile`/`downloadFile`/`removeFile` -
  the orchestration layer, same shape as `saveVault`/`changeMasterPassword`
  (guard on `active`/`active.idToken`, then call the crypto and API layers
  in sequence). Deliberately **no local caching** of the index or file bytes
  the way the vault has (`cache/db.js`) - §0.7 already declined offline file
  access, so every function here round-trips to the server, which is simpler
  than the vault's cache-then-reconcile shape and correct anyway (fetching
  file bytes from S3 needs the network regardless of any local index cache).
  `uploadFile` stores the entry's `sizeBytes` from `commit`'s response, not
  a locally-computed value - the authoritative figure `HeadObject` actually
  saw server-side, not a client guess.

**One acknowledged gap, not silently accepted**: `removeFile` makes two
independent requests (delete the object, then save the updated index) with
no transaction across them. If the process dies between them, the object is
gone from S3 but still listed in the index - `downloadFile`'s 404 from a
stale listing is the recovery signal for that gap today, not a graceful
fix. Noted in `removeFile`'s own doc comment; revisit if it turns out to
matter more in practice than that.

**Verification**: real crypto throughout (`crypto/files.js` is exercised
for real in every test, mirroring how `crypto/vault.js` is treated in
`session.test.js` - only the network boundary is mocked). New
`crypto/files.test.js` covers DEK generation/wrap/unwrap (including the
wrong-Vault-Key-fails case), file encrypt/decrypt round-trips (including a
check that ciphertext is genuinely not the plaintext passed through), the
size-cap rejection, and index encrypt/decrypt round-trips including the
empty-list case. `session.test.js` gained 12 tests for the four new
orchestration functions - `uploadFile`'s happy path asserts the *uploaded*
bytes are ciphertext, not plaintext, and that the entry's `sizeBytes` comes
from `commit`'s response, not a local computation; a second test confirms
uploading appends to an existing index (decrypted and checked directly)
rather than replacing it; `downloadFile`'s happy path round-trips a real
encrypted file through the full mocked-server path and asserts the
recovered bytes match the original plaintext exactly;
every function's offline/no-session rejection paths are covered, matching
the existing convention for `saveVault`/`changeMasterPassword`. **161/161
tests pass** (149 before this phase), `npm run build` clean.

**Not yet done**: nothing UI-facing exists yet (Phase 3), and none of this
has been exercised against a real deployed backend (no `cdk deploy` yet).

### Phase 3 - what was actually done

**`FilesView.svelte` is a sibling to `VaultView.svelte`, not a merge into
it** - a deliberate structural choice. Reusing `VaultView`'s considerable,
already-verified complexity (drag reordering, per-field password masking,
the add-entry panel) would have meant either awkwardly generalising all of
it for documents or duplicating this component's logic inside it either way.
**`VaultView.svelte` itself was not touched at all** - zero regression risk
to a component with extensive existing test/verification history. The one
cost of keeping them fully separate: `FilesView` carries its own small
"Sign out" button rather than sharing one persistent header-level control,
since Secrets and Files are peer tabs, not a single vault view. Accepted
deliberately rather than risk a wider refactor of `VaultView`'s toolbar to
extract a shared one.

**Also simpler than `VaultView` in a structural way that matters, not just
smaller**: there is no "Save vault" / dirty-tracking model for files at all.
Every action (`uploadFile`, `removeFile` in `session.js`, built in Phase 2)
already round-trips to the server before it returns, so by the time
`FilesView`'s local `files` array is updated, the change is already
durable. Nothing to lose on sign-out, so its `handleSignOut` needs no
unsaved-changes confirmation the way `VaultView`'s does.

**New components/modules**:

- `FileListItem.svelte` - one row per file. Deliberately much simpler than
  `EntryListItem.svelte`: a file's metadata (name, size, upload date) isn't
  a secret the way a password is, so there's nothing to mask behind a
  "Show" toggle and nothing to edit in place (a wrong filename isn't
  fixable without re-uploading - it's baked into what was encrypted). Just
  a name, formatted size/date, Download, and Delete.
- `formatFileSize.js` - human-readable sizes (`"1.5 KB"`), decimal (1000-
  based) units deliberately, not the binary (1024-based) units the rest of
  the codebase's *code* uses for real memory/storage boundaries
  (`MAX_FILE_SIZE_BYTES`, `512 KiB`) - this one is user-facing display, and
  decimal is what a browser's own file picker or an OS file manager shows,
  which is what a user will actually be comparing against. New, dedicated
  test file (6 tests) - the rounding behaviour and the no-trailing-".0"
  rule are exactly the kind of off-by-one-prone code worth covering
  directly rather than trusting by inspection.
- **App.svelte gained a Secrets/Files tab switcher**, shown only once
  unlocked. `view` resets to `'secrets'` on both explicit sign-out and
  inactivity auto-lock, so a fresh unlock always lands on the same tab
  rather than wherever a previous session happened to leave off.
- **`saveFile.js` (built for CSV export) was generalised for arbitrary
  downloaded files, not copied** - reused as the single writer for both.
  Two real fixes needed to make that safe, not just a call-site change:
  - `contents` is now typed to accept a `Uint8Array` as well as a `string` -
    `Blob`'s constructor already accepted either, so no logic change, just
    the type catching up to what Phase 3 actually needed to pass it.
  - The save-picker's `types` filter was **hardcoded to `text/csv`** before
    this phase - harmless while CSV was the only caller, actively wrong for
    a downloaded PDF or image. Now derived from the artifact's own
    `mimeType`/`path`. Fixing this surfaced a **second, pre-existing bug**
    in the process: `export.js`'s own `mimeType` is
    `'text/csv;charset=utf-8'`, and `showSaveFilePicker`'s `accept` map
    requires a bare MIME type with no `;`-delimited parameters - passing
    the real value through (rather than the old hardcoded `'text/csv'`,
    which happened to already be bare) would have broken the *existing*
    CSV export's save dialog. Fixed with a small `bareMimeType()` helper
    that strips parameters before use - the CSV export path is unaffected
    output-wise, just no longer silently relying on the old hardcoding to
    dodge a bug that was always there.

**Verified**: `npm test` **167/167** (161 before this phase - the 6 new
tests are `formatFileSize.test.js`; `FileListItem`/`FilesView` themselves
have no dedicated unit tests, since they contain no logic beyond what
`session.test.js` already exercises through `session.js` and what
`formatFileSize.test.js` exercises directly - see below for the one real
bug this phase's *visual* verification caught that unit tests alone would
have missed). `npm run build` clean, including a real warning fixed rather
than ignored: `FileListItem`'s `uploadedOn` was a plain `const` reading a
prop once (Svelte's `state_referenced_locally` - the exact same class of
bug `Alert.svelte` had earlier in this project, fixed the same way with
`$derived`).

Visual verification: `FileListItem` mounted directly with realistic fake
data (varying name lengths - confirming long-filename truncation actually
truncates rather than overflowing the card - varying sizes, and the
`downloading` disabled state) renders correctly and matches the app's
existing visual language exactly. `FilesView` mounted with no session
state confirms its toolbar/hint/error/empty-state chrome renders sanely
even in that condition - useful precisely because it's a state a real user
can genuinely hit (e.g. a token expiring mid-session). Mounting a fully
populated `FilesView` (upload → list → download → delete against a live
session) wasn't attempted here - it would have needed either a live
backend or briefly overwriting the *uncommitted* `session.js` with a fake
one, which was judged too risky for a temporary check; that path is
already covered functionally by Phase 2's `session.test.js` (real crypto,
mocked network), which is what actually proves the data layer works. This
phase's screenshots verify layout/CSS/interaction, not data correctness -
deliberately not claiming more than that.

**Not yet done**: Phase 4 (extending export to include files), and nothing
in this whole feature has been exercised against a real deployed backend.

### Phase 4 - what was actually done

**`export.js` stayed pure/synchronous, as designed** - the artifact list was
deliberately a *list* from the moment it was introduced (pre-file-storage),
specifically so this phase could be additive. It was: `buildExportArtifacts`
gained a `files` option (`{ name, mimeType, bytes }[]`, exactly
`session.js`'s `downloadFile()` return shape - no translation layer needed
between the two) and spreads one artifact per file onto the existing
CSV-only list. Omitting the option, or passing `files: []`, reproduces the
exact prior output byte-for-byte - verified directly with a test asserting
`buildExportArtifacts(vault, now)` and `buildExportArtifacts(vault, now, {
files: [] })` are `deepEqual`. `export.js` still never fetches or decrypts
anything itself; that stays in `session.js`/`ExportPanel.svelte`.

**A real gap the file case surfaced that CSV alone never could**: two
uploaded files can legitimately share a name (two different `receipt.pdf`s
are a real scenario, not a hypothetical). Writing both to `files/receipt.pdf`
in a directory export would silently drop one with no error. Fixed with a
new `deduplicatePaths()` helper - repeats get ` (1)`, ` (2)`, ... inserted
before the extension (or at the end, for an extension-less name like
`README`), applied before file artifacts are built. Covered by two tests:
with and without a file extension.

**`saveFile.js` gained `saveArtifacts` (plural) and `supportsDirectoryPicker`**,
alongside the existing (unchanged) `saveArtifact`/`supportsSaveFilePicker`:

- A single artifact still delegates straight to `saveArtifact` - the
  CSV-only export path (no files uploaded, or files failed to load) is
  byte-for-byte the same code path it always was.
- Multiple artifacts, directory picker available (`showDirectoryPicker`,
  Chromium-desktop-only - confirmed via MDN to share the exact same support
  boundary as `showSaveFilePicker`, so nothing new is lost on mobile/Firefox/
  Safari beyond what Phase 3 already accepted): one folder-destination
  dialog, then every artifact is written into it via `getDirectoryHandle`/
  `getFileHandle`, walking `path`'s `/`-separated segments to recreate the
  `files/` subfolder. `AbortError` on dismissal maps to `'cancelled'`, same
  convention `saveArtifact` already uses.
- Multiple artifacts, no directory picker: a sequential loop of
  `saveArtifact` calls - reuses `saveArtifact`'s own `<a download>` fallback
  for each one rather than duplicating that logic, since a browser without
  `showDirectoryPicker` doesn't have `showSaveFilePicker` either (same
  boundary), so every call in the loop is guaranteed to take that branch.
- No dedicated test file for any of this, consistent with Phase 3's
  precedent: `saveFile.js` is fundamentally `document`/`Blob`/File-System-
  Access-API-shaped, none of which `node:test` provides without a jsdom
  dependency this project doesn't have. It was already exercised only by
  visual/manual verification before this phase; that gap is unchanged, not
  newly introduced.

**`ExportPanel.svelte`**: the header comment's "makes no network calls and
works offline" claim is now false and was rewritten to say so plainly. A
real risk this raised - fetching/decrypting files before opening a picker
means a large/slow file set could let the click's transient activation
expire before the picker opens, and the browser would reject it outright -
was **fixed, not just documented** (2026-08-27, in response to review):
when a directory picker is available and there are files to include,
`runExport` now takes a `runExportStreamed` path that opens
`pickExportDirectory()` *first*, still inside the click's activation, and
only then downloads and writes each file one at a time
(`writeArtifactToDirectory`) plus the CSV - nothing is fetched before the
picker is granted. The two other cases (`runExportBuffered`) were never
exposed to this in the first place: a CSV-only export awaits nothing before
its one `saveArtifacts` call, and the picker-less fallback uses
`<a download>`, which needs no permission prompt and isn't activation-timed.
Locking the two paths' file-naming in agreement (the streamed path needs a
file's final path *before* its bytes exist, to write straight into the
handle) needed one more export.js export, `fileArtifactPaths(files)` -
`{ name }` in, deduplicated `files/...` paths out, factored out of the
existing `fileArtifacts()` and covered by a new test asserting it agrees
with `buildExportArtifacts`'s own paths. Real UI changes:

- The files list is fetched eagerly on open (`listFiles()`, cheap - just
  metadata) so the "what gets exported" summary can name a real file count
  before the button is ever clicked; a failure here degrades to "export will
  only include your entries" rather than blocking the panel.
- `runExport` now downloads+decrypts every listed file (`downloadFile()`
  per file, sequential - no meaningful parallelism gain given they're
  individually small and quota-capped at 500 MB total) before calling the
  new plural `buildExportArtifacts(..., { files })` / `saveArtifacts(...)`.
- Copy updated throughout: the button reads "Export" instead of "Export as
  CSV" once files exist, the success message names both counts, and the
  "what gets exported"/destination-dialog bullets now branch three ways
  (directory picker when files exist and it's available, save-file picker
  for CSV-only, Downloads-folder fallback otherwise) instead of two.
- The disabled/empty-state condition changed from "no entries" to "no
  entries **and** no files" (`nothingToExport`) - a vault with zero
  passwords but some uploaded files is a real, exportable state now.

**Verified**: `npm test` **173/173** (167 before the phase's first pass, 172
after it, 173 after the transient-activation fix - 6 new tests total, all in
`export.test.js`: no-files-option reproduces prior output exactly, one
artifact per file under `files/`, bytes pass through unchanged - an identity
check, not deep-equal, to prove no copy or re-encoding happens - the two
de-duplication cases, and `fileArtifactPaths` agreeing with
`buildExportArtifacts`'s own paths). `npm run build` clean both times.

**Not yet done**: nothing in this whole feature has been exercised against
a real deployed backend or a real browser (same standing gap as every
earlier phase). The transient-activation *fix* itself is untested against a
real slow connection (would need one to reproduce meaningfully) but the
ordering it relies on - picker before fetch - is exercised structurally by
`runExportStreamed`'s own code path, not just asserted.

---

## 11. What's still open

Nothing blocking - all ten original questions plus the Lambda-count question
are decided. Two loose ends, not decisions:

- **Naming**: `FilesBucket`, `files-index.json.enc`, `common`/`vault-lambda`/
  `files-lambda` are working names, not final.
- **Exact `common` module contents** aren't fully enumerated yet - `CurrentUser`
  for certain; whether any of the `error` package's exception-handling pattern
  is worth sharing too is a judgment call to make while actually doing the
  Phase 0.5 restructuring, not before.
