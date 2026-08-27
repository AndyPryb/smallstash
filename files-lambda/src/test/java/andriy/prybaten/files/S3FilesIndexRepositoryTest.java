package andriy.prybaten.files;

import io.micronaut.test.extensions.junit5.annotation.MicronautTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.BucketAlreadyExistsException;
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException;

import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Exercises S3FilesIndexRepository against LocalStack - a near-copy of
 * vault-lambda's S3VaultRepositoryTest, on purpose, matching how
 * S3FilesIndexRepository itself is a deliberate near-copy of S3VaultRepository
 * (see that class's own Javadoc, docs/file-storage-plan.md sec 4).
 */
@MicronautTest
class S3FilesIndexRepositoryTest {

    @Inject
    S3Client s3Client;

    @Inject
    FilesIndexRepository filesIndexRepository;

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
    void getThrowsWhenNoIndexUploadedYet() {
        assertThrows(FilesIndexNotFoundException.class, () -> filesIndexRepository.get("user-with-no-index"));
    }

    @Test
    void putThenGetRoundTripsCiphertext() {
        String userSub = "user-" + System.nanoTime();
        byte[] ciphertext = "not-real-ciphertext-just-bytes".getBytes();

        FilesIndexBlob written = filesIndexRepository.put(userSub, ciphertext);
        assertNotNull(written.updatedAt());

        FilesIndexBlob read = filesIndexRepository.get(userSub);
        assertArrayEquals(ciphertext, Base64.getDecoder().decode(read.ciphertextBase64()));
    }

    @Test
    void aSecondPutOverwritesRatherThanAppending() {
        String userSub = "user-" + System.nanoTime();
        filesIndexRepository.put(userSub, "first-version".getBytes());
        filesIndexRepository.put(userSub, "second-version".getBytes());

        FilesIndexBlob read = filesIndexRepository.get(userSub);
        assertArrayEquals("second-version".getBytes(), Base64.getDecoder().decode(read.ciphertextBase64()));
    }
}
