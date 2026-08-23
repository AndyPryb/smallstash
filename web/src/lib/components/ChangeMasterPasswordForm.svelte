<script>
  import { changeMasterPassword } from '../session.js';
  import { validateMasterPassword, MIN_MASTER_PASSWORD_LENGTH } from '../policy.js';

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
      <label>
        Current Master Password
        <input type="password" bind:value={currentMasterPassword} autocomplete="off" required />
      </label>

      <hr />

      <label>
        New Master Password
        <input type="password" bind:value={newMasterPassword} autocomplete="off" required />
        <small>At least {MIN_MASTER_PASSWORD_LENGTH} characters.</small>
      </label>
      <label>
        Confirm new Master Password
        <input type="password" bind:value={confirmNewMasterPassword} autocomplete="off" required />
      </label>

      <label>
        Recovery Key
        <input bind:value={recoveryKeyInput} autocomplete="off" required />
        <small>Your existing Recovery Key, from when this account was created - needed to re-wrap it under the new password too. It stays the same afterwards.</small>
      </label>

      <div class="actions">
        <button type="submit" disabled={busy}>{busy ? 'Changing…' : 'Change Master Password'}</button>
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
  .success {
    background: #1d3a24;
    color: #a8f0b8;
    border: 1px solid #2c6b3c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
</style>
