import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { buildZipArchive, bundleFileName } from './zipFiles.js';

test('buildZipArchive round-trips file names and bytes exactly', () => {
  const a = { name: 'a.txt', bytes: new TextEncoder().encode('hello') };
  const b = { name: 'photo.jpg', bytes: new Uint8Array([255, 0, 128, 64]) };

  const zip = buildZipArchive([a, b]);
  const unzipped = unzipSync(zip);

  assert.deepEqual(Object.keys(unzipped).sort(), ['a.txt', 'photo.jpg']);
  assert.equal(new TextDecoder().decode(unzipped['a.txt']), 'hello');
  assert.deepEqual([...unzipped['photo.jpg']], [255, 0, 128, 64]);
});

test('buildZipArchive de-duplicates files that share a name', () => {
  const files = [
    { name: 'receipt.pdf', bytes: new Uint8Array([1]) },
    { name: 'receipt.pdf', bytes: new Uint8Array([2]) },
    { name: 'receipt.pdf', bytes: new Uint8Array([3]) },
  ];

  const unzipped = unzipSync(buildZipArchive(files));

  assert.deepEqual(Object.keys(unzipped).sort(), ['receipt (1).pdf', 'receipt (2).pdf', 'receipt.pdf']);
  // Every entry keeps its own distinct bytes, not just a unique name -
  // proves the dedup renames rather than drops/overwrites.
  assert.deepEqual([...unzipped['receipt.pdf']], [1]);
  assert.deepEqual([...unzipped['receipt (1).pdf']], [2]);
  assert.deepEqual([...unzipped['receipt (2).pdf']], [3]);
});

test('buildZipArchive handles an empty file list', () => {
  const unzipped = unzipSync(buildZipArchive([]));
  assert.deepEqual(Object.keys(unzipped), []);
});

test('bundleFileName uses the local date, not UTC', () => {
  // 00:30 on the 5th in a UTC+2 zone is still the 4th in UTC; the filename
  // should say what day it was for the person clicking the button - same
  // reasoning as export.js's csvFileName.
  const local = new Date(2026, 0, 5, 0, 30);
  assert.equal(bundleFileName(local), 'smallstash-files-2026-01-05.zip');
});

test('bundleFileName zero-pads month and day', () => {
  assert.equal(bundleFileName(new Date(2026, 8, 9)), 'smallstash-files-2026-09-09.zip');
});
