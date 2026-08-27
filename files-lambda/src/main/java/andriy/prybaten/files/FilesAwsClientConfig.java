package andriy.prybaten.files;

import io.micronaut.context.annotation.Factory;
import jakarta.inject.Singleton;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ServiceClientConfiguration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * {@code micronaut-aws-sdk-v2} auto-creates the {@link S3Client} bean
 * (region/credentials/endpoint-override wired from
 * {@code aws.services.s3.*}, and from LocalStack's test-resources module in
 * local dev/test - see {@code application.properties}), but does not create
 * an {@link S3Presigner} - that's only needed here, for the presigned-POST
 * upload URLs vault-lambda has no equivalent of.
 *
 * <p>Built <em>from</em> the already-configured {@code S3Client} bean's own
 * {@link S3ServiceClientConfiguration} rather than re-deriving
 * region/credentials/endpoint-override independently - this is what
 * guarantees the presigner and the client agree (both point at LocalStack in
 * tests, both point at real S3 when deployed) by construction, not by
 * keeping two separately-written configuration paths in sync by hand.
 */
@Factory
public class FilesAwsClientConfig {

    @Singleton
    S3Presigner s3Presigner(S3Client s3Client) {
        S3ServiceClientConfiguration config = s3Client.serviceClientConfiguration();
        S3Presigner.Builder builder = S3Presigner.builder()
                .region(config.region())
                .credentialsProvider(config.credentialsProvider());
        config.endpointOverride().ifPresent(builder::endpointOverride);
        return builder.build();
    }
}
