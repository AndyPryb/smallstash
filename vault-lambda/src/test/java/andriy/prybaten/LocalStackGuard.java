package andriy.prybaten;

import io.micronaut.context.event.BeanCreatedEvent;
import io.micronaut.context.event.BeanCreatedEventListener;
import jakarta.inject.Singleton;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.s3.S3Client;

/**
 * Fails LocalStack-backed integration tests loudly at startup instead of
 * letting them silently succeed against real AWS.
 *
 * <p>Test-scope only ({@code src/test/java}) - never ships in the deployed
 * jar, since hitting real AWS is exactly correct/intended there.
 *
 * <p>Micronaut Test Resources is supposed to transparently redirect
 * {@link S3Client}/{@link DynamoDbClient} to a local LocalStack container
 * during tests. That redirect has been unreliable in this environment - and
 * on investigation (docs/todo.md, 2026-08-29), the underlying cause turned
 * out to be that Docker isn't reachable from this sandbox at all (confirmed:
 * no {@code docker} CLI on {@code PATH}, and live SDK request logging showed
 * every test request going to the real {@code *.amazonaws.com} endpoint,
 * every single time, across repeated runs). When the redirect fails,
 * Micronaut doesn't error - the AWS SDK's default credential chain quietly
 * takes over, using whatever real credentials are ambient in the
 * environment. The tests still pass, because the same CRUD operations work
 * identically against real S3/DynamoDB - that's what made this dangerous:
 * nothing before this made the fallback visible. These listeners close that
 * gap: if a client bean has no LocalStack endpoint override, the whole test
 * run refuses to start rather than silently proceeding against real
 * infrastructure.
 */
public final class LocalStackGuard {

    private LocalStackGuard() {
    }

    private static void requireLocalEndpoint(String clientName, boolean hasEndpointOverride) {
        if (!hasEndpointOverride) {
            throw new IllegalStateException(clientName + " has no LocalStack endpoint override - "
                    + "Docker/LocalStack was not reached, and this test would silently run against real "
                    + "AWS instead. Refusing to start. See docs/todo.md, 2026-08-29 entry, for the full "
                    + "investigation.");
        }
    }

    @Singleton
    public static class S3ClientGuard implements BeanCreatedEventListener<S3Client> {
        @Override
        public S3Client onCreated(BeanCreatedEvent<S3Client> event) {
            S3Client client = event.getBean();
            requireLocalEndpoint("S3Client", client.serviceClientConfiguration().endpointOverride().isPresent());
            return client;
        }
    }

    @Singleton
    public static class DynamoDbClientGuard implements BeanCreatedEventListener<DynamoDbClient> {
        @Override
        public DynamoDbClient onCreated(BeanCreatedEvent<DynamoDbClient> event) {
            DynamoDbClient client = event.getBean();
            requireLocalEndpoint("DynamoDbClient", client.serviceClientConfiguration().endpointOverride().isPresent());
            return client;
        }
    }
}
