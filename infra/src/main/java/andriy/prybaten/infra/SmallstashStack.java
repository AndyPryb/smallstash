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
import software.amazon.awscdk.services.apigatewayv2.CfnStage;
import software.amazon.awscdk.services.apigatewayv2.CorsHttpMethod;
import software.amazon.awscdk.services.apigatewayv2.CorsPreflightOptions;
import software.amazon.awscdk.services.apigatewayv2.HttpApi;
import software.amazon.awscdk.services.apigatewayv2.HttpMethod;
import software.amazon.awscdk.services.apigatewayv2.HttpStage;
import software.amazon.awscdk.services.apigatewayv2.ThrottleSettings;
import software.amazon.awscdk.services.cloudwatch.Alarm;
import software.amazon.awscdk.services.cloudwatch.ComparisonOperator;
import software.amazon.awscdk.services.cloudwatch.MetricOptions;
import software.amazon.awscdk.services.cloudwatch.TreatMissingData;
import software.amazon.awscdk.services.cloudwatch.actions.SnsAction;
import software.amazon.awscdk.services.cognito.AccountRecovery;
import software.amazon.awscdk.services.cognito.AuthFlow;
import software.amazon.awscdk.services.cognito.AutoVerifiedAttrs;
import software.amazon.awscdk.services.cognito.FeaturePlan;
import software.amazon.awscdk.services.cognito.Mfa;
import software.amazon.awscdk.services.cognito.MfaSecondFactor;
import software.amazon.awscdk.services.cognito.PasswordPolicy;
import software.amazon.awscdk.services.cognito.SignInAliases;
import software.amazon.awscdk.services.cognito.StandardThreatProtectionMode;
import software.amazon.awscdk.services.cognito.UserPool;
import software.amazon.awscdk.services.cognito.UserPoolClient;
import software.amazon.awscdk.services.cognito.UserPoolClientOptions;
import software.amazon.awscdk.services.cognito.UserPoolTriggers;
import software.amazon.awscdk.services.cloudfront.BehaviorOptions;
import software.amazon.awscdk.services.cloudfront.Distribution;
import software.amazon.awscdk.services.cloudfront.ErrorResponse;
import software.amazon.awscdk.services.cloudfront.HeadersFrameOption;
import software.amazon.awscdk.services.cloudfront.HeadersReferrerPolicy;
import software.amazon.awscdk.services.cloudfront.PriceClass;
import software.amazon.awscdk.services.cloudfront.ResponseCustomHeader;
import software.amazon.awscdk.services.cloudfront.ResponseCustomHeadersBehavior;
import software.amazon.awscdk.services.cloudfront.ResponseHeadersContentTypeOptions;
import software.amazon.awscdk.services.cloudfront.ResponseHeadersFrameOptions;
import software.amazon.awscdk.services.cloudfront.ResponseHeadersPolicy;
import software.amazon.awscdk.services.cloudfront.ResponseHeadersReferrerPolicy;
import software.amazon.awscdk.services.cloudfront.ResponseHeadersStrictTransportSecurity;
import software.amazon.awscdk.services.cloudfront.ResponseSecurityHeadersBehavior;
import software.amazon.awscdk.services.cloudfront.ViewerProtocolPolicy;
import software.amazon.awscdk.services.cloudfront.origins.S3BucketOrigin;
import software.amazon.awscdk.services.dynamodb.Attribute;
import software.amazon.awscdk.services.dynamodb.AttributeType;
import software.amazon.awscdk.services.dynamodb.BillingMode;
import software.amazon.awscdk.services.dynamodb.PointInTimeRecoverySpecification;
import software.amazon.awscdk.services.dynamodb.Table;
import software.amazon.awscdk.services.lambda.Code;
import software.amazon.awscdk.services.lambda.Function;
import software.amazon.awscdk.services.iam.PolicyStatement;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.logs.LogGroup;
import software.amazon.awscdk.services.logs.RetentionDays;
import software.amazon.awscdk.services.sns.Topic;
import software.amazon.awscdk.services.sns.subscriptions.EmailSubscription;
import software.amazon.awscdk.services.s3.BlockPublicAccess;
import software.amazon.awscdk.services.s3.Bucket;
import software.amazon.awscdk.services.s3.BucketEncryption;
import software.amazon.awscdk.services.s3.LifecycleRule;
import software.amazon.awscdk.services.s3.deployment.BucketDeployment;
import software.amazon.awscdk.services.s3.deployment.Source;
import software.constructs.Construct;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
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

        // DESTROY *only* while this stack still holds nothing but test data.
        // Deliberate: the stack gets destroyed/recreated frequently during
        // development, and RETAIN turns every cycle into a manual cleanup of
        // orphaned resources (worse with a fixed table name - the next deploy
        // fails outright because `smallstash-users` already exists).
        //
        // !! MUST FLIP TO RETAIN BEFORE THE FIRST REAL SECRET IS STORED !!
        // This was briefly RETAIN (security review finding H-3) and was
        // reverted on purpose to keep the pre-production destroy/recreate loop
        // cheap. Tracked in docs/todo.md - "Full teardown capability" and the
        // security review's Phase 0 section both carry the reminder.
        //
        // Why it matters more than "we'd lose the test vaults": the S3 blob is
        // versioned, so it has some rollback protection, but the DynamoDB KEYS
        // item (the wrapped Vault Key) is a single copy. Lose that and every
        // surviving S3 version is permanently undecryptable ciphertext.
        RemovalPolicy dataRemovalPolicy = RemovalPolicy.DESTROY;

        // ---------------------------------------------------------------
        // Storage (docs/decisions/0001-storage-s3-vs-dynamodb.md)
        // ---------------------------------------------------------------

        // Bucket name is CDK-generated (not hardcoded) - S3 names are globally
        // unique across all of AWS, so we let CDK pick one and pass it to the
        // Lambda via env var instead of risking a collision with a name we
        // guessed.
        //
        // autoDeleteObjects pairs with DESTROY above - a versioned bucket
        // can't be deleted while it still has object versions in it, so
        // without this every `cdk destroy` fails halfway. Drop it at the same
        // time dataRemovalPolicy flips to RETAIN.
        Bucket vaultBucket = Bucket.Builder.create(this, "VaultBucket")
                .versioned(true)
                .encryption(BucketEncryption.S3_MANAGED)
                .blockPublicAccess(BlockPublicAccess.BLOCK_ALL)
                .removalPolicy(dataRemovalPolicy)
                .autoDeleteObjects(true)
                // Versioning means every save keeps the previous blob forever
                // unless something expires it. Without this rule, normal use
                // grows storage without bound, and an abusive client can grow
                // it fast (see VaultController.MAX_CIPHERTEXT_BYTES, the other
                // half of that control). Keeps the 3 most recent superseded
                // versions as a manual "restore yesterday's vault" path
                // regardless of age, and expires anything older than 90 days
                // beyond those.
                .lifecycleRules(List.of(LifecycleRule.builder()
                        .id("ExpireOldVaultVersions")
                        .enabled(true)
                        .noncurrentVersionExpiration(Duration.days(90))
                        .noncurrentVersionsToRetain(3)
                        .abortIncompleteMultipartUploadAfter(Duration.days(7))
                        .build()))
                .build();

        // DynamoDB table names are only unique per account+region, so a fixed
        // name is safe here. This is the KDF salt/wrapped-key metadata every
        // login depends on - add `.deletionProtection(true)` here at the same
        // time dataRemovalPolicy flips to RETAIN (see above); it's omitted for
        // now only because it blocks the destroy/recreate loop.
        Table usersTable = Table.Builder.create(this, "UsersTable")
                .tableName("smallstash-users")
                .partitionKey(Attribute.builder().name("pk").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("sk").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                // Point-in-time recovery: continuous backups, restorable to
                // any second in the last 35 days. Priced per GB of table size,
                // and this table holds a few hundred bytes per user, so it is
                // effectively free here. Worth it because this table is the
                // asymmetry in the data model - the S3 vault blob is versioned,
                // the wrapped Vault Key in here is a single copy, and losing it
                // makes every surviving vault version permanently
                // undecryptable. This is the only thing that would let a
                // fat-fingered write or a bad deploy be undone.
                .pointInTimeRecoverySpecification(PointInTimeRecoverySpecification.builder()
                        .pointInTimeRecoveryEnabled(true)
                        .build())
                .removalPolicy(dataRemovalPolicy)
                .build();

        // ---------------------------------------------------------------
        // Auth (Cognito) - docs/todo.md: SRP-only, TOTP MFA optional
        // ---------------------------------------------------------------

        // The invite code gating self-signup. Deliberately NOT hardcoded in
        // this file: it's a shared secret handed out to real people, and
        // CLAUDE.md's "never commit real secrets" applies to it like anything
        // else. Normal path is SMALLSTASH_INVITE_CODE in the repo-root .env
        // (gitignored, same file the test config already lives in). The synth
        // fails loudly if it's missing rather than falling back to a default -
        // a default invite code shipping by accident is exactly the hole this
        // mechanism exists to close.
        String inviteCode = resolveInviteCode();

        // Rejects any SignUp whose validationData doesn't carry the current
        // invite code. Inline Node rather than a second Maven module: it's ~20
        // lines with no dependencies, and a Java Lambda's cold start would add
        // seconds to every signup for no benefit.
        //
        // Deliberately lets PreSignUp_AdminCreateUser through untouched -
        // admin-create-user already requires IAM credentials, so gating it on
        // an invite code adds nothing and would break it as a manual fallback
        // (it can't send validationData).
        Function preSignUp = Function.Builder.create(this, "PreSignUpFunction")
                .functionName("smallstash-presignup")
                .runtime(Runtime.NODEJS_22_X)
                .handler("index.handler")
                .code(Code.fromInline("""
                        exports.handler = async (event) => {
                          if (event.triggerSource === 'PreSignUp_AdminCreateUser') return event;

                          const expected = process.env.INVITE_CODE;
                          const provided = event.request?.validationData?.inviteCode;
                          if (!expected) throw new Error('Signup is unavailable right now.');
                          if (typeof provided !== 'string' || provided.length !== expected.length) {
                            throw new Error('That invite code is not valid.');
                          }
                          let diff = 0;
                          for (let i = 0; i < expected.length; i++) {
                            diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
                          }
                          if (diff !== 0) throw new Error('That invite code is not valid.');
                          return event;
                        };
                        """))
                .memorySize(128)
                .timeout(Duration.seconds(5))
                .environment(Map.of("INVITE_CODE", inviteCode))
                .build();

        // selfSignUpEnabled stays true - the PreSignUp trigger above is what
        // actually gates registration now. Turning this off instead would mean
        // admin-create-user for every one of ~20 people; the invite code keeps
        // it self-service while still closing the "anyone on the internet who
        // finds the CloudFront URL can register" hole (finding H-1), since the
        // pool id and client id in the PWA's config.json are public by design.
        UserPool userPool = UserPool.Builder.create(this, "UserPool")
                .userPoolName("smallstash-users")
                .selfSignUpEnabled(true)
                .signInAliases(SignInAliases.builder().email(true).build())
                .autoVerify(AutoVerifiedAttrs.builder().email(true).build())
                .accountRecovery(AccountRecovery.EMAIL_ONLY)
                // !! STAYS OPTIONAL UNTIL THE CLIENT CAN ENROL A TOTP DEVICE !!
                // Mfa.REQUIRED is the intended end state and is deliberately
                // NOT set yet: with TOTP as the only second factor, Cognito
                // answers the first sign-in of an un-enrolled user with an
                // MFA_SETUP challenge, and web/'s cognito.js has no
                // associateSoftwareToken/verifySoftwareToken flow to answer it
                // (MfaCodeForm only *responds* to a challenge for an
                // already-enrolled device). Flipping this without building
                // enrolment first locks every user out, including you. See
                // docs/todo.md.
                .mfa(Mfa.OPTIONAL)
                .mfaSecondFactor(MfaSecondFactor.builder().otp(true).sms(false).build())
                // Plus tier = threat protection: compromised-credential
                // detection (the login password checked against known-breach
                // corpora) and risk-based adaptive auth scoring IP reputation
                // and device signals. $0.02/MAU, no free tier - about
                // $0.40/month at 20 users, the one deliberately non-zero line
                // item in this stack. Cognito's own failed-login lockout is
                // free but not configurable and is per-user, not per-IP; this
                // is what covers password-spraying and credential stuffing.
                .featurePlan(FeaturePlan.PLUS)
                .standardThreatProtectionMode(StandardThreatProtectionMode.FULL_FUNCTION)
                .passwordPolicy(PasswordPolicy.builder()
                        .minLength(12)
                        .requireLowercase(true)
                        .requireUppercase(true)
                        .requireDigits(true)
                        .requireSymbols(true)
                        .build())
                .lambdaTriggers(UserPoolTriggers.builder()
                        .preSignUp(preSignUp)
                        .build())
                // `.deletionProtection(true)` goes here too when
                // dataRemovalPolicy flips to RETAIN - same reasoning as the
                // table above.
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
                // Without this, Cognito answers an unauthenticated
                // InitiateAuth for an unknown email with UserNotFoundException
                // - confirmed live against the deployed pool, so anyone on the
                // internet could test whether a given address has an account
                // here. With it, existence-revealing responses are replaced by
                // a generic failure.
                .preventUserExistenceErrors(true)
                // 30 days (the Cognito default) is generous for a secrets
                // manager - it's how long a stolen refresh token stays usable.
                // 7 still means a normal user rarely re-authenticates, since
                // any use inside the window slides it forward.
                .refreshTokenValidity(Duration.days(7))
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
                // Hard ceiling on how much Lambda this stack can ever run at
                // once - the cost control the API Gateway throttle can't be.
                // Throttling caps requests/second; concurrency caps how many
                // run simultaneously, which is what actually bounds GB-seconds
                // if something (a retry storm, a bug, an abusive client) gets
                // past the throttle. 5 is far above real demand for ~20 users
                // making a handful of requests a day, and low enough that a
                // runaway can't cost meaningful money before the alarm fires.
                .reservedConcurrentExecutions(5)
                // Without this, the log group CDK implicitly creates never
                // expires - logs accumulate (and stay billable) forever. One
                // month is plenty for debugging a personal app.
                .logGroup(LogGroup.Builder.create(this, "BackendFunctionLogGroup")
                        .logGroupName("/aws/lambda/smallstash-backend")
                        .retention(RetentionDays.ONE_MONTH)
                        .removalPolicy(RemovalPolicy.DESTROY)
                        .build())
                .environment(Map.of(
                        "SMALLSTASH_VAULT_BUCKET", vaultBucket.getBucketName(),
                        "SMALLSTASH_USERS_TABLE", usersTable.getTableName(),
                        "MICRONAUT_ENVIRONMENTS", "lambda",
                        "MICRONAUT_SECURITY_ENABLED", "true",
                        "COGNITO_JWKS_URL", userPool.getUserPoolProviderUrl() + "/.well-known/jwks.json",
                        // Feed the in-Lambda JWT claim validators (see
                        // application-lambda.properties). Previously the
                        // Lambda checked only the signature, so it would have
                        // accepted any token this pool ever signed.
                        "COGNITO_ISSUER", userPool.getUserPoolProviderUrl(),
                        "COGNITO_CLIENT_ID", userPoolClient.getUserPoolClientId()))
                .build();

        // Least privilege, replacing grantReadWrite/grantReadWriteData. Those
        // are convenient but hand out considerably more than this app uses -
        // notably s3:DeleteObject* (which on a versioned bucket includes
        // DeleteObjectVersion, i.e. the ability to destroy the version history
        // that is the vault's only rollback path) and dynamodb:DeleteItem
        // (which could drop the wrapped Vault Key). The app never deletes
        // anything: S3VaultRepository does GetObject/PutObject and
        // DynamoDbUserKeysRepository does GetItem/PutItem, full stop.
        //
        // Object access is additionally scoped to the users/ prefix - the only
        // place vault blobs live.
        backend.addToRolePolicy(PolicyStatement.Builder.create()
                .actions(List.of("s3:GetObject", "s3:PutObject"))
                .resources(List.of(vaultBucket.getBucketArn() + "/users/*"))
                .build());
        backend.addToRolePolicy(PolicyStatement.Builder.create()
                .actions(List.of("dynamodb:GetItem", "dynamodb:PutItem"))
                .resources(List.of(usersTable.getTableArn()))
                .build());

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

        // ---------------------------------------------------------------
        // Security headers + CSP (security review Phase 2)
        //
        // This is the highest-value control protecting the Master Password.
        // Argon2id runs in the browser by design, so the Master Password and
        // derived Vault Key are necessarily in page memory while a session is
        // unlocked - which means any script that executes in this origin can
        // read them straight out of memory and the zero-knowledge model is
        // gone. A CSP doesn't make XSS impossible, it makes the two usual
        // delivery paths (injected inline <script>, attacker-hosted JS) fail
        // closed even if some other bug lets untrusted input reach the DOM.
        // ---------------------------------------------------------------

        // Verified against the actual build output rather than assumed: Vite
        // emits no inline <script> or <style> (both are external files with
        // src/href), there are no inline style="" attributes in web/src, and
        // no Svelte transitions - which are the usual reason a Svelte app
        // needs 'unsafe-inline' in style-src. So this can start strict and be
        // loosened only if the report-only pass proves something needs it.
        //
        // 'wasm-unsafe-eval' is REQUIRED, not optional: hash-wasm runs
        // Argon2id as WebAssembly, and instantiating a WASM module counts as
        // eval-like under CSP. Without it, unlock silently fails - which
        // looks like "wrong Master Password", not like a CSP problem.
        //
        // The API endpoint is a *:execute-api wildcard rather than the exact
        // host on purpose: the real endpoint isn't known until HttpApi is
        // constructed, and HttpApi's CORS in turn needs this distribution's
        // domain name, so naming it exactly here would be a circular
        // dependency. Scoped to this region's API Gateway either way.
        String contentSecurityPolicy = String.join("; ",
                "default-src 'self'",
                "script-src 'self' 'wasm-unsafe-eval'",
                "style-src 'self'",
                "img-src 'self' data:",
                "font-src 'self'",
                "connect-src 'self'"
                        + " https://cognito-idp." + this.getRegion() + ".amazonaws.com"
                        + " https://*.execute-api." + this.getRegion() + ".amazonaws.com",
                "worker-src 'self'",
                "manifest-src 'self'",
                "object-src 'none'",
                "base-uri 'none'",
                "form-action 'self'",
                "frame-ancestors 'none'");

        ResponseHeadersPolicy securityHeaders = ResponseHeadersPolicy.Builder.create(this, "SiteSecurityHeaders")
                .responseHeadersPolicyName("smallstash-security-headers")
                .comment("HSTS/frame/type/referrer headers + report-only CSP for the PWA")
                .securityHeadersBehavior(ResponseSecurityHeadersBehavior.builder()
                        // 1 year + subdomains. Safe here because the only
                        // host this applies to is the CloudFront domain,
                        // which is HTTPS-only regardless.
                        .strictTransportSecurity(ResponseHeadersStrictTransportSecurity.builder()
                                .accessControlMaxAge(Duration.days(365))
                                .includeSubdomains(true)
                                .override(true)
                                .build())
                        .contentTypeOptions(ResponseHeadersContentTypeOptions.builder()
                                .override(true)
                                .build())
                        // Nothing here should ever be framed - a password
                        // manager in an iframe is a clickjacking target.
                        // Duplicates frame-ancestors above for older browsers.
                        .frameOptions(ResponseHeadersFrameOptions.builder()
                                .frameOption(HeadersFrameOption.DENY)
                                .override(true)
                                .build())
                        // Don't leak this app's URLs to anywhere a user
                        // navigates out to from a vault entry link.
                        .referrerPolicy(ResponseHeadersReferrerPolicy.builder()
                                .referrerPolicy(HeadersReferrerPolicy.NO_REFERRER)
                                .override(true)
                                .build())
                        .build())
                // Deliberately the *report-only* header, not the enforcing
                // one - hence a custom header rather than
                // securityHeadersBehavior's contentSecurityPolicy, which only
                // emits the enforcing variant. The browser logs what it
                // *would* have blocked instead of blocking it, so a policy
                // that's missing something breaks nothing while we find out.
                //
                // !! FLIP TO ENFORCING BEFORE STORING REAL SECRETS !!
                // Rename this header to "Content-Security-Policy" once a full
                // manual pass (login, signup, vault CRUD, MFA, offline
                // unlock, Master Password change) produces zero violations in
                // the browser console. Until then this is documentation, not
                // protection. Tracked in docs/todo.md.
                .customHeadersBehavior(ResponseCustomHeadersBehavior.builder()
                        .customHeaders(List.of(ResponseCustomHeader.builder()
                                .header("Content-Security-Policy-Report-Only")
                                .value(contentSecurityPolicy)
                                .override(true)
                                .build()))
                        .build())
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
                        .responseHeadersPolicy(securityHeaders)
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

        // localhost is only in the allowlist when explicitly asked for
        // (`-c allowLocalhostCors=true`, or SMALLSTASH_ALLOW_LOCALHOST_CORS in
        // .env). It used to be unconditional, which meant the production API
        // permanently advertised a development origin. CORS isn't much of a
        // security boundary for a bearer-token API - it uses no cookies, so a
        // malicious origin can't ride an ambient session - but there's no
        // reason for the deployed API to keep answering preflights for an
        // origin only a developer's machine can serve.
        String allowLocalhost = optionalSetting("allowLocalhostCors", "SMALLSTASH_ALLOW_LOCALHOST_CORS");
        List<String> allowedOrigins = "true".equalsIgnoreCase(allowLocalhost)
                ? List.of("http://localhost:5173", "https://" + distribution.getDistributionDomainName())
                : List.of("https://" + distribution.getDistributionDomainName());

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
                        .allowOrigins(allowedOrigins)
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
        HttpStage defaultStage = HttpStage.Builder.create(this, "DefaultStage")
                .httpApi(httpApi)
                .autoDeploy(true)
                .throttle(ThrottleSettings.builder()
                        .rateLimit(10)
                        .burstLimit(20)
                        .build())
                .build();

        // Access logs: who called what, when, from where, and what they got
        // back. Nothing else in this stack records that - the Lambda's own
        // logs start *after* the JWT authorizer has already accepted or
        // rejected a request, so a wave of 401s (the actual signal that
        // someone is probing) would otherwise be invisible. Deliberately no
        // request/response bodies, only metadata: bodies are ciphertext, but
        // logging them would put vault contents in CloudWatch for no benefit.
        LogGroup apiAccessLogs = LogGroup.Builder.create(this, "HttpApiAccessLogs")
                .logGroupName("/aws/apigateway/smallstash-api")
                .retention(RetentionDays.ONE_MONTH)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build();

        // No L2 property for this on HttpStage yet, so reach through to the
        // underlying CfnStage.
        CfnStage cfnStage = (CfnStage) defaultStage.getNode().getDefaultChild();
        cfnStage.setAccessLogSettings(CfnStage.AccessLogSettingsProperty.builder()
                .destinationArn(apiAccessLogs.getLogGroupArn())
                .format(String.join(" ",
                        "$context.identity.sourceIp",
                        "$context.requestTime",
                        "$context.httpMethod",
                        "$context.routeKey",
                        "$context.status",
                        "$context.responseLength",
                        "$context.requestId",
                        "$context.authorizer.error"))
                .build());

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
        // Cost/abuse alarm (security review Phase 3)
        //
        // The account already has two AWS Budgets ($15 monthly, $1
        // zero-spend), but Budgets are notification-only and evaluate only a
        // few times a day - a smoke alarm, not a circuit breaker. A runaway
        // could burn most of a day before they fire. This alarm reacts in
        // minutes on the metric that actually leads the spend.
        // ---------------------------------------------------------------

        String alertEmail = optionalSetting("alertEmail", "SMALLSTASH_ALERT_EMAIL");

        Topic alertTopic = Topic.Builder.create(this, "AlertTopic")
                .topicName("smallstash-alerts")
                .displayName("smallStash alerts")
                .build();

        if (alertEmail != null) {
            // AWS emails a confirmation link on first deploy; the subscription
            // stays "Pending confirmation" - and silently delivers nothing -
            // until it's clicked.
            alertTopic.addSubscription(new EmailSubscription(alertEmail));
        }

        // Real usage is a handful of requests every few days, so ~200
        // invocations in an hour already means something is wrong. Set well
        // below the API stage's own ceiling (10 rps would be 36,000/hour) so
        // this fires long before the throttle alone would bound the damage.
        Alarm.Builder.create(this, "BackendInvocationSpikeAlarm")
                .alarmName("smallstash-backend-invocation-spike")
                .alarmDescription("Backend Lambda invocations far above normal - possible abuse or runaway retry loop")
                .metric(backend.metricInvocations(MetricOptions.builder()
                        .period(Duration.hours(1))
                        .statistic("Sum")
                        .build()))
                .threshold(200)
                .evaluationPeriods(1)
                .comparisonOperator(ComparisonOperator.GREATER_THAN_THRESHOLD)
                // Absent data is the normal state for a mostly-idle app;
                // treating it as breaching would page constantly.
                .treatMissingData(TreatMissingData.NOT_BREACHING)
                .build()
                .addAlarmAction(new SnsAction(alertTopic));

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

    /**
     * Resolves the signup invite code, in precedence order: CDK context
     * ({@code -c inviteCode=...}), then the {@code SMALLSTASH_INVITE_CODE}
     * environment variable, then {@code SMALLSTASH_INVITE_CODE} in the
     * repo-root {@code .env}.
     *
     * <p>The {@code .env} lookup is the intended everyday path - it means a
     * plain {@code cdk deploy} works with no extra flags or exported vars,
     * while the code itself stays out of git ({@code .env} is gitignored;
     * {@code .env.example} carries the key with a blank value as the
     * template). CDK does not read {@code .env} on its own, hence the manual
     * parse.
     *
     * @throws IllegalStateException if no code is configured anywhere - a
     *     deliberate hard failure, since the alternative is deploying a signup
     *     endpoint that is either ungated or gated by a guessable default.
     */
    private String resolveInviteCode() {
        String inviteCode = optionalSetting("inviteCode", "SMALLSTASH_INVITE_CODE");
        if (inviteCode != null) {
            return inviteCode;
        }
        throw new IllegalStateException("""
                No invite code configured. Signup is gated by one, so this stack refuses \
                to synth rather than deploy an ungated (or default-coded) signup endpoint. \
                Set SMALLSTASH_INVITE_CODE in the repo-root .env (gitignored - see \
                .env.example), or pass it as CDK context: cdk deploy -c inviteCode=<value>. \
                See docs/todo.md's security review (finding H-1).""");
    }

    /**
     * Looks up a deploy-time setting, in precedence order: CDK context, then
     * the environment, then the gitignored repo-root {@code .env}.
     *
     * @return the value, or {@code null} if it isn't configured anywhere
     */
    private String optionalSetting(String contextKey, String envKey) {
        Object fromContext = this.getNode().tryGetContext(contextKey);
        if (fromContext != null && !fromContext.toString().isBlank()) {
            return fromContext.toString();
        }

        String fromEnv = System.getenv(envKey);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return fromEnv;
        }

        return readDotEnv(envKey);
    }

    /**
     * Minimal {@code .env} reader - CDK doesn't read {@code .env} itself, and
     * pulling in a dotenv library for two keys isn't worth the dependency.
     * {@code infra/} is the working directory for cdk commands, so the
     * repo-root file is one level up.
     */
    private static String readDotEnv(String key) {
        Path dotEnv = Path.of("..", ".env");
        if (!Files.isReadable(dotEnv)) {
            return null;
        }
        String prefix = key + "=";
        try {
            for (String line : Files.readAllLines(dotEnv)) {
                String trimmed = line.trim();
                if (trimmed.startsWith("#") || !trimmed.startsWith(prefix)) {
                    continue;
                }
                String value = trimmed.substring(prefix.length()).trim();
                // Tolerate the quoted form (KEY="abc") that .env files
                // commonly use.
                if (value.length() >= 2
                        && (value.startsWith("\"") && value.endsWith("\"")
                            || value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length() - 1);
                }
                if (!value.isBlank()) {
                    return value;
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException(
                    "Could not read " + dotEnv.toAbsolutePath() + " while looking for " + key, e);
        }
        return null;
    }
}
