package andriy.prybaten.keys;

import java.util.Optional;

public interface UserKeysRepository {

    Optional<UserKeys> findKeys(String userSub);

    void saveKeys(String userSub, UserKeys keys);

    Optional<UserProfile> findProfile(String userSub);

    /** Idempotent - a no-op if the user already has a profile. */
    void createProfileIfAbsent(String userSub, String plan);
}
