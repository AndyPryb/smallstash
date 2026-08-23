# smallStash

A personal, zero-knowledge secrets/password manager, self-hosted on AWS as
a cheap pet project. The backend can never read your secrets — not even
root/AWS itself; all encryption/decryption happens client-side.

**Status: pre-alpha.** Backend (Micronaut/Lambda) and infrastructure
(CDK) are written and verified locally. **Nothing is deployed to AWS yet**,
and the PWA client hasn't been started. See
[docs/architecture.md](docs/architecture.md) §9 for the exact current
state.

**Start here:**
- [CLAUDE.md](CLAUDE.md) — the short version: constraints, repo map, dev
  commands, doc index. Read this first if you're picking this project up
  cold (human or AI).
- [docs/architecture.md](docs/architecture.md) — full system design, data
  model, cost model, roadmap.
- [docs/decisions/0001-storage-s3-vs-dynamodb.md](docs/decisions/0001-storage-s3-vs-dynamodb.md) — ADRs explaining *why*, not just what.

## Repo layout

```
pom.xml, src/     Micronaut backend (the Lambda itself) - Java 25, Maven
infra/            AWS CDK app (Java) - defines every AWS resource
docs/             Architecture, decisions, open questions, TODOs
```

## Quick start

```bash
# Backend
mvn -DskipTests package    # builds target/smallstash-0.1.jar (infra/ points at this)
mvn test                   # LocalStack-backed integration tests - needs Docker running

# Infra (local synth only - no AWS calls, no credentials needed)
cd infra
../mvnw compile exec:java
```

Real deploys (`cdk bootstrap` / `cdk deploy`) touch a real AWS account and
are deliberately not run casually — see [docs/todo.md](docs/todo.md)
"first-deploy checklist" first.

## Handler

Handler: `io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction`
(built into `micronaut-function-aws-api-proxy` — routes HTTP API events,
payload format 2.0, to the `@Controller` classes in `andriy.prybaten.vault`
/ `andriy.prybaten.keys`. There's no hand-written handler class in this
repo; see [docs/architecture.md](docs/architecture.md) §2/§9.)

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
