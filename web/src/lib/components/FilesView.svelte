<script>
  /**
   * The Files tab (docs/file-storage-plan.md decision #4 - standalone
   * documents, own tab, separate from Secrets). Deliberately a sibling to
   * VaultView.svelte, not a merge into it: VaultView is left completely
   * untouched by this - a document is a different affordance from a
   * password entry, and reusing its considerable, already-verified
   * complexity (reordering, per-field masking, the add-entry panel) would
   * have meant either awkwardly generalising all of it or duplicating this
   * component's own logic inside it. The cost is a second, small "Sign out"
   * button here rather than one shared with VaultView's toolbar - accepted
   * deliberately, to keep this addition self-contained and VaultView's
   * regression risk at zero.
   *
   * Simpler than VaultView in one structural way that matters: there is no
   * "Save vault" / dirty-tracking model here at all. Every action -
   * `uploadFile`, `removeFile` in session.js - already round-trips to the
   * server before it returns, so by the time this component's local `files`
   * array is updated, the change is already durable. Nothing to lose on
   * sign-out, so `handleSignOut` needs no unsaved-changes confirmation the
   * way VaultView's does.
   */
  import { onMount } from 'svelte';
  import { listFiles, uploadFile, downloadFile, removeFile } from '../session.js';
  import { saveArtifact } from '../saveFile.js';
  import { MAX_FILE_SIZE_BYTES } from '../crypto/files.js';
  import { formatFileSize } from '../formatFileSize.js';
  import FileListItem from './FileListItem.svelte';
  import Alert from './Alert.svelte';

  /** @type {{ onsignout: () => void }} */
  let { onsignout } = $props();

  /** @type {import('../crypto/files.js').FileMetadata[]} */
  let files = $state([]);
  let loading = $state(true);
  let loadError = $state('');

  let uploading = $state(false);
  let uploadError = $state('');
  /** id of the file currently being downloaded, or null - only one at a
   * time keeps this a plain value instead of a Set, and downloading two
   * files at once isn't a real need. */
  let downloadingId = $state(null);
  let actionError = $state('');

  /** @type {HTMLInputElement | undefined} */
  let fileInput;

  onMount(async () => {
    await refresh();
  });

  async function refresh() {
    loading = true;
    loadError = '';
    try {
      files = await listFiles();
    } catch (err) {
      loadError = err.message ?? String(err);
    } finally {
      loading = false;
    }
  }

  /** @param {Event} event */
  async function handleFileSelected(event) {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget);
    const file = input.files?.[0];
    // Cleared immediately, before the async work below - otherwise
    // selecting the *same* file again after an error wouldn't fire a new
    // 'change' event (the input's value never actually changed), leaving no
    // way to retry without picking a different file first.
    input.value = '';
    if (!file) return;

    uploadError = '';
    // Client-side pre-check against the file's plaintext size - a fast,
    // read-nothing-yet rejection. The real cap (MAX_FILE_SIZE_BYTES in
    // crypto/files.js, mirroring FilesController server-side) is checked
    // against the *ciphertext* size inside encryptFile, which is always a
    // little larger (the AES-GCM envelope's version byte + IV + tag) - this
    // check is deliberately not exact for that reason, just close enough to
    // catch the obvious case before spending time reading+encrypting.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      uploadError = `"${file.name}" is too large (${formatFileSize(file.size)}) - the limit is ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`;
      return;
    }

    uploading = true;
    try {
      const entry = await uploadFile(file);
      files = [...files, entry];
    } catch (err) {
      uploadError = err.message ?? String(err);
    } finally {
      uploading = false;
    }
  }

  /** @param {import('../crypto/files.js').FileMetadata} file */
  async function handleDownload(file) {
    actionError = '';
    downloadingId = file.id;
    try {
      const { name, mimeType, bytes } = await downloadFile(file.id);
      await saveArtifact({ path: name, contents: bytes, mimeType });
    } catch (err) {
      actionError = err.message ?? String(err);
    } finally {
      downloadingId = null;
    }
  }

  /** @param {string} fileId */
  async function handleRemove(fileId) {
    actionError = '';
    try {
      await removeFile(fileId);
      files = files.filter((f) => f.id !== fileId);
    } catch (err) {
      actionError = err.message ?? String(err);
    }
  }

  function handleSignOut() {
    onsignout();
  }
</script>

<div class="files">
  <div class="toolbar">
    <div class="toolbar-primary">
      <button type="button" class="primary" onclick={() => fileInput.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload file'}
      </button>
      <!-- Hidden native input, triggered by the styled button above - a
           real <input type="file"> can't be restyled directly, and every
           other button in this app already goes through app.css's shared
           button styling. -->
      <input
        bind:this={fileInput}
        type="file"
        class="sr-only"
        onchange={handleFileSelected}
        aria-label="Choose a file to upload"
      />
    </div>
    <div class="toolbar-actions">
      <button type="button" class="compact danger" onclick={handleSignOut}>Sign out</button>
    </div>
  </div>

  <p class="hint">
    Files are encrypted on this device before upload and stored separately from your Secrets - up to
    {formatFileSize(MAX_FILE_SIZE_BYTES)} each. Unlike Secrets, uploading and deleting take effect immediately;
    there's no separate save step.
  </p>

  {#if loadError}
    <Alert variant="error" ondismiss={() => (loadError = '')}>{loadError}</Alert>
  {/if}

  {#if uploadError}
    <Alert variant="error" ondismiss={() => (uploadError = '')}>{uploadError}</Alert>
  {/if}

  {#if actionError}
    <Alert variant="error" ondismiss={() => (actionError = '')}>{actionError}</Alert>
  {/if}

  {#if loading}
    <p class="hint">Loading your files…</p>
  {:else}
    <ul class="entries">
      {#each files as file (file.id)}
        <FileListItem
          {file}
          downloading={downloadingId === file.id}
          ondownload={() => handleDownload(file)}
          onremove={() => handleRemove(file.id)}
        />
      {:else}
        <li class="empty">No files yet.</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Deliberately near-identical to VaultView's - same toolbar/list/empty-
     state shapes, so switching tabs doesn't feel like switching apps. See
     src/app.css for the shared control/`.hint` styling this relies on. */
  .files {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
  }

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

  .entries {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .entries li.empty {
    padding: var(--ss-space-6) var(--ss-space-4);
    border: 1px dashed var(--ss-border-strong);
    border-radius: var(--ss-radius-lg);
    color: var(--ss-text-muted);
    text-align: center;
  }
</style>
