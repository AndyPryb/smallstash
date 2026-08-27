package andriy.prybaten.files;

import io.micronaut.serde.annotation.Serdeable;

import java.util.Map;

/**
 * A presigned S3 {@code PUT} URL plus the exact headers the client must send
 * with it - both the URL's query string and these headers are covered by the
 * SigV4 signature, so the client cannot alter either without invalidating it.
 *
 * <p>Deliberately a PUT, not a POST-policy upload - see
 * {@link FilesController}'s class Javadoc for why: AWS SDK v2's
 * {@code S3Presigner} has no presigned-POST support at all (confirmed by
 * inspecting the actual dependency, not assumed), so the
 * {@code content-length-range} server-side size enforcement the original
 * plan called for isn't available through it. {@code headers} always
 * includes {@code x-amz-tagging: state=pending}, which is what still lets
 * this work with the plan's tag-then-lifecycle orphan cleanup
 * (docs/file-storage-plan.md sec 5) even without POST-policy.
 */
@Serdeable
public record PresignedUpload(String url, Map<String, String> headers) {
}
