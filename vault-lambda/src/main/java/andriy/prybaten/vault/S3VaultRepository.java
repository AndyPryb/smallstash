package andriy.prybaten.vault;

import andriy.prybaten.config.StorageProperties;
import jakarta.inject.Singleton;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;

import java.time.Instant;
import java.util.Base64;

/**
 * One whole-vault ciphertext blob per user, versioned bucket for free
 * rollback. See docs/decisions/0001-storage-s3-vs-dynamodb.md - the KDF
 * salt/wrapped-key metadata lives in DynamoDB instead (keys package), not
 * here.
 */
@Singleton
public class S3VaultRepository implements VaultRepository {

    private final S3Client s3;
    private final StorageProperties storageProperties;

    public S3VaultRepository(S3Client s3, StorageProperties storageProperties) {
        this.s3 = s3;
        this.storageProperties = storageProperties;
    }

    @Override
    public VaultBlob get(String userSub) {
        try {
            ResponseBytes<GetObjectResponse> response = s3.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(storageProperties.getVaultBucket())
                    .key(vaultKey(userSub))
                    .build());
            GetObjectResponse metadata = response.response();
            return new VaultBlob(
                    Base64.getEncoder().encodeToString(response.asByteArray()),
                    metadata.versionId(),
                    metadata.lastModified());
        } catch (NoSuchKeyException e) {
            throw new VaultNotFoundException(userSub);
        }
    }

    @Override
    public VaultBlob put(String userSub, byte[] ciphertext) {
        PutObjectResponse response = s3.putObject(
                PutObjectRequest.builder()
                        .bucket(storageProperties.getVaultBucket())
                        .key(vaultKey(userSub))
                        .build(),
                RequestBody.fromBytes(ciphertext));
        return new VaultBlob(
                Base64.getEncoder().encodeToString(ciphertext),
                response.versionId(),
                Instant.now());
    }

    private static String vaultKey(String userSub) {
        return "users/%s/vault.json.enc".formatted(userSub);
    }
}
