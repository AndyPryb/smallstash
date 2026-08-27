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
import software.amazon.awscdk.services.budgets.CfnBudget;
import software.amazon.awscdk.services.budgets.CfnBudgetsAction;
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
import software.amazon.awscdk.services.cloudfront.ResponseHeadersContentSecurityPolicy;
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
import software.amazon.awscdk.services.iam.Effect;
import software.amazon.awscdk.services.iam.ManagedPolicy;
import software.amazon.awscdk.services.iam.PolicyStatement;
import software.amazon.awscdk.services.iam.Role;
import software.amazon.awscdk.services.iam.ServicePrincipal;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.logs.LogGroup;
import software.amazon.awscdk.services.logs.RetentionDays;
import software.amazon.awscdk.services.sns.Topic;
import software.amazon.awscdk.services.sns.subscriptions.EmailSubscription;
import software.amazon.awscdk.services.s3.BlockPublicAccess;
import software.amazon.awscdk.services.s3.Bucket;
import software.amazon.awscdk.services.s3.BucketEncryption;
import software.amazon.awscdk.services.s3.CorsRule;
import software.amazon.awscdk.services.s3.HttpMethods;
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
 * ciphertext blob), Cognito (SRP-only, no MFA, docs/todo.md),
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

        // DESTROY - a deliberate, standing decision (2026-08-25), not a
        // pre-production placeholder waiting to be flipped. RETAIN was
        // evaluated and rejected: on `cdk destroy` it leaves resources
        // orphaned rather than deleted, and getting them back under stack
        // management afterward is its own project - S3 buckets and DynamoDB
        // tables support CloudFormation resource import (`cdk import`), but
        // Cognito User Pools do not (a known, longstanding gap - see
        // https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/1485).
        // A retained pool would just sit there unusable, so RETAIN alone
        // wouldn't even deliver on its own promise for one of these three
        // resources. DESTROY also keeps the destroy/recreate loop cheap,
        // which matters while this is under active development.
        //
        // The accepted risk: once real secrets live here, a `cdk destroy` -
        // accidental or deliberate - permanently deletes every vault, no
        // recovery. Known and accepted, not overlooked. If that ever needs
        // to change, `deletionProtection(true)` on the table and pool (both
        // support it directly) is a cheaper, simpler guard than RETAIN was -
        // it blocks the delete outright rather than leaving an orphan to
        // untangle afterward - see docs/todo.md if this gets revisited.
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
        // without this every `cdk destroy` fails halfway.
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
        // login depends on.
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

        // Files bucket (docs/file-storage-plan.md) - Phase 1. Separate from
        // vaultBucket above (sec 6), deliberately unversioned: files are
        // immutable-by-id (a new upload always gets a new fileId, never
        // overwrites an existing key), and "deletion means deletion"
        // (decision 5) is a goal, not something to route around - versioning
        // would leave deleted content recoverable, fighting that goal. On an
        // unversioned bucket, s3:DeleteObject just deletes the object, so
        // none of vaultBucket's DeleteObjectVersion concern (sec 6, why that
        // Lambda's role has no delete permission at all) applies here - this
        // is a different bucket with a different, equally deliberate
        // posture, not an exception carved into the vault's.
        //
        // Constructed here (rather than nearer the HTTP API section its
        // routes belong to) specifically so its own regional domain name -
        // needed by the CSP below - is available before the CSP has to be
        // built. Its CORS rule is attached later instead, via
        // addCorsRule(...), once allowedOrigins (which needs the CloudFront
        // distribution's domain name) actually exists - see that comment for
        // the full ordering explanation.
        Bucket filesBucket = Bucket.Builder.create(this, "FilesBucket")
                .encryption(BucketEncryption.S3_MANAGED)
                .blockPublicAccess(BlockPublicAccess.BLOCK_ALL)
                .removalPolicy(dataRemovalPolicy)
                .autoDeleteObjects(true)
                // Orphan cleanup (sec 5): FilesController tags every object
                // state=pending at upload time and flips it to state=live on
                // commit. An upload whose commit never arrives (tab closed,
                // network dropped) stays tagged pending forever otherwise -
                // this rule is what actually reclaims that storage, without
                // any server-side reconciliation job needed to notice it.
                .lifecycleRules(List.of(LifecycleRule.builder()
                        .id("ExpireAbandonedPendingUploads")
                        .enabled(true)
                        .tagFilters(Map.of("state", "pending"))
                        .expiration(Duration.days(1))
                        .build()))
                .build();

        // ---------------------------------------------------------------
        // Auth (Cognito) - docs/todo.md: SRP-only, no MFA (see below)
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
                // No MFA - a deliberate product decision (2026-08-25), not a
                // gap: the vault's real second factor is the Master Password
                // itself, which a stolen/lost phone still doesn't have, so
                // Cognito-level MFA would add login friction on every use
                // without closing a gap that matters here.
                .mfa(Mfa.OFF)
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
                // Path updated for the Phase 0.5 multi-module restructuring
                // (docs/file-storage-plan.md sec 3a): the repo root is now a
                // reactor aggregator, and this jar comes from its
                // vault-lambda/ child module, not the root itself.
                .code(Code.fromAsset("../vault-lambda/target/vault-lambda-0.1.jar"))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                // !! NO reservedConcurrentExecutions - re-add once the
                // account's Lambda concurrency quota is raised !!
                // Per-function reserved concurrency was tried here (5) and
                // reverted: it failed CREATE_FAILED at deploy time because
                // this account's total Lambda concurrency limit in
                // eu-west-1 is only 10 (confirmed via
                // `aws lambda get-account-settings` - AWS's own default is
                // 1000, this account just hasn't had it raised). AWS
                // enforces a hard floor of >=10 UnreservedConcurrentExecutions
                // for the rest of the account at all times, so with a total
                // of 10 there is no room to reserve any amount without going
                // negative on that floor - not something a code change can
                // route around.
                //
                // Not a bare regression: the account-wide ceiling of 10 is
                // itself a real, if coarser, concurrency cap - a runaway
                // can't exceed 10 concurrent Lambda executions account-wide
                // no matter what, since this is currently the only Lambda in
                // the account. The per-function reservation was additional
                // insurance on top of that, not the only thing standing
                // between a bug/abusive client and a cost blowout - see the
                // invite gate, throttle, and per-write size cap, all still
                // in place.
                //
                // To restore per-function reservation: request a Lambda
                // concurrent-execution Service Quota increase (e.g. to 100 -
                // usually auto-approved within minutes for an increase this
                // size), then reinstate `.reservedConcurrentExecutions(5)`
                // here. Tracked in docs/todo.md.
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
        // Files Lambda (docs/file-storage-plan.md sec 3a/8) - a second,
        // independent function, not a route bolted onto `backend` above.
        //
        // Deliberately its own Function, hence its own execution role (CDK
        // creates one per Function by default): the real payoff isn't
        // isolating a JWT check that turns out to need no bespoke code
        // either way (sec 3a's spike), it's that this role ends up with
        // *zero* access to the vault bucket or the users table, full stop -
        // not merely scoped narrowly within a shared role. A bug or
        // compromise in files-serving code cannot touch vault data at the
        // IAM layer, regardless of what the application code does.
        //
        // No JWT/authorizer wiring needed here at all: HttpApi's
        // defaultAuthorizer (below) applies to every route added via
        // addRoutes(...) regardless of which Lambda backs it - confirmed by
        // decompiling micronaut-function-aws-api-proxy directly, not
        // assumed (see docs/file-storage-plan.md sec 3a).
        Function filesFunction = Function.Builder.create(this, "FilesFunction")
                .functionName("smallstash-files")
                .runtime(Runtime.JAVA_25)
                .handler("io.micronaut.function.aws.proxy.payload2.APIGatewayV2HTTPEventFunction")
                // Built by the same aggregator `mvn package` as the backend
                // jar (docs/file-storage-plan.md sec 3a's Phase 0.5) - this
                // one comes from the files-lambda/ child module.
                .code(Code.fromAsset("../files-lambda/target/files-lambda-0.1.jar"))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                // No reservedConcurrentExecutions, same reasoning and same
                // account-wide constraint as `backend` above - see the long
                // comment there. Two Lambdas now share the same 10-execution
                // account ceiling rather than one, which is itself a small
                // additional argument for keeping both functions' workloads
                // light; nothing here changes that math meaningfully at this
                // app's real traffic.
                .logGroup(LogGroup.Builder.create(this, "FilesFunctionLogGroup")
                        .logGroupName("/aws/lambda/smallstash-files")
                        .retention(RetentionDays.ONE_MONTH)
                        .removalPolicy(RemovalPolicy.DESTROY)
                        .build())
                .environment(Map.of(
                        "SMALLSTASH_FILES_BUCKET", filesBucket.getBucketName(),
                        "MICRONAUT_ENVIRONMENTS", "lambda",
                        "MICRONAUT_SECURITY_ENABLED", "true",
                        // Same three values, sourced from the same CDK
                        // objects as `backend`'s environment above - nothing
                        // hand-retyped, nothing that can drift between the
                        // two Lambdas' defense-in-depth JWT checks (sec 3a).
                        "COGNITO_JWKS_URL", userPool.getUserPoolProviderUrl() + "/.well-known/jwks.json",
                        "COGNITO_ISSUER", userPool.getUserPoolProviderUrl(),
                        "COGNITO_CLIENT_ID", userPoolClient.getUserPoolClientId()))
                .build();

        // GetObject/PutObject/PutObjectTagging cover the files index blob
        // and every file object's normal lifecycle (upload, tag flip on
        // commit). DeleteObject is scoped tighter, to users/*/files/* only -
        // the index blob itself is never deleted, only ever overwritten via
        // PutObject, same as the vault. ListBucket is the one action this
        // role needs that `backend`'s never did: FilesUsageService computes
        // quota live by listing each user's files/ prefix rather than
        // tracking a counter in DynamoDB (this Lambda has none - see below),
        // and ListBucket is a bucket-level action in IAM terms, so it can't
        // be scoped to an object-key pattern the way the others are;
        // the s3:prefix condition is the closest available restriction,
        // limiting what prefixes this role may list even though it can't
        // limit which bucket.
        filesFunction.addToRolePolicy(PolicyStatement.Builder.create()
                .actions(List.of("s3:GetObject", "s3:PutObject", "s3:PutObjectTagging"))
                .resources(List.of(filesBucket.getBucketArn() + "/users/*"))
                .build());
        filesFunction.addToRolePolicy(PolicyStatement.Builder.create()
                .actions(List.of("s3:DeleteObject"))
                .resources(List.of(filesBucket.getBucketArn() + "/users/*/files/*"))
                .build());
        filesFunction.addToRolePolicy(PolicyStatement.Builder.create()
                .actions(List.of("s3:ListBucket"))
                .resources(List.of(filesBucket.getBucketArn()))
                .conditions(Map.of("StringLike", Map.of("s3:prefix", "users/*/files/*")))
                .build());
        // Deliberately no dynamodb:* statement at all - this Lambda never
        // touches the users table. The files index is an S3 blob
        // (docs/file-storage-plan.md sec 4), not a table row.

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
        //
        // The files bucket's own regional domain is added here too
        // (docs/file-storage-plan.md sec 8) - named exactly, not wildcarded,
        // since unlike the API endpoint the bucket already exists by this
        // point in the stack and there's no circular-dependency reason not
        // to. Without this, uploads fail looking like a network error, not
        // a policy error - the same trap class as 'wasm-unsafe-eval' below.
        // The vault bucket needs no equivalent entry: the browser never
        // talks to it directly, only through the API (see architecture.md).
        String contentSecurityPolicy = String.join("; ",
                "default-src 'self'",
                "script-src 'self' 'wasm-unsafe-eval'",
                "style-src 'self'",
                "img-src 'self' data:",
                "font-src 'self'",
                "connect-src 'self'"
                        + " https://cognito-idp." + this.getRegion() + ".amazonaws.com"
                        + " https://*.execute-api." + this.getRegion() + ".amazonaws.com"
                        + " https://" + filesBucket.getBucketRegionalDomainName(),
                "worker-src 'self'",
                "manifest-src 'self'",
                "object-src 'none'",
                "base-uri 'none'",
                "form-action 'self'",
                "frame-ancestors 'none'");

        ResponseHeadersPolicy securityHeaders = ResponseHeadersPolicy.Builder.create(this, "SiteSecurityHeaders")
                .responseHeadersPolicyName("smallstash-security-headers")
                .comment("HSTS/frame/type/referrer headers + enforcing CSP for the PWA")
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
                        // ENFORCING as of 2026-08-25, via this dedicated field
                        // - NOT customHeadersBehavior, which is what the first
                        // deploy attempt used and which CloudFront rejected
                        // outright ("Invalid request provided:
                        // AWS::CloudFront::ResponseHeadersPolicy", confirmed
                        // against AWS's own CloudFormation example, which
                        // shows Content-Security-Policy only ever set via
                        // SecurityHeadersConfig, never CustomHeadersConfig).
                        // The literal header name "Content-Security-Policy" is
                        // reserved for this field; only the distinct string
                        // "Content-Security-Policy-Report-Only" was ever
                        // valid as a custom header, which is why the
                        // report-only rollout worked via customHeadersBehavior
                        // and the flip to enforcing did not - an earlier
                        // comment here claiming "no functional difference"
                        // between the two approaches was wrong.
                        .contentSecurityPolicy(ResponseHeadersContentSecurityPolicy.builder()
                                .contentSecurityPolicy(contentSecurityPolicy)
                                .override(true)
                                .build())
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

        // CORS on the files bucket (constructed earlier, alongside
        // vaultBucket - see the comment there for why): the browser uploads
        // file bytes directly to this bucket via a presigned URL (sec 3 -
        // Lambda payload/API Gateway limits rule out routing bytes through
        // the API), so it needs to be a valid fetch/XHR target from the
        // PWA's own origin. Attached here via addCorsRule(...) rather than
        // at construction time purely because this is the first point in
        // the file allowedOrigins (which needs distribution's domain name)
        // actually exists - CDK's Bucket construct supports configuring CORS
        // after the fact for exactly this kind of ordering constraint.
        // allowedHeaders("*") is required for the x-amz-tagging header
        // FilesController signs into the presigned PUT (see that class's
        // Javadoc for why it's PUT, not the POST the original plan called
        // for) - a browser's CORS preflight has to see that header
        // pre-approved before the real PUT is allowed to send it.
        filesBucket.addCorsRule(CorsRule.builder()
                .allowedOrigins(allowedOrigins)
                .allowedMethods(List.of(HttpMethods.PUT, HttpMethods.GET))
                .allowedHeaders(List.of("*"))
                .exposedHeaders(List.of("ETag"))
                .build());

        HttpUserPoolAuthorizer authorizer = new HttpUserPoolAuthorizer("CognitoAuthorizer", userPool,
                HttpUserPoolAuthorizerProps.builder()
                        .userPoolClients(List.of(userPoolClient))
                        .build());

        HttpLambdaIntegration integration = new HttpLambdaIntegration("BackendIntegration", backend);
        HttpLambdaIntegration filesIntegration = new HttpLambdaIntegration("FilesIntegration", filesFunction);

        HttpApi httpApi = HttpApi.Builder.create(this, "HttpApi")
                .apiName("smallstash-api")
                .createDefaultStage(false)
                .defaultAuthorizer(authorizer)
                // Real PWA origin (this CloudFront distribution) plus
                // localhost:5173 for local `npm run dev`. The distribution's
                // domain name is a CloudFormation token resolved at deploy
                // time within this same stack, so no manual step is needed
                // once a real custom domain replaces it (see docs/todo.md).
                //
                // POST/DELETE added for the files routes below - the
                // original GET/PUT/OPTIONS set covered only /vault and
                // /keys, which never needed either verb.
                .corsPreflight(CorsPreflightOptions.builder()
                        .allowOrigins(allowedOrigins)
                        .allowMethods(List.of(
                                CorsHttpMethod.GET, CorsHttpMethod.PUT,
                                CorsHttpMethod.POST, CorsHttpMethod.DELETE,
                                CorsHttpMethod.OPTIONS))
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

        // Files routes (docs/file-storage-plan.md sec 5) - all on
        // filesIntegration, none of them touching `backend`. No per-route
        // .authorizer(...) call: defaultAuthorizer above already covers
        // every route added via addRoutes(...) regardless of which Lambda
        // it integrates with (sec 3a).
        httpApi.addRoutes(AddRoutesOptions.builder()
                .path("/files-index")
                .methods(List.of(HttpMethod.GET, HttpMethod.PUT))
                .integration(filesIntegration)
                .build());

        httpApi.addRoutes(AddRoutesOptions.builder()
                .path("/files")
                .methods(List.of(HttpMethod.POST))
                .integration(filesIntegration)
                .build());

        httpApi.addRoutes(AddRoutesOptions.builder()
                .path("/files/{fileId}/commit")
                .methods(List.of(HttpMethod.POST))
                .integration(filesIntegration)
                .build());

        // Added while starting Phase 2 - the bucket is BLOCK_ALL public
        // access, so nothing let a browser fetch file bytes without this.
        // A genuine Phase 1 gap, found before it caused a problem rather
        // than after (docs/file-storage-plan.md).
        httpApi.addRoutes(AddRoutesOptions.builder()
                .path("/files/{fileId}/url")
                .methods(List.of(HttpMethod.GET))
                .integration(filesIntegration)
                .build());

        httpApi.addRoutes(AddRoutesOptions.builder()
                .path("/files/{fileId}")
                .methods(List.of(HttpMethod.DELETE))
                .integration(filesIntegration)
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
        // Cost kill switch (security review Phase 3)
        //
        // The alarm above is detection; this is containment. When spend on
        // this stack's own budget crosses the limit, AWS Budgets attaches a
        // Deny policy to the backend Lambda's execution role, and every vault
        // read and write starts failing. That is deliberately blunt - a full
        // outage is the intended behaviour, on the reasoning that for a
        // personal app an unexplained bill is worse than downtime.
        //
        // Two things it deliberately does NOT touch: the root user, and
        // `smallstash-deployer`. Neither is in the live request path, so
        // denying them would achieve nothing while removing the very access
        // needed to investigate and undo this. Recovery is detaching the
        // policy - no redeploy required.
        //
        // The budget is created *here* rather than referencing one made in
        // the console: a CfnBudgetsAction has to name its budget, and pointing
        // at a hand-made one would silently break every future deploy the
        // moment that budget was renamed. This one belongs to the app, and any
        // personal budgets stay independent of it.
        // ---------------------------------------------------------------

        // Normal running cost is roughly $0.40/month (Cognito Plus) plus
        // pennies, so $10 is far enough above the noise floor that tripping it
        // means something is genuinely wrong, and low enough to stop real
        // damage. It is a *monthly* budget, so it resets on the 1st.
        final Number killSwitchLimitUsd = 10;

        CfnBudget appBudget = CfnBudget.Builder.create(this, "AppBudget")
                .budget(CfnBudget.BudgetDataProperty.builder()
                        .budgetName("smallstash-app")
                        .budgetType("COST")
                        .timeUnit("MONTHLY")
                        .budgetLimit(CfnBudget.SpendProperty.builder()
                                .amount(killSwitchLimitUsd)
                                .unit("USD")
                                .build())
                        .build())
                .build();

        // Created but attached to nothing. AWS Budgets attaches it on trigger;
        // an explicit Deny beats any Allow, so this shuts the data plane off
        // regardless of what the role is otherwise granted.
        ManagedPolicy killSwitchPolicy = ManagedPolicy.Builder.create(this, "CostKillSwitchPolicy")
                .managedPolicyName("smallstash-cost-kill-switch")
                .description("Attached by AWS Budgets to halt smallStash data access when the app budget is exceeded")
                .statements(List.of(PolicyStatement.Builder.create()
                        .effect(Effect.DENY)
                        .actions(List.of("s3:*", "dynamodb:*"))
                        .resources(List.of("*"))
                        .build()))
                .build();

        // The conditions are AWS's documented cross-service confused-deputy
        // prevention: without them, any budget in any account could in
        // principle induce Budgets to assume this role.
        ServicePrincipal budgetsPrincipal = new ServicePrincipal("budgets.amazonaws.com");
        Role budgetActionRole = Role.Builder.create(this, "BudgetActionRole")
                .description("Assumed by AWS Budgets to apply the smallStash cost kill switch")
                .assumedBy(budgetsPrincipal.withConditions(Map.of(
                        "ArnLike", Map.of("aws:SourceArn",
                                "arn:aws:budgets::" + this.getAccount() + ":budget/*"),
                        "StringEquals", Map.of("aws:SourceAccount", this.getAccount()))))
                .build();

        // Scoped hard in both directions: this role may attach only *this*
        // policy, and only to *this* Lambda's role. AWS's own example grants
        // attach/detach on "*" for users, groups and roles alike; there's no
        // reason to hand a budget that much reach.
        budgetActionRole.addToPolicy(PolicyStatement.Builder.create()
                .actions(List.of("iam:AttachRolePolicy", "iam:DetachRolePolicy"))
                .resources(List.of(backend.getRole().getRoleArn()))
                .conditions(Map.of("ArnEquals",
                        Map.of("iam:PolicyARN", killSwitchPolicy.getManagedPolicyArn())))
                .build());

        // A budget action must have at least one subscriber, so the kill
        // switch only exists when there's an address to tell. Skipping it
        // silently would be worse than not having it: a containment control
        // that fires with nobody informed is how an outage becomes a mystery.
        if (alertEmail != null) {
            CfnBudgetsAction killSwitch = CfnBudgetsAction.Builder.create(this, "CostKillSwitch")
                    .budgetName("smallstash-app")
                    .actionType("APPLY_IAM_POLICY")
                    // ACTUAL, not FORECASTED - a forecast can spike early in
                    // the month off very little real spend, and this action is
                    // destructive enough that it should only fire on money
                    // actually spent.
                    .notificationType("ACTUAL")
                    .actionThreshold(CfnBudgetsAction.ActionThresholdProperty.builder()
                            .type("ABSOLUTE_VALUE")
                            .value(killSwitchLimitUsd)
                            .build())
                    // AUTOMATIC is the point - MANUAL would just be another
                    // email needing a human, which the alarm already covers.
                    .approvalModel("AUTOMATIC")
                    .executionRoleArn(budgetActionRole.getRoleArn())
                    .definition(CfnBudgetsAction.DefinitionProperty.builder()
                            .iamActionDefinition(CfnBudgetsAction.IamActionDefinitionProperty.builder()
                                    .policyArn(killSwitchPolicy.getManagedPolicyArn())
                                    .roles(List.of(backend.getRole().getRoleName()))
                                    .build())
                            .build())
                    .subscribers(List.of(CfnBudgetsAction.SubscriberProperty.builder()
                            .type("EMAIL")
                            .address(alertEmail)
                            .build()))
                    .build();
            // The action references the budget by name, so the budget has to
            // exist first - CloudFormation can't infer that from a string.
            killSwitch.addDependency(appBudget);
        }

        // ---------------------------------------------------------------
        // Outputs
        // ---------------------------------------------------------------

        CfnOutput.Builder.create(this, "ApiUrl").value(httpApi.getApiEndpoint()).build();
        CfnOutput.Builder.create(this, "UserPoolId").value(userPool.getUserPoolId()).build();
        CfnOutput.Builder.create(this, "UserPoolClientId").value(userPoolClient.getUserPoolClientId()).build();
        CfnOutput.Builder.create(this, "VaultBucketName").value(vaultBucket.getBucketName()).build();
        CfnOutput.Builder.create(this, "FilesBucketName").value(filesBucket.getBucketName()).build();
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
