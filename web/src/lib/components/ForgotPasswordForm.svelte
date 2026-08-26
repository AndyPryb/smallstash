<script>
  /**
   * Cognito login-password recovery ("forgot password"), two steps:
   *   1. request - email -> Cognito emails a verification code
   *   2. confirm - code + new login password -> ConfirmForgotPassword
   *
   * Deliberately not the vault's Recovery Key flow - this resets the
   * Cognito *login* password only, never touches the Master Password or
   * vault key material (see session.js's requestLoginPasswordReset/
   * confirmLoginPasswordReset, architecture.md §5).
   */
  import { requestLoginPasswordReset, confirmLoginPasswordReset } from '../session.js';
  import { friendlyAuthErrorMessage } from '../errors.js';
  import PasswordField from './PasswordField.svelte';

  /** @type {{ oncomplete: () => void, oncancel: () => void }} */
  let { oncomplete, oncancel } = $props();

  /** @type {'request' | 'confirm'} */
  let step = $state('request');

  let email = $state('');
  let code = $state('');
  let newPassword = $state('');
  let confirmNewPassword = $state('');

  let busy = $state(false);
  let error = $state('');

  async function submitRequest(event) {
    event.preventDefault();
    error = '';
    busy = true;
    try {
      await requestLoginPasswordReset(email);
      step = 'confirm';
    } catch (err) {
      error = err.message ?? String(err);
    } finally {
      busy = false;
    }
  }

  async function submitConfirm(event) {
    event.preventDefault();
    error = '';

    if (newPassword !== confirmNewPassword) {
      error = 'New passwords do not match';
      return;
    }

    busy = true;
    try {
      await confirmLoginPasswordReset(email, code, newPassword);
      oncomplete();
    } catch (err) {
      error = friendlyAuthErrorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

{#if step === 'request'}
  <form onsubmit={submitRequest}>
    <p class="lead">Enter your account email and we'll send a verification code to reset your login password.</p>
    <label class="field">
      Email
      <input type="email" bind:value={email} autocomplete="username" required />
    </label>
    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      <button type="button" onclick={oncancel} disabled={busy}>Back to sign in</button>
    </div>
  </form>
{:else}
  <form onsubmit={submitConfirm}>
    <p class="lead">We emailed a verification code to <strong>{email}</strong>.</p>
    <label class="field">
      Verification code
      <input class="code-input" bind:value={code} autocomplete="one-time-code" required />
    </label>
    <label class="field">
      New login password
      <PasswordField bind:value={newPassword} autocomplete="new-password" required />
      <small>12+ characters, upper + lower case, a digit, and a symbol.</small>
    </label>
    <label class="field">
      Confirm new login password
      <PasswordField bind:value={confirmNewPassword} autocomplete="new-password" required />
    </label>
    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
      <button type="button" onclick={oncancel} disabled={busy}>Back to sign in</button>
    </div>
  </form>
{/if}

<style>
  /* Shared field/button/`.error` styling comes from src/app.css. */
  form {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
  }

  /* Explanatory sentence above a form - full body colour would compete
     with the field labels for the eye's first stop. */
  .lead {
    color: var(--ss-text-muted);
    font-size: var(--ss-text-base);
  }

  .lead strong {
    color: var(--ss-text);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
    margin-top: var(--ss-space-1);
  }

  .actions button.primary {
    flex: 1;
    min-width: 10rem;
  }

  /* Matches the same treatment in SignupForm - a verification code is short
     and mechanical, so it gets a short, tracked, monospace field. */
  .code-input {
    max-width: 14rem;
    font-family: var(--ss-font-mono);
    font-size: var(--ss-text-lg);
    letter-spacing: 0.35em;
  }
</style>
