package andriy.prybaten.keys;

import andriy.prybaten.error.ResourceNotFoundException;

public class UserKeysNotFoundException extends ResourceNotFoundException {

    public UserKeysNotFoundException(String userSub) {
        super("No key material for user " + userSub);
    }
}
