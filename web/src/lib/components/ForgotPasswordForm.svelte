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
    <p>Enter your account email and we'll send a verification code to reset your login password.</p>
    <label>
      Email
      <input type="email" bind:value={email} autocomplete="username" required />
    </label>
    <div class="actions">
      <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      <button type="button" onclick={oncancel} disabled={busy}>Back to sign in</button>
    </div>
  </form>
{:else}
  <form onsubmit={submitConfirm}>
    <p>We emailed a verification code to <strong>{email}</strong>.</p>
    <label>
      Verification code
      <input bind:value={code} autocomplete="one-time-code" required />
    </label>
    <label>
      New login password
      <PasswordField bind:value={newPassword} autocomplete="new-password" required />
      <small>12+ characters, upper + lower case, a digit, and a symbol.</small>
    </label>
    <label>
      Confirm new login password
      <PasswordField bind:value={confirmNewPassword} autocomplete="new-password" required />
    </label>
    <div class="actions">
      <button type="submit" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
      <button type="button" onclick={oncancel} disabled={busy}>Back to sign in</button>
    </div>
  </form>
{/if}

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }
  input {
    padding: 0.5rem;
    font-size: 1rem;
  }
  small {
    color: #888;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  button {
    padding: 0.6rem;
    font-size: 1rem;
    cursor: pointer;
  }
  .error {
    background: #3a1d1d;
    color: #ffb4b4;
    border: 1px solid #6b2c2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
</style>
