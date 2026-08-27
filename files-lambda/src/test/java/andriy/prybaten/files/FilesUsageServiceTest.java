package andriy.prybaten.files;

import io.micronaut.test.extensions.junit5.annotation.MicronautTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.BucketAlreadyExistsException;
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Exercises FilesUsageService's live S3-listing quota calculation (see its
 * own Javadoc for why it lists rather than reading a ledger) against
 * LocalStack.
 */
@MicronautTest
class FilesUsageServiceTest {

    @Inject
    S3Client s3Client;

    @Inject
    FilesUsageService usageService;

    @Inject
    FilesStorageProperties storageProperties;

    @BeforeEach
    void ensureBucketExists() {
        try {
            s3Client.createBucket(b -> b.bucket(storageProperties.getFilesBucket()));
        } catch (BucketAlreadyOwnedByYouException | BucketAlreadyExistsException alreadyThere) {
            // created by an earlier test in this run - fine.
        }
    }

    @Test
    void zeroForAUserWithNoFiles() {
        assertEquals(0L, usageService.currentUsageBytes("user-" + System.nanoTime()));
    }

    @Test
    void sumsEveryObjectUnderTheUsersPrefix() {
        String userSub = "user-" + System.nanoTime();
        putFile(userSub, "a", 100);
        putFile(userSub, "b", 250);

        assertEquals(350L, usageService.currentUsageBytes(userSub));
    }

    @Test
    void countsPendingObjectsToo() {
        // Deliberate, per the method's own Javadoc: a not-yet-committed
        // upload already occupies real storage, so it must count or a client
        // could bypass the quota by uploading many files and never
        // committing any of them.
        String userSub = "user-" + System.nanoTime();
        s3Client.putObject(
                PutObjectRequest.builder()
                        .bucket(storageProperties.getFilesBucket())
                        .key(FilesUsageService.fileKey(userSub, "pending-file"))
                        .tagging(FilesController.TAG_KEY + "=" + FilesController.TAG_VALUE_PENDING)
                        .build(),
                RequestBody.fromBytes(new byte[42]));

        assertEquals(42L, usageService.currentUsageBytes(userSub));
    }

    @Test
    void neverCountsAnotherUsersFiles() {
        String userSub = "user-" + System.nanoTime();
        String otherSub = "user-" + System.nanoTime() + "-other";
        putFile(otherSub, "not-mine", 999);

        assertEquals(0L, usageService.currentUsageBytes(userSub));
    }

    private void putFile(String userSub, String fileId, int sizeBytes) {
        s3Client.putObject(
                PutObjectRequest.builder()
                        .bucket(storageProperties.getFilesBucket())
                        .key(FilesUsageService.fileKey(userSub, fileId))
                        .build(),
                RequestBody.fromBytes(new byte[sizeBytes]));
    }
}
