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
 * The artifact list is intentionally a *list* even though there is exactly
 * one entry today. File attachments are planned (see docs/todo.md), and when
 * they land an export becomes "a CSV plus N files" - at which point the
 * writer switches from a single save dialog to a directory picker or an
 * archive. Designing that seam now means adding files is additive rather
 * than a rewrite of the export path.
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
 * Everything an export writes to disk.
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
 * @param {{ includeBom?: boolean }} [options]
 * @returns {Array<{ path: string, contents: string, mimeType: string }>}
 */
export function buildExportArtifacts(vaultDocument, now = new Date(), { includeBom = true } = {}) {
  const csv = entriesToCsv(vaultDocument?.entries ?? []);
  return [
    {
      path: csvFileName(now),
      contents: includeBom ? `${BOM}${csv}` : csv,
      mimeType: 'text/csv;charset=utf-8',
    },
  ];
}
