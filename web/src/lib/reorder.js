/**
 * Array reordering for the vault entry list.
 *
 * Pure and separate from the components so the index arithmetic - which is
 * the part that's easy to get subtly wrong, particularly when moving an item
 * *down* past its own removed slot - can be unit tested without a DOM or a
 * drag gesture.
 *
 * Nothing about entry order needs a backend change: `vaultDocument.entries`
 * is a plain array persisted as `JSON.stringify(vaultDocument)` by
 * crypto/vault.js, and JSON arrays are ordered, so array position already
 * *is* the stored order. The backend only ever sees opaque ciphertext (see
 * VaultController) and could not index or order entries even if it wanted
 * to - that's the zero-knowledge guarantee, not a gap.
 */

/**
 * Moves one item to a new index, returning a new array. Always returns a new
 * array (never mutates), because VaultView relies on reassigning
 * `vaultDocument.entries` to re-derive its `dirty` flag - an in-place splice
 * would reorder the vault without ever marking it unsaved.
 *
 * Out-of-range indices return an unchanged copy rather than throwing: the
 * callers are a pointer landing somewhere unexpected and a keyboard arrow at
 * the end of the list, and "do nothing" is the right answer for both.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {T[]}
 */
export function moveItem(items, fromIndex, toIndex) {
  const next = [...items];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return next;
  if (fromIndex < 0 || fromIndex >= next.length) return next;
  if (toIndex < 0 || toIndex >= next.length) return next;
  if (fromIndex === toIndex) return next;

  // splice-out then splice-in. Worth being explicit about why no index
  // adjustment is needed when moving down: removing the item first shifts
  // every later element left by one, so `toIndex` already refers to the
  // correct final slot in the shortened array.
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Given the vertical midpoints of the rendered rows and a pointer position,
 * returns the index the dragged row should occupy.
 *
 * Midpoints rather than edges is what makes a drag feel right: a row swaps
 * only once the pointer is more than halfway across its neighbour, so items
 * don't flicker back and forth while the pointer sits on a boundary.
 *
 * @param {readonly number[]} midpoints  viewport-relative y midpoint per row, in order
 * @param {number} fromIndex             where the dragged row currently sits
 * @param {number} pointerY              viewport-relative y of the pointer
 * @returns {number} the target index (=== fromIndex when nothing should move)
 */
export function dropIndexFor(midpoints, fromIndex, pointerY) {
  if (fromIndex < 0 || fromIndex >= midpoints.length) return fromIndex;

  // Moving up: the first row above whose midpoint the pointer has risen
  // past. Scanning downward from the top finds the furthest such row, so a
  // fast drag that overshoots several rows still lands correctly.
  for (let i = 0; i < fromIndex; i++) {
    if (pointerY < midpoints[i]) return i;
  }
  // Moving down: the last row below whose midpoint the pointer has passed.
  let target = fromIndex;
  for (let i = fromIndex + 1; i < midpoints.length; i++) {
    if (pointerY > midpoints[i]) target = i;
  }
  return target;
}
