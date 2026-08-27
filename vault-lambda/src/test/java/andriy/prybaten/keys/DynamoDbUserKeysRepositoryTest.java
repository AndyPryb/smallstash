package andriy.prybaten.keys;

import andriy.prybaten.config.StorageProperties;
import io.micronaut.test.extensions.junit5.annotation.MicronautTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;
import software.amazon.awssdk.services.dynamodb.model.CreateTableRequest;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Exercises DynamoDbUserKeysRepository against LocalStack (docs/architecture.md sec 4a). */
@MicronautTest
class DynamoDbUserKeysRepositoryTest {

    @Inject
    DynamoDbClient dynamoDbClient;

    @Inject
    UserKeysRepository userKeysRepository;

    @Inject
    StorageProperties storageProperties;

    @BeforeEach
    void ensureTableExists() {
        String table = storageProperties.getUsersTable();
        if (dynamoDbClient.listTables().tableNames().contains(table)) {
            return;
        }
        dynamoDbClient.createTable(CreateTableRequest.builder()
                .tableName(table)
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .keySchema(
                        KeySchemaElement.builder().attributeName("pk").keyType(KeyType.HASH).build(),
                        KeySchemaElement.builder().attributeName("sk").keyType(KeyType.RANGE).build())
                .attributeDefinitions(
                        AttributeDefinition.builder().attributeName("pk").attributeType(ScalarAttributeType.S).build(),
                        AttributeDefinition.builder().attributeName("sk").attributeType(ScalarAttributeType.S).build())
                .build());
    }

    @Test
    void findKeysIsEmptyForUnknownUser() {
        assertTrue(userKeysRepository.findKeys("nobody").isEmpty());
    }

    @Test
    void saveThenFindKeysRoundTrips() {
        String userSub = "user-" + System.nanoTime();
        UserKeys keys = new UserKeys(
                "c2FsdA==", 19456, 2, 1,
                "d3JhcHBlZC1ieS1tYXN0ZXI=", "d3JhcHBlZC1ieS1yZWNvdmVyeQ==", 1);

        userKeysRepository.saveKeys(userSub, keys);

        Optional<UserKeys> found = userKeysRepository.findKeys(userSub);
        assertTrue(found.isPresent());
        assertEquals(keys, found.get());
    }

    @Test
    void createProfileIfAbsentIsIdempotent() {
        String userSub = "user-" + System.nanoTime();

        userKeysRepository.createProfileIfAbsent(userSub, "free");
        userKeysRepository.createProfileIfAbsent(userSub, "free"); // must not throw

        Optional<UserProfile> profile = userKeysRepository.findProfile(userSub);
        assertTrue(profile.isPresent());
        assertEquals("free", profile.get().plan());
        assertEquals(0L, profile.get().storageBytesUsed());
    }
}
