package andriy.prybaten.vault;

import andriy.prybaten.security.CurrentUser;
import io.micronaut.http.annotation.Body;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Put;
import io.micronaut.security.annotation.Secured;
import io.micronaut.security.authentication.Authentication;
import io.micronaut.security.rules.SecurityRule;

import java.util.Base64;

@Secured(SecurityRule.IS_AUTHENTICATED)
@Controller("/vault")
public class VaultController {

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
        byte[] ciphertext = Base64.getDecoder().decode(body.ciphertextBase64());
        return vaultRepository.put(CurrentUser.subOf(authentication), ciphertext);
    }
}
