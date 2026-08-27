package andriy.prybaten.config;

import io.micronaut.context.annotation.Factory;
import jakarta.inject.Singleton;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbEnhancedClient;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

/**
 * micronaut-aws-sdk-v2 auto-creates the plain {@link DynamoDbClient} and
 * {@code S3Client} beans (region/credentials/endpoint-override wired from
 * {@code aws.services.<name>.*}, which is also what the LocalStack test
 * resources modules populate for local dev - see application.properties).
 * The enhanced client used by the repositories still needs one manual bean.
 */
@Factory
public class AwsClientConfig {

    @Singleton
    DynamoDbEnhancedClient dynamoDbEnhancedClient(DynamoDbClient dynamoDbClient) {
        return DynamoDbEnhancedClient.builder()
                .dynamoDbClient(dynamoDbClient)
                .build();
    }
}
