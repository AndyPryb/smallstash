<script>
  /**
   * `<textarea>` with a custom, oversized resize handle - replaces the
   * browser's native corner-drag, which on Android Chrome renders as close
   * to a single pixel and is essentially impossible to grab with a finger
   * (reported against the Notes field, 2026-08-24). Desktop's native handle
   * is small but at least mouse-precise; touch has no such precision, so
   * this needs a real touch target, not just a slightly bigger CSS resizer.
   *
   * Built on Pointer Events (not separate touch/mouse handlers) so one
   * implementation covers mouse, touch, and pen alike - `resize: none` on
   * the textarea itself turns off the native handle everywhere so there's
   * never two conflicting resize affordances stacked in the same corner.
   *
   * Deliberately a generic wrapper, not Notes-specific - factored out so
   * VaultView's add-entry form and EntryListItem's edit form (the two
   * places a Notes field exists) share one implementation rather than
   * duplicating the drag math.
   */

  /** @type {{ value: string, rows?: number }} */
  let { value = $bindable(''), rows = 3 } = $props();

  let textareaEl;
  let dragging = $state(false);
  let startY = 0;
  let startHeight = 0;

  function startResize(event) {
    dragging = true;
    startY = event.clientY;
    startHeight = textareaEl.getBoundingClientRect().height;
    // Keeps receiving move/up events even if the finger/cursor drifts off
    // the small handle mid-drag - without this, a fast drag on a touch
    // screen easily "escapes" the handle and silently stops resizing.
    event.target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onResize(event) {
    if (!dragging) return;
    const next = startHeight + (event.clientY - startY);
    // Floor matches the default ~3-row height so a drag can't collapse the
    // field to unusably short; no ceiling - let it grow as large as wanted.
    textareaEl.style.height = `${Math.max(next, 60)}px`;
  }

  function endResize() {
    dragging = false;
  }
</script>

<div class="resizable">
  <textarea bind:this={textareaEl} bind:value {rows}></textarea>
  <button
    type="button"
    class="resize-handle"
    class:dragging
    aria-label="Drag to resize this field"
    onpointerdown={startResize}
    onpointermove={onResize}
    onpointerup={endResize}
    onpointercancel={endResize}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M15 15 L15 1 L1 15 Z" />
    </svg>
  </button>
</div>

<style>
  .resizable {
    position: relative;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    /* Native resize turned off - the custom handle below replaces it
       everywhere, so there's exactly one resize affordance, not two. */
    resize: none;
    /* Room for the handle so it doesn't sit on top of typed text in the
       corner. */
    padding-bottom: 1.75rem;
  }
  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    /* 32px is below the 44-48px Android/iOS-recommended touch target, but a
       full-size target here would swallow too much of the textarea's own
       corner (where a user legitimately wants to place their text caret).
       32px is the practical compromise validated against a real phone
       during this fix - "not a dot", grabbable with a fingertip, without
       eating usable textarea space. */
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: #888;
    cursor: nwse-resize;
    touch-action: none;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
  }
  .resize-handle:hover,
  .resize-handle.dragging {
    color: #ccc;
  }
  .resize-handle svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
</style>
