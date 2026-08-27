package andriy.prybaten.keys;

import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbBean;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbPartitionKey;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbSortKey;

/**
 * DynamoDB item shape for {@code PK=USER#<sub>, SK=KEYS} in the
 * {@code smallstash-users} table (single-table design, see ADR-0001).
 * Deliberately a separate mutable bean from the {@link UserKeys} API
 * record - the Enhanced Client's bean mapper needs a no-arg
 * constructor + setters, records don't have those.
 */
@DynamoDbBean
public class UserKeysItem {

    private String pk;
    private String sk = "KEYS";
    private String kdfSalt;
    private int kdfMemoryKib;
    private int kdfIterations;
    private int kdfParallelism;
    private String wrappedVaultKeyByMaster;
    private String wrappedVaultKeyByRecovery;
    private int keyVersion;

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

    public String getKdfSalt() {
        return kdfSalt;
    }

    public void setKdfSalt(String kdfSalt) {
        this.kdfSalt = kdfSalt;
    }

    public int getKdfMemoryKib() {
        return kdfMemoryKib;
    }

    public void setKdfMemoryKib(int kdfMemoryKib) {
        this.kdfMemoryKib = kdfMemoryKib;
    }

    public int getKdfIterations() {
        return kdfIterations;
    }

    public void setKdfIterations(int kdfIterations) {
        this.kdfIterations = kdfIterations;
    }

    public int getKdfParallelism() {
        return kdfParallelism;
    }

    public void setKdfParallelism(int kdfParallelism) {
        this.kdfParallelism = kdfParallelism;
    }

    public String getWrappedVaultKeyByMaster() {
        return wrappedVaultKeyByMaster;
    }

    public void setWrappedVaultKeyByMaster(String wrappedVaultKeyByMaster) {
        this.wrappedVaultKeyByMaster = wrappedVaultKeyByMaster;
    }

    public String getWrappedVaultKeyByRecovery() {
        return wrappedVaultKeyByRecovery;
    }

    public void setWrappedVaultKeyByRecovery(String wrappedVaultKeyByRecovery) {
        this.wrappedVaultKeyByRecovery = wrappedVaultKeyByRecovery;
    }

    public int getKeyVersion() {
        return keyVersion;
    }

    public void setKeyVersion(int keyVersion) {
        this.keyVersion = keyVersion;
    }
}
