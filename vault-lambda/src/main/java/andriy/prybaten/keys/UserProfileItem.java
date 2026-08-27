package andriy.prybaten.keys;

import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbBean;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbPartitionKey;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbSortKey;

import java.time.Instant;

/** DynamoDB item shape for {@code PK=USER#<sub>, SK=PROFILE}. See {@link UserKeysItem}. */
@DynamoDbBean
public class UserProfileItem {

    private String pk;
    private String sk = "PROFILE";
    private Instant createdAt;
    private String plan;
    private long storageBytesUsed;

    @DynamoDbPartitionKey
    public String getPk() {
        return pk;
    }

    public void setPk(String pk) {
        this.pk = pk;
    }

    @DynamoDbSortKey
    public String getSk() {
        return sk;
    }

    public void setSk(String sk) {
        this.sk = sk;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public String getPlan() {
        return plan;
    }

    public void setPlan(String plan) {
        this.plan = plan;
    }

    public long getStorageBytesUsed() {
        return storageBytesUsed;
    }

    public void setStorageBytesUsed(long storageBytesUsed) {
        this.storageBytesUsed = storageBytesUsed;
    }
}
