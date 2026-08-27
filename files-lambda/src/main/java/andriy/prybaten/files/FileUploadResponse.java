package andriy.prybaten.files;

import io.micronaut.serde.annotation.Serdeable;

@Serdeable
public record FileUploadResponse(String fileId, PresignedUpload upload) {
}
