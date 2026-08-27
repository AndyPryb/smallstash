/**
 * Vault export - building the file contents. Writing them to disk lives in
 * saveFile.js, so everything here stays pure and testable.
 *
 * ⚠️ This module deliberately produces **plaintext**. It is the one place in
 * the app where decrypted vault content is packaged to leave the browser in
 * the clear, which is a deliberate hole in the zero-knowledge model
 * (architecture.md §3) rather than an oversight - the user is asking for
 * their own data in a form other software can read. Everything in the UI
 * around it exists to make sure that's a conscious choice: the export is
 * gated behind an explicit acknowledgement, and the resulting file has no
 * protection of any kind once written.
 *
 * The artifact list was a *list* from the start, even when there was exactly
 * one entry - so that adding uploaded files (docs/file-storage-plan.md
 * Phase 4) could be additive rather than a rewrite. That prediction held:
 * `buildExportArtifacts` below still only ever builds artifacts from data
 * already in memory, and stays synchronous and network-free - the actual
 * fetching/decrypting of file bytes happens in `session.js` (which already
 * owns every other file network call) and `ExportPanel.svelte` passes the
 * results in, already decrypted, as plain `{ name, mimeType, bytes }`
 * objects - exactly `session.js`'s `downloadFile()` return shape, so no
 * translation layer sits between the two.
 */

/** Column order of the exported CSV. Also the header row. */
export const CSV_COLUMNS = Object.freeze(['title', 'username', 'password', 'url', 'notes']);

/**
 * RFC 4180 field escaping.
 *
 * Quoting only when required, which is what every spreadsheet and most
 * importers expect to see. A field needs quotes if it contains the delimiter,
 * a quote, or a line break - and quotes inside a quoted field are escaped by
 * doubling them, not with a backslash. Leading/trailing whitespace is quoted
 * too, since some importers otherwise trim it, and trailing whitespace in a
 * password is both legal and invisible.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const needsQuoting = /[",\r\n]/.test(text) || text !== text.trim();
  if (!needsQuoting) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Serialises vault entries as CSV.
 *
 * CRLF line endings, per RFC 4180 and because Excel is the most likely
 * consumer.
 *
 * **Formula injection is deliberately not mitigated.** A field beginning
 * `=`, `+`, `-` or `@` can be evaluated as a formula when the file is opened
 * in Excel or Sheets. The usual mitigation is to prefix such fields with an
 * apostrophe - but that *changes the exported password*, and silently
 * handing back a wrong password is a worse failure for a password manager
 * than a spreadsheet quirk. Values are exported verbatim; the UI warns that
 * the file is plaintext and best opened in a text editor. Same choice
 * Bitwarden and 1Password make for their CSV exports.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} entries
 * @returns {string}
 */
export function entriesToCsv(entries) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const entry of entries ?? []) {
    rows.push(CSV_COLUMNS.map((column) => escapeCsvField(entry?.[column])).join(','));
  }
  return rows.join('\r\n');
}

/**
 * @param {Date} date
 * @returns {string} e.g. "smallstash-export-2026-08-26.csv"
 */
export function csvFileName(date) {
  // Local date, not toISOString(): the filename should match the day it was
  // the user's, not UTC's - an evening export in UTC+2 would otherwise be
  // stamped with tomorrow's date.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `smallstash-export-${year}-${month}-${day}.csv`;
}

/** UTF-8 byte order mark, U+FEFF. Encodes as the bytes EF BB BF. */
export const BOM = '﻿';

/**
 * Makes every path in a list unique by appending `(1)`, `(2)`, ... before
 * the extension of any repeat - two uploaded files can legitimately share a
 * name (e.g. two different `receipt.pdf`s), and silently letting one
 * overwrite the other during a directory-picker export would quietly lose
 * data with no error to explain why the export has fewer files than the
 * user uploaded.
 *
 * @param {string[]} paths in the order artifacts will be written
 * @returns {string[]} same order, same length, all unique
 */
function deduplicatePaths(paths) {
  const seen = new Map();
  return paths.map((path) => {
    const count = seen.get(path) ?? 0;
    seen.set(path, count + 1);
    if (count === 0) return path;
    const dot = path.lastIndexOf('.');
    return dot > 0 ? `${path.slice(0, dot)} (${count})${path.slice(dot)}` : `${path} (${count})`;
  });
}

/**
 * The `files/`-prefixed, deduplicated path each file will be written to -
 * `files/` so a directory-picker export lands them alongside the CSV in a
 * sub-folder rather than mixed in with it (`smallstash-export-....csv`
 * reads as the one thing at the export's top level, with everything else
 * organised under it).
 *
 * Exported separately from {@link fileArtifacts}/{@link buildExportArtifacts}
 * so a caller can compute the final path for a file **before** its bytes
 * are fetched - `ExportPanel.svelte` needs exactly that ordering to open a
 * directory picker ahead of a slow multi-file download rather than after it
 * (docs/file-storage-plan.md Phase 4's transient-activation note). Takes
 * just `{ name }` for that reason - it deliberately doesn't need the rest of
 * a file's metadata, only what's already known before download starts.
 *
 * @param {ReadonlyArray<{ name: string }>} files
 * @returns {string[]} same order, same length as `files`
 */
export function fileArtifactPaths(files) {
  return deduplicatePaths((files ?? []).map((f) => `files/${f.name}`));
}

/**
 * Builds one export artifact per already-decrypted file.
 *
 * @param {ReadonlyArray<{ name: string, mimeType: string, bytes: Uint8Array }>} files
 * @returns {Array<{ path: string, contents: Uint8Array, mimeType: string }>}
 */
function fileArtifacts(files) {
  const paths = fileArtifactPaths(files);
  return (files ?? []).map((f, i) => ({ path: paths[i], contents: f.bytes, mimeType: f.mimeType }));
}

/**
 * Everything an export writes to disk.
 *
 * `files`, if given, must already be decrypted - this function never fetches
 * or decrypts anything itself (see this module's header comment for why).
 * Omitting it or passing `[]` reproduces the exact CSV-only output this
 * function always produced, byte for byte - existing callers with no files
 * to add are unaffected.
 *
 * ### Why the BOM is a choice rather than always-on
 *
 * A CSV file carries no way to declare its own encoding - the `charset` in
 * the MIME type is an HTTP-level thing that's gone the moment the bytes are
 * on disk. So every reader guesses, and the two common guesses disagree:
 *
 * - **Microsoft Excel on Windows** assumes the legacy system codepage for a
 *   BOM-less CSV and mangles every non-ASCII character. A BOM is the only
 *   thing that makes it read UTF-8, which is why this defaults to on.
 * - **Readers that don't check for a BOM** decode those three bytes as
 *   whatever single-byte encoding they defaulted to, and show them as
 *   literal junk - `ï»¿` is `EF BB BF` read as Latin-1/Windows-1252. Reported
 *   from a mobile CSV viewer 2026-08-26, where the header appeared as
 *   `ï»¿title`.
 *
 * There is no single output that satisfies both, so the caller picks.
 *
 * @param {{ entries: ReadonlyArray<Record<string, unknown>> }} vaultDocument
 * @param {Date} [now]
 * @param {{ includeBom?: boolean, files?: ReadonlyArray<{ name: string, mimeType: string, bytes: Uint8Array }> }} [options]
 * @returns {Array<{ path: string, contents: string | Uint8Array, mimeType: string }>}
 */
export function buildExportArtifacts(vaultDocument, now = new Date(), { includeBom = true, files = [] } = {}) {
  const csv = entriesToCsv(vaultDocument?.entries ?? []);
  return [
    {
      path: csvFileName(now),
      contents: includeBom ? `${BOM}${csv}` : csv,
      mimeType: 'text/csv;charset=utf-8',
    },
    ...fileArtifacts(files),
  ];
}
