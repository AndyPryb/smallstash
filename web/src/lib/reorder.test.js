import test from 'node:test';
import assert from 'node:assert/strict';
import { moveItem, dropIndexFor } from './reorder.js';

const abcde = ['a', 'b', 'c', 'd', 'e'];

test('moveItem moves an item up', () => {
  assert.deepEqual(moveItem(abcde, 3, 1), ['a', 'd', 'b', 'c', 'e']);
});

test('moveItem moves an item down', () => {
  // The case with the off-by-one trap: removing 'b' first shifts everything
  // after it left, so index 3 in the shortened array is the slot after 'd'.
  assert.deepEqual(moveItem(abcde, 1, 3), ['a', 'c', 'd', 'b', 'e']);
});

test('moveItem moves to the first and last positions', () => {
  assert.deepEqual(moveItem(abcde, 4, 0), ['e', 'a', 'b', 'c', 'd']);
  assert.deepEqual(moveItem(abcde, 0, 4), ['b', 'c', 'd', 'e', 'a']);
});

test('moveItem is a no-op when the indices are the same', () => {
  assert.deepEqual(moveItem(abcde, 2, 2), abcde);
});

test('moveItem never mutates its input', () => {
  const original = [...abcde];
  moveItem(original, 0, 4);
  assert.deepEqual(original, abcde, 'input array was mutated');
});

test('moveItem always returns a new array', () => {
  // VaultView's `dirty` flag is derived from reassigning
  // vaultDocument.entries; handing back the same reference on a no-op path
  // would be fine, but a mutated-in-place array would silently reorder the
  // vault without marking it unsaved.
  const original = [...abcde];
  assert.notEqual(moveItem(original, 1, 3), original);
  assert.notEqual(moveItem(original, 2, 2), original);
});

test('moveItem ignores out-of-range indices instead of throwing', () => {
  assert.deepEqual(moveItem(abcde, -1, 2), abcde);
  assert.deepEqual(moveItem(abcde, 2, -1), abcde);
  assert.deepEqual(moveItem(abcde, 99, 2), abcde);
  assert.deepEqual(moveItem(abcde, 2, 99), abcde);
  assert.deepEqual(moveItem(abcde, 1.5, 2), abcde);
});

test('moveItem handles empty and single-item lists', () => {
  assert.deepEqual(moveItem([], 0, 0), []);
  assert.deepEqual(moveItem(['only'], 0, 0), ['only']);
});

test('moveItem round-trips back to the original order', () => {
  assert.deepEqual(moveItem(moveItem(abcde, 0, 3), 3, 0), abcde);
});

// Rows 50px tall starting at y=0: midpoints at 25, 75, 125, 175, 225.
const midpoints = [25, 75, 125, 175, 225];

test('dropIndexFor stays put while the pointer is inside its own row', () => {
  assert.equal(dropIndexFor(midpoints, 2, 125), 2);
  assert.equal(dropIndexFor(midpoints, 2, 110), 2);
  assert.equal(dropIndexFor(midpoints, 2, 140), 2);
});

test('dropIndexFor moves up once the pointer passes the row above midpoint', () => {
  assert.equal(dropIndexFor(midpoints, 2, 74), 1);
  assert.equal(dropIndexFor(midpoints, 2, 24), 0);
});

test('dropIndexFor moves down once the pointer passes the row below midpoint', () => {
  assert.equal(dropIndexFor(midpoints, 2, 176), 3);
  assert.equal(dropIndexFor(midpoints, 2, 226), 4);
});

test('dropIndexFor clamps to the ends when dragged far past them', () => {
  // A fast drag well outside the list must not produce an out-of-range index.
  assert.equal(dropIndexFor(midpoints, 2, -5000), 0);
  assert.equal(dropIndexFor(midpoints, 2, 5000), 4);
});

test('dropIndexFor handles the first and last rows', () => {
  assert.equal(dropIndexFor(midpoints, 0, -100), 0, 'first row cannot move further up');
  assert.equal(dropIndexFor(midpoints, 4, 5000), 4, 'last row cannot move further down');
  assert.equal(dropIndexFor(midpoints, 0, 5000), 4);
  assert.equal(dropIndexFor(midpoints, 4, -5000), 0);
});

test('dropIndexFor returns fromIndex unchanged when it is out of range', () => {
  assert.equal(dropIndexFor(midpoints, -1, 100), -1);
  assert.equal(dropIndexFor(midpoints, 99, 100), 99);
  assert.equal(dropIndexFor([], 0, 100), 0);
});
