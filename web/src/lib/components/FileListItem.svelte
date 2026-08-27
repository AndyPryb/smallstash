<script>
  /**
   * One row in the Files list - deliberately much simpler than
   * EntryListItem.svelte. A file's metadata (name, size, upload date) isn't
   * a secret the way a password is, so there's nothing here to mask behind
   * a "Show" toggle and nothing to edit in place - a wrong filename or MIME
   * type isn't fixable anyway without re-uploading, since it's baked into
   * what was encrypted. Download and delete are the only two actions a file
   * has.
   */
  import { formatFileSize } from '../formatFileSize.js';

  /**
   * @type {{
   *   file: { id: string, name: string, mimeType: string, sizeBytes: number, createdAt: string },
   *   downloading: boolean,
   *   ondownload: () => void,
   *   onremove: () => void,
   * }}
   */
  let { file, downloading, ondownload, onremove } = $props();

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
