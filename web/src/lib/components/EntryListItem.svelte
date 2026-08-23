<script>
  /**
   * One vault entry, collapsed to title/username by default with a toggle to
   * reveal the rest - the password stays masked until explicitly shown (in
   * both view and edit mode), same "don't display secrets unless asked"
   * reasoning as everywhere else the password appears on screen (login/
   * signup forms, generator preview). `showPassword` is shared between view
   * and edit so toggling it once carries over into editing the same entry.
   *
   * Also owns in-place editing - the "view" and "edit" states are mutually
   * exclusive within one entry's expanded area, so there's never a stale
   * read-only view showing alongside an edit form for the same entry.
   *
   * `onremove`/`onupdate` are id-keyed by the caller (VaultView.svelte),
   * not index-keyed - this component doesn't need to know its own position
   * in the list.
   */
  import PasswordGeneratorPanel from './PasswordGeneratorPanel.svelte';

  /** @type {{ entry: { id: string, title: string, username: string, password: string, url: string, notes: string }, onremove: () => void, onupdate: (updated: object) => void }} */
  let { entry, onremove, onupdate } = $props();

  let expanded = $state(false);
  let showPassword = $state(false);
  let copied = $state(false);

  let editing = $state(false);
  let showGenerator = $state(false);
  let editTitle = $state('');
  let editUsername = $state('');
  let editPassword = $state('');
  let editUrl = $state('');
  let editNotes = $state('');

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(entry.password);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard access denied/unavailable in this context - "Show" still
      // works as a fallback way to read the password, nothing else to do here.
    }
  }

  /**
   * Entries can legitimately have no password (a notes-only entry, say) -
   * masking an empty string still produced a row of dots that looked like a
   * hidden real password. Only mask when there's actually something to hide.
   */
  function maskedPassword() {
    if (!entry.password) return '—';
    return showPassword ? entry.password : '•'.repeat(Math.max(entry.password.length, 8));
  }

  /**
   * Entries.url is free-typed and commonly has no scheme (e.g. "example.com")
   * - used as-is in an <a href>, that resolves as a *relative* link against
   * this app's own origin instead of navigating out to the site, which looks
   * like the link is just broken. Assume https if nothing more specific was
   * given; the visible link text still shows exactly what the user typed.
   */
  function normalizedUrl(url) {
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  }

  function startEdit() {
    editTitle = entry.title;
    editUsername = entry.username;
    editPassword = entry.password;
    editUrl = entry.url;
    editNotes = entry.notes;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    showGenerator = false;
  }

  function saveEdit(event) {
    event.preventDefault();
    onupdate({
      title: editTitle,
      username: editUsername,
      password: editPassword,
      url: editUrl,
      notes: editNotes,
    });
    editing = false;
    showGenerator = false;
  }

  function useGeneratedPassword(generated) {
    editPassword = generated;
    showGenerator = false;
    // A password the user just consciously generated is one they'll want to
    // see/verify immediately, not re-hide-then-un-hide - matches common
    // password manager behavior (LastPass/Bitwarden do the same).
    showPassword = true;
  }

  function handleRemove() {
    if (confirm(`Delete "${entry.title || '(untitled)'}"? It's only permanent once you click "Save vault".`)) {
      onremove();
    }
  }
</script>

<li>
  <div class="summary">
    <button
      type="button"
      class="toggle"
      onclick={() => (expanded = !expanded)}
      disabled={editing}
      aria-expanded={expanded}
    >
      <strong>{entry.title || '(untitled)'}</strong>
      <span>{entry.username}</span>
    </button>
    <button type="button" onclick={handleRemove} aria-label="Delete entry" disabled={editing}>✕</button>
  </div>

  {#if expanded && !editing}
    <div class="details">
      <div class="field">
        <span class="label">Username</span>
        <span>{entry.username || '—'}</span>
      </div>

      <div class="field">
        <span class="label">Password</span>
        <span class="password">{maskedPassword()}</span>
        <button type="button" onclick={() => (showPassword = !showPassword)} disabled={!entry.password}>
          {showPassword ? 'Hide' : 'Show'}
        </button>
        <button type="button" onclick={copyPassword} disabled={!entry.password}>{copied ? 'Copied!' : 'Copy'}</button>
      </div>

      <div class="field">
        <span class="label">URL</span>
        {#if entry.url}
          <a href={normalizedUrl(entry.url)} target="_blank" rel="noopener noreferrer">{entry.url}</a>
        {:else}
          <span>—</span>
        {/if}
      </div>

      <div class="field notes">
        <span class="label">Notes</span>
        <p>{entry.notes || '—'}</p>
      </div>

      <div class="row">
        <button type="button" onclick={startEdit}>Edit</button>
      </div>
    </div>
  {/if}

  {#if editing}
    <form class="edit-form" onsubmit={saveEdit}>
      <label>Title <input bind:value={editTitle} required /></label>
      <label>Username <input bind:value={editUsername} /></label>
      <label>
        Password
        <span class="password-row">
          <input type={showPassword ? 'text' : 'password'} bind:value={editPassword} />
          <button type="button" onclick={() => (showPassword = !showPassword)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
          <button type="button" onclick={() => (showGenerator = !showGenerator)}>Generate</button>
        </span>
      </label>
      {#if showGenerator}
        <PasswordGeneratorPanel onuse={useGeneratedPassword} onclose={() => (showGenerator = false)} />
      {/if}
      <label>URL <input bind:value={editUrl} /></label>
      <label>Notes <textarea bind:value={editNotes}></textarea></label>
      <div class="row">
        <button type="submit">Save</button>
        <button type="button" onclick={cancelEdit}>Cancel</button>
      </div>
    </form>
  {/if}
</li>

<style>
  li {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0;
    border-bottom: 1px solid #333;
  }
  .summary {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .toggle:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .details,
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: #14171b;
    border: 1px solid #333;
    border-radius: 6px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }
  .field.notes {
    align-items: flex-start;
  }
  .field.notes p {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .label {
    min-width: 5rem;
    color: #888;
  }
  .password {
    font-family: monospace;
    letter-spacing: 0.05em;
    word-break: break-all;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .edit-form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }
  .edit-form input,
  .edit-form textarea {
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
  button {
    padding: 0.3rem 0.6rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
</style>
