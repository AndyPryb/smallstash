<script>
  /**
   * Changes the Cognito *login* password while signed in - independent of
   * ChangeMasterPasswordForm.svelte, which changes the vault Master
   * Password instead (architecture.md §5). See session.js's
   * changeLoginPassword for why this needs an online session.
   */
  import { changeLoginPassword } from '../session.js';
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
      error = err.message ?? String(err);
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
      <label>
        Current login password
        <PasswordField bind:value={currentLoginPassword} autocomplete="current-password" required />
      </label>

      <label>
        New login password
        <PasswordField bind:value={newLoginPassword} autocomplete="new-password" required />
        <small>12+ characters, upper + lower case, a digit, and a symbol.</small>
      </label>
      <label>
        Confirm new login password
        <PasswordField bind:value={confirmNewLoginPassword} autocomplete="new-password" required />
      </label>

      <div class="actions">
        <button type="submit" disabled={busy}>{busy ? 'Changing…' : 'Change login password'}</button>
        <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .panel {
    border: 1px solid #333;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }
  h2 {
    font-size: 1rem;
    margin-top: 0;
  }
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
  .success {
    background: #1d3a24;
    color: #a8f0b8;
    border: 1px solid #2c6b3c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
</style>
