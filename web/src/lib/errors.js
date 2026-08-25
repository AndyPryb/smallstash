/**
 * Friendlier substitutions for raw errors that would otherwise reach the
 * user verbatim. Kept as its own small module (alongside policy.js,
 * bytes.js) rather than folded into auth/cognito.js - this is UI-facing
 * message text, not SRP/Cognito wiring, and every caller needs it as a
 * plain function it can drop into an existing `catch (err) { error =
 * ...err.message ?? String(err) }` line with minimal change.
 */

/**
 * Cognito's `InvalidPasswordException` surfaces its own message verbatim
 * through this app's `err.message ?? String(err)` pattern (SignupForm,
 * ChangeLoginPasswordForm, ForgotPasswordForm - anywhere a new Cognito
 * login password is submitted). In at least one confirmed case that
 * message is literally `"Password did not conform with policy: null"` -
 * reproduced live 2026-08-25 via a deliberately weak password on
 * ChangeLoginPasswordForm. That's AWS's own backend leaving a template
 * slot unfilled, not something this app can fix at the source: grep
 * confirms "did not conform with policy" appears nowhere in this repo, so
 * there's no local string to correct. This substitutes a message that's
 * actually useful instead of exposing that gap to the user.
 *
 * @param {unknown} err
 * @returns {string} a message safe to show the user
 */
export function friendlyAuthErrorMessage(err) {
  if (err && typeof err === 'object' && (err.code === 'InvalidPasswordException' || err.name === 'InvalidPasswordException')) {
    return 'That password was rejected by the server - it may be too weak, or it may have appeared in a known data breach. Try a different one.';
  }
  return err?.message ?? String(err);
}
