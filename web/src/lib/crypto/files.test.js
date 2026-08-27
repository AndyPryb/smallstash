import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../bytes.js';
import {
  MAX_FILE_SIZE_BYTES,
  generateFileKey,
  wrapFileKey,
  unwrapFileKey,
  encryptFile,
  decryptFile,
  encryptFilesIndex,
  decryptFilesIndex,
} from './files.js';

test('generateFileKey produces a fresh 32-byte key each call', () => {
  const a = generateFileKey();
  const b = generateFileKey();
  assert.equal(a.byteLength, 32);
  assert.equal(b.byteLength, 32);
  assert.notEqual(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});

test('wrapFileKey/unwrapFileKey round-trips the same DEK under a Vault Key', async () => {
  const vaultKey = randomBytes(32);
  const fileKey = generateFileKey();

  const wrapped = await wrapFileKey(vaultKey, fileKey);
  const unwrapped = await unwrapFileKey(vaultKey, wrapped);

  assert.equal(Buffer.from(unwrapped).toString('hex'), Buffer.from(fileKey).toString('hex'));
});

test('unwrapFileKey fails with the wrong Vault Key', async () => {
  const vaultKey = randomBytes(32);
  const otherKey = randomBytes(32);
  const wrapped = await wrapFileKey(vaultKey, generateFileKey());

  await assert.rejects(() => unwrapFileKey(otherKey, wrapped));
});

test('encryptFile/decryptFile round-trips arbitrary bytes', async () => {
  const fileKey = generateFileKey();
  const plaintext = randomBytes(1024);

  const ciphertext = await encryptFile(fileKey, plaintext);
  const decrypted = await decryptFile(fileKey, ciphertext);

  assert.equal(Buffer.from(decrypted).toString('hex'), Buffer.from(plaintext).toString('hex'));
});

test('encryptFile output is not the plaintext (actually encrypted, not passed through)', async () => {
  const fileKey = generateFileKey();
  // A plaintext long enough that an accidental no-op wouldn't be masked by
  // ciphertext-overhead coincidence.
  const plaintext = new TextEncoder().encode('a'.repeat(256));

  const ciphertext = await encryptFile(fileKey, plaintext);

  assert.notEqual(Buffer.from(ciphertext).toString('hex'), Buffer.from(plaintext).toString('hex'));
});

test('decryptFile fails with the wrong DEK', async () => {
  const fileKey = generateFileKey();
  const otherKey = generateFileKey();
  const ciphertext = await encryptFile(fileKey, randomBytes(64));

  await assert.rejects(() => decryptFile(otherKey, ciphertext));
});

test('encryptFile rejects a file over the size cap', async () => {
  const fileKey = generateFileKey();
  // A byteLength-only stand-in is fine here: the cap check
  // (`plaintextBytes.byteLength > MAX_FILE_SIZE_BYTES`) reads only that
  // property, and this deliberately never reaches WebCrypto's encrypt() -
  // it should throw before that, which is exactly what's being asserted.
  const tooLarge = { byteLength: MAX_FILE_SIZE_BYTES + 1 };

  await assert.rejects(() => encryptFile(fileKey, tooLarge), /too large/i);
});

test('encryptFilesIndex/decryptFilesIndex round-trips an arbitrary document', async () => {
  const vaultKey = randomBytes(32);
  const document = {
    files: [
      {
        id: 'abc-123',
        name: 'passport-scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123456,
        wrappedFileKey: 'base64stuff',
        createdAt: new Date().toISOString(),
      },
    ],
  };

  const ciphertextBase64 = await encryptFilesIndex(vaultKey, document);
  const decrypted = await decryptFilesIndex(vaultKey, ciphertextBase64);

  assert.deepEqual(decrypted, document);
});

test('encryptFilesIndex/decryptFilesIndex round-trips an empty files list', async () => {
  const vaultKey = randomBytes(32);
  const document = { files: [] };

  const ciphertextBase64 = await encryptFilesIndex(vaultKey, document);
  const decrypted = await decryptFilesIndex(vaultKey, ciphertextBase64);

  assert.deepEqual(decrypted, document);
});

test('decryptFilesIndex fails with the wrong Vault Key', async () => {
  const vaultKey = randomBytes(32);
  const otherKey = randomBytes(32);
  const ciphertextBase64 = await encryptFilesIndex(vaultKey, { files: [] });

  await assert.rejects(() => decryptFilesIndex(otherKey, ciphertextBase64));
});
