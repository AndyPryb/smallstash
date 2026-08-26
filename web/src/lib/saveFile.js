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
 * @param {{ path: string, contents: string, mimeType: string }} artifact
 * @returns {Promise<SaveOutcome>}
 */
export async function saveArtifact({ path, contents, mimeType }) {
  const blob = new Blob([contents], { type: mimeType });

  if (supportsSaveFilePicker()) {
    let handle;
    try {
      handle = await globalThis.showSaveFilePicker({
        suggestedName: path,
        types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }],
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
