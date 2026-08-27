package andriy.prybaten.keys;

import io.micronaut.serde.annotation.Serdeable;

/**
 * Argon2id parameters + wrapped Vault Key material for one user - see
 * docs/architecture.md sec 3/4a. Every value here is either a public KDF
 * parameter or ciphertext (a key wrapped by another key); none of it is
 * usable without the user's Master Password or Recovery Key, which never
 * leave the client.
 */
@Serdeable
public record UserKeys(
        String kdfSalt,
        int kdfMemoryKib,
        int kdfIterations,
        int kdfParallelism,
        String wrappedVaultKeyByMaster,
        String wrappedVaultKeyByRecovery,
        int keyVersion) {
}
