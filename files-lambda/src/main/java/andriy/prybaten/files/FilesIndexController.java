package andriy.prybaten.files;

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

/**
 * The encrypted files index - {@code GET}/{@code PUT}, mirroring
 * {@code vault.VaultController} almost exactly (docs/file-storage-plan.md
 * sec 4). Holds only metadata (name, size, MIME type, wrapped per-file key)
 * for every file the user has uploaded - never file contents, which live as
 * separate objects handled by {@link FilesController}.
 */
@Secured(SecurityRule.IS_AUTHENTICATED)
@Controller("/files-index")
public class FilesIndexController {

    /**
     * Generous relative to a realistic index (a few hundred bytes of JSON
     * per file - see the plan doc's metadata-cost note) but still a real
     * ceiling: this is metadata only, never file bytes, so there is no
     * legitimate reason for it to approach the vault's own 512 KiB cap.
     */
    static final int MAX_CIPHERTEXT_BYTES = 64 * 1024;

    static final int MAX_CIPHERTEXT_BASE64_CHARS = 4 * ((MAX_CIPHERTEXT_BYTES + 2) / 3);

    private final FilesIndexRepository filesIndexRepository;

    public FilesIndexController(FilesIndexRepository filesIndexRepository) {
        this.filesIndexRepository = filesIndexRepository;
    }

    @Get
    public FilesIndexBlob get(Authentication authentication) {
        return filesIndexRepository.get(CurrentUser.subOf(authentication));
    }

    @Put
    public FilesIndexBlob put(Authentication authentication, @Body FilesIndexUploadRequest body) {
        byte[] ciphertext = decodeCiphertext(body.ciphertextBase64());
        return filesIndexRepository.put(CurrentUser.subOf(authentication), ciphertext);
    }

    /** Same shape as {@code VaultController.decodeCiphertext} - see there for why each check exists. */
    private static byte[] decodeCiphertext(String ciphertextBase64) {
        if (ciphertextBase64 == null || ciphertextBase64.isEmpty()) {
            throw new HttpStatusException(HttpStatus.BAD_REQUEST, "ciphertextBase64 is required");
        }
        if (ciphertextBase64.length() > MAX_CIPHERTEXT_BASE64_CHARS) {
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "Files index exceeds the maximum size of " + MAX_CIPHERTEXT_BYTES + " bytes");
        }

        byte[] ciphertext;
        try {
            ciphertext = Base64.getDecoder().decode(ciphertextBase64);
        } catch (IllegalArgumentException e) {
            throw new HttpStatusException(HttpStatus.BAD_REQUEST, "ciphertextBase64 is not valid Base64");
        }

        if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
            throw new HttpStatusException(HttpStatus.REQUEST_ENTITY_TOO_LARGE,
                    "Files index exceeds the maximum size of " + MAX_CIPHERTEXT_BYTES + " bytes");
        }
        return ciphertext;
    }
}
