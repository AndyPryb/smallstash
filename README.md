# smallStash

A personal, zero-knowledge password and secrets manager, built and run on AWS.

The server never sees plaintext. Argon2id key derivation and AES-256-GCM
encryption happen entirely in the browser, so the backend — Lambda, S3,
DynamoDB, Cognito, and AWS itself — only ever stores ciphertext it has no
means to read. Losing the Master Password means losing the data; that is the
design, not a gap in it.

> **Status: decommissioned.** This ran as a live deployment with a small
> group of real users from 2026-08-23 to 2026-09-19, when the stack was
> deliberately destroyed and every AWS resource removed. The code, the
> architecture decisions, and the full debugging history remain here as a
> record of the work. Any AWS identifiers still referenced in the docs point
> at resources that no longer exist.

## What it demonstrates

The service list is ordinary — Lambda, API Gateway, S3, DynamoDB, Cognito,
CloudFront, all defined in CDK. The parts worth reading are the ones where
AWS did not behave as expected and the reasoning had to change:

| Topic | Where |
|---|---|
| SnapStart enabled, measured, and reverted — restore got faster, total latency did not | [docs/todo.md](docs/todo.md) § "Lambda SnapStart" |
| A CloudFormation circular dependency that local `cdk synth` structurally cannot catch | [infra/…/SmallstashStack.java](infra/src/main/java/andriy/prybaten/infra/SmallstashStack.java) (CSP section) |
| Why S3 returns 403 rather than 404 for a missing key, and the outage it caused | [docs/todo.md](docs/todo.md) § "Live `s3:ListBucket AccessDenied`" |
| AWS SDK v2 has no presigned-POST support, and why the signing was not hand-rolled | [files-lambda/…/FilesController.java](files-lambda/src/main/java/andriy/prybaten/files/FilesController.java) |
| Integration tests silently passing against real AWS instead of LocalStack | [docs/todo.md](docs/todo.md) § "`./mvnw test` was silently hitting real AWS" |
| A written security review: threat model, findings, and four controls that turned out to be impossible | [docs/todo.md](docs/todo.md) § "Security review" |
| Why S3 *and* DynamoDB rather than one of them | [ADR-0001](docs/decisions/0001-storage-s3-vs-dynamodb.md) |

## Security model

Two independent secrets, deliberately never conflated: the **Cognito login
password** authenticates to the API, and the **Master Password** decrypts the
vault. The backend can verify the first and is structurally incapable of
learning the second.

- Argon2id (`hash-wasm`, cross-checked against `@noble/hashes` and an RFC 9106
  test vector) derives a Master Key in-browser; it unwraps a Vault Key that
  never leaves the client.
- Cognito SRP for login, with threat protection and an invite-gated signup
  trigger. No MFA — a deliberate decision, since the Master Password is
  already a second factor a stolen device does not have.
- Least-privilege IAM: the files Lambda has *zero* access to the vault bucket
  or user table, enforced by having its own execution role rather than a
  narrowly scoped shared one.
- Enforcing Content-Security-Policy, HSTS, and an S3 origin reachable only via
  CloudFront Origin Access Control.
- Cost controls as a security concern: per-request size caps, API stage
  throttling, log retention limits, and an AWS Budgets Action that attaches a
  Deny policy to both Lambda roles if spend crosses a threshold.

Full detail: [docs/architecture.md](docs/architecture.md) §3–§6.

## Repo layout

```
pom.xml           Reactor aggregator - builds every module below in one invocation
common/           Shared library: CurrentUser, error handling
vault-lambda/     Vault + keys API (Micronaut, Java 25)
files-lambda/     File attachments API - separate Lambda, separate IAM role
infra/            AWS CDK app (Java) - every AWS resource is defined here
web/              PWA client (Svelte 5 + Vite). All crypto lives in web/src/lib/crypto/
docs/             Architecture, ADRs, security review, and the full working log
```

## Building

```bash
# Backend - from the repo root (it is a reactor aggregator)
mvn -DskipTests package   # -> vault-lambda/target/vault-lambda-0.1.jar
                          #    files-lambda/target/files-lambda-0.1.jar
mvn test                  # LocalStack-backed integration tests; needs Docker running

# Frontend - from web/
npm test                  # 97 tests, node:test, no browser required
npm run build             # produces web/dist

# Infra - local synth only, no AWS calls and no credentials needed
cd infra
CDK_OUTDIR=cdk.out ../mvnw compile exec:java
```

`CDK_OUTDIR` is load-bearing: without it the command succeeds but silently
writes no `cdk.out/`. The synth also requires `SMALLSTASH_INVITE_CODE` to be
set (see `.env.example`) — it fails deliberately rather than produce a stack
with an ungated signup endpoint.

The integration tests fail fast, by design, if Docker/LocalStack is not
reachable. An earlier version of the suite passed against real AWS without
saying so; a startup guard now makes that impossible.

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System design, data model, threat model, cost model |
| [docs/decisions/](docs/decisions/) | ADRs — the reasoning behind non-obvious choices |
| [docs/todo.md](docs/todo.md) | The working log: incidents, root causes, reversed decisions, security review |
| [docs/file-storage-plan.md](docs/file-storage-plan.md) | Design and phased delivery of file attachments |
| [CLAUDE.md](CLAUDE.md) | Project constraints and conventions, written for AI agents |

`docs/todo.md` is a genuine working log rather than polished prose. It is kept
because the record of what went wrong — and which confident claims turned out
to be false — is more useful than a tidied-up version would be.

## How this was built

This project was co-authored end to end with an AI coding agent (Claude Code):
architecture, implementation, and the debugging sessions recorded in the docs.
[CLAUDE.md](CLAUDE.md) is the instruction file that agent worked from, kept in
the repo as part of the record.

## License

[MIT](LICENSE).

---

<details>
<summary>Generated Micronaut project links (from Micronaut Launch)</summary>

## Micronaut 5.1.0 Documentation

- [User Guide](https://docs.micronaut.io/5.1.0/guide/index.html)
- [API Reference](https://docs.micronaut.io/5.1.0/api/index.html)
- [Configuration Reference](https://docs.micronaut.io/5.1.0/guide/configurationreference.html)
- [Micronaut Guides](https://guides.micronaut.io/index.html)
- [Micronaut Maven Plugin documentation](https://micronaut-projects.github.io/micronaut-maven-plugin/latest/)
- [Micronaut Amazon API Gateway REST API documentation](https://micronaut-projects.github.io/micronaut-aws/latest/guide/index.html#amazonApiGateway)
- [Micronaut AWS Lambda Function documentation](https://micronaut-projects.github.io/micronaut-aws/latest/guide/index.html#lambda)
- [Micronaut Serialization Jackson Core documentation](https://micronaut-projects.github.io/micronaut-serialization/latest/guide/)
- [Micronaut AWS Lambda Events Serde documentation](https://micronaut-projects.github.io/micronaut-aws/snapshot/guide/#eventsLambdaSerde)

</details>
