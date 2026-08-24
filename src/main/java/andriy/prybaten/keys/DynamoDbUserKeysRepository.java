package andriy.prybaten.keys;

import andriy.prybaten.config.StorageProperties;
import jakarta.inject.Singleton;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbEnhancedClient;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbTable;
import software.amazon.awssdk.enhanced.dynamodb.Expression;
import software.amazon.awssdk.enhanced.dynamodb.Key;
import software.amazon.awssdk.enhanced.dynamodb.TableSchema;
import software.amazon.awssdk.enhanced.dynamodb.model.PutItemEnhancedRequest;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.ConditionalCheckFailedException;

import java.time.Instant;
import java.util.Optional;

/**
 * Single-table design: {@code smallstash-users} holds both item shapes
 * (PK=USER#&lt;sub&gt;, SK=PROFILE|KEYS) - see ADR-0001. Two
 * {@link DynamoDbTable} handles pointing at the same physical table name,
 * one per item shape, is the standard Enhanced Client pattern for this.
 */
@Singleton
public class DynamoDbUserKeysRepository implements UserKeysRepository {

    private final DynamoDbTable<UserKeysItem> keysTable;
    private final DynamoDbTable<UserProfileItem> profileTable;

    public DynamoDbUserKeysRepository(DynamoDbEnhancedClient enhancedClient, StorageProperties storageProperties) {
        this.keysTable = enhancedClient.table(storageProperties.getUsersTable(), TableSchema.fromBean(UserKeysItem.class));
        this.profileTable = enhancedClient.table(storageProperties.getUsersTable(), TableSchema.fromBean(UserProfileItem.class));
    }

    @Override
    public Optional<UserKeys> findKeys(String userSub) {
        UserKeysItem item = keysTable.getItem(itemKey(userSub, "KEYS"));
        return Optional.ofNullable(item).map(DynamoDbUserKeysRepository::toDomain);
    }

    /**
     * Conditional on the incoming {@code keyVersion} being strictly newer than
     * whatever is stored (or nothing being stored yet, for the first write at
     * signup). See {@link KeyVersionConflictException} for why this write in
     * particular is guarded - it's the one that can permanently orphan a
     * vault.
     */
    @Override
    public void saveKeys(String userSub, UserKeys keys) {
        UserKeysItem item = new UserKeysItem();
        item.setPk(partitionKey(userSub));
        item.setSk("KEYS");
        item.setKdfSalt(keys.kdfSalt());
        item.setKdfMemoryKib(keys.kdfMemoryKib());
        item.setKdfIterations(keys.kdfIterations());
        item.setKdfParallelism(keys.kdfParallelism());
        item.setWrappedVaultKeyByMaster(keys.wrappedVaultKeyByMaster());
        item.setWrappedVaultKeyByRecovery(keys.wrappedVaultKeyByRecovery());
        item.setKeyVersion(keys.keyVersion());

        // #kv rather than a bare `keyVersion`: attribute names in condition
        // expressions collide with DynamoDB's reserved-word list, and using a
        // placeholder sidesteps the question entirely.
        PutItemEnhancedRequest<UserKeysItem> request = PutItemEnhancedRequest.builder(UserKeysItem.class)
                .item(item)
                .conditionExpression(Expression.builder()
                        .expression("attribute_not_exists(pk) OR #kv < :newKeyVersion")
                        .putExpressionName("#kv", "keyVersion")
                        .putExpressionValue(":newKeyVersion",
                                AttributeValue.builder().n(Integer.toString(keys.keyVersion())).build())
                        .build())
                .build();
        try {
            keysTable.putItem(request);
        } catch (ConditionalCheckFailedException stale) {
            throw new KeyVersionConflictException(userSub, keys.keyVersion());
        }
    }

    @Override
    public Optional<UserProfile> findProfile(String userSub) {
        UserProfileItem item = profileTable.getItem(itemKey(userSub, "PROFILE"));
        return Optional.ofNullable(item)
                .map(i -> new UserProfile(i.getCreatedAt(), i.getPlan(), i.getStorageBytesUsed()));
    }

    @Override
    public void createProfileIfAbsent(String userSub, String plan) {
        UserProfileItem item = new UserProfileItem();
        item.setPk(partitionKey(userSub));
        item.setSk("PROFILE");
        item.setCreatedAt(Instant.now());
        item.setPlan(plan);
        item.setStorageBytesUsed(0L);

        PutItemEnhancedRequest<UserProfileItem> request = PutItemEnhancedRequest.builder(UserProfileItem.class)
                .item(item)
                .conditionExpression(Expression.builder()
                        .expression("attribute_not_exists(pk)")
                        .build())
                .build();
        try {
            profileTable.putItem(request);
        } catch (ConditionalCheckFailedException alreadyExists) {
            // Idempotent create - a profile is already there, nothing to do.
        }
    }

    private static Key itemKey(String userSub, String sortValue) {
        return Key.builder().partitionValue(partitionKey(userSub)).sortValue(sortValue).build();
    }

    private static String partitionKey(String userSub) {
        return "USER#" + userSub;
    }

    private static UserKeys toDomain(UserKeysItem item) {
        return new UserKeys(
                item.getKdfSalt(),
                item.getKdfMemoryKib(),
                item.getKdfIterations(),
                item.getKdfParallelism(),
                item.getWrappedVaultKeyByMaster(),
                item.getWrappedVaultKeyByRecovery(),
                item.getKeyVersion());
    }
}
