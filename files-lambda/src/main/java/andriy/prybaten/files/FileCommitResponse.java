package andriy.prybaten.files;

import io.micronaut.serde.annotation.Serdeable;

/**
 * The authoritative size S3 actually received, returned so the client can
 * reconcile its local files-index metadata against reality rather than
 * trust its own pre-upload estimate.
 */
@Serdeable
public record FileCommitResponse(long sizeBytes) {
}
