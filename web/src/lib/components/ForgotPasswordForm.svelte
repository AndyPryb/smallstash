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
  import { LOGIN_PASSWORD_RULES } from '../policy.js';
  import PasswordField from './PasswordField.svelte';
  import PasswordRequirements from './PasswordRequirements.svelte';
  import Alert from './Alert.svelte';

  /** @type {{ oncomplete: () => void, oncancel: () => void }} */
  let { oncomplete, oncancel } = $props();

  // See LoginForm for why fields use explicit for/id + aria-describedby.
  const uid = $props.id();

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
  <Alert variant="error" ondismiss={() => (error = '')}>{error}</Alert>
{/if}

{#if step === 'request'}
  <form onsubmit={submitRequest}>
    <p class="lead">Enter your account email and we'll send a verification code to reset your login password.</p>
    <!-- The single most important thing to say on this screen. A user who
         has forgotten their login password may well assume this resets
         everything, try it, and then find their vault still locked with no
         idea why. -->
    <Alert variant="notice">
      This resets your <strong>login password</strong> only. Your Master Password and everything in your vault are
      untouched - you'll still need your Master Password to unlock it afterwards.
    </Alert>
    <div class="field">
      <label for="{uid}-email">Email</label>
      <input id="{uid}-email" type="email" bind:value={email} autocomplete="username" required />
    </div>
    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      <button type="button" onclick={oncancel} disabled={busy}>Back to sign in</button>
    </div>
  </form>
{:else}
  <form onsubmit={submitConfirm}>
    <p class="lead">We emailed a verification code to <strong>{email}</strong>.</p>
    <div class="field">
      <label for="{uid}-code">Verification code</label>
      <input
        id="{uid}-code"
        aria-describedby="{uid}-code-hint"
        class="code-input"
        bind:value={code}
        autocomplete="one-time-code"
        required
      />
      <small id="{uid}-code-hint">If it hasn't arrived in a minute or two, check your spam folder - these emails often land there.</small>
    </div>
    <div class="field">
      <label for="{uid}-new-password">New login password</label>
      <PasswordField id="{uid}-new-password" bind:value={newPassword} fieldName="new login password" autocomplete="new-password" required />
    </div>
    <PasswordRequirements value={newPassword} rules={LOGIN_PASSWORD_RULES} />
    <div class="field">
      <label for="{uid}-confirm-new-password">Confirm new login password</label>
      <PasswordField
        id="{uid}-confirm-new-password"
        bind:value={confirmNewPassword} fieldName="new login password confirmation"
        autocomplete="new-password"
        required
      />
    </div>
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
