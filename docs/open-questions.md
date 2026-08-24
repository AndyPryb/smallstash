# smallStash — Open questions

Tracks the questions raised across sessions, my recommended default for
each (so we don't stall on all of them at once), and status. Update this
file as answers land — move resolved ones into
[architecture.md](architecture.md) and mark `Resolved` here with a
one-line pointer.

## Resolved this session

1. **Storage: hybrid S3 + DynamoDB, per [ADR-0001](decisions/0001-storage-s3-vs-dynamodb.md).**
   **Status: Resolved — confirmed and implemented.** `smallstash-users`
   DynamoDB table (profile + KDF/key metadata) + the S3 vault bucket
   (whole-vault blob). Note the bucket is **not** named `smallstash-vaults`
   as this line long claimed — S3 names are globally unique, so CDK
   generates one and passes it to the Lambda via `SMALLSTASH_VAULT_BUCKET`.
   See architecture.md §4 and the `vault`/`keys` packages in
   `src/main/java/andriy/prybaten`.

2. **Cognito login password vs. vault Master Password.**
   **Status: Resolved — two independent secrets**, per architecture.md §5.

3. **API Gateway type.**
   **Status: Resolved — HTTP API**, payload format 2.0. Lambda entry point
   is the built-in `io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction`.
   `micronaut-security-jwt` is included as defense-in-depth (validates the
   Cognito JWT in-Lambda too, not just at the authorizer) — off by default
   (`micronaut.security.enabled=false`) until a real Cognito pool exists,
   see application.properties / application-lambda.properties.

4. **Infra-as-code tool.**
   **Status: Resolved — AWS CDK (Java)**, confirmed. New decisions made
   alongside it (SRP-only app client, MFA, dedicated deploy IAM user, CDK
   auto-wiring the Lambda security env vars) are tracked in
   [todo.md](todo.md) until the `infra/` CDK module actually lands.

5. **Master Key session persistence** (re-litigated and reaffirmed
   2026-08-23 - see architecture.md §5 for the fuller reasoning that led
   here). **Status: Resolved — two independent secrets stays as-is**
   (re-confirming #2), **plus memory-only Master Key caching for v1**:
   keep the derived Master Key in a plain JS variable for the duration of
   an active session (never written to localStorage/IndexedDB/any
   persistent store), cleared on tab close / inactivity timeout.
   **Implemented and re-verified 2026-08-24**: `session.js` holds it in a
   module-level variable with a 15-minute inactivity auto-lock; a grep of
   `web/src` confirms the only `localStorage` use is a non-secret
   `{email, sub}` for the offline-unlock flow — no key material.
   A hardware-backed persistent
   version (WebAuthn platform authenticator + PRF/largeBlob extension,
   survives a full browser restart) is a legitimate future v2 - real
   cross-browser support gaps and meaningfully more engineering, not
   worth building before v1 ships and the friction is felt in practice.

## Resolved 2026-08-23 (PWA kickoff)

7. **Frontend framework.** **Status: Resolved — Svelte 5 + Vite, plain SPA
   (deliberately not SvelteKit).** SSR would put frontend code (which
   handles the Master Password) somewhere other than the browser — see
   [ADR-0002](decisions/0002-pwa-stack.md) decision 1 for the full
   reasoning, including why the same logic rules out Next.js/Nuxt had
   React/Vue been picked instead.

8. **WASM Argon2id library.** **Status: Resolved — `hash-wasm`**, freshness
   checked 2026-08-23 (commit/download-stats comparison against
   `argon2-browser`, which turned out effectively dead, ~4.8yr since last
   commit). `@noble/hashes` added as a **test-only** cross-check against a
   published RFC 9106 vector — see [ADR-0002](decisions/0002-pwa-stack.md)
   decision 2 for the numbers and why the cross-check exists (a silent
   Argon2id output drift would make every existing vault permanently
   undecryptable).

9. **Repo structure.** **Status: Resolved — monorepo, `web/`** at the repo
   root alongside `src/`/`infra/`. See
   [ADR-0002](decisions/0002-pwa-stack.md) decision 3.

## Lower urgency (don't block backend/storage work, decide when we get there)

5. **Recovery key delivery format** — downloadable file, printable code,
   BIP39-style word phrase, or other?
   **Partially settled for v1:** `web/src/lib/crypto/recovery.js` ships a
   Crockford Base32 grouped code (e.g. `XXXX-XXXX-...`), not BIP39, as a
   pragmatic v1 answer — no extra wordlist dependency, still
   human-transcribable, ambiguous characters (I/L/O/U) excluded by
   construction. Re-opening this later requires care: a recovery key the
   user has already written down has to keep working forever, so treat this
   as frozen the moment any real vault relies on it. See that file's header
   comment.

6. **Password generator scope.** **Status: Resolved — included in v1**, as
   leaned. `web/src/lib/generator.js` +
   `web/src/lib/components/PasswordGeneratorPanel.svelte` (2026-08-23) — see
   [docs/todo.md](todo.md) "PWA kickoff scaffold" for implementation detail.

## Correlations worth keeping in mind

- Q1 (storage) and Q3 (API Gateway type) interact: the `sub` claim is
  exactly the value used as both the DynamoDB PK and the S3 key prefix, so
  how it's established is what makes the authorization model in
  architecture.md §5 sound.
  **Correction (2026-08-24):** an earlier version of this bullet said the
  authorizer means the Lambda "can trust `sub` from the request context
  without re-verifying the token." That misdescribes what the code does and
  would be dangerous to act on. The Lambda **does** re-verify, via
  `micronaut-security-jwt`, and `CurrentUser.subOf()` reads
  `authentication.getName()` from *that* verification — not from the
  authorizer's request context. The two layers are deliberately
  independent (defence in depth); don't "simplify" by removing the
  in-Lambda one on the theory that the authorizer already covered it.
- Q2 (independent secrets) and Q1 (DynamoDB `KEYS` item) interact: since
  KDF salts/params now live in DynamoDB rather than a second S3 object,
  changing the Master Password (independent of Cognito password) means
  updating one DynamoDB item, not re-uploading a `keys.json` object —
  slightly simpler "change master password" flow either way.
- Q9 (monorepo) makes Q4 (CDK in Java) more attractive: infra code,
  backend, and (if monorepo) frontend build config all live in one
  place with one CI pipeline to reason about.
