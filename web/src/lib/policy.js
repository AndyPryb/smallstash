/**
 * Master Password policy - deliberately much lighter than the Cognito login
 * password's policy (12+ chars, upper/lower/digit/symbol, enforced
 * server-side by Cognito itself, see infra/.../SmallstashStack.java). The
 * Master Password has no server-side enforcement at all - it never reaches
 * the backend - so the only floor against a trivially weak vault password
 * is whatever the client checks before deriving from it.
 *
 * Set to 4 (a PIN-length floor, not a real strength gate) - deliberate
 * choice to allow short PIN-style Master Passwords. Worth remembering: a
 * short Master Password is meaningfully weaker against offline brute-force
 * if the wrapped-key blob (KEYS item) is ever exfiltrated - Argon2id raises
 * the cost per guess, it doesn't rescue a 4-character search space.
 */
export const MIN_MASTER_PASSWORD_LENGTH = 4;

export const MIN_LOGIN_PASSWORD_LENGTH = 12;

/**
 * The Cognito pool's password policy, expressed as individually testable
 * rules rather than one all-or-nothing regex.
 *
 * Why the shape changed: the rule used to be a single lookahead regex inside
 * SignupForm, which could only ever answer "does this pass?" - so the user
 * got one lump message *after* submitting ("needs 12+ characters with upper,
 * lower, a digit, and a symbol") and had to work out for themselves which
 * part they'd missed. Splitting it lets the UI show a live checklist as they
 * type, which is what Google, Apple and 1Password all do here, while the
 * combined message below stays byte-identical for the failed-submit path.
 *
 * Mirrors infra/.../SmallstashStack.java's `PasswordPolicy` (minLength 12 +
 * require upper/lower/digit/symbol). Cognito's own rejection is still the
 * real enforcement - everything here is guidance that saves a round trip.
 * **Keep the two in sync by hand**; nothing checks that today.
 *
 * @type {ReadonlyArray<{ label: string, test: (password: string) => boolean }>}
 */
export const LOGIN_PASSWORD_RULES = Object.freeze([
  { label: `At least ${MIN_LOGIN_PASSWORD_LENGTH} characters`, test: (p) => p.length >= MIN_LOGIN_PASSWORD_LENGTH },
  { label: 'An uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { label: 'A number (0-9)', test: (p) => /[0-9]/.test(p) },
  { label: 'A symbol (! ? # $ …)', test: (p) => /[^A-Za-z0-9]/.test(p) },
]);

/**
 * @param {string} loginPassword
 * @returns {string | null} an error message, or null if acceptable
 */
export function validateLoginPassword(loginPassword) {
  // Message text is load-bearing: e2e/signup-negative.spec.js asserts on the
  // "12+ characters" substring. Don't reword without updating that spec.
  return LOGIN_PASSWORD_RULES.every((rule) => rule.test(loginPassword))
    ? null
    : 'Login password needs 12+ characters with upper, lower, a digit, and a symbol';
}

/**
 * The Master Password's (much lighter) policy, in the same shape, so the
 * same checklist component can render both. See the note above about why
 * this floor is only 4 characters.
 *
 * @type {ReadonlyArray<{ label: string, test: (password: string) => boolean }>}
 */
export const MASTER_PASSWORD_RULES = Object.freeze([
  {
    label: `At least ${MIN_MASTER_PASSWORD_LENGTH} characters`,
    test: (p) => p.length >= MIN_MASTER_PASSWORD_LENGTH,
  },
]);

/**
 * Mirrors the backend's own ceiling (VaultController.MAX_CIPHERTEXT_BYTES,
 * 512 KiB) so an oversized vault fails with a clear message here instead of a
 * bare 413 after uploading the whole thing. The backend check is the real
 * enforcement - this is UX, same as the login password pattern check in
 * SignupForm. Keep the two in sync.
 */
export const MAX_VAULT_CIPHERTEXT_BYTES = 512 * 1024;

/**
 * @param {string} ciphertextBase64
 * @returns {string | null} an error message, or null if acceptable
 */
export function validateVaultSize(ciphertextBase64) {
  // Base64 is 4 characters per 3 bytes; derive the decoded size rather than
  // measuring the encoded string, so this compares like-for-like with the
  // backend's byte-count check.
  const padding = ciphertextBase64.endsWith('==') ? 2 : ciphertextBase64.endsWith('=') ? 1 : 0;
  const decodedBytes = (ciphertextBase64.length / 4) * 3 - padding;
  if (decodedBytes > MAX_VAULT_CIPHERTEXT_BYTES) {
    return `Vault is too large to save (over ${MAX_VAULT_CIPHERTEXT_BYTES / 1024} KiB encrypted). Remove some entries or large notes and try again.`;
  }
  return null;
}

/**
 * @param {string} masterPassword
 * @returns {string | null} an error message, or null if acceptable
 */
export function validateMasterPassword(masterPassword) {
  if (!masterPassword) return 'Master Password is required';
  if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
    return `Master Password should be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`;
  }
  return null;
}
