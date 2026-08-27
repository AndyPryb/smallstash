package andriy.prybaten.files;

import io.micronaut.context.annotation.ConfigurationProperties;

/**
 * The one bucket name this Lambda needs. Deliberately much smaller than
 * vault-lambda's {@code StorageProperties} - no users-table property here at
 * all, since this Lambda has zero DynamoDB access
 * (docs/file-storage-plan.md sec 8.5). Same config prefix
 * ({@code smallstash.storage}) as vault-lambda's equivalent purely by
 * convention - the two never load into the same JVM, so there's no
 * collision to worry about.
 */
@ConfigurationProperties("smallstash.storage")
public interface FilesStorageProperties {

    String getFilesBucket();
}
