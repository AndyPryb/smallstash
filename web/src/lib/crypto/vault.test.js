import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeyMaterial,
  unlockWithMasterPassword,
  unlockWithRecoveryKey,
  rewrapWithNewMasterPassword,
  encryptVault,
  decryptVault,
  WrongSecretError,
} from './vault.js';

// These use production KDF params (64 MiB Argon2id), so each test genuinely
// takes real wall-clock time - that cost is the whole point of the KDF.

test('unlockWithMasterPassword recovers the same Vault Key that was minted', async () => {
  const { userKeys, vaultKey } = await createKeyMaterial('correct horse battery staple');

  const unlocked = await unlockWithMasterPassword(userKeys, 'correct horse battery staple');

  assert.equal(Buffer.from(unlocked).toString('hex'), Buffer.from(vaultKey).toString('hex'));
});

test('unlockWithMasterPassword rejects the wrong Master Password', async () => {
  const { userKeys } = await createKeyMaterial('correct horse battery staple');
  await assert.rejects(
    () => unlockWithMasterPassword(userKeys, 'wrong password'),
    WrongSecretError,
  );
});

test('unlockWithRecoveryKey recovers the same Vault Key via the Recovery Key path', async () => {
  const { userKeys, vaultKey, recoveryKey } = await createKeyMaterial('a master password');

  const unlocked = await unlockWithRecoveryKey(userKeys, recoveryKey);

  assert.equal(Buffer.from(unlocked).toString('hex'), Buffer.from(vaultKey).toString('hex'));
});

test('unlockWithRecoveryKey rejects a wrong-but-well-formed recovery key', async () => {
  const { userKeys } = await createKeyMaterial('a master password');
  const { recoveryKey: unrelated } = await createKeyMaterial('a different account');

  await assert.rejects(() => unlockWithRecoveryKey(userKeys, unrelated), WrongSecretError);
});

test('rewrapWithNewMasterPassword keeps the same Vault Key reachable under the new password', async () => {
  const { userKeys, vaultKey, recoveryKey } = await createKeyMaterial('old password');

  const rewrapped = await rewrapWithNewMasterPassword({
    vaultKey,
    newMasterPassword: 'new password',
    recoveryKeyInput: recoveryKey,
  });

  const unlocked = await unlockWithMasterPassword(rewrapped, 'new password');
  assert.equal(Buffer.from(unlocked).toString('hex'), Buffer.from(vaultKey).toString('hex'));

  // The old password must no longer work against the new wrapped material.
  await assert.rejects(() => unlockWithMasterPassword(rewrapped, 'old password'), WrongSecretError);

  // The Recovery Key still works too, now wrapped under a fresh salt.
  const viaRecovery = await unlockWithRecoveryKey(rewrapped, recoveryKey);
  assert.equal(Buffer.from(viaRecovery).toString('hex'), Buffer.from(vaultKey).toString('hex'));

  // keyVersion is unix-seconds (see nextKeyVersion) - two calls in the same
  // test can land in the same second, so only the salt is asserted here.
  assert.notEqual(rewrapped.kdfSalt, userKeys.kdfSalt);
});

test('rewrapWithNewMasterPassword steps keyVersion past a previous version ahead of this clock', async () => {
  const { vaultKey, recoveryKey } = await createKeyMaterial('old password');

  // Simulates the case the backend's conditional PUT /keys would otherwise
  // reject forever: another device (or a clock ahead of ours) already stored
  // a keyVersion in the future relative to Date.now(). Without stepping past
  // it, this device could never change its Master Password again.
  const farFuture = Math.floor(Date.now() / 1000) + 86_400;

  const rewrapped = await rewrapWithNewMasterPassword({
    vaultKey,
    newMasterPassword: 'new password',
    recoveryKeyInput: recoveryKey,
    previousKeyVersion: farFuture,
  });

  assert.ok(
    rewrapped.keyVersion > farFuture,
    `expected keyVersion > ${farFuture}, got ${rewrapped.keyVersion}`,
  );
  // Still an int32 - keyVersion is an `int` backend-side (UserKeys.java).
  assert.ok(rewrapped.keyVersion < 2 ** 31 - 1);
});

test('rewrapWithNewMasterPassword uses wall-clock time when no previous version is ahead of it', async () => {
  const { vaultKey, recoveryKey } = await createKeyMaterial('old password');
  const before = Math.floor(Date.now() / 1000);

  const rewrapped = await rewrapWithNewMasterPassword({
    vaultKey,
    newMasterPassword: 'new password',
    recoveryKeyInput: recoveryKey,
    previousKeyVersion: 1,
  });

  assert.ok(rewrapped.keyVersion >= before);
});

test('encryptVault/decryptVault round-trips an arbitrary JSON document', async () => {
  const { vaultKey } = await createKeyMaterial('a master password');
  const document = {
    entries: [
      { title: 'Example', username: 'me@example.com', password: 'p@ss', url: 'https://example.com' },
    ],
  };

  const ciphertextBase64 = await encryptVault(vaultKey, document);
  const decrypted = await decryptVault(vaultKey, ciphertextBase64);

  assert.deepEqual(decrypted, document);
});

test('decryptVault fails with the wrong Vault Key', async () => {
  const { vaultKey } = await createKeyMaterial('a');
  const { vaultKey: otherKey } = await createKeyMaterial('b');

  const ciphertextBase64 = await encryptVault(vaultKey, { ok: true });
  await assert.rejects(() => decryptVault(otherKey, ciphertextBase64));
});
