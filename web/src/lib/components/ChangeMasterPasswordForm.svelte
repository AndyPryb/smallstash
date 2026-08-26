<script>
  import { changeMasterPassword } from '../session.js';
  import { validateMasterPassword, MASTER_PASSWORD_RULES } from '../policy.js';
  import PasswordField from './PasswordField.svelte';
  import PasswordRequirements from './PasswordRequirements.svelte';
  import Alert from './Alert.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  // See LoginForm for why fields use explicit for/id + aria-describedby.
  // This form and ChangeLoginPasswordForm can both be open at once, so their
  // field ids must not collide.
  const uid = $props.id();

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
    <Alert variant="error" ondismiss={() => (error = '')}>{error}</Alert>
  {/if}

  {#if done}
    <Alert variant="success">Master Password changed. Your Recovery Key is unchanged and still works.</Alert>
    <button type="button" onclick={onclose}>Close</button>
  {:else}
    <!-- Both facts here are non-obvious and both have bitten people in
         other password managers: that the vault has to be re-locked under
         the new password (so every device re-unlocks with it), and that the
         Recovery Key survives unchanged (so there's nothing new to write
         down afterwards). -->
    <Alert variant="notice">
      This re-locks your vault with a new key. Your saved passwords stay exactly as they are, and your Recovery Key
      does <strong>not</strong> change - the one you already have keeps working.
    </Alert>

    <form onsubmit={submit}>
      <div class="field">
        <label for="{uid}-current">Current Master Password</label>
        <PasswordField id="{uid}-current" bind:value={currentMasterPassword} fieldName="current Master Password" autocomplete="off" required />
      </div>

      <hr />

      <div class="field">
        <label for="{uid}-new">New Master Password</label>
        <PasswordField
          id="{uid}-new"
          describedby="{uid}-new-hint"
          bind:value={newMasterPassword} fieldName="new Master Password"
          autocomplete="off"
          required
        />
        <small id="{uid}-new-hint">You'll use this to unlock your vault from now on, on every device.</small>
      </div>
      <PasswordRequirements value={newMasterPassword} rules={MASTER_PASSWORD_RULES} />
      <div class="field">
        <label for="{uid}-confirm-new">Confirm new Master Password</label>
        <PasswordField id="{uid}-confirm-new" bind:value={confirmNewMasterPassword} fieldName="new Master Password confirmation" autocomplete="off" required />
      </div>

      <div class="field">
        <label for="{uid}-recovery-key">Recovery Key</label>
        <input
          id="{uid}-recovery-key"
          aria-describedby="{uid}-recovery-key-hint"
          bind:value={recoveryKeyInput}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          required
        />
        <small id="{uid}-recovery-key-hint">Your existing Recovery Key, from when this account was created - needed to re-wrap it under the new password too. It stays the same afterwards.</small>
      </div>

      <div class="actions">
        <!-- "Update", not "Change": the toolbar button that opens this panel
             is already called "Change Master Password", and two buttons with
             byte-identical accessible names doing different things is
             ambiguous to a screen reader and to any role-based query
             (Playwright throws a strict-mode violation on it). The sibling
             login panel had the same collision, dodged only by a difference
             in capitalisation - which is one styling tweak away from
             breaking silently. Distinct verbs fix both properly. -->
        <button type="submit" class="primary" disabled={busy}>{busy ? 'Updating…' : 'Update Master Password'}</button>
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
