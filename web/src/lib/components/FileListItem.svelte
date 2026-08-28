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
  // One field per tag, not one comma-separated field - each entry here is a
  // whole tag, edited on its own. `startEditTags` seeds one field per
  // existing tag, or a single empty one for a file with none yet, so
  // there's always at least one field to type into without needing an
  // extra click first.
  /** @type {string[]} */
  let tagInputs = $state([]);

  function startEditTags() {
    tagInputs = tags.length > 0 ? [...tags] : [''];
    editingTags = true;
  }

  function addTagField() {
    tagInputs = [...tagInputs, ''];
  }

  /** @param {number} index */
  function removeTagField(index) {
    // Always leaves at least one field - clearing the last remaining one
    // and saving is how you get down to zero tags, same as it always was;
    // this button is for discarding an extra field you added, not the only
    // field left.
    if (tagInputs.length <= 1) return;
    tagInputs = tagInputs.filter((_, i) => i !== index);
  }

  function cancelEditTags() {
    editingTags = false;
  }

  /** Enter applies the whole edit, from any field - not "add another field"
   * (that's what the + button is for), matching how Enter reads as "I'm
   * done" rather than "give me more room" in a short multi-field form. */
  function handleTagFieldKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleSaveTags();
  }

  async function handleSaveTags() {
    // One string per field already - normalizeTags in session.js still does
    // the real trim/dedupe/empty-drop, so a blank or duplicate field here is
    // harmless, just quietly dropped on save.
    await onedittags(tagInputs.map((t) => t.trim()).filter(Boolean));
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
      <div class="tag-edit-fields">
        {#each tagInputs as _, i}
          <div class="tag-edit-field">
            <input
              type="text"
              bind:value={tagInputs[i]}
              placeholder="Tag"
              aria-label="Tag {i + 1} for {file.name}"
              disabled={savingTags}
              onkeydown={handleTagFieldKeydown}
            />
            {#if tagInputs.length > 1}
              <button
                type="button"
                class="tag-field-remove"
                onclick={() => removeTagField(i)}
                disabled={savingTags}
                aria-label="Remove tag field {i + 1}"
              >
                ✕
              </button>
            {/if}
          </div>
        {/each}
        <button type="button" class="compact tag-field-add" onclick={addTagField} disabled={savingTags}>
          + Tag
        </button>
      </div>
      <div class="tag-edit-actions">
        <button type="button" class="compact" onclick={handleSaveTags} disabled={savingTags}>
          {savingTags ? 'Saving…' : 'Save'}
        </button>
        <button type="button" class="compact" onclick={cancelEditTags} disabled={savingTags}>Cancel</button>
      </div>
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
    flex-direction: column;
    gap: var(--ss-space-2);
    margin-top: var(--ss-space-2);
  }

  .tag-edit-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ss-space-2);
  }

  .tag-edit-field {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* Narrow on purpose - each field holds one tag, not a sentence, and a
     row of short fields reads at a glance as "several small things" the
     way one wide field never would. */
  .tag-edit-field input {
    width: 8rem;
  }

  /* Same quiet treatment as .tag-edit-toggle - it sits directly against an
     input it's about to remove and shouldn't read as heavier than that. */
  .tag-field-remove {
    padding: 0;
    background: transparent;
    border-color: transparent;
    color: var(--ss-text-faint);
    width: var(--ss-control-height-sm);
    height: var(--ss-control-height-sm);
  }

  .tag-field-remove:hover:not(:disabled) {
    background: var(--ss-danger-surface);
    border-color: var(--ss-danger-border);
    color: var(--ss-danger-text);
  }

  .tag-edit-actions {
    display: flex;
    gap: var(--ss-space-2);
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
