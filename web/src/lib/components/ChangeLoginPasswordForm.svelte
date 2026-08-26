<script>
  /**
   * Changes the Cognito *login* password while signed in - independent of
   * ChangeMasterPasswordForm.svelte, which changes the vault Master
   * Password instead (architecture.md §5). See session.js's
   * changeLoginPassword for why this needs an online session.
   */
  import { changeLoginPassword } from '../session.js';
  import { friendlyAuthErrorMessage } from '../errors.js';
  import { LOGIN_PASSWORD_RULES } from '../policy.js';
  import PasswordField from './PasswordField.svelte';
  import PasswordRequirements from './PasswordRequirements.svelte';
  import Alert from './Alert.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  // See LoginForm for why fields use explicit for/id + aria-describedby.
  // Also load-bearing here specifically: this form and
  // ChangeMasterPasswordForm can both be open at once, so their field ids
  // must not collide.
  const uid = $props.id();

  let currentLoginPassword = $state('');
  let newLoginPassword = $state('');
  let confirmNewLoginPassword = $state('');

  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  async function submit(event) {
    event.preventDefault();
    error = '';

    if (newLoginPassword !== confirmNewLoginPassword) {
      error = 'New login passwords do not match';
      return;
    }

    busy = true;
    try {
      await changeLoginPassword(currentLoginPassword, newLoginPassword);
      done = true;
      currentLoginPassword = newLoginPassword = confirmNewLoginPassword = '';
    } catch (err) {
      error = friendlyAuthErrorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel">
  <h2>Change Login Password</h2>

  {#if error}
    <Alert variant="error" ondismiss={() => (error = '')}>{error}</Alert>
  {/if}

  {#if done}
    <Alert variant="success">Login password changed.</Alert>
    <button type="button" onclick={onclose}>Close</button>
  {:else}
    <Alert variant="notice">
      This changes how you <strong>sign in</strong>. Your Master Password and the contents of your vault are not
      affected.
    </Alert>

    <form onsubmit={submit}>
      <div class="field">
        <label for="{uid}-current">Current login password</label>
        <PasswordField id="{uid}-current" bind:value={currentLoginPassword} fieldName="current login password" autocomplete="current-password" required />
      </div>

      <hr />

      <div class="field">
        <label for="{uid}-new">New login password</label>
        <PasswordField id="{uid}-new" bind:value={newLoginPassword} fieldName="new login password" autocomplete="new-password" required />
      </div>
      <!-- Guidance only - this form deliberately has no blocking pre-check,
           so a policy-compliant-but-breached password still reaches Cognito
           and gets caught by its compromised-credential screening
           (e2e/change-login-password.spec.js depends on that path). -->
      <PasswordRequirements value={newLoginPassword} rules={LOGIN_PASSWORD_RULES} />
      <div class="field">
        <label for="{uid}-confirm-new">Confirm new login password</label>
        <PasswordField
          id="{uid}-confirm-new"
          bind:value={confirmNewLoginPassword} fieldName="new login password confirmation"
          autocomplete="new-password"
          required
        />
      </div>

      <div class="actions">
        <!-- "Update", not "Change" - see ChangeMasterPasswordForm for why.
             This one used to differ from the toolbar's "Change Login
             Password" only by capitalisation, which e2e had to match
             exactly to disambiguate. -->
        <button type="submit" class="primary" disabled={busy}>{busy ? 'Updating…' : 'Update login password'}</button>
        <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
      </div>
    </form>
  {/if}
</div>

<style>
  /* Shared field/button/hr/`.error`/`.success` styling: src/app.css.
     Kept visually identical to ChangeMasterPasswordForm - they're siblings
     in the same toolbar and shouldn't look like different features. */
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
    padding: var(--ss-space-5);
    background: var(--ss-surface);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-lg);
    box-shadow: var(--ss-shadow-2);
  }

  h2 {
    font-size: var(--ss-text-lg);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
    margin-top: var(--ss-space-1);
  }

  .actions button.primary {
    flex: 1;
    min-width: 14rem;
  }

  /* Aligns the standalone Close button with the form's action row rather
     than letting it stretch the full panel width. */
  .panel > button {
    align-self: flex-start;
  }

  @media (max-width: 32rem) {
    .panel {
      padding: var(--ss-space-4);
    }
  }
</style>
