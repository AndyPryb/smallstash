package andriy.prybaten.files;

public interface FilesIndexRepository {

    /** @throws FilesIndexNotFoundException if the user has never uploaded a files index. */
    FilesIndexBlob get(String userSub);

    FilesIndexBlob put(String userSub, byte[] ciphertext);
}
