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
- **The stack IS deployed** (since 2026-08-23 — an earlier version of this
  line said otherwise and was wrong). `cdk bootstrap`/`cdk deploy`/`cdk
  destroy` (or any AWS-account-mutating command) still needs explicit user
  confirmation before running, **every time** — prior approval doesn't
  carry over to the next deploy or the next session. Read-only AWS CLI
  calls (`describe-*`, `get-*`, `list-*`) are fine without asking.
- **No real secrets are stored yet, and one thing gates that.** All three
  data resources are `RemovalPolicy.DESTROY` on purpose, so the
  destroy/recreate loop stays cheap while this is pre-production. **Flip
  them to `RETAIN` + deletion protection before the first real secret goes
  in** — inline `!! MUST FLIP TO RETAIN !!` comments mark all three spots
  in `SmallstashStack.java`. This matters more than it looks: the S3 vault
  blob is versioned, but the DynamoDB `KEYS` item (the wrapped Vault Key)
  is a single copy — lose it and every vault version becomes permanently
  undecryptable.
- **`cdk` commands need `SMALLSTASH_INVITE_CODE` set in the gitignored
  repo-root `.env`.** Signup is invite-gated by a PreSignUp Lambda trigger,
  and the synth **hard-fails** without a code rather than deploying an
  ungated signup endpoint. If a synth dies with `No invite code
  configured`, that's this — not a broken build. Never hardcode the value
  in `SmallstashStack.java`, and never echo it into chat/tool output.
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
- Infra (`infra/`): **currently NOT deployed.** `SmallstashStack` is
  `DELETE_COMPLETE` (verified 2026-08-24) — deliberately torn down between
  pre-production iterations, which is what the DESTROY removal policy is
  for. It *was* live 2026-08-23 and the design is proven (JWT enforcement
  verified against the real API, unauthenticated → 401), but nothing runs
  right now. ⚠️ **Every "live stack output" in
  [docs/todo.md](docs/todo.md) and in `.env` is dead** — pool id, client
  id, API URL, bucket names all vanished with the stack. Refresh them from
  `aws cloudformation describe-stacks` after the next deploy; stale `.env`
  values have already caused one confusing "you're offline" incident.
- Redeploying: `cd infra && cdk deploy` — the backend jar rebuilds
  automatically first (`cdk.json`'s app command), but **`npm run build` in
  `web/` is still manual** and CDK uploads whatever `web/dist` holds.
- ⚠️ **The whole security review is committed but has never been
  deployed** — every phase below exists only in the repo.
- PWA client (`web/`): **built and deployed**, see
  [ADR-0002](docs/decisions/0002-pwa-stack.md). Svelte 5 + Vite SPA on
  S3 + CloudFront (OAC-fronted); login (Cognito SRP), signup, vault CRUD,
  password generator, offline unlock, MFA UI, change-Master-Password, and
  inactivity auto-lock all exist. `npm test` (**97 tests**, incl. Argon2id
  cross-checked against `@noble/hashes` + an RFC 9106 vector) and
  `npm run build` verified clean. Much of the UI has only ever been
  verified by unit test + build, **not by a real browser run-through** —
  see [docs/todo.md](docs/todo.md) for the per-feature list of what's
  still manually unverified.
- Security review Phases 2–3 (2026-08-24, **not deployed**): CloudFront
  security headers + strict CSP, a `javascript:` URL XSS fix (`45ccec5`),
  `.github/dependabot.yml`, Cognito Plus/threat protection,
  `preventUserExistenceErrors`, 7-day refresh tokens, in-Lambda `iss`/`aud`
  JWT validation, least-privilege Lambda IAM, localhost dropped from prod
  CORS, a Lambda-invocation-spike alarm → SNS email, and a Budgets Action
  cost kill switch on a CDK-owned `smallstash-app` budget (auto-attaches an
  S3/DynamoDB Deny to the **Lambda execution role** — root and
  `smallstash-deployer` stay untouched; recovery is detaching the policy,
  no redeploy).
- ⚠️ **Two things look done but aren't, and both fail quietly:** the CSP
  ships as **`Content-Security-Policy-Report-Only`** (logs violations,
  blocks nothing) until the header is renamed; and the SNS alert email
  needs its **AWS confirmation link clicked** or the alarm notifies nobody.
- 🚫 **Do not set `Mfa.REQUIRED`.** It looks like a one-line flip and is
  not: `web/` has no TOTP *enrolment* flow, so Cognito's `MFA_SETUP`
  challenge would hang `signIn` and lock out every user. See
  [docs/todo.md](docs/todo.md).
- Not yet built anywhere: CI (no workflow runs `mvn test` / `npm test`),
  Svelte component tests, browser/E2E tests (deliberately deferred until
  the security phases land — see [docs/todo.md](docs/todo.md)).

## Where to look for what

| Question | Look here |
|---|---|
| Why S3 *and* DynamoDB, not just one? | [docs/decisions/0001-storage-s3-vs-dynamodb.md](docs/decisions/0001-storage-s3-vs-dynamodb.md) |
| Full system design, cost model, data model | [docs/architecture.md](docs/architecture.md) |
| What's deliberately deferred and why (WAF, VPC, etc.) | [docs/todo.md](docs/todo.md) |
| Security review: findings, what's fixed, what's owed | [docs/todo.md](docs/todo.md) § "Security review 2026-08-24" |
| Why WAF/fail2ban/CrowdSec aren't used here | [docs/todo.md](docs/todo.md) § "Brute-force / IP-blocking research" |
| Threat model, auth/authorization mechanics, cost-abuse controls | [docs/architecture.md §4a/§4b/§5/§6](docs/architecture.md) |
| What's still undecided | [docs/open-questions.md](docs/open-questions.md) |
| "Explain X again" (SRP, JWKS, ...) for the user, not code-relevant | [docs/learning-notes/README.md](docs/learning-notes/README.md) (gitignored) |

## Dev workflow cheat-sheet

```bash
# Backend: build + test (test needs Docker running - LocalStack via testcontainers)
mvn -DskipTests package        # produces target/smallstash-0.1.jar - infra/ points at this
mvn test                       # full LocalStack-backed integration tests

# Frontend: test + build (from web/)
npm test                       # 97 tests, node:test, no browser needed
npm run build                  # must run before `cdk deploy` - CDK uploads web/dist

# Infra: compile + local synth (no AWS calls, no credentials needed)
cd infra
CDK_OUTDIR=cdk.out ../mvnw compile exec:java   # `cdk synth` without the CLI
# Real cdk CLI (once installed) run from infra/: cdk bootstrap / cdk deploy / cdk diff
```

- **`CDK_OUTDIR` is load-bearing for the local synth.** Without it the
  command "succeeds" but silently writes no `cdk.out/`, so there's nothing
  to inspect and it looks like it worked.
- **The synth needs `SMALLSTASH_INVITE_CODE` in the repo-root `.env`** (see
  the constraint above). `No invite code configured` is that, not a broken
  build.
- **Verify the synthesized template, don't just trust the CDK source.**
  Reading `cdk.out/SmallstashStack.template.json` is how several claims in
  this repo turned out to be wrong — e.g. `autoDeleteObjects` silently
  defeating a `RETAIN` policy. `DeletionPolicy`, `LifecycleConfiguration`,
  `PointInTimeRecoverySpecification`, and `LambdaConfig` are all worth
  eyeballing after touching them.

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

- **Security claims especially need verifying, not asserting.** Several
  plausible-sounding "facts" turned out to be wrong when checked during the
  2026-08-24 review: AWS WAF can't attach to an API Gateway HTTP API (v2)
  at all; WAF's ATP/ACFP rule groups are forbidden on Cognito user pools;
  Cognito's failed-login lockout exists but is **not configurable**; WAF
  rate-based rules have a 100-request floor, so "block after 10 failures"
  is impossible to express. Check the docs before recommending a control —
  a security recommendation that can't actually be implemented wastes more
  time than admitting uncertainty.
- **Distinguish identifiers from credentials.** The Cognito pool id and
  client id are published in the PWA's `config.json` on purpose and are in
  the JS bundle regardless — hiding them fixes nothing. When something
  looks like an exposure, check whether it's actually secret before
  proposing to hide it, and fix the real control instead (here: gating
  registration).
- Verify library/framework API claims against real sources (compile it,
  or search docs) rather than asserting from training-data memory —
  several Micronaut AWS and CDK Java specifics turned out to have moved
  since training; guessing wrong here wastes more time than checking.
- When something can be verified locally (compile, synth, a read-only AWS
  CLI call), do that instead of asking the user to trust an assertion.
- Before staging/committing, check `git status`/`git diff` for anything
  that looks like a credential, and confirm `docs/learning-notes/` isn't
  caught by an IDE auto-add.
