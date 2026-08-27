package andriy.prybaten.files;

import andriy.prybaten.error.ResourceNotFoundException;

/**
 * Thrown when a user has never uploaded a files index yet - mirrors
 * {@code vault.VaultNotFoundException} exactly. {@code common}'s
 * {@code ResourceNotFoundExceptionHandler} maps this to 404 with no code
 * duplicated here.
 */
public class FilesIndexNotFoundException extends ResourceNotFoundException {

    public FilesIndexNotFoundException(String userSub) {
        super("No files index found for user " + userSub);
    }
}
