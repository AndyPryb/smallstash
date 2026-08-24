package andriy.prybaten.keys;

/**
 * A {@code PUT /keys} was rejected because its {@code keyVersion} wasn't newer
 * than the one already stored - mapped to HTTP 409 by
 * {@link KeyVersionConflictExceptionHandler}.
 *
 * <p>This guards the single most destructive write in the system. The KEYS
 * item holds the only copy of the wrapped Vault Key; the S3 vault blob is
 * versioned, but this isn't. Overwrite it with key material derived from a
 * different Master Password and every existing vault version - current and
 * historical - becomes permanently undecryptable. A stale or replayed write
 * losing someone's entire vault is a worse outcome than a rejected one, so
 * the write is conditional and this is what a losing race looks like.
 */
public class KeyVersionConflictException extends RuntimeException {

    public KeyVersionConflictException(String userSub, int attemptedKeyVersion) {
        super("Rejected key material for user " + userSub + " at keyVersion " + attemptedKeyVersion
                + ": the stored keyVersion is the same or newer. Re-fetch GET /keys and retry.");
    }
}
