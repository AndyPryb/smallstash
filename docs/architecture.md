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
| `USER#<cognito-sub>` | `PROFILE` | `createdAt`, `plan`, `storageBytesUsed`, `displayName?` | app-level user metadata, not in Cognito attributes |
| `USER#<cognito-sub>` | `KEYS` | `kdfSalt`, `kdfParams` (memory/iterations/parallelism), `wrappedVaultKey`, `wrappedVaultKeyByRecovery`, `keyVersion` | read once per login, before/alongside the vault blob fetch |

Single-table design (PK/SK convention) leaves room to add
`SK = ENTRY#<id>` items later for per-entry sync without a new table or
migration of existing data.

### 4b. S3 — `smallstash-vaults` bucket (versioning on)

```
s3://smallstash-vaults/users/{cognito-sub}/vault.json.enc
```

One whole-vault encrypted blob per user, replacing the previous plan's
*two* S3 objects (the `keys.json` piece has moved to DynamoDB, §4a).
Versioning stays on for free rollback if a corrupt/malicious write ever
lands.

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
- **Cognito Free tier:** ~10,000 MAU forever (Essentials tier) — a
  personal-to-small-startup user base costs $0 on the auth side
  indefinitely.
- **Authorization model:** the Lambda execution role has broad read/write
  access to the S3 bucket and DynamoDB table (a single shared role — this
  is *not* per-caller scoped via Cognito Identity Pool + STS, which would
  be the "enterprise" approach). Instead, **the application code enforces
  authorization on every request**: extract `sub` from the verified JWT,
  compare it against the resource owner encoded in the request path/key,
  reject on mismatch. This is simpler to build and reason about at this
  project's scale; Identity-Pool-scoped IAM is worth adding only if this
  ever needs to satisfy a stricter multi-tenant compliance bar.
- **Cognito login password vs. vault Master Password — recommended:
  two fully independent secrets** (not the same secret derived two ways).
  Rationale: keeps blast radius separate — if the Cognito login path is
  ever phished, logged, or its password reset abused, it reveals nothing
  about the vault's Master Key. It also keeps "forgot my Cognito
  password" (a standard Cognito-managed email reset flow) completely
  decoupled from vault recovery, which must stay the deliberate,
  user-driven Recovery Key flow — conflating the two would either weaken
  vault security or complicate the reset UX. **Confirmed.**

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

## 7. Infra-as-code (recommendation, open question #7)

**Recommended default: AWS CDK, Java.** Reasoning: the backend is already
Java/Maven, so CDK-in-Java keeps one language across app and infra code —
no context-switch to HCL (Terraform) or YAML (SAM) for a solo maintainer.
CDK also has first-class constructs for exactly this stack (Lambda,
HTTP API + Cognito authorizer, DynamoDB table, S3 bucket with versioning).
Terraform remains a fine alternative if multi-cloud portability or a
declarative-diff workflow is preferred — flag if that's the case.

## 8. Phased roadmap

**v1 (this doc's scope):**
- Cognito user pool (self sign-up, SRP), single-tenant-in-practice but
  multi-tenant-by-design.
- HTTP API + JWT authorizer → Lambda (Micronaut).
- DynamoDB `smallstash-users` table for profile + key metadata.
- S3 `smallstash-vaults` bucket for the whole-vault encrypted blob.
- PWA client: KeePass-inspired fields (Title/Username/Password/URL/
  Notes/Tags), client-side Argon2id + AES-256-GCM, IndexedDB cache of
  ciphertext only.
- Recovery Key generated at signup (format: TBD, leaning BIP39-style word
  phrase — open question #3).

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
- **Not built yet:** Cognito user pool itself (no IaC yet, see open
  question #4), signup flow wiring `keys` write to a Cognito
  post-confirmation trigger vs. an explicit client call, HTTP API +
  authorizer provisioning, `application-lambda.properties`
  `COGNITO_JWKS_URL` is a required-but-unset placeholder until the pool
  exists.

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
