<script>
  import { changeMasterPassword } from '../session.js';
  import { validateMasterPassword, MIN_MASTER_PASSWORD_LENGTH } from '../policy.js';
  import PasswordField from './PasswordField.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  let currentMasterPassword = $state('');
  let newMasterPassword = $state('');
  let confirmNewMasterPassword = $state('');
  let recoveryKeyInput = $state('');

  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  async function submit(event) {
    event.preventDefault();
    error = '';

    if (newMasterPassword !== confirmNewMasterPassword) {
      error = 'New Master Passwords do not match';
      return;
    }
    const masterPasswordError = validateMasterPassword(newMasterPassword);
    if (masterPasswordError) {
      error = masterPasswordError;
      return;
    }

    busy = true;
    try {
      await changeMasterPassword(currentMasterPassword, newMasterPassword, recoveryKeyInput);
      done = true;
      currentMasterPassword = newMasterPassword = confirmNewMasterPassword = recoveryKeyInput = '';
    } catch (err) {
      error = err.message ?? String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel">
  <h2>Change Master Password</h2>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if done}
    <p class="success">Master Password changed. Your Recovery Key is unchanged and still works.</p>
    <button type="button" onclick={onclose}>Close</button>
  {:else}
    <form onsubmit={submit}>
      <label class="field">
        Current Master Password
        <PasswordField bind:value={currentMasterPassword} autocomplete="off" required />
      </label>

      <hr />

      <label class="field">
        New Master Password
        <PasswordField bind:value={newMasterPassword} autocomplete="off" required />
        <small>At least {MIN_MASTER_PASSWORD_LENGTH} characters.</small>
      </label>
      <label class="field">
        Confirm new Master Password
        <PasswordField bind:value={confirmNewMasterPassword} autocomplete="off" required />
      </label>

      <label class="field">
        Recovery Key
        <input
          bind:value={recoveryKeyInput}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          required
        />
        <small>Your existing Recovery Key, from when this account was created - needed to re-wrap it under the new password too. It stays the same afterwards.</small>
      </label>

      <div class="actions">
        <button type="submit" class="primary" disabled={busy}>{busy ? 'Changing…' : 'Change Master Password'}</button>
        <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
      </div>
    </form>
  {/if}
</div>

<style>
  /* Shared field/button/hr/`.error`/`.success` styling: src/app.css. Panel
     geometry is deliberately identical to ChangeLoginPasswordForm's. */
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

  /* The Recovery Key is transcribed from wherever the user saved it, so it
     gets the monospace treatment used everywhere that key appears. */
  form input {
    font-family: var(--ss-font-mono);
    letter-spacing: 0.04em;
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

  .panel > button {
    align-self: flex-start;
  }

  @media (max-width: 32rem) {
    .panel {
      padding: var(--ss-space-4);
    }
  }
</style>
