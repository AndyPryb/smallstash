<script>
  /**
   * Exports the unlocked vault as a plaintext CSV.
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
   * Everything happens in memory from the already-decrypted vault - the
   * export makes no network calls and works offline.
   */
  import { buildExportArtifacts } from '../export.js';
  import { saveArtifact, supportsSaveFilePicker } from '../saveFile.js';
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

  const entryCount = $derived(vaultDocument?.entries?.length ?? 0);
  // Resolved once, at setup: this is a capability of the browser, and it
  // can't change while the panel is open.
  const canPickDestination = supportsSaveFilePicker();

  async function runExport() {
    error = '';
    outcome = '';
    busy = true;
    try {
      // Built synchronously before any await, so the click's transient
      // activation is still valid when the save picker is opened.
      const [artifact] = buildExportArtifacts(vaultDocument, new Date(), { includeBom: excelMarker });
      savedAs = artifact.path;
      outcome = await saveArtifact(artifact);
    } catch (err) {
      error = err?.message ?? String(err);
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

  {#if outcome === 'saved' || outcome === 'downloaded'}
    <Alert variant="success">
      Exported {entryCount}
      {entryCount === 1 ? 'entry' : 'entries'} to <strong>{savedAs}</strong>.
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
        <li>Your Master Password and Recovery Key are <strong>not</strong> included - they're not stored anywhere to export.</li>
        <li>
          {#if canPickDestination}
            You'll be asked where to save it.
          {:else}
            It will be saved to this device's Downloads folder - this browser can't offer a "save as" dialog.
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
      <button type="button" class="primary" disabled={!acknowledged || busy || entryCount === 0} onclick={runExport}>
        {busy ? 'Exporting…' : 'Export as CSV'}
      </button>
      <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
    </div>

    {#if entryCount === 0}
      <p class="hint">There's nothing to export yet - add an entry first.</p>
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
