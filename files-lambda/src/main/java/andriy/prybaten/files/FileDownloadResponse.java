package andriy.prybaten.files;

import io.micronaut.serde.annotation.Serdeable;

@Serdeable
public record FileDownloadResponse(String url) {
}
