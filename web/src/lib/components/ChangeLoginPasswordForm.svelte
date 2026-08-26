<script>
  /**
   * Changes the Cognito *login* password while signed in - independent of
   * ChangeMasterPasswordForm.svelte, which changes the vault Master
   * Password instead (architecture.md §5). See session.js's
   * changeLoginPassword for why this needs an online session.
   */
  import { changeLoginPassword } from '../session.js';
  import { friendlyAuthErrorMessage } from '../errors.js';
  import PasswordField from './PasswordField.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

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
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if done}
    <p class="success">Login password changed.</p>
    <button type="button" onclick={onclose}>Close</button>
  {:else}
    <form onsubmit={submit}>
      <label class="field">
        Current login password
        <PasswordField bind:value={currentLoginPassword} autocomplete="current-password" required />
      </label>

      <hr />

      <label class="field">
        New login password
        <PasswordField bind:value={newLoginPassword} autocomplete="new-password" required />
        <small>12+ characters, upper + lower case, a digit, and a symbol.</small>
      </label>
      <label class="field">
        Confirm new login password
        <PasswordField bind:value={confirmNewLoginPassword} autocomplete="new-password" required />
      </label>

      <div class="actions">
        <button type="submit" class="primary" disabled={busy}>{busy ? 'Changing…' : 'Change login password'}</button>
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
