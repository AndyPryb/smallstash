package andriy.prybaten.infra;

import software.amazon.awscdk.CfnOutput;
import software.amazon.awscdk.Duration;
import software.amazon.awscdk.RemovalPolicy;
import software.amazon.awscdk.Stack;
import software.amazon.awscdk.StackProps;
import software.amazon.awscdk.aws_apigatewayv2_authorizers.HttpUserPoolAuthorizer;
import software.amazon.awscdk.aws_apigatewayv2_authorizers.HttpUserPoolAuthorizerProps;
import software.amazon.awscdk.aws_apigatewayv2_integrations.HttpLambdaIntegration;
import software.amazon.awscdk.services.apigatewayv2.AddRoutesOptions;
import software.amazon.awscdk.services.apigatewayv2.CorsHttpMethod;
import software.amazon.awscdk.services.apigatewayv2.CorsPreflightOptions;
import software.amazon.awscdk.services.apigatewayv2.HttpApi;
import software.amazon.awscdk.services.apigatewayv2.HttpMethod;
import software.amazon.awscdk.services.apigatewayv2.HttpStage;
import software.amazon.awscdk.services.apigatewayv2.ThrottleSettings;
import software.amazon.awscdk.services.cognito.AccountRecovery;
import software.amazon.awscdk.services.cognito.AuthFlow;
import software.amazon.awscdk.services.cognito.AutoVerifiedAttrs;
import software.amazon.awscdk.services.cognito.Mfa;
import software.amazon.awscdk.services.cognito.MfaSecondFactor;
import software.amazon.awscdk.services.cognito.PasswordPolicy;
import software.amazon.awscdk.services.cognito.SignInAliases;
import software.amazon.awscdk.services.cognito.UserPool;
import software.amazon.awscdk.services.cognito.UserPoolClient;
import software.amazon.awscdk.services.cognito.UserPoolClientOptions;
import software.amazon.awscdk.services.dynamodb.Attribute;
import software.amazon.awscdk.services.dynamodb.AttributeType;
import software.amazon.awscdk.services.dynamodb.BillingMode;
import software.amazon.awscdk.services.dynamodb.Table;
import software.amazon.awscdk.services.lambda.Code;
import software.amazon.awscdk.services.lambda.Function;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.s3.BlockPublicAccess;
import software.amazon.awscdk.services.s3.Bucket;
import software.amazon.awscdk.services.s3.BucketEncryption;
import software.constructs.Construct;

import java.util.List;
import java.util.Map;

/**
 * Everything from docs/architecture.md in one CDK stack: DynamoDB
 * (profile + KDF/wrapped-key metadata, ADR-0001), S3 (whole-vault
 * ciphertext blob), Cognito (SRP-only + optional TOTP MFA, docs/todo.md),
 * Lambda (the Micronaut jar), and HTTP API fronted by a native Cognito JWT
 * authorizer.
 *
 * Deliberately NOT run yet - see docs/todo.md "first-deploy checklist"
 * before ever running {@code cdk deploy} against a real account.
 */
public class SmallstashStack extends Stack {

    public SmallstashStack(final Construct scope, final String id) {
        this(scope, id, null);
    }

    public SmallstashStack(final Construct scope, final String id, final StackProps props) {
        super(scope, id, props);

        // Opt-in escape hatch for a genuine full teardown (dev/test convenience -
        // docs/todo.md). Defaults to false = RETAIN (safe). Only takes effect
        // after a `cdk deploy -c destroyData=true` (updates the deployed
        // resources' DeletionPolicy in place) - THEN `cdk destroy` actually
        // deletes them. CloudFormation deletes based on the deployed template's
        // stored DeletionPolicy, not a fresh local synth, so `cdk destroy` alone
        // (without deploying this flag first) still respects RETAIN regardless
        // of what this code says. Never leave this true once real user data exists.
        boolean destroyData = "true".equals(String.valueOf(this.getNode().tryGetContext("destroyData")));
        RemovalPolicy dataRemovalPolicy = destroyData ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

        // ---------------------------------------------------------------
        // Storage (docs/decisions/0001-storage-s3-vs-dynamodb.md)
        // ---------------------------------------------------------------

        // Bucket name is CDK-generated (not hardcoded) - S3 names are globally
        // unique across all of AWS, so we let CDK pick one and pass it to the
        // Lambda via env var instead of risking a collision with a name we
        // guessed. RETAIN by default: losing this bucket loses every user's
        // vault - `cdk destroy` must never take it out from under you by
        // accident. autoDeleteObjects only activates alongside DESTROY (S3
        // won't delete a non-empty bucket otherwise; this must match
        // dataRemovalPolicy or CDK refuses to synth).
        Bucket vaultBucket = Bucket.Builder.create(this, "VaultBucket")
                .versioned(true)
                .encryption(BucketEncryption.S3_MANAGED)
                .blockPublicAccess(BlockPublicAccess.BLOCK_ALL)
                .removalPolicy(dataRemovalPolicy)
                .autoDeleteObjects(destroyData)
                .build();

        // DynamoDB table names are only unique per account+region, so a fixed
        // name is safe here. Same RETAIN-by-default reasoning as the bucket -
        // this is the KDF salt/wrapped-key metadata every login depends on.
        Table usersTable = Table.Builder.create(this, "UsersTable")
                .tableName("smallstash-users")
                .partitionKey(Attribute.builder().name("pk").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("sk").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(dataRemovalPolicy)
                .build();

        // ---------------------------------------------------------------
        // Auth (Cognito) - docs/todo.md: SRP-only, TOTP MFA optional
        // ---------------------------------------------------------------

        UserPool userPool = UserPool.Builder.create(this, "UserPool")
                .userPoolName("smallstash-users")
                .selfSignUpEnabled(true)
                .signInAliases(SignInAliases.builder().email(true).build())
                .autoVerify(AutoVerifiedAttrs.builder().email(true).build())
                .accountRecovery(AccountRecovery.EMAIL_ONLY)
                .mfa(Mfa.OPTIONAL)
                .mfaSecondFactor(MfaSecondFactor.builder().otp(true).sms(false).build())
                .passwordPolicy(PasswordPolicy.builder()
                        .minLength(12)
                        .requireLowercase(true)
                        .requireUppercase(true)
                        .requireDigits(true)
                        .requireSymbols(true)
                        .build())
                .removalPolicy(dataRemovalPolicy)
                .build();

        // SRP only, no other auth flow - the production end state. Real
        // clients (the PWA) test via Cognito Hosted UI's OAuth2 flow, which
        // does SRP internally, not a shortcut around it. `.adminUserPassword(true)`
        // was here temporarily for manual testing without implementing SRP
        // client-side (see docs/todo.md) - reverted now that the target is
        // automated JS tests using a real SRP-capable client library instead.
        // generateSecret(false): this is a public client (browser PWA), it
        // can't keep a client secret confidential.
        UserPoolClient userPoolClient = userPool.addClient("WebClient", UserPoolClientOptions.builder()
                .authFlows(AuthFlow.builder()
                        .userSrp(true)
                        .build())
                .generateSecret(false)
                .build());

        // ---------------------------------------------------------------
        // Lambda
        // ---------------------------------------------------------------

        Function backend = Function.Builder.create(this, "BackendFunction")
                .functionName("smallstash-backend")
                .runtime(Runtime.JAVA_25)
                .handler("io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction")
                // Built by `mvn package` in the repo root - see docs/architecture.md
                // sec 9. Re-run that before every deploy; CDK doesn't build it for you.
                .code(Code.fromAsset("../target/smallstash-0.1.jar"))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                .environment(Map.of(
                        "SMALLSTASH_VAULT_BUCKET", vaultBucket.getBucketName(),
                        "SMALLSTASH_USERS_TABLE", usersTable.getTableName(),
                        "MICRONAUT_ENVIRONMENTS", "lambda",
                        "MICRONAUT_SECURITY_ENABLED", "true",
                        "COGNITO_JWKS_URL", userPool.getUserPoolProviderUrl() + "/.well-known/jwks.json"))
                .build();

        vaultBucket.grantReadWrite(backend);
        usersTable.grantReadWriteData(backend);

        // ---------------------------------------------------------------
        // HTTP API (docs/architecture.md sec 2) - native Cognito JWT
        // authorizer in front, so an invalid/expired token never even
        // reaches the Lambda. micronaut-security-jwt re-checks it in-Lambda
        // too (defense in depth, see application-lambda.properties).
        // ---------------------------------------------------------------

        HttpUserPoolAuthorizer authorizer = new HttpUserPoolAuthorizer("CognitoAuthorizer", userPool,
                HttpUserPoolAuthorizerProps.builder()
                        .userPoolClients(List.of(userPoolClient))
                        .build());

        HttpLambdaIntegration integration = new HttpLambdaIntegration("BackendIntegration", backend);

        HttpApi httpApi = HttpApi.Builder.create(this, "HttpApi")
                .apiName("smallstash-api")
                .createDefaultStage(false)
                .defaultAuthorizer(authorizer)
                // TODO: replace with the real PWA origin once it has a domain -
                // see docs/todo.md. localhost:5173 is a Vite-style local dev default.
                .corsPreflight(CorsPreflightOptions.builder()
                        .allowOrigins(List.of("http://localhost:5173"))
                        .allowMethods(List.of(CorsHttpMethod.GET, CorsHttpMethod.PUT, CorsHttpMethod.OPTIONS))
                        .allowHeaders(List.of("Authorization", "Content-Type"))
                        .build())
                .build();

        httpApi.addRoutes(AddRoutesOptions.builder()
                .path("/vault")
                .methods(List.of(HttpMethod.GET, HttpMethod.PUT))
                .integration(integration)
                .build());

        httpApi.addRoutes(AddRoutesOptions.builder()
                .path("/keys")
                .methods(List.of(HttpMethod.GET, HttpMethod.PUT))
                .integration(integration)
                .build());

        // Explicit low throttle as cheap worst-case-cost insurance (real usage
        // is a handful of requests every few days - see docs/todo.md). AWS's
        // account-level default (thousands of req/s) is a much higher ceiling
        // that stays in place regardless; this is a deliberately tighter one.
        HttpStage.Builder.create(this, "DefaultStage")
                .httpApi(httpApi)
                .autoDeploy(true)
                .throttle(ThrottleSettings.builder()
                        .rateLimit(10)
                        .burstLimit(20)
                        .build())
                .build();

        // ---------------------------------------------------------------
        // Outputs
        // ---------------------------------------------------------------

        CfnOutput.Builder.create(this, "ApiUrl").value(httpApi.getApiEndpoint()).build();
        CfnOutput.Builder.create(this, "UserPoolId").value(userPool.getUserPoolId()).build();
        CfnOutput.Builder.create(this, "UserPoolClientId").value(userPoolClient.getUserPoolClientId()).build();
        CfnOutput.Builder.create(this, "VaultBucketName").value(vaultBucket.getBucketName()).build();
    }
}
