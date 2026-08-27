<script>
  /**
   * Exports the unlocked vault - and, since Phase 4
   * (docs/file-storage-plan.md), every uploaded file - as plaintext.
   *
   * This is the one feature that deliberately breaks the app's central
   * promise: everywhere else, secrets are encrypted before they leave the
   * browser, and here they are written to the user's disk in the clear
   * because that's the entire point of an export. The UI's job is to make
   * that a decision rather than a surprise - hence the warning, and the
   * explicit acknowledgement gating the button (the same pattern the signup
   * Recovery Key screen uses for the same reason: a consequence that can't
   * be undone once it has happened).
   *
   * No longer offline/network-free: including files means fetching and
   * decrypting each one (session.js's `downloadFile`) before anything can be
   * written, since export.js stays synchronous/pure by design (see its
   * header comment) and never fetches on its own.
   *
   * That raised a real risk worth naming: a picker dialog needs the click's
   * "transient activation", which can expire during a slow multi-file fetch
   * - if the picker were opened only after every file was downloaded, a
   * large/slow file set could see the browser reject the picker outright.
   * Avoided, not just documented: when a directory picker is available and
   * there are files to include, `runExport` opens it *first*
   * (`pickExportDirectory`) and only downloads/writes afterwards
   * (`writeArtifactToDirectory`, streamed one file at a time rather than
   * collected into an array first) - the picker consumes the activation
   * while it's still fresh, so the fetch's length no longer matters. The
   * other two cases don't have this exposure to begin with: a CSV-only
   * export never awaits anything before its single `saveArtifacts` call, and
   * the picker-less fallback uses `<a download>`, which needs no permission
   * prompt and so isn't time-limited the same way.
   */
  import { buildExportArtifacts, fileArtifactPaths } from '../export.js';
  import {
    saveArtifacts,
    supportsSaveFilePicker,
    supportsDirectoryPicker,
    pickExportDirectory,
    writeArtifactToDirectory,
  } from '../saveFile.js';
  import { listFiles, downloadFile } from '../session.js';
  import Alert from './Alert.svelte';

  /** @type {{ vaultDocument: { entries: object[] }, onclose: () => void }} */
  let { vaultDocument, onclose } = $props();

  const uid = $props.id();

  let acknowledged = $state(false);

  /**
   * Whether to write a UTF-8 BOM. Defaults to whether this browser can offer
   * a save dialog, which in practice means "is this a desktop browser" - the
   * marker exists for Excel on Windows, and the reader that chokes on it was
   * a mobile CSV viewer. That's a heuristic, not a fact about the device,
   * which is exactly why it's a visible checkbox the user can flip rather
   * than hidden behaviour.
   */
  let excelMarker = $state(supportsSaveFilePicker());
  let busy = $state(false);
  let error = $state('');
  /** @type {'saved' | 'downloaded' | 'cancelled' | ''} */
  let outcome = $state('');
  let savedAs = $state('');

  /** @type {import('../crypto/files.js').FileMetadata[]} */
  let files = $state([]);
  let filesLoadError = $state('');

  const entryCount = $derived(vaultDocument?.entries?.length ?? 0);
  const fileCount = $derived(files.length);
  const nothingToExport = $derived(entryCount === 0 && fileCount === 0);
  // Resolved once, at setup: these are capabilities of the browser, and they
  // can't change while the panel is open.
  const canPickDestination = supportsSaveFilePicker();
  const canPickDirectory = supportsDirectoryPicker();

  // The files list is fetched eagerly (not just at export time) so the "what
  // gets exported" summary below can name a real count instead of staying
  // silent about files until the button is clicked - a listing call is cheap
  // next to downloading every file's bytes, which only happens on export.
  $effect(() => {
    listFiles()
      .then((list) => {
        files = list;
      })
      .catch((err) => {
        filesLoadError = err.message ?? String(err);
      });
  });

  /**
   * Files-included export where a directory picker exists: opens it first
   * (still inside the click's transient activation, before any network
   * call), then downloads and writes each file one at a time, plus the CSV.
   * See this component's header comment for why the ordering matters.
   */
  async function runExportStreamed() {
    const rootHandle = await pickExportDirectory();
    if (rootHandle === null) {
      outcome = 'cancelled';
      return;
    }

    const [csvArtifact] = buildExportArtifacts(vaultDocument, new Date(), { includeBom: excelMarker, files: [] });
    await writeArtifactToDirectory(rootHandle, csvArtifact);

    const paths = fileArtifactPaths(files);
    for (let i = 0; i < files.length; i += 1) {
      const { mimeType, bytes } = await downloadFile(files[i].id);
      await writeArtifactToDirectory(rootHandle, { path: paths[i], contents: bytes, mimeType });
    }

    savedAs = `${1 + files.length} files`;
    outcome = 'saved';
  }

  /**
   * Every other case: no files to include (nothing gated on activation
   * timing to begin with), or files but no directory picker (falls back to
   * `<a download>`, which isn't activation-limited either). Builds the full
   * artifact list up front, same as before Phase 4's streaming path existed.
   */
  async function runExportBuffered() {
    const downloaded = [];
    for (const file of files) {
      downloaded.push(await downloadFile(file.id));
    }
    const artifacts = buildExportArtifacts(vaultDocument, new Date(), { includeBom: excelMarker, files: downloaded });
    savedAs = artifacts.length === 1 ? artifacts[0].path : `${artifacts.length} files`;
    outcome = await saveArtifacts(artifacts);
  }

  async function runExport() {
    error = '';
    outcome = '';
    busy = true;
    try {
      if (fileCount > 0 && canPickDirectory) {
        await runExportStreamed();
      } else {
        await runExportBuffered();
      }
    } catch (err) {
      error = err.message ?? String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel">
  <h2>Export vault</h2>

  {#if error}
    <Alert variant="error" ondismiss={() => (error = '')}>{error}</Alert>
  {/if}

  {#if filesLoadError}
    <Alert variant="error" ondismiss={() => (filesLoadError = '')}>
      Couldn't load your files list, so the export below will only include your {entryCount === 1 ? 'entry' : 'entries'}:
      {filesLoadError}
    </Alert>
  {/if}

  {#if outcome === 'saved' || outcome === 'downloaded'}
    <Alert variant="success">
      Exported {entryCount}
      {entryCount === 1 ? 'entry' : 'entries'}{#if fileCount > 0}
        and {fileCount} {fileCount === 1 ? 'file' : 'files'}{/if} to <strong>{savedAs}</strong>.
      {#if outcome === 'downloaded'}
        Check your device's Downloads folder.
      {/if}
    </Alert>
    <Alert variant="notice">
      That file is not encrypted and nothing is protecting it. Move it somewhere safe or delete it once you're done
      with it.
    </Alert>
    <div class="actions">
      <button type="button" onclick={onclose}>Close</button>
    </div>
  {:else}
    {#if outcome === 'cancelled'}
      <Alert variant="notice" ondismiss={() => (outcome = '')}>Export cancelled - nothing was written.</Alert>
    {/if}

    <!-- The warning is an error-styled box, not a notice: this is the one
         action in the app that removes every protection the rest of it
         exists to provide, and it shouldn't look like a piece of advice. -->
    <Alert variant="error">
      <strong>This writes your passwords to a plain, unencrypted file.</strong> Anyone who can read that file - or the
      device it's on, or a backup of it - can read every password in your vault. Small Stash cannot protect it once
      it's saved.
    </Alert>

    <div class="detail">
      <p class="detail-label">What gets exported</p>
      <ul>
        <li>All <strong>{entryCount}</strong> {entryCount === 1 ? 'entry' : 'entries'}, including passwords and notes, as a CSV file.</li>
        {#if fileCount > 0}
          <li>All <strong>{fileCount}</strong> {fileCount === 1 ? 'file' : 'files'} from your Files tab, decrypted, under a <code>files/</code> folder.</li>
        {/if}
        <li>Your Master Password and Recovery Key are <strong>not</strong> included - they're not stored anywhere to export.</li>
        <li>
          {#if fileCount > 0 && canPickDirectory}
            You'll be asked to choose a destination folder - the CSV and every file are written into it together.
          {:else if canPickDestination}
            You'll be asked where to save it.
          {:else}
            {fileCount > 0 ? 'Each item' : 'It'} will be saved to this device's Downloads folder - this browser can't
            offer a "save as" dialog.
          {/if}
        </li>
      </ul>
      <p class="detail-note">
        Best opened in a text editor. A spreadsheet may treat a password starting with <code>=</code> as a formula,
        and can mangle it.
      </p>
    </div>

    <!-- Described by what it does to the file, not by its name. "Add a UTF-8
         BOM" means nothing to most people; "Excel shows accented characters
         correctly, some other apps show ï»¿" is the actual trade-off, and
         quoting the exact junk string makes it recognisable to someone who
         has already hit it. -->
    <div class="option">
      <label class="option-row" for="{uid}-excel">
        <input id="{uid}-excel" type="checkbox" bind:checked={excelMarker} />
        Add a compatibility marker for Microsoft Excel
      </label>
      <p class="option-hint">
        {#if excelMarker}
          Needed for Excel on Windows to show accented and non-Latin characters correctly. Some apps - mobile CSV
          viewers especially - don't understand it and show <code>ï»¿</code> at the start of the file instead. Turn
          this off if you see that.
        {:else}
          The file will start directly with the column headers. Microsoft Excel on Windows may then misread accented
          and non-Latin characters; most other apps prefer it this way.
        {/if}
      </p>
    </div>

    <label class="acknowledge" for="{uid}-ack">
      <input id="{uid}-ack" type="checkbox" bind:checked={acknowledged} />
      I understand this file will not be encrypted
    </label>

    <div class="actions">
      <button type="button" class="primary" disabled={!acknowledged || busy || nothingToExport} onclick={runExport}>
        {busy ? 'Exporting…' : fileCount > 0 ? 'Export' : 'Export as CSV'}
      </button>
      <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
    </div>

    {#if nothingToExport}
      <p class="hint">There's nothing to export yet - add an entry or upload a file first.</p>
    {/if}
  {/if}
</div>

<style>
  /* Panel geometry matches the two change-password panels - they're siblings
     opened from the same toolbar and shouldn't look like different features.
     See src/app.css for the shared control styling. */
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

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    padding: var(--ss-space-4);
    background: var(--ss-surface-raised);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
    color: var(--ss-text-muted);
    font-size: var(--ss-text-sm);
    line-height: 1.6;
  }

  .detail-label {
    color: var(--ss-text);
    font-weight: 600;
  }

  .detail ul {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-1);
    margin: 0;
    padding-left: var(--ss-space-4);
  }

  .detail strong {
    color: var(--ss-text);
  }

  .detail-note {
    padding-top: var(--ss-space-2);
    border-top: 1px solid var(--ss-border);
    font-size: var(--ss-text-xs);
  }

  .detail-note code {
    padding: 0 0.25em;
    background: var(--ss-surface-sunken);
    border-radius: var(--ss-radius-sm);
    color: var(--ss-text);
  }

  /* An adjustable setting, so it's visually quieter than the acknowledgement
     gate below it - that one is a decision, this is a preference. */
  .option {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    padding: var(--ss-space-3);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
  }

  .option-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--ss-space-3);
    font-size: var(--ss-text-sm);
    cursor: pointer;
  }

  .option-hint {
    color: var(--ss-text-faint);
    font-size: var(--ss-text-xs);
    line-height: 1.5;
  }

  .option-hint code {
    padding: 0 0.25em;
    background: var(--ss-surface-sunken);
    border-radius: var(--ss-radius-sm);
    color: var(--ss-text-muted);
  }

  /* Same treatment as the Recovery Key acknowledgement at signup - a
     deliberate, clickable gate rather than fine print. */
  .acknowledge {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--ss-space-3);
    padding: var(--ss-space-3);
    background: var(--ss-surface-raised);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
    font-size: var(--ss-text-base);
    cursor: pointer;
  }

  .acknowledge:hover {
    border-color: var(--ss-border-strong);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
  }

  @media (max-width: 32rem) {
    .panel {
      padding: var(--ss-space-4);
    }
  }
</style>
