package andriy.prybaten.vault;

import io.micronaut.serde.annotation.Serdeable;

import java.time.Instant;

/**
 * The whole encrypted vault, as returned to/from the client. {@code
 * ciphertextBase64} is opaque AES-256-GCM output produced client-side - the
 * backend never decodes it beyond base64, let alone decrypts it.
 */
@Serdeable
public record VaultBlob(String ciphertextBase64, String versionId, Instant updatedAt) {
}
