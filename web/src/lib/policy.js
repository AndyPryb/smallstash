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
