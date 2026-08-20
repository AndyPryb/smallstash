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

    public static void main(final String[] args) {
        App app = new App();
        Environment env = Environment.builder()
                .account(System.getenv("CDK_DEFAULT_ACCOUNT"))
                .region(REGION)
                .build();
        new SmallstashStack(app, "SmallstashStack", StackProps.builder().env(env).build());
        app.synth();
    }
}
