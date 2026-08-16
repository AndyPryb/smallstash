package andriy.prybaten.vault;

import andriy.prybaten.config.StorageProperties;
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

/** Exercises S3VaultRepository against LocalStack (docs/architecture.md sec 4b). */
@MicronautTest
class S3VaultRepositoryTest {

    @Inject
    S3Client s3Client;

    @Inject
    VaultRepository vaultRepository;

    @Inject
    StorageProperties storageProperties;

    @BeforeEach
    void ensureBucketExists() {
        try {
            s3Client.createBucket(b -> b.bucket(storageProperties.getVaultBucket()));
        } catch (BucketAlreadyOwnedByYouException | BucketAlreadyExistsException alreadyThere) {
            // created by an earlier test in this run - fine.
        }
    }

    @Test
    void getThrowsWhenNoVaultUploadedYet() {
        assertThrows(VaultNotFoundException.class, () -> vaultRepository.get("user-with-no-vault"));
    }

    @Test
    void putThenGetRoundTripsCiphertext() {
        String userSub = "user-" + System.nanoTime();
        byte[] ciphertext = "not-real-ciphertext-just-bytes".getBytes();

        VaultBlob written = vaultRepository.put(userSub, ciphertext);
        assertNotNull(written.updatedAt());

        VaultBlob read = vaultRepository.get(userSub);
        assertArrayEquals(ciphertext, Base64.getDecoder().decode(read.ciphertextBase64()));
    }
}
