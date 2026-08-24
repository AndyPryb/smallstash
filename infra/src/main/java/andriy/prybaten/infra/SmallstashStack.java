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
import software.amazon.awscdk.services.cloudfront.BehaviorOptions;
import software.amazon.awscdk.services.cloudfront.Distribution;
import software.amazon.awscdk.services.cloudfront.ErrorResponse;
import software.amazon.awscdk.services.cloudfront.PriceClass;
import software.amazon.awscdk.services.cloudfront.ViewerProtocolPolicy;
import software.amazon.awscdk.services.cloudfront.origins.S3BucketOrigin;
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
import software.amazon.awscdk.services.s3.deployment.BucketDeployment;
import software.amazon.awscdk.services.s3.deployment.Source;
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

        // Always DESTROY - deliberate choice while this stack is 100% dev/test
        // (see docs/todo.md "Full teardown"). No real user data lives here
        // yet, so `cdk destroy` should tear down cleanly with no orphaned
        // S3/DynamoDB/Cognito resources left behind to hunt down manually.
        // This used to be a `destroyData` context flag defaulting to RETAIN -
        // switch it back to that pattern (or hardcode RETAIN) before this
        // ever holds real, non-test data; see docs/todo.md for the tradeoffs.
        RemovalPolicy dataRemovalPolicy = RemovalPolicy.DESTROY;

        // ---------------------------------------------------------------
        // Storage (docs/decisions/0001-storage-s3-vs-dynamodb.md)
        // ---------------------------------------------------------------

        // Bucket name is CDK-generated (not hardcoded) - S3 names are globally
        // unique across all of AWS, so we let CDK pick one and pass it to the
        // Lambda via env var instead of risking a collision with a name we
        // guessed.
        Bucket vaultBucket = Bucket.Builder.create(this, "VaultBucket")
                .versioned(true)
                .encryption(BucketEncryption.S3_MANAGED)
                .blockPublicAccess(BlockPublicAccess.BLOCK_ALL)
                .removalPolicy(dataRemovalPolicy)
                .autoDeleteObjects(true)
                .build();

        // DynamoDB table names are only unique per account+region, so a fixed
        // name is safe here. This is the KDF salt/wrapped-key metadata every
        // login depends on.
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
        // PWA hosting (web/dist -> S3, fronted by CloudFront)
        //
        // Bucket holds only the built static site (HTML/JS/CSS/wasm) - not
        // user data, so it's always DESTROY/auto-delete regardless of what
        // dataRemovalPolicy above is set to: losing it loses nothing but a
        // `npm run build` + redeploy. Fully private (BLOCK_ALL) - CloudFront
        // reaches it via Origin Access Control (OAC), never a public bucket
        // policy.
        Bucket siteBucket = Bucket.Builder.create(this, "SiteBucket")
                .encryption(BucketEncryption.S3_MANAGED)
                .blockPublicAccess(BlockPublicAccess.BLOCK_ALL)
                .removalPolicy(RemovalPolicy.DESTROY)
                .autoDeleteObjects(true)
                .build();

        // SPA routing fix: client-side routes like /vault/entry/42 have no
        // matching S3 key, so a refresh on one 403s (bucket is private, no
        // "key doesn't exist" distinction reaches CloudFront as 404) -
        // rewrite both 403 and 404 to /index.html so the app's own router
        // handles the path instead of the user seeing a raw S3 error.
        Distribution distribution = Distribution.Builder.create(this, "SiteDistribution")
                .defaultBehavior(BehaviorOptions.builder()
                        .origin(S3BucketOrigin.withOriginAccessControl(siteBucket))
                        .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
                        .build())
                .defaultRootObject("index.html")
                .errorResponses(List.of(
                        ErrorResponse.builder()
                                .httpStatus(403)
                                .responseHttpStatus(200)
                                .responsePagePath("/index.html")
                                .build(),
                        ErrorResponse.builder()
                                .httpStatus(404)
                                .responseHttpStatus(200)
                                .responsePagePath("/index.html")
                                .build()))
                // Cheapest tier (US/Canada/Europe edge locations only) - fine
                // for a ~20-user personal app, see docs/architecture.md cost
                // model. PRICE_CLASS_ALL would add edge locations nobody here
                // is close to, for extra cost.
                .priceClass(PriceClass.PRICE_CLASS_100)
                .build();

        // Uploads web/dist on every `cdk deploy` and invalidates the
        // CloudFront cache so the new build is visible immediately (no
        // waiting out the default TTL). Needs `npm run build` (in web/) run
        // first, same as the backend jar needs `mvn package` first - CDK
        // does not build either for you and fails with an asset-not-found
        // error on a stale/missing web/dist.
        //
        // Excludes config.json: `npm run build` writes a dev-only copy of it
        // (from the local .env) so `npm run preview` works standalone, but
        // the deployed site must only ever get the one ConfigDeployment
        // writes below, from this stack's actual live values - otherwise
        // whichever of the two BucketDeployments happens to run last would
        // silently decide which one wins.
        BucketDeployment.Builder.create(this, "SiteDeployment")
                .sources(List.of(Source.asset("../web/dist")))
                .destinationBucket(siteBucket)
                .exclude(List.of("config.json"))
                .distribution(distribution)
                .distributionPaths(List.of("/*"))
                .build();

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
                // Real PWA origin (this CloudFront distribution) plus
                // localhost:5173 for local `npm run dev`. The distribution's
                // domain name is a CloudFormation token resolved at deploy
                // time within this same stack, so no manual step is needed
                // once a real custom domain replaces it (see docs/todo.md).
                .corsPreflight(CorsPreflightOptions.builder()
                        .allowOrigins(List.of(
                                "http://localhost:5173",
                                "https://" + distribution.getDistributionDomainName()))
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

        // Generates the runtime config.json the deployed PWA fetches at
        // startup (src/lib/config.js) - written from this stack's actual
        // resolved values, not baked into the JS bundle at `npm run build`
        // time. This is what lets a full stack recreate (new pool/client/API
        // IDs) take effect on the live site without ever needing a frontend
        // rebuild - see docs/todo.md "PWA build/deploy gotcha" for the
        // incident this replaced. Deliberately a second, separate
        // BucketDeployment from SiteDeployment above (not one more Source in
        // that list) purely because these values - httpApi's endpoint in
        // particular - aren't available until HttpApi is constructed further
        // down in this file than SiteDeployment is; order doesn't otherwise
        // matter since SiteDeployment explicitly excludes this same key.
        // prune(false) is load-bearing, not decoration: BucketDeployment
        // defaults to prune=true, i.e. `aws s3 sync --delete` against
        // whatever it's given as its source. With two separate
        // BucketDeployments sharing one bucket, ConfigDeployment's source is
        // only ever this one file - left at the default, its own delete pass
        // treats every other file SiteDeployment uploaded (the JS bundle,
        // icons, etc.) as "not mine, delete it". Confirmed this actually
        // happened live: two files silently vanished from the deployed
        // bucket, which is what "site loads to a blank page" turned out to
        // be - a CloudFront SPA-fallback 200 (text/html) for the missing JS
        // module instead of the real file. SiteDeployment doesn't need this
        // - it's meant to fully mirror web/dist (minus config.json, via
        // .exclude above).
        BucketDeployment.Builder.create(this, "ConfigDeployment")
                .sources(List.of(Source.jsonData("config.json", Map.of(
                        "region", this.getRegion(),
                        "userPoolId", userPool.getUserPoolId(),
                        "clientId", userPoolClient.getUserPoolClientId(),
                        "apiBaseUrl", httpApi.getApiEndpoint()))))
                .destinationBucket(siteBucket)
                .prune(false)
                .distribution(distribution)
                .distributionPaths(List.of("/config.json"))
                .build();

        // ---------------------------------------------------------------
        // Outputs
        // ---------------------------------------------------------------

        CfnOutput.Builder.create(this, "ApiUrl").value(httpApi.getApiEndpoint()).build();
        CfnOutput.Builder.create(this, "UserPoolId").value(userPool.getUserPoolId()).build();
        CfnOutput.Builder.create(this, "UserPoolClientId").value(userPoolClient.getUserPoolClientId()).build();
        CfnOutput.Builder.create(this, "VaultBucketName").value(vaultBucket.getBucketName()).build();
        CfnOutput.Builder.create(this, "SiteUrl")
                .value("https://" + distribution.getDistributionDomainName())
                .build();
    }
}
