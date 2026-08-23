<script>
  /**
   * One vault entry, collapsed to title/username by default with a toggle to
   * reveal the rest - the password stays masked until explicitly shown, same
   * "don't display secrets unless asked" reasoning as everywhere else the
   * password appears on screen (login/signup forms, generator preview).
   */

  /** @type {{ entry: { title: string, username: string, password: string, url: string, notes: string }, onremove: () => void }} */
  let { entry, onremove } = $props();

  let expanded = $state(false);
  let showPassword = $state(false);
  let copied = $state(false);

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
</script>

<li>
  <div class="summary">
    <button type="button" class="toggle" onclick={() => (expanded = !expanded)}>
      <strong>{entry.title || '(untitled)'}</strong>
      <span>{entry.username}</span>
    </button>
    <button type="button" onclick={onremove} aria-label="Delete entry">✕</button>
  </div>

  {#if expanded}
    <div class="details">
      <div class="field">
        <span class="label">Username</span>
        <span>{entry.username || '—'}</span>
      </div>

      <div class="field">
        <span class="label">Password</span>
        <span class="password">{showPassword ? entry.password || '—' : '•'.repeat(Math.max(entry.password?.length ?? 0, 8))}</span>
        <button type="button" onclick={() => (showPassword = !showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
        <button type="button" onclick={copyPassword} disabled={!entry.password}>{copied ? 'Copied!' : 'Copy'}</button>
      </div>

      <div class="field">
        <span class="label">URL</span>
        {#if entry.url}
          <a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.url}</a>
        {:else}
          <span>—</span>
        {/if}
      </div>

      <div class="field notes">
        <span class="label">Notes</span>
        <p>{entry.notes || '—'}</p>
      </div>
    </div>
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
  .details {
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
  }
  button {
    padding: 0.3rem 0.6rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
</style>
