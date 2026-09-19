package andriy.prybaten.infra;

import software.amazon.awscdk.App;
import software.amazon.awscdk.Environment;
import software.amazon.awscdk.StackProps;

/**
 * CDK entry point - {@code cdk} CLI runs this via {@code mvn ... exec:java}
 * (see cdk.json). No AWS calls happen just from running this; {@code cdk
 * synth} only renders a local CloudFormation template, {@code cdk deploy}
 * is the step that actually touches your AWS account.
 */
public final class SmallstashApp {

    // Pinned explicitly rather than left environment-agnostic, so a future
    // change to the deploying machine's default CLI region can't silently
    // redirect where this deploys. Account stays dynamic (whichever
    // credentials are active - see docs/todo.md deployer IAM user), region
    // is a deliberate choice (docs/architecture.md - eu-west-1: broadest EU
    // service coverage, cheapest EU region, chosen 2026-08-20).
    private static final String REGION = "eu-west-1";

    /**
     * Where {@link CloudFrontAlarmStack} has to go - not a preference. See
     * that class: CloudFront publishes its CloudWatch metrics only to
     * us-east-1, and a CloudWatch alarm cannot reference a metric in another
     * region, so the alarm cannot live in {@link #REGION} with everything
     * else.
     */
    private static final String CLOUDFRONT_METRICS_REGION = "us-east-1";

    public static void main(final String[] args) {
        App app = new App();
        String account = System.getenv("CDK_DEFAULT_ACCOUNT");
        Environment env = Environment.builder()
                .account(account)
                .region(REGION)
                .build();

        // crossRegionReferences: the alarm stack below needs this stack's
        // distribution id, and a plain CloudFormation export/import is
        // same-region only. CDK bridges it with an SSM parameter plus a
        // deploy-time custom resource - both stacks have to opt in, the
        // producer to publish and the consumer to read.
        SmallstashStack main = new SmallstashStack(app, "SmallstashStack", StackProps.builder()
                .env(env)
                .crossRegionReferences(true)
                .build());

        new CloudFrontAlarmStack(app, "SmallstashCloudFrontAlarmStack",
                StackProps.builder()
                        .env(Environment.builder()
                                .account(account)
                                .region(CLOUDFRONT_METRICS_REGION)
                                .build())
                        .crossRegionReferences(true)
                        .build(),
                main.getDistribution(),
                main.getAlertEmail());

        app.synth();
    }
}
