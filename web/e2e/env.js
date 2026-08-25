import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Reads deploy-time settings the E2E suite needs from the repo-root `.env`
 * - the same gitignored file `SmallstashStack`'s `resolveInviteCode()`
 * reads at synth time (infra/SmallstashStack.java). Kept as a tiny local
 * reader rather than pulling in a dotenv dependency for one file.
 *
 * Deliberately never logged/printed anywhere in this module or its
 * callers - specs read `inviteCode()` and use it directly in a `.fill()`
 * call, never in a `console.log`/test title/assertion message.
 */

const dotEnvPath = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '.env');

let cache;
function loadDotEnv() {
  if (cache) return cache;
  cache = {};
  let text;
  try {
    text = readFileSync(dotEnvPath, 'utf8');
  } catch {
    return cache;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    cache[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return cache;
}

/** @returns {string} the real invite code - throws if unset, rather than silently testing against '' */
export function inviteCode() {
  const value = loadDotEnv().SMALLSTASH_INVITE_CODE;
  if (!value) {
    throw new Error('SMALLSTASH_INVITE_CODE is not set in the repo-root .env - needed for E2E specs that exercise a valid invite code.');
  }
  return value;
}

/** @returns {string} throws if unset, rather than silently running an authenticated spec against '' */
function required(key) {
  const value = loadDotEnv()[key];
  if (!value) {
    throw new Error(`${key} is not set in the repo-root .env - needed for this E2E spec.`);
  }
  return value;
}

export function testUserEmail() {
  return required('TEST_USER_EMAIL');
}

/** Cognito login password - independent of the Master Password below, see architecture.md §5. */
export function testUserPassword() {
  return required('TEST_USER_PASSWORD');
}

/** Vault Master Password - never the same value as the login password. */
export function testUserMasterPassword() {
  return required('TEST_USER_MASTER_PASSWORD');
}

/** Shown once at signup; needed by change-Master-Password specs. */
export function testUserRecoveryKey() {
  return required('TEST_USER_RECOVERY_KEY');
}
