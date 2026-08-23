/**
 * Master Password policy - deliberately much lighter than the Cognito login
 * password's policy (12+ chars, upper/lower/digit/symbol, enforced
 * server-side by Cognito itself, see infra/.../SmallstashStack.java). The
 * Master Password has no server-side enforcement at all - it never reaches
 * the backend - so the only floor against a trivially weak vault password
 * is whatever the client checks before deriving from it. Kept low (8, not
 * matching the login policy's 12) so it doesn't read as "the same rules as
 * the other password" and tempt reuse; a determined user typing "aaaaaaaa"
 * still can, this is a nudge against typos/empty-ish input, not a real
 * strength gate.
 */
export const MIN_MASTER_PASSWORD_LENGTH = 8;

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
