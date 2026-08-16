package andriy.prybaten.config;

import io.micronaut.context.annotation.ConfigurationProperties;

/**
 * Bucket/table names for the hybrid storage layer - see
 * docs/decisions/0001-storage-s3-vs-dynamodb.md for why S3 and DynamoDB are
 * both in play.
 */
@ConfigurationProperties("smallstash.storage")
public interface StorageProperties {

    String getVaultBucket();

    String getUsersTable();
}
