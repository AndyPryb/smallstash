package andriy.prybaten.infra;

import software.amazon.awscdk.Duration;
import software.amazon.awscdk.Stack;
import software.amazon.awscdk.StackProps;
import software.amazon.awscdk.services.cloudfront.Distribution;
import software.amazon.awscdk.services.cloudwatch.Alarm;
import software.amazon.awscdk.services.cloudwatch.ComparisonOperator;
import software.amazon.awscdk.services.cloudwatch.Metric;
import software.amazon.awscdk.services.cloudwatch.MetricOptions;
import software.amazon.awscdk.services.cloudwatch.TreatMissingData;
import software.amazon.awscdk.services.cloudwatch.actions.SnsAction;
import software.amazon.awscdk.services.sns.Topic;
import software.amazon.awscdk.services.sns.subscriptions.EmailSubscription;
import software.constructs.Construct;

import java.util.Map;

/**
 * A request-rate alarm on the PWA's CloudFront distribution - the one cost
 * vector the rest of the stack's controls genuinely do not cover.
 *
 * <h2>Why this exists</h2>
 *
 * {@code SmallstashStack}'s cost kill switch denies {@code s3:*}/{@code
 * dynamodb:*} on the two Lambda execution roles. That bounds abuse routed
 * <i>through the API</i>, which is also the path already bounded by the
 * Cognito authorizer, the stage throttle, and the per-write size caps.
 * CloudFront sits outside all of it: it serves the static site to anyone on
 * the internet with no authentication, no rate limit, and no WAF, and
 * attaching a Deny policy to a Lambda role does nothing to stop it billing
 * data transfer. The built site is ~315 KB, so a deliberate flood pulling it
 * at 1 Gbps would run roughly $900/day at $0.085/GB with nothing in the
 * account automatically containing it. AWS Budgets evaluates only a few
 * times a day, so the existing $10 budget action would notice hours late and
 * still not be able to stop CloudFront.
 *
 * <p>This does not <i>prevent</i> that - it is detection, deliberately. The
 * only hard stop is disabling the distribution by hand, and automating that
 * on a metric threshold would mean a self-inflicted outage on any false
 * positive. What this buys is finding out in minutes instead of hours, which
 * is the difference between a few dollars and a few hundred.
 *
 * <h2>Why a separate stack, in us-east-1</h2>
 *
 * Not a style choice - two hard AWS constraints leave no alternative:
 *
 * <ol>
 *   <li><b>CloudFront publishes its CloudWatch metrics only to us-east-1</b>,
 *       regardless of where the distribution's own stack lives. A
 *       {@code AWS/CloudFront} metric simply does not exist in eu-west-1.</li>
 *   <li><b>A CloudWatch alarm cannot reference a metric in another region.</b>
 *       Confirmed in aws-cdk-lib 2.252.0's own source rather than assumed:
 *       {@code Alarm.validateMetricStat} throws {@code AlarmRegionMismatch}
 *       ("Cannot create an Alarm in region X based on metric in Y"). So the
 *       alarm has to be created in us-east-1, which means a second stack -
 *       one stack is one region.</li>
 * </ol>
 *
 * <p>The SNS topic is duplicated here for the same class of reason: an alarm
 * action must target a topic in the alarm's own region, so eu-west-1's
 * {@code smallstash-alerts} is not reachable from here. <b>That means a
 * second confirmation email</b> - AWS sends one per subscription, and this
 * one delivers nothing until its link is clicked, exactly like the original.
 *
 * <p>Both stacks need {@code crossRegionReferences(true)} (set in
 * {@code SmallstashApp}) so the distribution id can cross the region
 * boundary; CDK implements that with an SSM parameter and a small
 * deploy-time custom resource, which costs nothing at rest.
 */
public class CloudFrontAlarmStack extends Stack {

    /**
     * Requests per five minutes that should never happen legitimately.
     *
     * <p>Real usage is ~20 people, and a cold page load is a handful of
     * requests (HTML, one JS bundle, one stylesheet, config.json, icons);
     * the service worker makes repeat visits close to free. So even a busy
     * five minutes is low hundreds at the very worst. 2000 - a sustained
     * ~6.7 req/s - is far enough above that to not cry wolf, and far enough
     * below a real flood (thousands per second) to trip almost immediately.
     *
     * <p>Five minutes rather than the one-hour period the Lambda alarms in
     * {@code SmallstashStack} use: those watch a metric whose cost accrues
     * slowly, this one watches the vector that can spend real money inside a
     * single hour, so it is deliberately the twitchiest alarm in the stack.
     */
    private static final Number REQUESTS_PER_5_MIN_THRESHOLD = 2000;

    public CloudFrontAlarmStack(
            final Construct scope,
            final String id,
            final StackProps props,
            final Distribution distribution,
            final String alertEmail) {
        super(scope, id, props);

        Topic alertTopic = Topic.Builder.create(this, "CloudFrontAlertTopic")
                .topicName("smallstash-cloudfront-alerts")
                .displayName("smallStash CloudFront alerts")
                .build();

        if (alertEmail != null) {
            alertTopic.addSubscription(new EmailSubscription(alertEmail));
        }

        // dimensionsMap is supplied in full, not extended: CDK's
        // metricRequests() sets only {DistributionId}, and in its
        // implementation the caller's props are spread *after* that default,
        // so anything passed here replaces the map wholesale rather than
        // merging into it.
        //
        // The Region dimension is the reason this can't be left at CDK's
        // default. CloudFront's per-distribution metrics are published with
        // *two* dimensions, DistributionId and Region, the latter always the
        // literal string "Global" for these. An alarm whose dimension set
        // doesn't match the published set exactly matches no metric at all -
        // it doesn't error, it just sits in INSUFFICIENT_DATA forever, which
        // is a worse outcome than having no alarm because it looks like
        // coverage. See this stack's note in docs/todo.md for the post-deploy
        // check that confirms it is actually receiving datapoints.
        Metric requests = distribution.metricRequests(MetricOptions.builder()
                .period(Duration.minutes(5))
                .statistic("Sum")
                .dimensionsMap(Map.of(
                        "DistributionId", distribution.getDistributionId(),
                        "Region", "Global"))
                .build());

        Alarm.Builder.create(this, "CloudFrontRequestSpikeAlarm")
                .alarmName("smallstash-cloudfront-request-spike")
                .alarmDescription(
                        "CloudFront requests far above normal - possible flood/scraping. "
                                + "CloudFront data transfer is outside the cost kill switch, so this "
                                + "is detection only: if it is real, disable the distribution by hand.")
                .metric(requests)
                .threshold(REQUESTS_PER_5_MIN_THRESHOLD)
                .evaluationPeriods(1)
                .comparisonOperator(ComparisonOperator.GREATER_THAN_THRESHOLD)
                // A mostly-idle app publishes no datapoints at all for long
                // stretches; breaching on absent data would page constantly.
                // Same reasoning as the Lambda alarms in SmallstashStack.
                .treatMissingData(TreatMissingData.NOT_BREACHING)
                .build()
                .addAlarmAction(new SnsAction(alertTopic));
    }
}
