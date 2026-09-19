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
- **The stack is DECOMMISSIONED as of 2026-09-19.** `cdk destroy` ran
  cleanly and every AWS resource is gone — stack, Cognito pool, DynamoDB
  table, all three buckets, and the CDK bootstrap that supported them. It
  *was* live from 2026-08-23 to 2026-09-19 with real users, so anything
  below written in the present tense about deployed resources is history,
  not current state. Standing this back up means `cdk bootstrap` **and**
  `cdk deploy` from scratch, and every resource gets new identifiers.
  `cdk bootstrap`/`cdk deploy`/`cdk destroy` (or any AWS-account-mutating
  command) still needs explicit user confirmation before running, **every
  time** — prior approval doesn't carry over to the next deploy or the next
  session. Read-only AWS CLI calls (`describe-*`, `get-*`, `list-*`) are
  fine without asking.
- **All three data resources are `RemovalPolicy.DESTROY`, permanently —
  this is a standing decision (2026-08-25), not a pre-production
  placeholder.** RETAIN was evaluated and rejected: on `cdk destroy` it
  leaves resources orphaned rather than deleted, and getting them back
  under stack management is its own project — S3/DynamoDB support
  CloudFormation resource import, Cognito User Pools do not (a known,
  longstanding AWS gap), so RETAIN wouldn't even have delivered full
  recovery. **Accepted risk, stated plainly**: once real secrets are
  stored here, a `cdk destroy` — accidental or deliberate — permanently
  deletes every vault, no recovery path. The DynamoDB `KEYS` item (the
  wrapped Vault Key) is the sharper edge of that: it's a single copy, so
  losing it makes every S3 vault version permanently undecryptable even
  though S3 itself is versioned. If this risk tolerance ever changes,
  `deletionProtection(true)` on the table and pool is the lighter-weight
  guard to reach for — blocks the delete outright, no orphan-recovery
  complexity — not RETAIN.
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
pom.xml                 Reactor aggregator only (packaging=pom) - no source
                         of its own. `mvn package` here builds every module
                         below in one invocation.
common/                  Shared Java lib - CurrentUser, ResourceNotFound*
                         (docs/file-storage-plan.md sec 3a). Not a Lambda
                         deployment artifact itself.
vault-lambda/            Micronaut backend (the vault/keys Lambda) - Java 25,
                         Maven. Was the repo-root project before the
                         multi-module restructuring (2026-08-27); package
                         names unchanged, only its module location moved.
files-lambda/            Micronaut backend (the files Lambda) - Java 25,
                         Maven, sibling to vault-lambda, added 2026-08-27
                         (docs/file-storage-plan.md). Own S3 bucket, own IAM
                         role with zero DynamoDB/vault-bucket access, same
                         HttpApi + Cognito authorizer as vault-lambda.
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

- Backend (`vault`/`keys`/`config` in `vault-lambda`, `security`/`error` in
  `common`): written, compiles clean. **Docker/LocalStack is NOT reachable
  from this sandbox, confirmed 2026-08-29** - correcting a wrong claim this
  file made as recently as 2026-08-27 ("`./mvnw test` reaches the real
  Docker engine"). That claim was itself a false positive: `./mvnw test`
  passing was never proof LocalStack was used, because when Micronaut Test
  Resources' LocalStack redirect fails, the AWS SDK silently falls back to
  real AWS with real ambient credentials - and the *same* test assertions
  pass either way, since the CRUD operations behave identically against
  real S3/DynamoDB. Confirmed directly, not inferred: live SDK request
  logging showed 100% of test requests hitting the real
  `*.amazonaws.com` endpoint across repeated runs, and `docker`/`where
  docker` find nothing on this shell's `PATH` in either direction. A
  `LocalStackGuard` (test-scope only, both modules) now fails every
  LocalStack-backed test loudly at startup if no LocalStack endpoint
  override is present, rather than silently proceeding against real AWS -
  so **these tests currently fail here**, correctly, until Docker becomes
  reachable in whatever environment runs them. See docs/todo.md's
  2026-08-29 entry for the full investigation.
- Infra (`infra/`): **deployed and live** (2026-08-25, in-place update to
  the same stack — `SmallstashStack` ARN, pool ID `eu-west-1_<pool-id>`,
  API URL, and bucket names all unchanged from the "Live stack outputs" in
  [docs/todo.md](docs/todo.md); `.env` there is current). **The entire
  security review (Phases 0–3) plus MFA removal, the CSP enforcing flip,
  the offline-boot fix, and the null-bug friendlier message are all live**
  — verified post-deploy, not assumed: `Content-Security-Policy` header is
  the real enforcing one (not `-Report-Only`), Cognito `MfaConfiguration:
  OFF`, and all 5 registered users (`andystarrrr`, `bogdanbw`,
  `prybaten-demo`, `vrivnalu4`, `classeakmain`) survived the deploy
  untouched (`CONFIRMED`, in-place update as `cdk diff` predicted — no
  data loss, no downtime).
- One deploy attempt failed first and is worth knowing about if it
  recurs: CloudFront rejects `Content-Security-Policy` set via a custom
  header (`customHeadersBehavior`) — that literal name is reserved for
  `securityHeadersBehavior.contentSecurityPolicy`, the field it now uses.
  Confirmed against AWS's own CloudFormation example. The stack rolled
  back cleanly (`UPDATE_ROLLBACK_COMPLETE`) with zero impact before the
  fix landed.
- Redeploying: `cd infra && cdk deploy` — the backend jar rebuilds
  automatically first (`cdk.json`'s app command), but **`npm run build` in
  `web/` is still manual** and CDK uploads whatever `web/dist` holds.
- PWA client (`web/`): **built and deployed**, see
  [ADR-0002](docs/decisions/0002-pwa-stack.md). Svelte 5 + Vite SPA on
  S3 + CloudFront (OAC-fronted); login (Cognito SRP), signup, vault CRUD,
  password generator, offline unlock, change-Master-Password, and
  inactivity auto-lock all exist. No MFA — deliberately, permanently not
  built (decided 2026-08-25, not deferred): the Master Password is the
  real second factor, and a lost/stolen phone doesn't have it either — see
  architecture.md §5. `npm test` (**97 tests**, incl. Argon2id
  cross-checked against `@noble/hashes` + an RFC 9106 vector) and
  `npm run build` verified clean. Much of the UI has only ever been
  verified by unit test + build, **not by a real browser run-through** —
  see [docs/todo.md](docs/todo.md) for the per-feature list of what's
  still manually unverified.
- Security review Phases 0–3 (Cognito Plus/threat protection,
  `preventUserExistenceErrors`, 7-day refresh tokens, in-Lambda `iss`/`aud`
  JWT validation, least-privilege Lambda IAM, localhost dropped from prod
  CORS, a Lambda-invocation-spike alarm → SNS email, and a Budgets Action
  cost kill switch on a CDK-owned `smallstash-app` budget) are **all
  deployed and live** as of 2026-08-25. The SNS alert email's confirmation
  link has been clicked, so the alarm/kill switch actually notify.
- ⚠️ **`web/e2e/offline-unlock.spec.js` still carries a `test.fail()`
  annotation from before the offline-boot fix was deployed** - now that
  the fix is live, this needs re-running against the live URL; if it
  passes for real, remove the annotation. Not yet done as of this note -
  first thing worth doing next session. Same idea for
  `security-headers.spec.js`'s CSP-enforcing check and
  `change-login-password.spec.js`'s friendly-message check - both should
  now pass live where they didn't before deploy; worth a full
  `npx playwright test` run to confirm all 16 are genuinely green, not
  just assumed from this session's individual checks.
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
| Static analysis (Semgrep, OWASP Dependency-Check) - local-only, by design | [docs/static-analysis.md](docs/static-analysis.md) |

## Dev workflow cheat-sheet

```bash
# Backend: build + test (test needs Docker running - LocalStack via testcontainers)
# Run from the repo root - it's a reactor aggregator (see Repo map above),
# so this builds common/, vault-lambda/, and files-lambda/ in one invocation.
mvn -DskipTests package        # produces vault-lambda/target/vault-lambda-0.1.jar and
                                # files-lambda/target/files-lambda-0.1.jar - infra/ points at both
mvn test                       # full LocalStack-backed integration tests, all modules

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

- **Neither `docker info` nor `./mvnw test` passing proves Docker/LocalStack
  is reachable - a claim this file itself got wrong twice.** First
  (2026-08-27): asserted `docker info` failing meant Docker was unavailable,
  when the real issue was just the bare `docker` CLI missing from this
  shell's `PATH`. That got "corrected" to "`./mvnw test` passing proves it
  works" - which turned out to be wrong too (2026-08-29): when Micronaut
  Test Resources' LocalStack redirect silently fails, the AWS SDK falls
  back to real AWS, and the same tests still pass against real
  S3/DynamoDB with real ambient credentials - a false positive, not proof
  of anything. The only reliable check now: a `LocalStackGuard` in both
  backend modules' test sources fails the build loudly if a client bean
  has no LocalStack endpoint override. If `mvn test` fails with that exact
  message, Docker/LocalStack genuinely isn't reachable - trust that
  failure, don't explain it away.
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
