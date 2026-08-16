package andriy.prybaten.security;

import io.micronaut.security.authentication.Authentication;

/**
 * Single place that turns a verified {@link Authentication} into the Cognito
 * {@code sub} used as the DynamoDB partition key and S3 key prefix for a
 * user. {@code authentication.getName()} returns the JWT subject claim by
 * default in micronaut-security-jwt - kept behind this indirection so
 * there's exactly one spot to change if that mapping ever needs a custom
 * claim.
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static String subOf(Authentication authentication) {
        return authentication.getName();
    }
}
