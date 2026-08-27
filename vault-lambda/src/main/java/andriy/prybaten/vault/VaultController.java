package andriy.prybaten.vault;

import andriy.prybaten.security.CurrentUser;
import io.micronaut.http.HttpStatus;
import io.micronaut.http.annotation.Body;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Put;
import io.micronaut.http.exceptions.HttpStatusException;
import io.micronaut.security.annotation.Secured;
import io.micronaut.security.authentication.Authentication;
import io.micronaut.security.rules.SecurityRule;

import java.util.Base64;

@Secured(SecurityRule.IS_AUTHENTICATED)
@Controller("/vault")
public class VaultController {

    /**
     * Hard ceiling on one user's vault ciphertext. A realistic vault is single
     * -digit kilobytes (a few hundred entries of text at ~100-200 bytes each),
     * so 512 KiB is still ~100x headroom for normal use while bounding the
     * worst case an order of magnitude tighter than the 1 MiB first tried.
     *
     * <p>This is a cost-abuse control, not just input validation. The bucket
     * is versioned with no way for a client to delete an old version, so every
     * PUT permanently adds its full size to stored bytes until the lifecycle
     * rule in {@code SmallstashStack} expires it. Without a cap, one
     * authenticated account could push the API's throttle ceiling worth of
     * multi-megabyte blobs and run up an unbounded S3 bill. See
     * docs/todo.md's "Security review 2026-08-24" (finding H-2).
     */
    static final int MAX_CIPHERTEXT_BYTES = 512 * 1024;

    /**
     * Base64 expands 3 bytes into 4 characters, rounded up to a 4-char block.
     * Checked before decoding so an oversized body is rejected without
     * allocating the decoded array for it first.
     */
    static final int MAX_CIPHERTEXT_BASE64_CHARS = 4 * ((MAX_CIPHERTEXT_BYTES + 2) / 3);

    private final VaultRepository vaultRepository;

    public VaultController(VaultRepository vaultRepository) {
        this.vaultRepository = vaultRepository;
    }

    @Get
    public VaultBlob get(Authentication authentication) {
        return vaultRepository.get(CurrentUser.subOf(authentication));
    }

    @Put
    public VaultBlob put(Authentication authentication, @Body VaultUploadRequest body) {
        byte[] ciphertext = decodeCiphertext(body.ciphertextBase64());
        return vaultRepository.put(CurrentUser.subOf(authentication), ciphertext);
    }

    /**
     * Decodes and size-checks the client's ciphertext, mapping every rejection
     * onto a deliberate 4xx. Note the plain {@code Base64.getDecoder().decode()}
     * this replaced threw {@link IllegalArgumentException} on malformed input,
     * which surfaced as an unhandled 500 - a client bug reported as a server
     * error.
     */
    private static byte[] decodeCiphertext(String ciphertextBase64) {
        if (ciphertextBase64 == null || ciphertextBase64.isEmpty()) {
            throw new HttpStatusException(HttpStatus.BAD_REQUEST, "ciphertextBase64 is required");
        }
        if (ciphertextBase64.length() > MAX_CIPHERTEXT_BASE64_CHARS) {
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "Vault exceeds the maximum size of " + MAX_CIPHERTEXT_BYTES + " bytes");
        }

        byte[] ciphertext;
        try {
            ciphertext = Base64.getDecoder().decode(ciphertextBase64);
        } catch (IllegalArgumentException e) {
            throw new HttpStatusException(HttpStatus.BAD_REQUEST, "ciphertextBase64 is not valid Base64");
        }

        // The char-length check above is an approximation (padding, and it
        // can't account for a decoder that tolerates whitespace); this is the
        // authoritative one, on the bytes actually about to be stored.
        if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "Vault exceeds the maximum size of " + MAX_CIPHERTEXT_BYTES + " bytes");
        }
        return ciphertext;
    }
}
