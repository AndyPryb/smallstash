package andriy.prybaten.files;

import jakarta.inject.Singleton;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.time.Instant;
import java.util.Base64;

/**
 * One encrypted files-index blob per user - a near-copy of
 * {@code vault.S3VaultRepository} on purpose (docs/file-storage-plan.md
 * sec 4: "a deliberate near-copy... not a new pattern to audit from
 * scratch"). The one structural difference is the object key's own bucket:
 * this repository talks to the separate files bucket
 * ({@link FilesStorageProperties}), never the vault bucket.
 */
@Singleton
public class S3FilesIndexRepository implements FilesIndexRepository {

    private final S3Client s3;
    private final FilesStorageProperties storageProperties;

    public S3FilesIndexRepository(S3Client s3, FilesStorageProperties storageProperties) {
        this.s3 = s3;
        this.storageProperties = storageProperties;
    }

    @Override
    public FilesIndexBlob get(String userSub) {
        try {
            ResponseBytes<GetObjectResponse> response = s3.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(storageProperties.getFilesBucket())
                    .key(indexKey(userSub))
                    .build());
            GetObjectResponse metadata = response.response();
            return new FilesIndexBlob(
                    Base64.getEncoder().encodeToString(response.asByteArray()),
                    metadata.lastModified());
        } catch (NoSuchKeyException e) {
            throw new FilesIndexNotFoundException(userSub);
        }
    }

    @Override
    public FilesIndexBlob put(String userSub, byte[] ciphertext) {
        s3.putObject(
                PutObjectRequest.builder()
                        .bucket(storageProperties.getFilesBucket())
                        .key(indexKey(userSub))
                        .build(),
                RequestBody.fromBytes(ciphertext));
        return new FilesIndexBlob(Base64.getEncoder().encodeToString(ciphertext), Instant.now());
    }

    private static String indexKey(String userSub) {
        return "users/%s/files-index.json.enc".formatted(userSub);
    }
}
