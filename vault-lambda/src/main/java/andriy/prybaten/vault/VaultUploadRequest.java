package andriy.prybaten.vault;

import io.micronaut.serde.annotation.Serdeable;

@Serdeable
public record VaultUploadRequest(String ciphertextBase64) {
}
