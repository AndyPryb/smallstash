# smallStash — TODO / parked notes

Things raised in conversation that are decided-but-not-built, or
deliberately deferred. Check items off / delete them as they land instead
of leaving them stale.

## Full teardown capability - `destroyData` context flag (2026-08-23)

`SmallstashStack.java` reads a CDK context flag to decide the
`RemovalPolicy` on the 3 data-bearing resources (S3 vault bucket,
DynamoDB table, Cognito pool) - **defaults to `RETAIN` (safe)**, only
switches to `DESTROY` (+ `autoDeleteObjects` on the bucket) when passed
explicitly:

```bash
cdk deploy -c destroyData=true   # bakes DeletionPolicy=Delete into the
                                  # resources from creation
cdk destroy                      # from then on, deletes everything in
                                  # one command - no flag needed again,
                                  # CloudFormation remembers the policy
                                  # from the last deploy, not fresh code
```

Verified both directions actually change `DeletionPolicy` in the
synthesized template (`Retain` by default, `Delete` with the flag) -
not just assumed from the code.

- [ ] **Flip back to the safe default (redeploy without the flag) before
      this ever holds real, non-test data.** Not automatic - has to be a
      deliberate `cdk deploy` (no `-c destroyData=true`) to restore
      `RETAIN` once it matters. Easy to forget since nothing forces it.

## What's built

See [architecture.md §9/§9b](architecture.md#9-implementation-status) for
the current, authoritative list of what's built vs. deployed — not
duplicated here to avoid the two drifting out of sync. Short version: all
backend code + the full CDK infra definition are written, locally
verified, **and deployed** (see below) — just no PWA client yet.

The deployer IAM user (`smallstash-deployer`) **is** created and is the
active AWS CLI default profile — `infra/scripts/create-deployer-user.sh`
already run. Its scoping caveat still applies, see "Guides owed" below.

## First deploy — done (2026-08-23)

Deployed via `cdk deploy` (SmallstashStack, 21/21 resources,
`CREATE_COMPLETE`, 91.92s). `infra/cdk.json`'s app command now rebuilds
the backend jar automatically before every `cdk` command that
synthesizes, so a stale/missing jar is no longer a manual thing to
remember (see architecture.md §9b for the exact command).

Post-deploy checklist - all verified against the live stack, not just
assumed from the code:

- [x] Deployer IAM user created and set as the AWS CLI default profile
      (`smallstash-deployer`, region `eu-west-1`).
- [x] `MICRONAUT_SECURITY_ENABLED=true` confirmed on the deployed Lambda's
      env vars (`aws lambda get-function-configuration`).
- [x] `COGNITO_JWKS_URL` resolves to the real pool (see current pool id
      below - re-verified after the full recreate), not the old placeholder.
- [x] `GET /vault` with no token → **401** `{"message":"Unauthorized"}`,
      not a leak, not a 500.
- [x] DynamoDB table `ACTIVE`, S3 vault bucket reachable, Cognito pool
      exists with `MfaConfiguration: OPTIONAL` as designed.

Live stack outputs (account `<aws-account-id>`, region `eu-west-1`) - **updated
2026-08-23 after a `cdk destroy` (manual, orphans included) +
`cdk deploy -c destroyData=true` full recreate — every ID below is new,
the ones from the first deploy no longer exist**:
```
ApiUrl            = https://<api-id>.execute-api.eu-west-1.amazonaws.com
UserPoolId        = eu-west-1_<pool-id>
UserPoolClientId  = es8shgod8c4glft5nrn1hennc
VaultBucketName   = smallstashstack-vaultbucket95cbf29a-jxpgfio6ua7w
```

## Manual test user (2026-08-23) — stand-in, not the real signup flow

Created via `admin-create-user` + `admin-set-user-password --permanent`
(bypasses email verification entirely - fine for a one-off manual test
account, **wrong for real users**). See architecture.md §9 for why this
isn't the real flow: the PWA must use the actual self-service `SignUp` +
`ConfirmSignUp` APIs instead.

**Recreated 2026-08-23** in the fresh pool after the full teardown/rebuild
above - same email/password as before, new `sub` (new pool = new identity,
even with identical credentials):
```
email (sign-in alias) = test@example.com
password               = <TEST_USER_PASSWORD - do not commit, see your own local notes>
sub (real identity)    = 2275b414-90e1-704f-8271-e318f8ced185
```

- [ ] Replace/remove this manual user once the PWA has a real signup flow
      - it's a test artifact, not meant to be long-lived.

## Account-level safety nets (already in place, outside CDK/this repo)

Confirmed 2026-08-23, so a future session doesn't re-raise these as gaps:

- [x] **Console MFA** enabled on the personal (`Andy`) AWS account - the
      biggest single lever against full account compromise, outside
      anything smallStash itself controls.
- [x] **Two AWS Budget alerts** configured (verified via
      `aws budgets describe-budgets`): "My Monthly Cost Budget" ($15) and
      "My Zero-Spend Budget" ($1 - given this project's expected real
      cost is ~$0, this one will catch almost any unexpected activity
      fast, not just a large spike). Neither is part of the CDK stack -
      account-level, set up independently.

Combined with the Lambda execution role's tight scoping (verified via
`cdk diff` - no EC2/compute-launch permissions, only CloudWatch Logs +
this project's own DynamoDB table + S3 bucket), the realistic "AWS
account hijacked for crypto-mining" risk is reasonably well bounded for
a personal project at this scale.

## PWA: offline access to key material - open design gap (2026-08-23)

`docs/architecture.md` says the PWA caches vault **ciphertext** in
IndexedDB for offline use, but never addresses whether the `keys` data
(salt, KDF params, wrapped Vault Key) is cached locally too. Without it,
true offline unlock isn't possible: even with a cached vault blob,
opening it requires `GET /keys` first, which needs network + a valid JWT
- so "offline-capable" currently only half-works.

- [ ] **Decide and implement: cache the wrapped key material locally too**
      (e.g. IndexedDB, alongside the vault ciphertext), so the vault can
      be unlocked with no network at all, not just re-read while offline.
      Same security property either way - it's still wrapped/encrypted,
      caching it locally doesn't expose anything caching it server-side
      doesn't already. Needs the same "ciphertext only, never plaintext"
      rule applied - cache `wrappedVaultKeyByMaster`/`wrappedVaultKeyByRecovery`/
      salt/params, never the derived Master Key or unwrapped Vault Key.
- [ ] **Staleness handling**: if the Master Password changes (new
      `keyVersion`, per the earlier password-change discussion), a stale
      cached wrapped key on another device needs to be detected and
      refreshed once back online - use `keyVersion` to detect this rather
      than silently using outdated cached key material.

## Profile feature - not functionally wired up yet (2026-08-23)

`UserProfileItem`/`UserProfile` exist as a schema, but two of its three
fields don't do anything yet:

- [ ] **`storageBytesUsed` is never updated.** Set to `0` at creation
      (`createProfileIfAbsent`) and never touched again - `PUT /vault`
      writes the new blob to S3 but doesn't update this field. To make it
      real: after a successful S3 write in `VaultController.put()`,
      update the DynamoDB `PROFILE` item with the new ciphertext's byte
      length. Note the design tension this creates: `vault` and `keys`
      are currently deliberately independent packages (see the earlier
      "why is DynamoDbUserKeysRepository separate from S3VaultRepository"
      discussion) - wiring this means either `VaultController` taking a
      dependency on `UserKeysRepository`, or some other decoupled
      mechanism (e.g. an S3 event trigger recalculating usage
      asynchronously - more moving parts, avoids the coupling).
- [ ] **`plan` is hardcoded to `"free"` and nothing reads it.** No
      plan-based limits, no tiers, no logic anywhere depends on this
      value - it's pure scaffolding right now.
- [ ] **No `GET /profile` endpoint exists at all** - nothing lets a user
      (or the PWA) actually see their own profile data today, even the
      one field (`createdAt`) that *is* accurate.
- [ ] **Open question worth asking before building any of this**: does a
      personal/small-scale pet project actually need a plan/tier system
      at all? Given the project framing ("not enterprise," see
      architecture.md top), a full multi-tier plan feature may be
      overkill - worth deciding the real scope (maybe just "show me my
      join date and storage used," no tiers/limits) before implementing
      rather than building out `plan` further by default.

## Deferred - revisit later, not blocking anything now

- [ ] **AWS WAF** - rate-based rules, IP reputation, basic bot protection.
      Real monthly cost (~$5+/mo minimum + per-request) - reconsider once/if
      actual abuse is observed, not preemptively for a solo-user app.
- [ ] **VPC / private networking for the Lambda** - deliberately left
      questionable. Wrong shape for a public multi-device API as currently
      scoped; revisit only if a concrete reason shows up later.
- [ ] **AWS Shield Advanced** - enterprise-grade, expensive, not justified
      at this scale. Shield *Standard* is already on for free automatically
      for every API Gateway endpoint.
- [ ] **Cognito Advanced Security Features** (paid add-on: compromised-credential
      checks, adaptive auth) - skip for now, personal-scale traffic doesn't
      justify it.

## Postman collection (2026-08-23) — auth shortcut reverted, see below

`postman/smallstash.postman_collection.json` + paired
`postman/smallstash.postman_environment.json` - import both, select the
environment, then get a token (see below) and paste it into the
environment's `access_token` variable.

- [x] **`.adminUserPassword(true)` reverted in code** (2026-08-23) -
      `SmallstashStack.java` is back to SRP-only on the app client, the
      intended production end-state. Verified via `cdk synth`:
      `ExplicitAuthFlows` is now just `['ALLOW_USER_SRP_AUTH',
      'ALLOW_REFRESH_TOKEN_AUTH']`. **Not deployed yet** - the currently
      *live* pool still has `ALLOW_ADMIN_USER_PASSWORD_AUTH` until the
      next `cdk deploy`.
- [ ] **Consequence once this actually deploys: the `admin-initiate-auth`
      token command below stops working**, and so does the Postman
      collection's pre-request auto-reuse (nothing to reuse once you
      can't mint a token this way anymore). This was a deliberate
      tradeoff, not an oversight - reverting to SRP-only was chosen over
      continued Postman convenience once the goal shifted to
      production-readiness for the PWA. Future manual API testing needs
      either the Hosted UI + OAuth2-in-Postman guide below, or a real
      SRP-capable client (the PWA itself, once it exists).
- [x] (Historical, while the admin flow was still live) Token command
      used during this session - IDs from the 2026-08-23 full recreate:
      ```
      aws cognito-idp admin-initiate-auth \
        --user-pool-id eu-west-1_<pool-id> \
        --client-id es8shgod8c4glft5nrn1hennc \
        --auth-flow ADMIN_USER_PASSWORD_AUTH \
        --auth-parameters USERNAME=test@example.com,PASSWORD='<TEST_USER_PASSWORD - do not commit, see your own local notes>' \
        --region eu-west-1
      ```
- [x] **Smart reuse, not blind re-fetch or blind resend** (still in the
      collection, harmless once the admin flow is gone - it'll just
      always report "missing/expired" and point at a command that no
      longer works, which is at least an honest failure mode): a
      collection-level pre-request script decodes the cached token's own
      `exp` claim and reuses it silently while valid.
- [ ] **Fuller automation was considered, not built**: the pre-request
      script could have minted tokens itself with zero manual steps, by
      additionally enabling the *public* (non-admin) `ALLOW_USER_PASSWORD_AUTH`
      flow and calling Cognito's plain `InitiateAuth` API directly via
      `pm.sendRequest()` - moot now that the auth-flow reduction went the
      other direction (removing admin access rather than adding another
      flow). Leaving this note for context, not as something to still do.
- [ ] Real Hosted UI + OAuth2-in-Postman guide (below) is still the
      more production-realistic path, worth doing once the PWA exists -
      the `admin-initiate-auth` shortcut above is a testing convenience,
      not a replacement for it.

## Guides owed to you (ask when ready, not needed yet)

- [ ] How to turn on Cognito **Hosted UI** and configure Postman's OAuth 2.0
      auth tab against it (authorization-code grant) for manual API testing
      against the real deployed stack.
- [ ] Tightening the deploy IAM user's policy beyond the initial broad grant,
      once the CDK stack's actual resource set is stable.
- [ ] Moving CI/CD off the static access-key IAM user onto GitHub Actions
      OIDC federation (short-lived, no long-lived keys sitting in repo
      secrets) once CI/CD is actually set up — the access-key user is a
      fine starting point, not the long-term answer for automated deploys.
