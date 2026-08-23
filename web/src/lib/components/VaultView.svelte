<script>
  import { onMount } from 'svelte';
  import { saveVault, isOfflineSession } from '../session.js';
  import ChangeMasterPasswordForm from './ChangeMasterPasswordForm.svelte';
  import PasswordGeneratorPanel from './PasswordGeneratorPanel.svelte';
  import EntryListItem from './EntryListItem.svelte';

  /** @type {{ vaultDocument: { entries: object[] }, onsignout: () => void }} */
  let { vaultDocument = $bindable(), onsignout } = $props();

  // Fixed for this component's lifetime - a session doesn't transition from
  // offline to online without a full new unlock, which tears down and
  // recreates this component anyway (App.svelte only renders VaultView once
  // vaultDocument is set). Plain constant, not reactive state, on purpose.
  const offlineSession = isOfflineSession();

  // Backfill a stable id on any entry that doesn't have one yet (vaults
  // created before this field existed) - runs once at component creation,
  // not reactively. Keying the entry list by `entry.id` instead of array
  // index means deleting/reordering one entry can't misattribute another
  // entry's local UI state (expanded/editing/etc.) to the wrong row, which
  // index-keying could in principle do.
  for (const entry of vaultDocument.entries) {
    if (!entry.id) entry.id = crypto.randomUUID();
  }

  let saving = $state(false);
  let saveError = $state('');
  let showChangePassword = $state(false);
  let showGenerator = $state(false);
  let showNewPassword = $state(false);

  let title = $state('');
  let username = $state('');
  let password = $state('');
  let url = $state('');
  let notes = $state('');

  // Tracks whether vaultDocument has changed since the last successful save
  // (or since it was loaded, if never saved this session) - drives the
  // sign-out confirmation and the beforeunload warning below. Comparing
  // full JSON is simple and plenty fast at vault-sized data; re-derives
  // automatically whenever vaultDocument.entries is reassigned (add/edit/
  // remove all do a fresh array assignment, never an in-place mutation).
  let savedSnapshot = $state(JSON.stringify(vaultDocument));
  let dirty = $derived(JSON.stringify(vaultDocument) !== savedSnapshot);

  // Warn before closing/reloading the tab with unsaved changes - the
  // standard beforeunload pattern. Browsers show their own generic
  // confirmation text, not whatever's in returnValue, but setting it is
  // still required to trigger the prompt at all in most of them.
  onMount(() => {
    const handler = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });

  function useGeneratedPassword(generated) {
    password = generated;
    showGenerator = false;
    // A password just consciously generated is one the user will want to
    // see/verify immediately, not re-hide-then-un-hide.
    showNewPassword = true;
  }

  function addEntry(event) {
    event.preventDefault();
    vaultDocument.entries = [
      ...vaultDocument.entries,
      { id: crypto.randomUUID(), title, username, password, url, notes },
    ];
    title = username = password = url = notes = '';
    showGenerator = false;
    showNewPassword = false;
  }

  function removeEntry(id) {
    vaultDocument.entries = vaultDocument.entries.filter((entry) => entry.id !== id);
  }

  function updateEntry(id, updatedFields) {
    vaultDocument.entries = vaultDocument.entries.map((entry) =>
      entry.id === id ? { ...updatedFields, id } : entry,
    );
  }

  async function persist() {
    saveError = '';
    saving = true;
    try {
      await saveVault(vaultDocument);
      savedSnapshot = JSON.stringify(vaultDocument);
    } catch (err) {
      saveError = err.message ?? String(err);
    } finally {
      saving = false;
    }
  }

  function handleSignOut() {
    if (dirty && !confirm('You have unsaved changes that will be lost if you sign out now. Sign out anyway?')) {
      return;
    }
    onsignout();
  }
</script>

<div>
  <div class="toolbar">
    <button type="button" onclick={persist} disabled={saving}>{saving ? 'Saving…' : 'Save vault'}</button>
    {#if dirty}
      <span class="dirty-indicator" role="status">Unsaved changes</span>
    {/if}
    <button type="button" onclick={() => (showChangePassword = !showChangePassword)}>Change Master Password</button>
    <button type="button" onclick={handleSignOut}>Sign out</button>
  </div>

  {#if offlineSession}
    <p class="notice">
      You're viewing an offline copy - changes won't sync until you reconnect and sign in again. Signing back in
      online will replace this view with the latest saved vault, so save anything important elsewhere first if you
      can't reconnect right away.
    </p>
  {/if}

  {#if saveError}
    <p class="error" role="alert">{saveError}</p>
  {/if}

  {#if showChangePassword}
    <ChangeMasterPasswordForm onclose={() => (showChangePassword = false)} />
  {/if}

  <ul class="entries">
    {#each vaultDocument.entries as entry (entry.id)}
      <EntryListItem {entry} onremove={() => removeEntry(entry.id)} onupdate={(updated) => updateEntry(entry.id, updated)} />
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
        <input type={showNewPassword ? 'text' : 'password'} bind:value={password} />
        <button type="button" onclick={() => (showNewPassword = !showNewPassword)}>
          {showNewPassword ? 'Hide' : 'Show'}
        </button>
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
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .dirty-indicator {
    font-size: 0.85rem;
    color: #f0d68a;
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
    min-width: 0;
  }
  .error {
    background: #3a1d1d;
    color: #ffb4b4;
    border: 1px solid #6b2c2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
  }
  .notice {
    background: #3a2f0f;
    color: #f0d68a;
    border: 1px solid #6b5a2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }
</style>
