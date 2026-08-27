package andriy.prybaten.files;

import jakarta.inject.Singleton;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.S3Object;

/**
 * Per-user storage usage, computed live by listing S3 rather than tracked in
 * a ledger - see docs/file-storage-plan.md sec 8.5/todo.md: this Lambda has
 * zero DynamoDB access by design, so there is no table row for
 * {@code UserProfile.storageBytesUsed} (the field the original plan named)
 * to read or write here. Listing instead means usage can never drift from
 * reality - a delete is reflected the next time anything asks, with no
 * separate counter to keep in sync - at the cost of an
 * {@code s3:ListBucket} call per check. At the file counts this app will
 * ever see (low tens, bounded by the 25 MiB/file and ~500 MiB/user caps),
 * that's one cheap, unpaginated-in-practice request, not a scaling concern.
 */
@Singleton
public class FilesUsageService {

    private final S3Client s3;
    private final FilesStorageProperties storageProperties;

    public FilesUsageService(S3Client s3, FilesStorageProperties storageProperties) {
        this.s3 = s3;
        this.storageProperties = storageProperties;
    }

    /**
     * Sums the size of every object under the user's {@code files/} prefix,
     * regardless of {@code state=pending}/{@code state=live} tag - a
     * not-yet-committed upload already occupies real S3 storage and must
     * count, or a client could bypass the quota by uploading many objects
     * and never committing them. Paginated via the SDK's built-in iterable
     * (correct at any scale, even though this app never approaches one page).
     *
     * @param userSub whose usage to compute
     * @return total bytes currently stored across all of that user's file objects
     */
    public long currentUsageBytes(String userSub) {
        ListObjectsV2Request request = ListObjectsV2Request.builder()
                .bucket(storageProperties.getFilesBucket())
                .prefix(filesPrefix(userSub))
                .build();

        long total = 0;
        for (S3Object object : s3.listObjectsV2Paginator(request).contents()) {
            total += object.size();
        }
        return total;
    }

    static String filesPrefix(String userSub) {
        return "users/%s/files/".formatted(userSub);
    }

    static String fileKey(String userSub, String fileId) {
        return filesPrefix(userSub) + fileId;
    }
}
