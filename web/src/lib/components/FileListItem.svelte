<script>
  /**
   * One row in the Files list - deliberately much simpler than
   * EntryListItem.svelte. A file's metadata (name, size, upload date) isn't
   * a secret the way a password is, so there's nothing here to mask behind
   * a "Show" toggle - a wrong filename or MIME type isn't fixable anyway
   * without re-uploading, since it's baked into what was encrypted. Tags are
   * the one exception: they're metadata *about* the file, not baked into
   * what was encrypted at upload time, so unlike everything else here
   * they're genuinely editable in place (docs/todo.md "Option B" tagging).
   */
  import { formatFileSize } from '../formatFileSize.js';

  /**
   * @type {{
   *   file: { id: string, name: string, mimeType: string, sizeBytes: number, createdAt: string, tags?: string[] },
   *   downloading: boolean,
   *   savingTags: boolean,
   *   ondownload: () => void,
   *   onremove: () => void,
   *   onedittags: (tags: string[]) => void | Promise<void>,
   * }}
   */
  let { file, downloading, savingTags, ondownload, onremove, onedittags } = $props();

  // $derived, not a plain const: a bare const reads file.createdAt once at
  // setup and never again (Svelte's state_referenced_locally warning) - see
  // Alert.svelte for the same fix applied to the same class of bug. Safe in
  // practice today, since the parent's {#each} is keyed by file.id and this
  // component is recreated rather than reused across different files, but
  // that's a property of the caller, not this component - not something to
  // rely on silently.
  let uploadedOn = $derived(
    new Date(file.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
  );

  // Missing entirely, not `[]`, for any file uploaded before tags existed -
  // see crypto/files.js's FileMetadata typedef for why every reader treats
  // the two the same rather than migrating old index entries.
  let tags = $derived(file.tags ?? []);

  let editingTags = $state(false);
  let tagInput = $state('');

  function startEditTags() {
    tagInput = tags.join(', ');
    editingTags = true;
  }

  function cancelEditTags() {
    editingTags = false;
  }

  async function handleSaveTags() {
    // Free-text, comma-separated - normalizeTags in session.js does the
    // real trim/dedupe/empty-drop, so this only needs to split on the
    // delimiter the input actually uses.
    await onedittags(tagInput.split(',').map((t) => t.trim()).filter(Boolean));
    editingTags = false;
  }

  function handleRemove() {
    if (confirm(`Delete "${file.name}"? This cannot be undone - it's removed from storage immediately, not on next save.`)) {
      onremove();
    }
  }
</script>

<li>
  <div class="summary">
    <div class="details">
      <span class="name">{file.name}</span>
      <span class="meta">{formatFileSize(file.sizeBytes)} · uploaded {uploadedOn}</span>
    </div>
    <div class="actions">
      <button type="button" class="compact" onclick={ondownload} disabled={downloading}>
        {downloading ? 'Downloading…' : 'Download'}
      </button>
      <button type="button" class="delete compact" onclick={handleRemove} aria-label="Delete {file.name}">✕</button>
    </div>
  </div>

  {#if editingTags}
    <div class="tag-edit">
      <input
        type="text"
        bind:value={tagInput}
        placeholder="e.g. taxes, 2026"
        aria-label="Tags for {file.name}"
        disabled={savingTags}
      />
      <button type="button" class="compact" onclick={handleSaveTags} disabled={savingTags}>
        {savingTags ? 'Saving…' : 'Save'}
      </button>
      <button type="button" class="compact" onclick={cancelEditTags} disabled={savingTags}>Cancel</button>
    </div>
  {:else}
    <div class="tags">
      {#each tags as tag (tag)}
        <span class="tag">{tag}</span>
      {/each}
      <button type="button" class="tag-edit-toggle compact" onclick={startEditTags}>
        {tags.length ? 'Edit tags' : '+ Add tags'}
      </button>
    </div>
  {/if}
</li>

<style>
  /* Same card treatment as EntryListItem's <li> - one visual language for
     "a row in a list of things you own" across both tabs. */
  li {
    display: flex;
    padding: var(--ss-space-3) var(--ss-space-2) var(--ss-space-3) var(--ss-space-4);
    background: var(--ss-surface);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-lg);
    transition: border-color 120ms ease;
  }

  li:hover {
    border-color: var(--ss-border-strong);
  }

  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ss-space-3);
    width: 100%;
    min-width: 0;
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-1);
    min-width: 0;
  }

  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    color: var(--ss-text-muted);
    font-size: var(--ss-text-sm);
  }

  .actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--ss-space-2);
  }

  .delete {
    background: transparent;
    border-color: transparent;
    color: var(--ss-text-faint);
    width: var(--ss-control-height-sm);
    padding: 0;
  }

  .delete:hover:not(:disabled) {
    background: var(--ss-danger-surface);
    border-color: var(--ss-danger-border);
    color: var(--ss-danger-text);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ss-space-2);
    margin-top: var(--ss-space-2);
  }

  .tag {
    padding: 0.15em 0.65em;
    background: var(--ss-surface-raised);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-full, 999px);
    color: var(--ss-text-muted);
    font-size: var(--ss-text-xs);
    white-space: nowrap;
  }

  /* A quiet text-button, not a bordered one - it sits among the tag pills
     themselves and shouldn't visually compete with them for attention. */
  .tag-edit-toggle {
    padding: 0 var(--ss-space-1);
    background: transparent;
    border-color: transparent;
    color: var(--ss-text-faint);
    font-size: var(--ss-text-xs);
    height: auto;
  }

  .tag-edit-toggle:hover {
    color: var(--ss-accent);
    text-decoration: underline;
  }

  .tag-edit {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
    margin-top: var(--ss-space-2);
  }

  .tag-edit input {
    flex: 1 1 12rem;
    min-width: 0;
  }

  @media (max-width: 32rem) {
    .summary {
      flex-direction: column;
      align-items: flex-start;
    }
    .actions {
      align-self: stretch;
      justify-content: space-between;
    }
  }
</style>
