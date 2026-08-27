package andriy.prybaten.files;

import io.micronaut.serde.annotation.Serdeable;

import java.time.Instant;

/**
 * The encrypted files index, as returned to/from the client - mirrors
 * {@code vault.VaultBlob} exactly in spirit: {@code ciphertextBase64} is
 * opaque AES-256-GCM output produced client-side (encrypted with the Vault
 * Key, same as the vault itself - docs/file-storage-plan.md sec 4), and the
 * backend never decodes it beyond base64.
 *
 * <p>No {@code versionId} field, unlike {@code VaultBlob} - the files bucket
 * is deliberately unversioned (sec 6: "deletion means deletion" would fight
 * versioning), so S3 never returns one here to carry.
 */
@Serdeable
public record FilesIndexBlob(String ciphertextBase64, Instant updatedAt) {
}
