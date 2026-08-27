/**
 * Writing an exported artifact to the user's device.
 *
 * Two paths, because the good one isn't available everywhere:
 *
 * 1. **`showSaveFilePicker`** (File System Access API) - a real "save as"
 *    dialog, so the user chooses the folder and filename. This is
 *    **Chromium-desktop only**: not Firefox, not Safari, and notably *not
 *    Chrome for Android*, which is the browser this PWA is most likely
 *    installed in on a phone. Verified against MDN and Chrome's own
 *    capability docs rather than assumed, because "let the user pick where
 *    it goes" was a stated requirement and it simply cannot be met on mobile.
 * 2. **An `<a download>` click** everywhere else - the file lands in the
 *    browser's download location with no picker. This is the accepted
 *    behaviour on Android and in Firefox/Safari, not a bug to work around.
 *
 * Feature-detected, never sniffed by user agent: the same browser can gain
 * the API in a later version, and a UA string is a guess where a typeof check
 * is a fact.
 */

/**
 * @returns {boolean} whether a real save-destination dialog is available
 */
export function supportsSaveFilePicker() {
  return typeof globalThis.showSaveFilePicker === 'function';
}

/**
 * @returns {boolean} whether a real destination-*folder* dialog is
 *   available - used by {@link saveArtifacts} for a multi-file export
 *   (docs/file-storage-plan.md Phase 4). Checked separately from
 *   {@link supportsSaveFilePicker} even though the two are correlated in
 *   every browser that ships either today - they're still two different
 *   globals, and "feature-detected, never sniffed" (this module's own
 *   stated principle) means testing the specific capability actually being
 *   used, not inferring it from a related one.
 */
export function supportsDirectoryPicker() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

/**
 * @param {string} path
 * @returns {string} the `.ext` suffix, or `.bin` if `path` has none -
 *   `showSaveFilePicker`'s `accept` map requires at least one extension per
 *   entry, and a file with no extension at all is a real possibility for an
 *   uploaded document.
 */
function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot > 0 ? path.slice(dot) : '.bin';
}

/**
 * @param {string | undefined} mimeType e.g. `'text/csv;charset=utf-8'`
 * @returns {string} just `'text/csv'` - `showSaveFilePicker`'s `accept` map
 *   wants a bare MIME type, no `;`-delimited parameters
 */
function bareMimeType(mimeType) {
  return (mimeType || 'application/octet-stream').split(';')[0].trim();
}

/**
 * @typedef {'saved' | 'downloaded' | 'cancelled'} SaveOutcome
 * `saved` - written to a location the user picked.
 * `downloaded` - handed to the browser's downloads, no picker shown.
 * `cancelled` - the user dismissed the picker; nothing was written.
 */

/**
 * Writes one artifact to disk.
 *
 * Must be called from a user gesture: the picker requires transient
 * activation, which is why the caller builds the contents synchronously
 * first and doesn't await anything before this.
 *
 * `contents` accepts a `Uint8Array` as well as a `string` - `Blob`'s
 * constructor takes either, and downloaded file bytes (added when this
 * function was generalised for file downloads, docs/file-storage-plan.md
 * Phase 3) are binary, never text.
 *
 * @param {{ path: string, contents: string | Uint8Array, mimeType: string }} artifact
 * @returns {Promise<SaveOutcome>}
 */
export async function saveArtifact({ path, contents, mimeType }) {
  const blob = new Blob([contents], { type: mimeType });

  if (supportsSaveFilePicker()) {
    let handle;
    try {
      handle = await globalThis.showSaveFilePicker({
        suggestedName: path,
        // Derived from the artifact itself rather than hardcoded, since
        // this is no longer CSV-export-only (Phase 3 added arbitrary
        // downloaded file types - PDFs, images, whatever a user uploaded).
        // The `accept` key must be a bare MIME type with no parameters -
        // export.js's own mimeType is 'text/csv;charset=utf-8', which the
        // picker rejects/ignores if passed through as-is (the previous
        // hardcoded 'text/csv' here happened to already be bare, masking
        // this). Falling back to a generic binary type covers a
        // mimeType-less artifact rather than crashing the save.
        types: [{ description: 'File', accept: { [bareMimeType(mimeType)]: [extensionOf(path)] } }],
      });
    } catch (err) {
      // Dismissing the dialog rejects with AbortError. That's a decision,
      // not a failure - surfacing it as an error would tell the user
      // something went wrong when they simply changed their mind.
      if (err?.name === 'AbortError') return 'cancelled';
      throw err;
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      // Without close() the file is left empty or partially written; run it
      // even if write() threw, so no zero-byte file is left behind holding a
      // name the user chose.
      await writable.close();
    }
    return 'saved';
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = path;
    // Firefox historically required the anchor to be in the document for a
    // programmatic click to start a download.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking synchronously can cancel a download that hasn't started
    // reading the blob yet; a task-queue turn is enough and avoids leaking
    // the object URL for the life of the page.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return 'downloaded';
}

/**
 * Opens the destination-folder dialog on its own, ahead of any other work -
 * the counterpart to {@link writeArtifactToDirectory} for a caller that
 * needs to produce its artifacts *after* the picker is granted rather than
 * before (docs/file-storage-plan.md Phase 4's transient-activation note:
 * {@link saveArtifacts} builds/fetches every artifact first and only then
 * opens the picker, which risks the click's transient activation expiring
 * during a slow multi-file fetch; a caller that instead calls this first and
 * fetches afterwards doesn't have that problem, because the picker consumes
 * the activation while it's still fresh).
 *
 * @returns {Promise<FileSystemDirectoryHandle | null>} `null` if the user
 *   dismissed the dialog (`AbortError`) - same "decision, not a failure"
 *   handling as everywhere else in this module.
 */
export async function pickExportDirectory() {
  try {
    return await globalThis.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Writes one artifact into an already-open directory handle, creating any
 * intermediate folders `path` implies (`files/photo.jpg` gets a `files`
 * subfolder) - `FileSystemDirectoryHandle` only offers single-segment
 * lookups, so a multi-segment path has to be walked one directory at a time.
 *
 * Exported (not just used internally by {@link saveArtifacts}) so a caller
 * can pair it with {@link pickExportDirectory} to write artifacts as they
 * become available, rather than needing the full list up front - see that
 * function's doc comment for why that ordering matters.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {{ path: string, contents: string | Uint8Array, mimeType: string }} artifact
 */
export async function writeArtifactToDirectory(rootHandle, { path, contents, mimeType }) {
  const segments = path.split('/');
  const fileName = segments.pop();

  let dirHandle = rootHandle;
  for (const segment of segments) {
    dirHandle = await dirHandle.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(new Blob([contents], { type: mimeType }));
  } finally {
    await writable.close();
  }
}

/**
 * Writes multiple artifacts to disk in one user action - the export's
 * CSV-plus-uploaded-files case (docs/file-storage-plan.md Phase 4). A
 * single artifact is delegated straight to {@link saveArtifact} unchanged,
 * so nothing about the existing single-file export path (CSV with no
 * files) changes even slightly by this function existing.
 *
 * For more than one artifact:
 * - **Directory picker** (desktop) - one folder-destination dialog, every
 *   artifact written inside it preserving `path`'s subfolder structure.
 * - **Sequential downloads** (everywhere else, same support boundary as
 *   {@link supportsSaveFilePicker} - no picker exists there for a single
 *   file either) - each artifact goes through `saveArtifact`'s own
 *   `<a download>` fallback in turn, which is why this doesn't need its own
 *   copy of that logic.
 *
 * @param {Array<{ path: string, contents: string | Uint8Array, mimeType: string }>} artifacts
 * @returns {Promise<SaveOutcome>}
 */
export async function saveArtifacts(artifacts) {
  if (artifacts.length === 0) {
    throw new Error('saveArtifacts called with nothing to save');
  }
  if (artifacts.length === 1) {
    return saveArtifact(artifacts[0]);
  }

  if (supportsDirectoryPicker()) {
    const rootHandle = await pickExportDirectory();
    if (rootHandle === null) return 'cancelled';
    for (const artifact of artifacts) {
      await writeArtifactToDirectory(rootHandle, artifact);
    }
    return 'saved';
  }

  for (const artifact of artifacts) {
    await saveArtifact(artifact);
  }
  return 'downloaded';
}
