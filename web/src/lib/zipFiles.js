import { zipSync } from 'fflate';
import { deduplicatePaths } from './export.js';

/**
 * Bundles multiple already-decrypted files into a single zip archive -
 * "Download all" / "Download N files" in FilesView.svelte, so the browser
 * shows one save prompt instead of one per file.
 *
 * Deliberately client-side only, same as everything else that touches
 * plaintext file bytes (zero-knowledge, architecture.md §3): built entirely
 * in memory from bytes `session.js`'s `downloadFile()` already decrypted,
 * never touching the network again. `fflate`'s `zipSync` (not a streaming
 * API) is the right fit at this app's real scale - the same "low tens of
 * files, bounded by the 500 MiB quota" reasoning `crypto/files.js`'s own
 * header comment already accepts for holding a whole file in memory at
 * once applies here too, just for several files at a time instead of one.
 *
 * @param {ReadonlyArray<{ name: string, bytes: Uint8Array }>} files
 * @returns {Uint8Array} the zip archive's raw bytes, ready for `saveArtifact`
 */
export function buildZipArchive(files) {
  const paths = deduplicatePaths(files.map((f) => f.name));
  /** @type {Record<string, Uint8Array>} */
  const entries = {};
  files.forEach((f, i) => {
    entries[paths[i]] = f.bytes;
  });
  return zipSync(entries);
}

/**
 * @param {Date} [now]
 * @returns {string} e.g. "smallstash-files-2026-08-28.zip"
 */
export function bundleFileName(now = new Date()) {
  // Local date, not toISOString() - same reasoning as export.js's
  // csvFileName: the filename should match the day it was the user's, not
  // UTC's.
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `smallstash-files-${year}-${month}-${day}.zip`;
}
