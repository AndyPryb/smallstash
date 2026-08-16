# smallStash — Open questions

Tracks the questions raised across sessions, my recommended default for
each (so we don't stall on all of them at once), and status. Update this
file as answers land — move resolved ones into
[architecture.md](architecture.md) and mark `Resolved` here with a
one-line pointer.

## Resolved this session

1. **Storage: hybrid S3 + DynamoDB, per [ADR-0001](decisions/0001-storage-s3-vs-dynamodb.md).**
   **Status: Resolved — confirmed and implemented.** `smallstash-users`
   DynamoDB table (profile + KDF/key metadata) + `smallstash-vaults` S3
   bucket (whole-vault blob), see architecture.md §4 and the `vault`/`keys`
   packages in `src/main/java/andriy/prybaten`.

2. **Cognito login password vs. vault Master Password.**
   **Status: Resolved — two independent secrets**, per architecture.md §5.

3. **API Gateway type.**
   **Status: Resolved — HTTP API**, payload format 2.0. Lambda entry point
   is the built-in `io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction`.
   `micronaut-security-jwt` is included as defense-in-depth (validates the
   Cognito JWT in-Lambda too, not just at the authorizer) — off by default
   (`micronaut.security.enabled=false`) until a real Cognito pool exists,
   see application.properties / application-lambda.properties.

## Still open, doesn't block current backend work

4. **Infra-as-code tool** — Terraform, CDK, SAM, or manual console?
   Recommended: **AWS CDK (Java)** — keeps one language across app and
   infra for a solo maintainer. Terraform acceptable alternative if
   multi-cloud portability matters to you. Not needed yet: local backend
   work runs against LocalStack (`mvn test`) regardless of which tool
   eventually provisions the real AWS resources.
   **Status: recommended default given, awaiting confirmation — needed
   before the first real deploy, not before local dev.**

## Lower urgency (don't block backend/storage work, decide when we get there)

5. **Recovery key delivery format** — downloadable file, printable code,
   BIP39-style word phrase, or other?
   Leaning: BIP39-style word phrase (standard, human-writable, mature
   libraries available). Affects the signup "save this now" UX screen,
   not the backend.

6. **Password generator scope** — in v1 alongside the vault, or later?
   Leaning: include in v1 — it's client-side-only, low effort, and users
   expect it from a password manager.

7. **Frontend framework** — React, Vue, Svelte, vanilla JS?
   No strong recommendation yet — genuinely preference-driven. Given a
   solo dev + PWA + offline/IndexedDB requirement, a lighter framework
   (Svelte/Vue) reduces bundle size and mental overhead vs. React, but
   pick whichever you already have the most fluency in — that matters
   more than the marginal technical difference here.

8. **WASM Argon2id library** — since WebCrypto has no native Argon2id.
   Leaning: `hash-wasm` (actively maintained, tree-shakeable, TS types)
   over `argon2-browser` (older, less actively maintained as of last
   check) — but worth a quick freshness check when you actually wire
   this up, library maintenance status can shift.

9. **Repo structure** — monorepo (backend + PWA) or separate repos?
   Leaning: monorepo for a solo-dev pet project — simpler CI, atomic
   commits across FE/BE changes, no version-skew coordination overhead.
   Only worth splitting if you want independent deploy cadences or plan
   to open-source one half separately from the other.

## Correlations worth keeping in mind

- Q1 (storage) and Q3 (API Gateway type) interact: HTTP API's native JWT
  authorizer means the Lambda can trust `sub` from the request context
  without re-verifying the token — that `sub` is exactly the value used
  as both the DynamoDB PK and the S3 key prefix, so getting the
  authorizer wired correctly is what makes the app-code authorization
  check in architecture.md §5 actually sound.
- Q2 (independent secrets) and Q1 (DynamoDB `KEYS` item) interact: since
  KDF salts/params now live in DynamoDB rather than a second S3 object,
  changing the Master Password (independent of Cognito password) means
  updating one DynamoDB item, not re-uploading a `keys.json` object —
  slightly simpler "change master password" flow either way.
- Q9 (monorepo) makes Q4 (CDK in Java) more attractive: infra code,
  backend, and (if monorepo) frontend build config all live in one
  place with one CI pipeline to reason about.
