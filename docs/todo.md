# smallStash — TODO / parked notes

Things raised in conversation that are decided-but-not-built, or
deliberately deferred. Check items off / delete them as they land instead
of leaving them stale.

## Built (infra/ CDK module - compiled + synthesized locally, NOT deployed)

- [x] **SRP-only Cognito app client.** No `ALLOW_USER_PASSWORD_AUTH`
      fallback — test via Hosted UI's OAuth2 flow instead (guide still
      owed, see below).
- [x] **TOTP MFA**, optional, on the Cognito user pool (login step only -
      independent of the vault's own Argon2id/Master Password crypto).
- [x] **CDK sets `MICRONAUT_SECURITY_ENABLED=true`, `COGNITO_JWKS_URL`,
      `MICRONAUT_ENVIRONMENTS=lambda`, and the bucket/table names** as
      Lambda env vars automatically, derived from the resources the same
      stack creates — not a manually-remembered toggle. Still worth
      eyeballing after the first real deploy (see checklist below).
- [x] **HTTP API throttling** — explicit low limit (rate 10/s, burst 20) as
      cheap worst-case-cost insurance given real usage is a handful of
      requests every few days. AWS's much higher account-level default
      throttle stays in place regardless; this is a deliberately tighter
      one on top of it, not a replacement for anything.
- [x] **CORS** — `HttpApi` CORS preflight configured, currently allowing
      `http://localhost:5173` (placeholder) — **must be updated to the
      real PWA origin once it has a domain**, before that matters for
      real use.
- [ ] **Dedicated IAM user for `aws configure`/CDK deploys** - script
      provided in chat (CloudShell, run as root once). PowerUserAccess +
      a custom policy scoping IAM role/policy management to
      `smallstash-*`/`cdk-*` resource names (not blanket `AdministratorAccess`)
      — genuinely tighter than "just use admin," but PowerUserAccess is
      still broad by nature; revisit tightening further once the stack's
      real resource set is stable. No console password/MFA on this user —
      it's programmatic-only (CLI/CI), MFA doesn't fit a headless credential.
      **You still need to actually run the script.**

## First-deploy checklist (don't forget, even though CDK should make this automatic)

- [ ] Run `mvn -DskipTests package` in the repo root first — CDK's Lambda
      asset points at `../target/smallstash-0.1.jar`, CDK does not build it
      for you, and `cdk deploy` will fail with `CannotFindAsset` if it's
      missing or stale.
- [ ] Run the IAM deployer-user script (below) and `aws configure` with its
      keys before the first `cdk bootstrap`/`cdk deploy`.
- [ ] Confirm `MICRONAUT_SECURITY_ENABLED=true` actually landed on the
      deployed Lambda's env vars after the first `cdk deploy`.
- [ ] Confirm `COGNITO_JWKS_URL` resolves and isn't the old unset/placeholder
      value.
- [ ] Hit a protected route with **no** token and confirm 401, not a leak.

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
