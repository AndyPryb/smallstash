import { seal, open } from './aesgcm.js';
import { KEY_LENGTH } from './kdf.js';
import { randomBytes, toBase64, fromBase64, wipe } from '../bytes.js';

/**
 * File encryption - a second application of the same envelope
 * `crypto/vault.js` already uses, not a new primitive. See
 * docs/file-storage-plan.md §4:
 *
 *   Vault Key ──wraps──> per-file DEK ──encrypts──> file bytes
 *        │
 *        └──encrypts──> files-index.json (holds the wrapped DEK + metadata)
 *
 * Wrapped by the **Vault Key**, not the Master Key - load-bearing, not a
 * style choice. Changing the Master Password only re-wraps the Vault Key
 * (`rewrapWithNewMasterPassword` in crypto/vault.js); because every file's
 * DEK is wrapped by the Vault Key rather than derived from the Master
 * Password directly, a password change touches zero files. The same
 * property is what gives the Recovery Key access to files for free - it
 * already unwraps the Vault Key, and that's all any file needs too.
 *
 * Deliberately whole-file, not chunked/streamed - see the plan doc §4's
 * disambiguation. WebCrypto's AES-GCM needs the whole plaintext in memory at
 * once regardless (peak ~2x the file size), which is fine at the agreed
 * 25 MiB per-file cap. `MAX_FILE_SIZE_BYTES` here mirrors
 * `FilesController.MAX_FILE_SIZE_BYTES` server-side - the server is the
 * real enforcement (see that class's Javadoc for why, and how commit-time
 * checking replaced the presigned-POST size limit the original plan
 * assumed); this is purely the immediate, no-round-trip UX check, same
 * relationship as MAX_VAULT_CIPHERTEXT_BYTES/VaultController.
 */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** @returns {Uint8Array} a fresh 32-byte per-file data encryption key (DEK) */
export function generateFileKey() {
  return randomBytes(KEY_LENGTH);
}

/**
 * @param {Uint8Array} vaultKey
 * @param {Uint8Array} fileKey
 * @returns {Promise<string>} base64 wrapped DEK, ready to store in the files index
 */
export async function wrapFileKey(vaultKey, fileKey) {
  return toBase64(await seal(vaultKey, fileKey));
}

/**
 * @param {Uint8Array} vaultKey
 * @param {string} wrappedFileKeyBase64 as read from the files index
 * @returns {Promise<Uint8Array>} the unwrapped per-file DEK
 * @throws if the Vault Key is wrong or the wrapped key was tampered with -
 *   GCM authenticates, so this can't silently return garbage
 */
export async function unwrapFileKey(vaultKey, wrappedFileKeyBase64) {
  return open(vaultKey, fromBase64(wrappedFileKeyBase64));
}

/**
 * Encrypts a file's plaintext bytes with its own DEK.
 *
 * Returns a raw `Uint8Array`, deliberately **not** base64 - unlike the vault
 * and files-index blobs (small JSON, sent inside a JSON request body so
 * base64 makes sense), file ciphertext is uploaded as the literal body of a
 * `PUT` straight to S3 (see `api/files.js`). Base64-encoding a 25 MiB file
 * would cost ~33% extra bytes over the wire and ~33% extra peak memory for
 * no benefit - nothing on the upload path needs it to be text.
 *
 * @param {Uint8Array} fileKey
 * @param {Uint8Array} plaintextBytes
 * @returns {Promise<Uint8Array>} sealed ciphertext ready to upload
 * @throws if plaintextBytes exceeds {@link MAX_FILE_SIZE_BYTES}
 */
export async function encryptFile(fileKey, plaintextBytes) {
  if (plaintextBytes.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File is too large to encrypt (max ${MAX_FILE_SIZE_BYTES} bytes)`);
  }
  return seal(fileKey, plaintextBytes);
}

/**
 * @param {Uint8Array} fileKey
 * @param {Uint8Array} ciphertextBytes as downloaded from S3
 * @returns {Promise<Uint8Array>} the decrypted file bytes
 * @throws if the DEK is wrong or the file was tampered with
 */
export async function decryptFile(fileKey, ciphertextBytes) {
  return open(fileKey, ciphertextBytes);
}

/**
 * One entry in the decrypted files index - the shape of each element in its
 * `files` array. Matches `files-lambda`'s implicit schema
 * (docs/file-storage-plan.md §4); the backend never sees this shape, only
 * the encrypted blob it's serialized into.
 *
 * @typedef {object} FileMetadata
 * @property {string} id matches the S3 object's fileId / the backend's {fileId}
 * @property {string} name original filename, plaintext only ever client-side
 * @property {string} mimeType
 * @property {number} sizeBytes ciphertext size (what commit's response returned)
 * @property {string} wrappedFileKey base64, this file's DEK wrapped by the Vault Key
 * @property {string} createdAt ISO 8601
 */

/**
 * @param {Uint8Array} vaultKey
 * @param {{ files: FileMetadata[] }} filesIndexDocument
 * @returns {Promise<string>} base64 ciphertext, ready for PUT /files-index
 */
export async function encryptFilesIndex(vaultKey, filesIndexDocument) {
  const plaintext = new TextEncoder().encode(JSON.stringify(filesIndexDocument));
  const sealed = await seal(vaultKey, plaintext);
  wipe(plaintext);
  return toBase64(sealed);
}

/**
 * @param {Uint8Array} vaultKey
 * @param {string} ciphertextBase64 as returned by GET /files-index
 * @returns {Promise<{ files: FileMetadata[] }>}
 */
export async function decryptFilesIndex(vaultKey, ciphertextBase64) {
  const plaintext = await open(vaultKey, fromBase64(ciphertextBase64));
  try {
    return JSON.parse(new TextDecoder().decode(plaintext));
  } finally {
    wipe(plaintext);
  }
}
