# smallStash — Project Context Summary

*Transfer this file into your IDE AI assistant's context (e.g. as a pinned file or first message) to continue this project with full background.*

## What this is
A personal, zero-knowledge secrets/password manager, self-hosted on AWS as a cheap pet project. Backend must never be able to read secrets — not even root/AWS itself.

## Decisions made so far

**Naming:** `smallStash` (confirmed casing)

**Compute:** AWS Lambda, not EC2 — usage pattern is roughly once every couple of days, so Lambda is effectively free (well within free tier) vs. EC2's fixed monthly cost for something mostly idle.

**Language/framework:** Java + **Micronaut**, built via **Maven** (not Gradle).

**Cold start:** Explicitly **not** using SnapStart or GraalVM native-image for now. Accepted tradeoff: cold starts will likely run several seconds (Java/Micronaut without mitigation), which is acceptable since usage is infrequent anyway. Revisit SnapStart later if this becomes annoying in practice — Micronaut supports adding it later without an architecture rewrite.

**Auth:** AWS Cognito, using the SRP (Secure Remote Password) flow so the login password never crosses the wire even encrypted. **Open question:** whether the Cognito login password and the vault's Master Password should be the same secret (derived two ways via separate salts) or two fully independent secrets — see Interview Questions below.

**Storage:** S3 (not DynamoDB, not EC2 disk) — one encrypted vault blob per user, versioning enabled for free rollback protection. Key structure:
```
s3://smallstash-vaults/users/{cognito-sub}/vault.json.enc
s3://smallstash-vaults/users/{cognito-sub}/keys.json   (wrapped vault keys, salts, KDF params)
```

**Encryption model (client-side only, zero-knowledge):**
1. Master password → Argon2id (memory-hard KDF) → Master Key
2. Random AES-256 Vault Key generated, encrypts actual vault contents
3. Vault Key wrapped (encrypted) by Master Key for storage
4. Separate random Recovery Key generated at signup, also wraps a copy of the Vault Key — lets user recover access if they forget their password, without giving the backend any readable data
5. Backend only ever stores/returns ciphertext

**Vault data model (v1):** KeePass-inspired fields (not KeePass file format) — Title, Username, Password, URL, Notes, Tags. Whole-vault JSON blob, encrypted client-side (AES-256-GCM) before upload. TOTP support deferred to v2.

**Client:** Progressive Web App (PWA) — single codebase for Android + desktop browser, installable, offline-capable via service worker + IndexedDB (cached ciphertext only, never plaintext).

**Multi-user:** Designed in from day 1 (Cognito user pool, S3 keyed by user ID) even though only the owner will use it initially — retrofitting this later would be painful.

**Dependencies decided (Maven, current):**
```xml
io.micronaut.serde:micronaut-serde-jackson
io.micronaut.aws:micronaut-function-aws-api-proxy
software.amazon.awssdk:s3
io.micronaut.security:micronaut-security-jwt   (optional — depends on API Gateway type, see below)
io.micronaut.testresources:micronaut-test-resources-localstack (test)
org.testcontainers:localstack (test)
```
No `graalvm` feature, no SnapStart-related config for now.

## Full architecture/roadmap doc
A more detailed version of all of the above (cost estimates, phased roadmap, S3 key structure diagrams) was produced earlier in this session as `smallStash-plan.md` — bring that file along too if available; this summary is the condensed/updated version reflecting the latest decisions (Maven, no SnapStart).

## Known open items / risks flagged so far
- **SnapStart tradeoffs** (if revisited later): don't generate salts/nonces/IVs during Lambda init — regenerate per-request, since a resumed snapshot reuses the same frozen state across invocations. Also: SnapStart only works on published Lambda versions (not `$LATEST`), so CI/CD needs a publish-version step.
- **API Gateway type not yet decided** (HTTP API vs REST API) — this determines whether `micronaut-security-jwt` is needed in the Lambda at all. If using HTTP API's native Cognito JWT authorizer, invalid tokens are rejected before the Lambda runs, so in-function validation is optional/defense-in-depth only.

---

## Interview questions for the next agent to ask me

Please ask me these before writing code, so we don't build on unstated assumptions:

1. **API Gateway type** — HTTP API (simpler, cheaper, native Cognito JWT authorizer) or REST API (more features, e.g. request validation, usage plans)? This affects whether `micronaut-security-jwt` is needed in the Lambda.
2. **Cognito password vs. Master Password** — same secret with different KDF derivation paths, or two fully separate secrets the user manages? Security/UX tradeoff, needs a deliberate answer before building the signup flow.
3. **Recovery key delivery format** — downloadable file, printable code, BIP39-style word phrase, or something else? Affects the "save this now" UX at signup.
4. **Password generator scope** — is a client-side password generator in scope for v1 alongside the vault itself, or a later addition?
5. **Frontend framework** — React, Vue, vanilla JS, or something else for the PWA? Not yet decided.
6. **WASM Argon2id library choice** — which client-side Argon2id implementation to use in the browser (e.g. `argon2-browser` or an alternative), since WebCrypto doesn't natively support Argon2.
7. **Infra-as-code tool** — Terraform, AWS CDK, SAM, or manual console setup for provisioning Cognito/S3/API Gateway/Lambda?
8. **Repo/project structure** — monorepo (backend + PWA together) or separate repos?
