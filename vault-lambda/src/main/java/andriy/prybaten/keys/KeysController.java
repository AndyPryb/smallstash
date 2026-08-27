package andriy.prybaten.keys;

import andriy.prybaten.security.CurrentUser;
import io.micronaut.http.HttpStatus;
import io.micronaut.http.annotation.Body;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Put;
import io.micronaut.http.annotation.Status;
import io.micronaut.security.annotation.Secured;
import io.micronaut.security.authentication.Authentication;
import io.micronaut.security.rules.SecurityRule;

@Secured(SecurityRule.IS_AUTHENTICATED)
@Controller("/keys")
public class KeysController {

    private final UserKeysRepository userKeysRepository;

    public KeysController(UserKeysRepository userKeysRepository) {
        this.userKeysRepository = userKeysRepository;
    }

    @Get
    public UserKeys get(Authentication authentication) {
        String sub = CurrentUser.subOf(authentication);
        return userKeysRepository.findKeys(sub).orElseThrow(() -> new UserKeysNotFoundException(sub));
    }

    /**
     * First-time write at signup, or a deliberate master-password change -
     * not distinguishing those two cases yet, both just mean "the client
     * has decided these wrapped keys are now authoritative, store them."
     */
    @Put
    @Status(HttpStatus.NO_CONTENT)
    public void put(Authentication authentication, @Body UserKeys keys) {
        String sub = CurrentUser.subOf(authentication);
        userKeysRepository.createProfileIfAbsent(sub, "free");
        userKeysRepository.saveKeys(sub, keys);
    }
}
