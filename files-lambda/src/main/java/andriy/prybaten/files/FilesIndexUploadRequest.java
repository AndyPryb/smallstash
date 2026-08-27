package andriy.prybaten.files;

import io.micronaut.serde.annotation.Serdeable;

@Serdeable
public record FilesIndexUploadRequest(String ciphertextBase64) {
}
