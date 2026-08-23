<script>
  import { saveVault } from '../session.js';
  import ChangeMasterPasswordForm from './ChangeMasterPasswordForm.svelte';
  import PasswordGeneratorPanel from './PasswordGeneratorPanel.svelte';
  import EntryListItem from './EntryListItem.svelte';

  /** @type {{ vaultDocument: { entries: object[] }, onsignout: () => void }} */
  let { vaultDocument = $bindable(), onsignout } = $props();

  let saving = $state(false);
  let saveError = $state('');
  let showChangePassword = $state(false);
  let showGenerator = $state(false);

  let title = $state('');
  let username = $state('');
  let password = $state('');
  let url = $state('');
  let notes = $state('');

  function useGeneratedPassword(generated) {
    password = generated;
    showGenerator = false;
  }

  function addEntry(event) {
    event.preventDefault();
    vaultDocument.entries = [
      ...vaultDocument.entries,
      { title, username, password, url, notes },
    ];
    title = username = password = url = notes = '';
  }

  function removeEntry(index) {
    vaultDocument.entries = vaultDocument.entries.filter((_, i) => i !== index);
  }

  async function persist() {
    saveError = '';
    saving = true;
    try {
      await saveVault(vaultDocument);
    } catch (err) {
      saveError = err.message ?? String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div>
  <div class="toolbar">
    <button onclick={persist} disabled={saving}>{saving ? 'Saving…' : 'Save vault'}</button>
    <button onclick={() => (showChangePassword = !showChangePassword)}>Change Master Password</button>
    <button onclick={onsignout}>Sign out</button>
  </div>

  {#if saveError}
    <p class="error" role="alert">{saveError}</p>
  {/if}

  {#if showChangePassword}
    <ChangeMasterPasswordForm onclose={() => (showChangePassword = false)} />
  {/if}

  <ul class="entries">
    {#each vaultDocument.entries as entry, i (i)}
      <EntryListItem {entry} onremove={() => removeEntry(i)} />
    {:else}
      <li class="empty">No entries yet.</li>
    {/each}
  </ul>

  <form onsubmit={addEntry}>
    <h2>Add entry</h2>
    <label>Title <input bind:value={title} required /></label>
    <label>Username <input bind:value={username} /></label>
    <label>
      Password
      <span class="password-row">
        <input type="password" bind:value={password} />
        <button type="button" onclick={() => (showGenerator = !showGenerator)}>Generate</button>
      </span>
    </label>
    {#if showGenerator}
      <PasswordGeneratorPanel onuse={useGeneratedPassword} onclose={() => (showGenerator = false)} />
    {/if}
    <label>URL <input bind:value={url} /></label>
    <label>Notes <textarea bind:value={notes}></textarea></label>
    <button type="submit">Add entry</button>
  </form>
</div>

<style>
  .toolbar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .entries {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
  }
  .entries li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid #333;
  }
  .entries li.empty {
    color: #888;
    border-bottom: none;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 360px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }
  input,
  textarea {
    padding: 0.4rem;
  }
  .password-row {
    display: flex;
    gap: 0.4rem;
  }
  .password-row input {
    flex: 1;
  }
  .error {
    background: #3a1d1d;
    color: #ffb4b4;
    border: 1px solid #6b2c2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
  }
</style>
