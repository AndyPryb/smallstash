## Micronaut 5.1.0 Documentation

- [User Guide](https://docs.micronaut.io/5.1.0/guide/index.html)
- [API Reference](https://docs.micronaut.io/5.1.0/api/index.html)
- [Configuration Reference](https://docs.micronaut.io/5.1.0/guide/configurationreference.html)
- [Micronaut Guides](https://guides.micronaut.io/index.html)
---

## Handler

Handler: `io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction`
(built into `micronaut-function-aws-api-proxy` — routes HTTP API events,
payload format 2.0, to the `@Controller` classes in `andriy.prybaten.vault`
/ `andriy.prybaten.keys`. There's no hand-written handler class in this
repo; see docs/architecture.md §2/§9.)

[AWS Lambda Handler](https://docs.aws.amazon.com/lambda/latest/dg/java-handler.html)

## Local development

- `mvn test` runs the repository integration tests against LocalStack
  (via micronaut-test-resources) — **requires Docker running locally.**
- Auth is off by default (`micronaut.security.enabled=false`) so `mvn test`
  / `mn:run` don't need a real Cognito pool. See
  `src/main/resources/application-lambda.properties` for what a real
  deployment must set.
- Full architecture, storage design, and decision log: see `docs/`,
  starting with `docs/architecture.md`.

- [Micronaut Maven Plugin documentation](https://micronaut-projects.github.io/micronaut-maven-plugin/latest/)
## Feature maven-enforcer-plugin documentation


- [https://maven.apache.org/enforcer/maven-enforcer-plugin/](https://maven.apache.org/enforcer/maven-enforcer-plugin/)


## Feature amazon-api-gateway documentation


- [Micronaut Amazon API Gateway REST API documentation](https://micronaut-projects.github.io/micronaut-aws/latest/guide/index.html#amazonApiGateway)


- [https://docs.aws.amazon.com/apigateway/](https://docs.aws.amazon.com/apigateway/)


## Feature aws-lambda documentation


- [Micronaut AWS Lambda Function documentation](https://micronaut-projects.github.io/micronaut-aws/latest/guide/index.html#lambda)


## Feature serialization-jackson documentation


- [Micronaut Serialization Jackson Core documentation](https://micronaut-projects.github.io/micronaut-serialization/latest/guide/)


## Feature aws-lambda-events-serde documentation


- [Micronaut AWS Lambda Events Serde documentation](https://micronaut-projects.github.io/micronaut-aws/snapshot/guide/#eventsLambdaSerde)


- [https://github.com/aws/aws-lambda-java-libs/tree/main/aws-lambda-java-events](https://github.com/aws/aws-lambda-java-libs/tree/main/aws-lambda-java-events)


## Feature snapstart documentation


- [https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)


