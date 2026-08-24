import { seal, open } from './aesgcm.js';
import { deriveMasterKey, DEFAULT_KDF_PARAMS, KEY_LENGTH } from './kdf.js';
import {
  generateRecoveryKey,
  parseRecoveryKey,
  deriveRecoveryWrapKey,
} from './recovery.js';
import { toBase64, fromBase64, utf8, fromUtf8, randomBytes, wipe } from '../bytes.js';

/**
 * The zero-knowledge boundary, assembled. Everything the server ever sees is
 * produced here and is either ciphertext or a public KDF parameter:
 *
 *   Master Password --Argon2id--> Master Key --AES-GCM--> wraps Vault Key
 *   Recovery Key    --HKDF-----> Recovery Wrap Key --AES-GCM--> wraps Vault Key
 *   Vault Key       --AES-GCM--> encrypts the vault document
 *
 * The Vault Key is what actually encrypts data; the two wrapped copies are
 * just two doors to the same key. That indirection is what makes changing the
 * Master Password cheap - re-wrap one 32-byte key, don't re-encrypt the vault.
 */

const SALT_LENGTH = 16;

/**
 * @typedef {object} UserKeys server-side KEYS item; matches UserKeys.java
 * @property {string} kdfSalt base64
 * @property {number} kdfMemoryKib
 * @property {number} kdfIterations
 * @property {number} kdfParallelism
 * @property {string} wrappedVaultKeyByMaster base64
 * @property {string} wrappedVaultKeyByRecovery base64
 * @property {number} keyVersion
 */

/**
 * First-time setup: mint a Vault Key and both wrapped copies of it.
 *
 * @param {string} masterPassword
 * @returns {Promise<{ userKeys: UserKeys, vaultKey: Uint8Array, recoveryKey: string }>}
 *   `recoveryKey` is the formatted string to show the user exactly once - it
 *   is never stored anywhere, by us or by the server.
 */
export async function createKeyMaterial(masterPassword) {
  const salt = randomBytes(SALT_LENGTH);
  const vaultKey = randomBytes(KEY_LENGTH);
  const recovery = generateRecoveryKey();

  const masterKey = await deriveMasterKey(masterPassword, salt, DEFAULT_KDF_PARAMS);
  const recoveryWrapKey = await deriveRecoveryWrapKey(recovery.bytes, salt);

  const userKeys = {
    kdfSalt: toBase64(salt),
    ...DEFAULT_KDF_PARAMS,
    wrappedVaultKeyByMaster: toBase64(await seal(masterKey, vaultKey)),
    wrappedVaultKeyByRecovery: toBase64(await seal(recoveryWrapKey, vaultKey)),
    keyVersion: nextKeyVersion(),
  };

  wipe(masterKey);
  wipe(recoveryWrapKey);
  wipe(recovery.bytes);

  return { userKeys, vaultKey, recoveryKey: recovery.formatted };
}

/**
 * @param {UserKeys} userKeys
 * @param {string} masterPassword
 * @returns {Promise<Uint8Array>} the unwrapped Vault Key
 * @throws {WrongSecretError} if the Master Password is wrong
 */
export async function unlockWithMasterPassword(userKeys, masterPassword) {
  const masterKey = await deriveMasterKey(
    masterPassword,
    fromBase64(userKeys.kdfSalt),
    userKeys,
  );
  try {
    return await open(masterKey, fromBase64(userKeys.wrappedVaultKeyByMaster));
  } catch {
    // GCM authenticates, so a failed unwrap means a wrong password (or
    // tampering) - never silent garbage. Deliberately not distinguishing
    // those two cases to the user; both mean "this didn't open".
    throw new WrongSecretError('Incorrect Master Password');
  } finally {
    wipe(masterKey);
  }
}

/**
 * @param {UserKeys} userKeys
 * @param {string} recoveryKeyInput as typed by the user
 * @returns {Promise<Uint8Array>} the unwrapped Vault Key
 * @throws {WrongSecretError} if the Recovery Key is wrong or malformed
 */
export async function unlockWithRecoveryKey(userKeys, recoveryKeyInput) {
  const salt = fromBase64(userKeys.kdfSalt);

  let recoveryBytes;
  try {
    recoveryBytes = parseRecoveryKey(recoveryKeyInput);
  } catch (err) {
    throw new WrongSecretError(err.message);
  }

  const wrapKey = await deriveRecoveryWrapKey(recoveryBytes, salt);
  try {
    return await open(wrapKey, fromBase64(userKeys.wrappedVaultKeyByRecovery));
  } catch {
    throw new WrongSecretError('That Recovery Key does not match this account');
  } finally {
    wipe(recoveryBytes);
    wipe(wrapKey);
  }
}

/**
 * Change the Master Password: re-wrap the *same* Vault Key under a new Master
 * Key. The vault ciphertext is untouched, so this stays a single small write
 * no matter how large the vault is.
 *
 * A fresh salt is generated rather than reused - reusing it would let anyone
 * holding the old blob confirm a password change happened, and costs nothing
 * to avoid. The recovery copy is re-wrapped under the same salt too, which is
 * why the caller must supply the current Recovery Key.
 *
 * @param {object} args
 * @param {Uint8Array} args.vaultKey the already-unwrapped Vault Key
 * @param {string} args.newMasterPassword
 * @param {string} args.recoveryKeyInput current Recovery Key, re-wrapped as-is
 * @param {number} [args.previousKeyVersion] the currently-stored keyVersion,
 *   so the new one is guaranteed to be greater - `PUT /keys` rejects anything
 *   that isn't (see nextKeyVersion)
 * @returns {Promise<UserKeys>}
 */
export async function rewrapWithNewMasterPassword({
  vaultKey,
  newMasterPassword,
  recoveryKeyInput,
  previousKeyVersion,
}) {
  const salt = randomBytes(SALT_LENGTH);
  const recoveryBytes = parseRecoveryKey(recoveryKeyInput);

  const masterKey = await deriveMasterKey(newMasterPassword, salt, DEFAULT_KDF_PARAMS);
  const recoveryWrapKey = await deriveRecoveryWrapKey(recoveryBytes, salt);

  const userKeys = {
    kdfSalt: toBase64(salt),
    ...DEFAULT_KDF_PARAMS,
    wrappedVaultKeyByMaster: toBase64(await seal(masterKey, vaultKey)),
    wrappedVaultKeyByRecovery: toBase64(await seal(recoveryWrapKey, vaultKey)),
    keyVersion: nextKeyVersion(previousKeyVersion),
  };

  wipe(masterKey);
  wipe(recoveryWrapKey);
  wipe(recoveryBytes);
  return userKeys;
}

/**
 * @param {Uint8Array} vaultKey
 * @param {object} vaultDocument
 * @returns {Promise<string>} base64 ciphertext, ready for PUT /vault
 */
export async function encryptVault(vaultKey, vaultDocument) {
  const plaintext = utf8(JSON.stringify(vaultDocument));
  const sealed = await seal(vaultKey, plaintext);
  wipe(plaintext);
  return toBase64(sealed);
}

/**
 * @param {Uint8Array} vaultKey
 * @param {string} ciphertextBase64 as returned by GET /vault
 * @returns {Promise<object>} the decrypted vault document
 */
export async function decryptVault(vaultKey, ciphertextBase64) {
  const plaintext = await open(vaultKey, fromBase64(ciphertextBase64));
  try {
    return JSON.parse(fromUtf8(plaintext));
  } finally {
    wipe(plaintext);
  }
}

/**
 * Unix *seconds*, not milliseconds: keyVersion is an `int` backend-side
 * (UserKeys.java) and ms-epoch overflows 32 bits. Same reasoning as the note
 * in tests/api/keys.test.js.
 *
 * `PUT /keys` is conditional on the new version being strictly greater than
 * the stored one (DynamoDbUserKeysRepository.saveKeys), so a bare clock read
 * isn't enough: a device whose clock is behind the one that wrote last - or
 * two changes inside the same second - would produce a version the backend
 * rejects, leaving that device permanently unable to change its Master
 * Password. Stepping past the previous version keeps it monotonic regardless
 * of clock skew, while still being wall-clock-ish in the normal case.
 *
 * @param {number} [previousKeyVersion] the currently-stored version, if any
 */
function nextKeyVersion(previousKeyVersion = 0) {
  return Math.max(Math.floor(Date.now() / 1000), (previousKeyVersion ?? 0) + 1);
}

/** Wrong Master Password / Recovery Key - expected, user-correctable. */
export class WrongSecretError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'WrongSecretError';
  }
}
