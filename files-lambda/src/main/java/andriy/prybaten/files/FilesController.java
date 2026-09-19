package andriy.prybaten.files;

import andriy.prybaten.security.CurrentUser;
import io.micronaut.http.HttpStatus;
import io.micronaut.http.annotation.Body;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Delete;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.PathVariable;
import io.micronaut.http.annotation.Post;
import io.micronaut.http.annotation.Status;
import io.micronaut.http.exceptions.HttpStatusException;
import io.micronaut.security.annotation.Secured;
import io.micronaut.security.authentication.Authentication;
import io.micronaut.security.rules.SecurityRule;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectTaggingRequest;
import software.amazon.awssdk.services.s3.model.Tag;
import software.amazon.awssdk.services.s3.model.Tagging;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Mint/commit/delete for individual file objects - contents only, never
 * metadata (that's {@link FilesIndexController}). See
 * docs/file-storage-plan.md sec 3/5 for the overall design this implements,
 * and the note below for one significant way this deviates from what that
 * document originally proposed.
 *
 * <h2>Deviation from the plan: PUT, not POST, and why</h2>
 *
 * The plan called for a presigned <b>POST</b> specifically because its
 * {@code content-length-range} policy condition lets the server bound the
 * uploaded size before any bytes arrive. That turned out not to be buildable
 * as designed: <b>AWS SDK v2's {@code S3Presigner} has no presigned-POST
 * support at all</b> - confirmed by listing every class in
 * {@code software.amazon.awssdk.services.s3.presigner.model} (only
 * Get/Put/Head/Delete/multipart-step presign requests exist), not assumed
 * from memory. Hand-rolling AWS's raw POST-policy signing (a base64 JSON
 * policy, SigV4 signing-key derivation, an {@code x-amz-security-token}
 * field for the Lambda's temporary role credentials) was deliberately not
 * attempted - that is exactly the kind of security-sensitive code that is
 * easy to get subtly wrong, security-critical enough that "not offered by
 * the SDK" is reason enough on its own not to hand-roll it.
 *
 * <p>Used instead: a presigned <b>PUT</b>, which SDK v2 does support, plus
 * the tagging condition still carried as a signed header
 * ({@code x-amz-tagging}) so the orphan-cleanup tag-then-lifecycle design
 * (sec 5) is unaffected. What's lost is the ability to reject an oversized
 * body <i>before</i> S3 accepts it - a presigned PUT's SigV4 signature does
 * not cover {@code Content-Length} the way a POST policy would.
 * <b>Compensating control</b>: {@link #commit} re-checks the
 * <i>actual</i> uploaded size via {@code HeadObject} and the user's real
 * total usage, and deletes-and-rejects if either is over limit. This is
 * real enforcement, just after the fact rather than before it - a briefly
 * oversized object can exist between upload and commit, where the
 * plan's original design would have refused it outright. Worth revisiting
 * with hand-rolled POST-policy signing later if that gap ever matters more
 * than the risk of shipping untested signing code does now.
 */
@Secured(SecurityRule.IS_AUTHENTICATED)
@Controller("/files")
public class FilesController {

    /** Decision #1 (docs/file-storage-plan.md sec 0): 25 MiB per file. */
    static final long MAX_FILE_SIZE_BYTES = 25L * 1024 * 1024;

    /** Decision #2: ~500 MiB per user, enforced at commit time (see class Javadoc). */
    static final long MAX_USER_QUOTA_BYTES = 500L * 1024 * 1024;

    /** Agreed TTL (sec 3): comfortably enough for one upload up to the cap, even on a slow connection. */
    static final Duration PRESIGN_TTL = Duration.ofMinutes(5);

    /** The tag every object is uploaded with; {@link #commit} flips it to {@code live}. */
    static final String TAG_KEY = "state";
    static final String TAG_VALUE_PENDING = "pending";
    static final String TAG_VALUE_LIVE = "live";

    /**
     * Every {@code fileId} this app has ever minted comes from
     * {@link UUID#randomUUID()}, so a canonical lowercase UUID is the exact
     * shape of the only legitimate value - see {@link #requireValidFileId}.
     *
     * <p>Deliberately a regex rather than {@link UUID#fromString}: that method
     * is lenient (it accepts {@code 1-1-1-1-1} and other non-canonical forms),
     * and since the *original* string - not the parsed object - is what gets
     * concatenated into the S3 key, its leniency would be the thing being
     * relied on. A strict pattern has no such gap. Lowercase-only breaks
     * nothing: {@code randomUUID().toString()} never emits uppercase, so no
     * existing object has a key this rejects.
     */
    private static final java.util.regex.Pattern FILE_ID_PATTERN =
            java.util.regex.Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private final S3Client s3;
    private final S3Presigner presigner;
    private final FilesStorageProperties storageProperties;
    private final FilesUsageService usageService;

    public FilesController(
            S3Client s3,
            S3Presigner presigner,
            FilesStorageProperties storageProperties,
            FilesUsageService usageService) {
        this.s3 = s3;
        this.presigner = presigner;
        this.storageProperties = storageProperties;
        this.usageService = usageService;
    }

    /**
     * Mints a presigned upload URL for a new file. Non-authoritative
     * pre-checks only (see class Javadoc) - real enforcement is in
     * {@link #commit}.
     */
    @Post
    public FileUploadResponse mint(Authentication authentication, @Body FileUploadRequest body) {
        String userSub = CurrentUser.subOf(authentication);

        if (body.sizeBytes() <= 0 || body.sizeBytes() > MAX_FILE_SIZE_BYTES) {
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "File exceeds the maximum size of " + MAX_FILE_SIZE_BYTES + " bytes");
        }

        long currentUsage = usageService.currentUsageBytes(userSub);
        if (currentUsage + body.sizeBytes() > MAX_USER_QUOTA_BYTES) {
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "This upload would exceed your storage quota of " + MAX_USER_QUOTA_BYTES + " bytes");
        }

        String fileId = UUID.randomUUID().toString();
        String key = FilesUsageService.fileKey(userSub, fileId);

        PresignedPutObjectRequest presigned = presigner.presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(PRESIGN_TTL)
                .putObjectRequest(PutObjectRequest.builder()
                        .bucket(storageProperties.getFilesBucket())
                        .key(key)
                        // Signed into the URL, so the client cannot upload
                        // without this exact tag - see the orphan-cleanup
                        // design in docs/file-storage-plan.md sec 5.
                        .tagging(TAG_KEY + "=" + TAG_VALUE_PENDING)
                        .build())
                .build());

        // signedHeaders() already includes everything the signature covers
        // (host, x-amz-date, x-amz-tagging, ...) - passed through verbatim
        // rather than re-listing just x-amz-tagging by hand, so this can
        // never drift from whatever the SDK actually signed.
        Map<String, String> headers = new LinkedHashMap<>();
        presigned.signedHeaders().forEach((name, values) -> headers.put(name, String.join(",", values)));

        return new FileUploadResponse(fileId, new PresignedUpload(presigned.url().toString(), headers));
    }

    /**
     * Mints a presigned GET for downloading a file - added while starting
     * Phase 2 (docs/file-storage-plan.md), a gap found in Phase 1's own
     * review rather than before it: the bucket is {@code BLOCK_ALL} public
     * access, so nothing lets a browser fetch an object directly without
     * this. Same TTL as upload; no existence check first (an expired/wrong
     * presigned URL fails the same way a 404 would from the client's point
     * of view, so there is nothing extra to catch here).
     */
    @Get("/{fileId}/url")
    public FileDownloadResponse downloadUrl(Authentication authentication, @PathVariable String fileId) {
        requireValidFileId(fileId);
        String userSub = CurrentUser.subOf(authentication);
        String key = FilesUsageService.fileKey(userSub, fileId);

        PresignedGetObjectRequest presigned = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(PRESIGN_TTL)
                .getObjectRequest(GetObjectRequest.builder()
                        .bucket(storageProperties.getFilesBucket())
                        .key(key)
                        .build())
                .build());

        return new FileDownloadResponse(presigned.url().toString());
    }

    /**
     * Confirms an upload actually happened and marks it live - and, per the
     * class Javadoc, is where real size/quota enforcement actually lives.
     */
    @Post("/{fileId}/commit")
    public FileCommitResponse commit(Authentication authentication, @PathVariable String fileId) {
        requireValidFileId(fileId);
        String userSub = CurrentUser.subOf(authentication);
        String key = FilesUsageService.fileKey(userSub, fileId);
        String bucket = storageProperties.getFilesBucket();

        HeadObjectResponse head;
        try {
            head = s3.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build());
        } catch (NoSuchKeyException e) {
            throw new HttpStatusException(HttpStatus.NOT_FOUND, "No upload found for file " + fileId);
        }

        long actualSize = head.contentLength() == null ? 0 : head.contentLength();

        if (actualSize > MAX_FILE_SIZE_BYTES) {
            s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "Uploaded file exceeds the maximum size of " + MAX_FILE_SIZE_BYTES + " bytes");
        }

        // Usage already includes this object (it exists in S3 now, counted
        // by the same prefix listing) - no need to add actualSize separately.
        long totalUsage = usageService.currentUsageBytes(userSub);
        if (totalUsage > MAX_USER_QUOTA_BYTES) {
            s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "This file would exceed your storage quota of " + MAX_USER_QUOTA_BYTES + " bytes");
        }

        s3.putObjectTagging(PutObjectTaggingRequest.builder()
                .bucket(bucket)
                .key(key)
                .tagging(Tagging.builder()
                        .tagSet(List.of(Tag.builder().key(TAG_KEY).value(TAG_VALUE_LIVE).build()))
                        .build())
                .build());

        return new FileCommitResponse(actualSize);
    }

    /**
     * Idempotent by design - deleting a file that's already gone (or was
     * never committed) is still success from the caller's point of view, so
     * this never checks existence first, just like S3's own DeleteObject.
     */
    @Delete("/{fileId}")
    @Status(HttpStatus.NO_CONTENT)
    public void delete(Authentication authentication, @PathVariable String fileId) {
        requireValidFileId(fileId);
        String userSub = CurrentUser.subOf(authentication);
        s3.deleteObject(DeleteObjectRequest.builder()
                .bucket(storageProperties.getFilesBucket())
                .key(FilesUsageService.fileKey(userSub, fileId))
                .build());
    }

    /**
     * Rejects any {@code fileId} that isn't a canonical UUID, before it can
     * reach {@link FilesUsageService#fileKey} and become part of an S3 key.
     *
     * <p>Without this, {@code fileId} was a raw URL path segment concatenated
     * straight into the key. S3 does not normalise {@code ..} in object keys,
     * so a value like {@code ../../<other-sub>/files/<id>} would address
     * another user's object while still passing every authentication check -
     * the per-user prefix is the <i>only</i> thing isolating one account's
     * files from another's, and this is what keeps the client from writing
     * outside its own prefix. Whether API Gateway's own path handling would
     * have let an encoded {@code %2F} through to begin with was never
     * established either way; validating here means it no longer matters.
     *
     * <p>400, not 404: a malformed id is a bad request, and answering 404
     * would imply the id was well-formed but absent.
     */
    private static void requireValidFileId(String fileId) {
        if (fileId == null || !FILE_ID_PATTERN.matcher(fileId).matches()) {
            throw new HttpStatusException(HttpStatus.BAD_REQUEST, "Malformed file id");
        }
    }
}
