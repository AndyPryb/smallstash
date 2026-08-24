# smallStash — instructions for AI agents working in this repo

Read this first, every session. It's kept short on purpose — it's loaded
into context automatically, so it points at deeper docs rather than
duplicating them. Follow the links when you need detail.

## What this is

A personal, **zero-knowledge** secrets/password manager, self-hosted on
AWS as a cheap pet project (not enterprise — optimize for near-zero idle
cost and low operational burden, not scalability headroom nobody needs
yet). Backend must never be able to read secrets, not even root/AWS
itself. Full design: [docs/architecture.md](docs/architecture.md).

## Non-negotiable constraints

- **Zero-knowledge is the one invariant everything else serves.** Argon2id
  + AES-256-GCM key derivation/decryption happen **only** in the browser
  client. The backend (Lambda, S3, DynamoDB, Cognito) must never receive
  or be able to derive plaintext vault content or the Master Password —
  no exceptions, no "just for debugging." See
  [docs/architecture.md §3](docs/architecture.md#3-encryption-model-client-side-only-zero-knowledge).
- **Two independent secrets, not one:** the Cognito login password and the
  vault Master Password are deliberately separate. Never conflate them.
- **Never commit real secrets to git — not even locally, not even in a
  commit you plan to amend away.** Treat anything pasted into chat the
  same way: if a real AWS secret key ever appears in a message, rotate it
  immediately rather than treat the leak as contained.
- **Nothing is deployed to AWS yet.** `cdk bootstrap`/`cdk deploy` (or any
  AWS-account-mutating command) needs explicit user confirmation before
  running, every time — prior approval doesn't carry over to the next
  session or the next deploy.
- **Never run `git commit` (or `git push`) unless explicitly told to, for
  that specific change, right now.** Editing/writing files is fine on your
  own initiative; committing is not. An earlier "yes, commit" does **not**
  carry over to later changes in the same or a later session — ask again
  every time. If asked to "update docs" or similar without the word
  commit/push, that means edit the files and stop there.
- Prefer **CDK code changes over AWS console clicks** — the user wants
  console interaction minimized. If something was changed by hand in the
  console, that's a bug to fix in `infra/`, not a pattern to repeat.

## Repo map

```
pom.xml, src/            Micronaut backend (the Lambda) - Java 25, Maven
infra/                   AWS CDK app (Java) - defines all AWS resources.
                         Independent Maven project; only references the
                         backend's build OUTPUT (the jar), not its source.
web/                     PWA client (Svelte 5 + Vite, plain SPA - no
                         SSR/SvelteKit, see docs/decisions/0002-pwa-stack.md).
                         Own package.json, independent of the Maven builds.
                         All Argon2id/AES-256-GCM crypto lives under
                         web/src/lib/crypto/ - nowhere else, ever.
docs/architecture.md     Living design doc - system diagram, data model,
                         cost model, phased roadmap. Source of truth.
docs/decisions/          ADRs - the *why* behind non-obvious choices.
docs/todo.md             Forward-looking: deferred items, first-deploy
                         checklist, guides still owed to the user.
docs/open-questions.md   Tracks open decisions with recommended defaults.
docs/learning-notes/     User's personal explainer notes. Gitignored -
                         never stage or commit anything under this path.
docs/smallStash-session-summary.md   Historical (session 1) - superseded
                         by architecture.md where they disagree.
```

## Current status (check `git log` / `docs/architecture.md` §9 for the live version)

- Backend (`vault`, `keys`, `security`, `error`, `config` packages):
  written, compiles clean, LocalStack integration tests written but not
  yet run end-to-end here (needs Docker, unavailable in this sandbox).
- Infra (`infra/`): **deployed and live** (2026-08-23) — Cognito, DynamoDB,
  S3, Lambda, HTTP API + JWT authorizer, throttling, CORS all exist in
  account `<aws-account-id>`, region `eu-west-1`. JWT enforcement verified
  against the live API (unauthenticated request → 401), not just the
  code. Live stack outputs (API URL, pool ID, bucket name) are in
  [docs/todo.md](docs/todo.md). Redeploying: `cd infra && cdk deploy` —
  the backend jar rebuilds automatically first, no manual `mvn package`
  needed (`cdk.json`'s app command does it).
- PWA client (`web/`): **scaffolded 2026-08-23**, see
  [ADR-0002](docs/decisions/0002-pwa-stack.md). Svelte 5 + Vite SPA; login
  (Cognito SRP) + minimal vault CRUD work end-to-end against the live API.
  `npm test` (22 tests, incl. Argon2id cross-checked against `@noble/hashes`
  + an RFC 9106 vector) and `npm run build` both verified clean. Not yet
  built: signup UI, password generator, offline-unlock UI, MFA UI. Hosting
  for the built output (S3 + CloudFront, OAC-fronted) is now in
  `infra/`'s `SmallstashStack` but **not deployed** — no public URL yet.
  See [docs/todo.md](docs/todo.md) "PWA kickoff scaffold" / "PWA hosting"
  for the full list.

## Where to look for what

| Question | Look here |
|---|---|
| Why S3 *and* DynamoDB, not just one? | [docs/decisions/0001-storage-s3-vs-dynamodb.md](docs/decisions/0001-storage-s3-vs-dynamodb.md) |
| Full system design, cost model, data model | [docs/architecture.md](docs/architecture.md) |
| What's deliberately deferred and why (WAF, VPC, etc.) | [docs/todo.md](docs/todo.md) |
| What's still undecided | [docs/open-questions.md](docs/open-questions.md) |
| "Explain X again" (SRP, JWKS, ...) for the user, not code-relevant | [docs/learning-notes/README.md](docs/learning-notes/README.md) (gitignored) |

## Dev workflow cheat-sheet

```bash
# Backend: build + test (test needs Docker running - LocalStack via testcontainers)
mvn -DskipTests package        # produces target/smallstash-0.1.jar - infra/ points at this
mvn test                       # full LocalStack-backed integration tests

# Infra: compile + local synth (no AWS calls, no credentials needed)
cd infra
../mvnw compile exec:java      # equivalent to `cdk synth` without the CLI installed
# Real cdk CLI (once installed) run from infra/: cdk bootstrap / cdk deploy / cdk diff
```

- AWS CLI default profile is `smallstash-deployer` (a dedicated IAM user,
  not root/personal — see `infra/scripts/create-deployer-user.sh`),
  region `eu-west-1`.
- Security (`micronaut.security.enabled`) is **off by default** so local
  dev/tests don't need a real Cognito pool — see `application.properties`
  vs. `application-lambda.properties`.
- Rebuild the jar (`mvn package`) before every `cdk deploy` — CDK does not
  build it for you and will fail with `CannotFindAsset` on a stale/missing
  jar.

## Working agreements (learned this session, keep applying them)

- Verify library/framework API claims against real sources (compile it,
  or search docs) rather than asserting from training-data memory —
  several Micronaut AWS and CDK Java specifics turned out to have moved
  since training; guessing wrong here wastes more time than checking.
- When something can be verified locally (compile, synth, a read-only AWS
  CLI call), do that instead of asking the user to trust an assertion.
- Before staging/committing, check `git status`/`git diff` for anything
  that looks like a credential, and confirm `docs/learning-notes/` isn't
  caught by an IDE auto-add.
