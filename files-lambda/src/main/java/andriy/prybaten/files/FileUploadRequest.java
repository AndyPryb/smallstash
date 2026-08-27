package andriy.prybaten.files;

import io.micronaut.serde.annotation.Serdeable;

/**
 * The client's declared ciphertext size, in bytes, for a file it's about to
 * upload. Used only as a fast, non-authoritative pre-check (reject an
 * obviously-oversized or clearly-over-quota request before minting a URL
 * that would only fail later) - see {@link FilesController} for why the
 * real enforcement happens at commit time instead, against what S3 actually
 * received.
 */
@Serdeable
public record FileUploadRequest(long sizeBytes) {
}
