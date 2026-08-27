package andriy.prybaten.vault;

public interface VaultRepository {

    /** @throws VaultNotFoundException if the user has never uploaded a vault. */
    VaultBlob get(String userSub);

    VaultBlob put(String userSub, byte[] ciphertext);
}
