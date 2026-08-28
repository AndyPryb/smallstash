package andriy.prybaten;

import io.micronaut.context.event.BeanCreatedEvent;
import io.micronaut.context.event.BeanCreatedEventListener;
import jakarta.inject.Singleton;
import software.amazon.awssdk.services.s3.S3Client;

/**
 * Fails LocalStack-backed integration tests loudly at startup instead of
 * letting them silently succeed against real AWS.
 *
 * <p>Test-scope only ({@code src/test/java}) - never ships in the deployed
 * jar. Same reasoning as {@code vault-lambda}'s copy of this class - see
 * there for the full investigation (docs/todo.md, 2026-08-29).
 */
@Singleton
public class LocalStackGuard implements BeanCreatedEventListener<S3Client> {

    @Override
    public S3Client onCreated(BeanCreatedEvent<S3Client> event) {
        S3Client client = event.getBean();
        if (client.serviceClientConfiguration().endpointOverride().isEmpty()) {
            throw new IllegalStateException("S3Client has no LocalStack endpoint override - Docker/LocalStack "
                    + "was not reached, and this test would silently run against real AWS instead. Refusing "
                    + "to start. See docs/todo.md, 2026-08-29 entry, for the full investigation.");
        }
        return client;
    }
}
