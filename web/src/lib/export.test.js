import test from 'node:test';
import assert from 'node:assert/strict';
import { entriesToCsv, csvFileName, buildExportArtifacts, fileArtifactPaths, CSV_COLUMNS, BOM } from './export.js';

const HEADER = 'title,username,password,url,notes';

const entry = (over = {}) => ({
  title: 'GitHub',
  username: 'user@example.com',
  password: 'hunter2',
  url: 'https://github.com',
  notes: 'personal',
  ...over,
});

test('emits a header row even with no entries', () => {
  assert.equal(entriesToCsv([]), HEADER);
  assert.equal(entriesToCsv(undefined), HEADER);
});

test('emits one CRLF-terminated row per entry, in column order', () => {
  const csv = entriesToCsv([entry()]);
  assert.equal(csv, `${HEADER}\r\nGitHub,user@example.com,hunter2,https://github.com,personal`);
});

test('uses CRLF between rows, per RFC 4180', () => {
  const csv = entriesToCsv([entry({ title: 'A' }), entry({ title: 'B' })]);
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(!/[^\r]\n/.test(csv), 'found a bare LF line ending');
});

test('quotes and doubles embedded quotes', () => {
  const csv = entriesToCsv([entry({ password: 'say "hi"' })]);
  assert.ok(csv.includes('"say ""hi"""'), csv);
});

test('quotes fields containing the delimiter', () => {
  const csv = entriesToCsv([entry({ notes: 'one, two, three' })]);
  assert.ok(csv.includes('"one, two, three"'), csv);
});

test('quotes multi-line notes so the row is not split', () => {
  // The realistic case: Notes is a textarea, so newlines are expected.
  const csv = entriesToCsv([entry({ notes: 'line one\nline two' })]);
  assert.ok(csv.includes('"line one\nline two"'), csv);
  // Exactly one record separator - the embedded newline must not create one.
  assert.equal(csv.split('\r\n').length, 2);
});

test('quotes CRLF inside a field without creating a new record', () => {
  const csv = entriesToCsv([entry({ notes: 'a\r\nb' })]);
  assert.equal(csv.split('\r\n').length, 3, 'a quoted CRLF still splits naively - expected');
  assert.ok(csv.includes('"a\r\nb"'), csv);
});

test('quotes fields with leading or trailing whitespace', () => {
  // Trailing whitespace in a password is legal, invisible, and silently
  // trimmed by some importers if it is not quoted.
  assert.ok(entriesToCsv([entry({ password: ' pad ' })]).includes('" pad "'));
  assert.ok(entriesToCsv([entry({ password: 'trail ' })]).includes('"trail "'));
});

test('does not quote when quoting is unnecessary', () => {
  assert.ok(entriesToCsv([entry({ title: 'plain' })]).includes(',plain,') === false);
  const csv = entriesToCsv([entry({ title: 'plain', username: '', password: '', url: '', notes: '' })]);
  assert.equal(csv, `${HEADER}\r\nplain,,,,`);
});

test('treats missing and null fields as empty, not "undefined"', () => {
  const csv = entriesToCsv([{ title: 'only-a-title', notes: null }]);
  assert.equal(csv, `${HEADER}\r\nonly-a-title,,,,`);
  assert.ok(!csv.includes('undefined'));
  assert.ok(!csv.includes('null'));
});

test('ignores extra fields not in CSV_COLUMNS, such as the internal id', () => {
  const csv = entriesToCsv([entry({ id: 'uuid-should-not-appear' })]);
  assert.ok(!csv.includes('uuid-should-not-appear'), csv);
  assert.equal(csv.split('\r\n')[0], CSV_COLUMNS.join(','));
});

test('exports values verbatim, including formula-looking ones', () => {
  // Deliberate: mangling a password that happens to start with "=" would be
  // a worse failure than the spreadsheet quirk it avoids. See export.js.
  const csv = entriesToCsv([entry({ password: '=1+1' })]);
  assert.ok(csv.includes('=1+1'), csv);
  assert.ok(!csv.includes("'=1+1"), 'password was mangled by an anti-injection prefix');
});

test('csvFileName uses the local date, not UTC', () => {
  // 00:30 on the 5th in a UTC+2 zone is still the 4th in UTC; the filename
  // should say what day it was for the person clicking the button.
  const local = new Date(2026, 0, 5, 0, 30);
  assert.equal(csvFileName(local), 'smallstash-export-2026-01-05.csv');
});

test('csvFileName zero-pads month and day', () => {
  assert.equal(csvFileName(new Date(2026, 8, 9)), 'smallstash-export-2026-09-09.csv');
});

test('buildExportArtifacts returns one CSV artifact today', () => {
  const artifacts = buildExportArtifacts({ entries: [entry()] }, new Date(2026, 7, 26));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'smallstash-export-2026-08-26.csv');
  assert.match(artifacts[0].mimeType, /^text\/csv/);
});

test('buildExportArtifacts prefixes a UTF-8 BOM for Excel by default', () => {
  const [artifact] = buildExportArtifacts({ entries: [] }, new Date());
  assert.equal(artifact.contents.charCodeAt(0), 0xfeff);
  assert.ok(artifact.contents.slice(1).startsWith('title,'));
});

test('buildExportArtifacts omits the BOM when asked', () => {
  // The BOM is what a reader that ignores it renders as "ï»¿" (those three
  // bytes read as Latin-1). Turning it off has to remove it entirely, not
  // just move it.
  const [artifact] = buildExportArtifacts({ entries: [] }, new Date(), { includeBom: false });
  assert.notEqual(artifact.contents.charCodeAt(0), 0xfeff);
  assert.ok(artifact.contents.startsWith('title,'));
  assert.ok(!artifact.contents.includes(BOM));
});

test('the BOM is the only difference between the two variants', () => {
  const vault = { entries: [entry({ password: 'ф' })] };
  const now = new Date(2026, 7, 26);
  const withBom = buildExportArtifacts(vault, now, { includeBom: true })[0];
  const without = buildExportArtifacts(vault, now, { includeBom: false })[0];
  assert.equal(withBom.contents, BOM + without.contents);
  assert.equal(withBom.path, without.path, 'filename must not depend on the BOM choice');
});

test('BOM-less output still encodes non-ASCII as UTF-8', () => {
  // Dropping the BOM changes nothing about the encoding itself - a reader
  // that decodes as Latin-1 will still mangle "ф" (UTF-8 D1 84 -> "Ñ" plus a
  // control byte). Removing the BOM fixes the visible "ï»¿", not a reader
  // that ignores UTF-8 altogether.
  const [artifact] = buildExportArtifacts({ entries: [entry({ password: 'ф' })] }, new Date(), {
    includeBom: false,
  });
  assert.ok(artifact.contents.includes('ф'));
  assert.deepEqual([...new TextEncoder().encode('ф')], [0xd1, 0x84]);
});

test('buildExportArtifacts survives a missing or empty vault document', () => {
  assert.equal(buildExportArtifacts(undefined, new Date()).length, 1);
  assert.equal(buildExportArtifacts({}, new Date())[0].contents.slice(1), 'title,username,password,url,notes');
});

test('non-ASCII content round-trips unchanged', () => {
  const csv = entriesToCsv([entry({ password: 'pässwörd–✓', notes: 'Ω' })]);
  assert.ok(csv.includes('pässwörd–✓'));
  assert.ok(csv.includes('Ω'));
});

// --- files (docs/file-storage-plan.md Phase 4) --------------------------

const file = (over = {}) => ({
  name: 'document.pdf',
  mimeType: 'application/pdf',
  bytes: new Uint8Array([1, 2, 3, 4]),
  ...over,
});

test('buildExportArtifacts with no files option reproduces the exact CSV-only output', () => {
  const vault = { entries: [entry()] };
  const withoutOption = buildExportArtifacts(vault, new Date(2026, 7, 26));
  const withEmptyFiles = buildExportArtifacts(vault, new Date(2026, 7, 26), { files: [] });
  assert.equal(withoutOption.length, 1);
  assert.deepEqual(withoutOption, withEmptyFiles);
});

test('buildExportArtifacts adds one artifact per file, under files/', () => {
  const artifacts = buildExportArtifacts(
    { entries: [] },
    new Date(),
    { files: [file({ name: 'a.pdf' }), file({ name: 'b.jpg', mimeType: 'image/jpeg' })] },
  );

  assert.equal(artifacts.length, 3, 'CSV + 2 files');
  assert.equal(artifacts[0].path.endsWith('.csv'), true, 'CSV artifact stays first');
  assert.equal(artifacts[1].path, 'files/a.pdf');
  assert.equal(artifacts[2].path, 'files/b.jpg');
  assert.equal(artifacts[2].mimeType, 'image/jpeg');
});

test('buildExportArtifacts passes file bytes through unchanged, not re-encoded', () => {
  const bytes = new Uint8Array([255, 0, 128, 64]);
  const [, fileArtifact] = buildExportArtifacts({ entries: [] }, new Date(), { files: [file({ bytes })] });

  assert.equal(fileArtifact.contents, bytes, 'must be the same bytes, not a copy or a string conversion');
});

test('buildExportArtifacts de-duplicates files that share a name', () => {
  const artifacts = buildExportArtifacts(
    { entries: [] },
    new Date(),
    { files: [file({ name: 'receipt.pdf' }), file({ name: 'receipt.pdf' }), file({ name: 'receipt.pdf' })] },
  );

  const paths = artifacts.slice(1).map((a) => a.path);
  assert.deepEqual(paths, ['files/receipt.pdf', 'files/receipt (1).pdf', 'files/receipt (2).pdf']);
  // Every path is unique - no artifact would silently overwrite another
  // when written to a real directory.
  assert.equal(new Set(paths).size, paths.length);
});

test('buildExportArtifacts de-duplicates an extension-less file name', () => {
  const artifacts = buildExportArtifacts(
    { entries: [] },
    new Date(),
    { files: [file({ name: 'README' }), file({ name: 'README' })] },
  );

  assert.deepEqual(artifacts.slice(1).map((a) => a.path), ['files/README', 'files/README (1)']);
});

test('fileArtifactPaths matches the paths buildExportArtifacts would assign, computed from name alone', () => {
  // ExportPanel.svelte's streamed export relies on this: it needs the final
  // path *before* a file's bytes are downloaded, to write straight into a
  // directory handle opened ahead of the fetch (docs/file-storage-plan.md
  // Phase 4's transient-activation fix). This locks the two in agreement.
  const metadata = [{ name: 'receipt.pdf' }, { name: 'receipt.pdf' }, { name: 'photo.jpg' }];
  const paths = fileArtifactPaths(metadata);

  const artifacts = buildExportArtifacts(
    { entries: [] },
    new Date(),
    { files: metadata.map((m) => file({ name: m.name })) },
  );

  assert.deepEqual(paths, artifacts.slice(1).map((a) => a.path));
});
