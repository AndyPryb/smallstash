package andriy.prybaten.files;

import io.micronaut.http.HttpStatus;
import io.micronaut.http.exceptions.HttpStatusException;
import io.micronaut.security.authentication.Authentication;
import io.micronaut.test.extensions.junit5.annotation.MicronautTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.BucketAlreadyExistsException;
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException;
import software.amazon.awssdk.services.s3.model.GetObjectTaggingRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises FilesController's mint/commit/delete lifecycle against
 * LocalStack - the real enforcement path described in the class's own
 * Javadoc (presigned PUT can't bound size up front, so commit is where the
 * size cap and quota are actually checked, against what S3 really received).
 *
 * The 25 MiB size cap is exercised with a real oversized object below - small
 * enough to actually allocate and upload in a test. The ~500 MiB user quota
 * is not: reproducing that boundary for real would mean storing that much
 * data in LocalStack per test, which is genuine but impractical weight for a
 * fast suite. Named here rather than silently skipped - the quota's
 * <em>arithmetic</em> (`currentUsage + declared > cap`) is simple enough that
 * FilesUsageServiceTest's coverage of the summation it depends on is the
 * next best thing to exercising the 500 MiB branch directly.
 */
@MicronautTest
class FilesControllerTest {

    @Inject
    S3Client s3Client;

    @Inject
    FilesController filesController;

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

    private static Authentication userAuth(String sub) {
        return Authentication.build(sub);
    }

    @Test
    void mintRejectsAZeroOrNegativeDeclaredSize() {
        Authentication auth = userAuth("user-" + System.nanoTime());
        assertThrows(HttpStatusException.class, () -> filesController.mint(auth, new FileUploadRequest(0)));
        assertThrows(HttpStatusException.class, () -> filesController.mint(auth, new FileUploadRequest(-1)));
    }

    @Test
    void mintRejectsADeclaredSizeOverTheFileCap() {
        Authentication auth = userAuth("user-" + System.nanoTime());
        HttpStatusException ex = assertThrows(HttpStatusException.class,
                () -> filesController.mint(auth, new FileUploadRequest(FilesController.MAX_FILE_SIZE_BYTES + 1)));
        assertEquals(HttpStatus.REQUEST_ENTITY_TOO_LARGE, ex.getStatus());
    }

    @Test
    void mintReturnsAPresignedPutCarryingThePendingTag() {
        Authentication auth = userAuth("user-" + System.nanoTime());
        FileUploadResponse response = filesController.mint(auth, new FileUploadRequest(1024));

        assertNotNull(response.fileId());
        assertTrue(response.upload().url().contains(storageProperties.getFilesBucket()));
        // Signed into the URL/headers so the client can't upload without it -
        // see PresignedUpload's own Javadoc for why this matters.
        assertEquals("state=pending", response.upload().headers().get("x-amz-tagging"));
    }

    @Test
    void downloadUrlReturnsAUrlNamingTheRequestedObject() {
        String userSub = "user-" + System.nanoTime();
        String fileId = UUID.randomUUID().toString();

        FileDownloadResponse response = filesController.downloadUrl(userAuth(userSub), fileId);

        assertTrue(response.url().contains(FilesUsageService.fileKey(userSub, fileId)));
    }

    @Test
    void commitThrowsWhenNothingWasUploaded() {
        Authentication auth = userAuth("user-" + System.nanoTime());
        HttpStatusException ex = assertThrows(HttpStatusException.class,
                () -> filesController.commit(auth, UUID.randomUUID().toString()));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatus());
    }

    @Test
    void commitReturnsTheRealSizeAndFlipsTheObjectToLive() {
        String userSub = "user-" + System.nanoTime();
        Authentication auth = userAuth(userSub);
        String fileId = uploadPendingObject(userSub, 777);

        FileCommitResponse response = filesController.commit(auth, fileId);

        assertEquals(777L, response.sizeBytes());
        var tags = s3Client.getObjectTagging(GetObjectTaggingRequest.builder()
                .bucket(storageProperties.getFilesBucket())
                .key(FilesUsageService.fileKey(userSub, fileId))
                .build()).tagSet();
        assertTrue(tags.stream().anyMatch(
                t -> t.key().equals(FilesController.TAG_KEY) && t.value().equals(FilesController.TAG_VALUE_LIVE)));
    }

    @Test
    void commitDeletesAndRejectsAnObjectThatEndedUpOverTheSizeCap() {
        // Simulates the exact gap the class Javadoc documents: a presigned
        // PUT's signature doesn't cover Content-Length, so an oversized
        // object can briefly exist in S3 - this is where that actually gets
        // caught, real bytes and all, not just asserted from reading the
        // source.
        String userSub = "user-" + System.nanoTime();
        Authentication auth = userAuth(userSub);
        String fileId = uploadPendingObject(userSub, (int) FilesController.MAX_FILE_SIZE_BYTES + 1);

        HttpStatusException ex = assertThrows(HttpStatusException.class, () -> filesController.commit(auth, fileId));
        assertEquals(HttpStatus.REQUEST_ENTITY_TOO_LARGE, ex.getStatus());

        // The compensating control only works if the oversized object is
        // actually removed, not just rejected on this one call - a second
        // commit attempt must see it as gone (404), not still-too-large.
        HttpStatusException second = assertThrows(HttpStatusException.class, () -> filesController.commit(auth, fileId));
        assertEquals(HttpStatus.NOT_FOUND, second.getStatus());
    }

    @Test
    void deleteIsIdempotent() {
        String userSub = "user-" + System.nanoTime();
        Authentication auth = userAuth(userSub);
        String fileId = uploadPendingObject(userSub, 10);

        filesController.delete(auth, fileId);
        filesController.delete(auth, fileId); // must not throw the second time
    }

    /**
     * Places an object directly at the key a real upload would have left,
     * pending tag included - skips actually performing the presigned PUT's
     * HTTP round trip, since S3Presigner's own correctness isn't what these
     * tests are checking; {@link #mintReturnsAPresignedPutCarryingThePendingTag}
     * covers the URL/headers `mint` hands back.
     */
    private String uploadPendingObject(String userSub, int sizeBytes) {
        String fileId = UUID.randomUUID().toString();
        s3Client.putObject(
                PutObjectRequest.builder()
                        .bucket(storageProperties.getFilesBucket())
                        .key(FilesUsageService.fileKey(userSub, fileId))
                        .tagging(FilesController.TAG_KEY + "=" + FilesController.TAG_VALUE_PENDING)
                        .build(),
                RequestBody.fromBytes(new byte[sizeBytes]));
        return fileId;
    }
}
