package andriy.prybaten.vault;

import andriy.prybaten.error.ResourceNotFoundException;

public class VaultNotFoundException extends ResourceNotFoundException {

    public VaultNotFoundException(String userSub) {
        super("No vault found for user " + userSub);
    }
}
