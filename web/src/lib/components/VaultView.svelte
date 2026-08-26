<script>
  import { onMount } from 'svelte';
  import { saveVault, isOfflineSession } from '../session.js';
  import ChangeMasterPasswordForm from './ChangeMasterPasswordForm.svelte';
  import ChangeLoginPasswordForm from './ChangeLoginPasswordForm.svelte';
  import PasswordGeneratorPanel from './PasswordGeneratorPanel.svelte';
  import EntryListItem from './EntryListItem.svelte';
  import ResizableTextarea from './ResizableTextarea.svelte';
  import Alert from './Alert.svelte';

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

  // Saving used to be silent on success - the "Unsaved changes" pill simply
  // disappeared, which is the absence of a signal rather than confirmation
  // that anything reached the server. Says "encrypted on this device" too,
  // because that reassurance is worth repeating at the exact moment data
  // leaves the browser.
  let saved = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let savedTimer;

  // The offline banner describes an ongoing condition, so it isn't
  // auto-dismissed - but it is a long paragraph that only needs reading
  // once, so the user can close it.
  let offlineNoticeDismissed = $state(false);
  /**
   * Which settings panel is open, as one value rather than a boolean each.
   *
   * With two independent booleans, opening the second panel left the first
   * one open above it - pushing the new panel below the fold, with nothing
   * on screen to suggest it had appeared at all, so it read as the button
   * doing nothing. Modelling it as "at most one of these" makes both-open
   * unrepresentable instead of something each new toggle has to remember to
   * prevent.
   *
   * @type {'master-password' | 'login-password' | null}
   */
  let openPanel = $state(null);

  /** @param {'master-password' | 'login-password'} panel */
  function togglePanel(panel) {
    openPanel = openPanel === panel ? null : panel;
  }

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
    return () => {
      window.removeEventListener('beforeunload', handler);
      clearTimeout(savedTimer);
    };
  });

  // A "saved" confirmation stops being true the moment the vault is edited
  // again - leaving it up next to an "Unsaved changes" pill would be two
  // messages contradicting each other.
  $effect(() => {
    if (dirty) saved = false;
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
    saved = false;
    saving = true;
    try {
      await saveVault(vaultDocument);
      savedSnapshot = JSON.stringify(vaultDocument);
      saved = true;
      // Success confirmations auto-retire; errors never do. A confirmation
      // has been fully absorbed the moment it's read, whereas an error the
      // user glanced away from is one they'd have no way to get back.
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved = false), 4000);
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

<div class="vault">
  <div class="toolbar">
    <!-- Saving is the one action with consequences here, so it's the only
         primary and it's separated from the account/settings actions rather
         than sitting fourth in an undifferentiated row of five buttons. -->
    <div class="toolbar-primary">
      <button type="button" class="primary" onclick={persist} disabled={saving}>
        {saving ? 'Saving…' : 'Save vault'}
      </button>
      {#if dirty}
        <span class="dirty-indicator" role="status">Unsaved changes</span>
      {/if}
    </div>
    <div class="toolbar-actions">
      <button
        type="button"
        class="compact"
        aria-expanded={openPanel === 'master-password'}
        onclick={() => togglePanel('master-password')}
      >
        Change Master Password
      </button>
      <button
        type="button"
        class="compact"
        aria-expanded={openPanel === 'login-password'}
        onclick={() => togglePanel('login-password')}
      >
        Change Login Password
      </button>
      <!-- Danger-outline rather than another neutral button: it's the one
           control here that ends the session, and with unsaved changes it
           can lose work (hence the confirm in handleSignOut). Outline, not
           a solid red - a filled danger button next to the primary "Save
           vault" would fight it for attention on a screen where signing out
           is the rarest thing anyone does. -->
      <button type="button" class="compact danger" onclick={handleSignOut}>Sign out</button>
    </div>
  </div>

  {#if offlineSession && !offlineNoticeDismissed}
    <Alert variant="notice" ondismiss={() => (offlineNoticeDismissed = true)}>
      You're viewing an offline copy - changes won't sync until you reconnect and sign in again. Signing back in
      online will replace this view with the latest saved vault, so save anything important elsewhere first if you
      can't reconnect right away.
    </Alert>
  {/if}

  {#if saveError}
    <Alert variant="error" ondismiss={() => (saveError = '')}>{saveError}</Alert>
  {/if}

  {#if saved}
    <Alert variant="success" ondismiss={() => (saved = false)}>
      Vault saved - encrypted on this device before it was uploaded.
    </Alert>
  {/if}

  {#if openPanel === 'master-password'}
    <ChangeMasterPasswordForm onclose={() => (openPanel = null)} />
  {/if}

  {#if openPanel === 'login-password'}
    <ChangeLoginPasswordForm onclose={() => (openPanel = null)} />
  {/if}

  <ul class="entries">
    {#each vaultDocument.entries as entry (entry.id)}
      <EntryListItem {entry} onremove={() => removeEntry(entry.id)} onupdate={(updated) => updateEntry(entry.id, updated)} />
    {:else}
      <li class="empty">No entries yet.</li>
    {/each}
  </ul>

  <form class="add-entry" onsubmit={addEntry}>
    <h2>Add entry</h2>
    <!-- The manual-save model is the app's other non-obvious behaviour:
         "Add entry" adds it to the list on screen, but nothing is stored
         until "Save vault". Without saying so, a user can reasonably add
         five entries, close the tab, and lose all of them. -->
    <p class="hint">Adding puts the entry in the list above. Nothing leaves this browser until you press Save vault.</p>
    <label class="field">Title <input bind:value={title} required /></label>
    <label class="field">Username <input bind:value={username} /></label>
    <label class="field">
      Password
      <span class="password-row">
        <input type={showNewPassword ? 'text' : 'password'} bind:value={password} />
        <!-- aria-labels name which form these belong to: an entry's edit
             form has its own Show/Generate pair and can be open at the same
             time as this one, which left two different controls sharing an
             accessible name. Visible text stays short. -->
        <button
          type="button"
          class="compact"
          aria-label={showNewPassword ? 'Hide new entry password' : 'Show new entry password'}
          onclick={() => (showNewPassword = !showNewPassword)}
        >
          {showNewPassword ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          class="compact"
          aria-label="Generate a password for the new entry"
          onclick={() => (showGenerator = !showGenerator)}
        >
          Generate
        </button>
      </span>
    </label>
    {#if showGenerator}
      <PasswordGeneratorPanel onuse={useGeneratedPassword} onclose={() => (showGenerator = false)} />
    {/if}
    <label class="field">URL <input bind:value={url} /></label>
    <label class="field">Notes <ResizableTextarea bind:value={notes} label="the new entry's notes" /></label>
    <button type="submit" class="primary">Add entry</button>
  </form>
</div>

<style>
  /* Control, field, and `.error`/`.notice` styling comes from src/app.css. */
  .vault {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
  }

  /**
   * Sticky action bar. "Save vault" is the one thing a user must not have
   * to hunt for after editing a long list, and previously it scrolled away
   * with the top of the page. The bar keeps the canvas colour behind it so
   * entries don't show through as they scroll under.
   */
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--ss-space-3);
    padding: var(--ss-space-3) 0;
    background: var(--ss-canvas);
    border-bottom: 1px solid var(--ss-border);
  }

  .toolbar-primary,
  .toolbar-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
  }

  /* A status pill rather than bare amber text - "Unsaved changes" is a
     state, and reads as one next to the button that clears it. */
  .dirty-indicator {
    padding: var(--ss-space-1) var(--ss-space-3);
    background: var(--ss-warn-surface);
    border: 1px solid var(--ss-warn-border);
    border-radius: var(--ss-radius-pill);
    color: var(--ss-warn-text);
    font-size: var(--ss-text-xs);
    font-weight: 500;
    white-space: nowrap;
  }

  /* Entries are cards in a stack, not rows separated by hairlines - each
     one expands to a details panel, and a card makes the boundary between
     "this entry" and "the next entry" obvious while expanded. */
  .entries {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  /* Dashed, muted, centred - reads as an absent list rather than a broken
     one, and doesn't imitate a real entry card. */
  .entries li.empty {
    padding: var(--ss-space-6) var(--ss-space-4);
    border: 1px dashed var(--ss-border-strong);
    border-radius: var(--ss-radius-lg);
    color: var(--ss-text-muted);
    text-align: center;
  }

  .add-entry {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
    /* Full width, dropping the old 360px cap. A narrower card than the
       entry list above it read as a detached widget rather than the end of
       the same column, and at 360px the Password row's input was squeezed
       to a few characters once Show and Generate took their width. */
    padding: var(--ss-space-5);
    background: var(--ss-surface);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-lg);
  }

  h2 {
    font-size: var(--ss-text-lg);
  }

  .add-entry > button {
    align-self: flex-start;
    min-width: 10rem;
  }

  .password-row {
    display: flex;
    gap: var(--ss-space-2);
  }

  .password-row input {
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 32rem) {
    .add-entry {
      padding: var(--ss-space-4);
    }
    /* Show + Generate leave the password input about ten characters wide on
       a 390px screen - give the input its own line instead. */
    .password-row {
      flex-wrap: wrap;
    }
    .password-row input {
      flex-basis: 100%;
    }
    /* Full-width submit on a phone - "align-self: flex-start" leaves a
       stranded small button under a stack of full-width fields. */
    .add-entry > button {
      align-self: stretch;
    }
  }
</style>
