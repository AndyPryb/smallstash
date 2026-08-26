<script>
  /**
   * One vault entry, collapsed to title/username by default with a toggle to
   * reveal the rest - the password stays masked until explicitly shown (in
   * both view and edit mode), same "don't display secrets unless asked"
   * reasoning as everywhere else the password appears on screen (login/
   * signup forms, generator preview). `showPassword` is shared between view
   * and edit so toggling it once carries over into editing the same entry.
   *
   * Also owns in-place editing - the "view" and "edit" states are mutually
   * exclusive within one entry's expanded area, so there's never a stale
   * read-only view showing alongside an edit form for the same entry.
   *
   * `onremove`/`onupdate` are id-keyed by the caller (VaultView.svelte),
   * not index-keyed - this component doesn't need to know its own position
   * in the list.
   */
  import PasswordGeneratorPanel from './PasswordGeneratorPanel.svelte';
  import ResizableTextarea from './ResizableTextarea.svelte';
  import { normalizedUrl } from '../url.js';

  /**
   * Reordering is owned by VaultView, not here - only it can see the whole
   * list, and the drop target depends on every row's position. This
   * component renders the handle and forwards the raw pointer events up.
   *
   * @type {{
   *   entry: { id: string, title: string, username: string, password: string, url: string, notes: string },
   *   onremove: () => void,
   *   onupdate: (updated: object) => void,
   *   index?: number,
   *   total?: number,
   *   dragging?: boolean,
   *   onreorderstart?: (event: PointerEvent) => void,
   *   onreordermove?: (event: PointerEvent) => void,
   *   onreorderend?: (event: PointerEvent) => void,
   *   onreordercancel?: () => void,
   *   onreorderstep?: (delta: number) => void,
   * }}
   */
  let {
    entry,
    onremove,
    onupdate,
    index = 0,
    total = 1,
    dragging = false,
    onreorderstart = undefined,
    onreordermove = undefined,
    onreorderend = undefined,
    onreordercancel = undefined,
    onreorderstep = undefined,
  } = $props();

  /**
   * Keyboard equivalent of the drag. A drag-only implementation is simply
   * unusable without a pointer, so the handle is a real focusable button
   * that moves the entry with the arrow keys - the same affordance,
   * reachable by tab.
   *
   * @param {KeyboardEvent} event
   */
  function handleReorderKey(event) {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    // Stops the page scrolling under the user mid-reorder.
    event.preventDefault();
    onreorderstep?.(delta);
  }

  // How this entry is referred to in the accessible names of its own
  // controls. Matches what the summary row displays, so what a screen
  // reader announces and what's on screen agree.
  let entryLabel = $derived(entry.title || '(untitled)');

  let expanded = $state(false);
  let showPassword = $state(false);
  let copied = $state(false);

  let editing = $state(false);
  let showGenerator = $state(false);
  let editTitle = $state('');
  let editUsername = $state('');
  let editPassword = $state('');
  let editUrl = $state('');
  let editNotes = $state('');

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(entry.password);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard access denied/unavailable in this context - "Show" still
      // works as a fallback way to read the password, nothing else to do here.
    }
  }

  /**
   * Entries can legitimately have no password (a notes-only entry, say) -
   * masking an empty string still produced a row of dots that looked like a
   * hidden real password. Only mask when there's actually something to hide.
   */
  function maskedPassword() {
    if (!entry.password) return '—';
    return showPassword ? entry.password : '•'.repeat(Math.max(entry.password.length, 8));
  }

  // normalizedUrl lives in lib/url.js so it can be unit-tested - see the
  // comment there for why a url field needs sanitising at all.

  function startEdit() {
    editTitle = entry.title;
    editUsername = entry.username;
    editPassword = entry.password;
    editUrl = entry.url;
    editNotes = entry.notes;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    showGenerator = false;
  }

  function saveEdit(event) {
    event.preventDefault();
    onupdate({
      title: editTitle,
      username: editUsername,
      password: editPassword,
      url: editUrl,
      notes: editNotes,
    });
    editing = false;
    showGenerator = false;
  }

  function useGeneratedPassword(generated) {
    editPassword = generated;
    showGenerator = false;
    // A password the user just consciously generated is one they'll want to
    // see/verify immediately, not re-hide-then-un-hide - matches common
    // password manager behavior (LastPass/Bitwarden do the same).
    showPassword = true;
  }

  function handleRemove() {
    if (confirm(`Delete "${entry.title || '(untitled)'}"? It's only permanent once you click "Save vault".`)) {
      onremove();
    }
  }
</script>

<li class:expanded={expanded || editing} class:dragging>
  <div class="summary">
    <!-- A dedicated handle rather than dragging the whole row. The row is
         already a button (tap to expand), so making it draggable too would
         make every tap ambiguous - and on touch, a drag gesture on a
         vertical list is indistinguishable from scrolling it. A handle
         needs no long-press timer to disambiguate: grabbing it *is* the
         disambiguation.
         Hidden when there's nothing to reorder. -->
    {#if total > 1}
      <button
        type="button"
        class="drag-handle"
        aria-label="Reorder {entryLabel}. Position {index + 1} of {total}. Press the up or down arrow key to move it."
        disabled={editing}
        onpointerdown={onreorderstart}
        onpointermove={onreordermove}
        onpointerup={onreorderend}
        onpointercancel={onreordercancel}
        onkeydown={handleReorderKey}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="6" cy="3.5" r="1.35" />
          <circle cx="10" cy="3.5" r="1.35" />
          <circle cx="6" cy="8" r="1.35" />
          <circle cx="10" cy="8" r="1.35" />
          <circle cx="6" cy="12.5" r="1.35" />
          <circle cx="10" cy="12.5" r="1.35" />
        </svg>
      </button>
    {/if}
    <button
      type="button"
      class="toggle"
      onclick={() => (expanded = !expanded)}
      disabled={editing}
      aria-expanded={expanded}
    >
      <!-- Purely decorative disclosure caret, rotated by CSS on expand -
           aria-expanded on the button is what actually conveys the state. -->
      <svg class="caret" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 3.5 L11 8 L6 12.5" />
      </svg>
      <span class="entry-title"><strong>{entry.title || '(untitled)'}</strong></span>
      <span class="entry-username">{entry.username}</span>
    </button>
    <button type="button" class="delete compact" onclick={handleRemove} aria-label="Delete {entryLabel}" disabled={editing}>
      ✕
    </button>
  </div>

  {#if expanded && !editing}
    <div class="details">
      <div class="detail-row">
        <span class="label">Username</span>
        <span class="value">{entry.username || '—'}</span>
      </div>

      <div class="detail-row">
        <span class="label">Password</span>
        <span class="value password">{maskedPassword()}</span>
        <button type="button" class="compact" onclick={() => (showPassword = !showPassword)} disabled={!entry.password}>
          {showPassword ? 'Hide' : 'Show'}
        </button>
        <button type="button" class="compact" onclick={copyPassword} disabled={!entry.password}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <div class="detail-row">
        <span class="label">URL</span>
        {#if entry.url}
          <a class="value" href={normalizedUrl(entry.url)} target="_blank" rel="noopener noreferrer">{entry.url}</a>
        {:else}
          <span class="value">—</span>
        {/if}
      </div>

      <div class="detail-row notes">
        <span class="label">Notes</span>
        <p class="value">{entry.notes || '—'}</p>
      </div>

      <div class="row">
        <button type="button" class="compact" onclick={startEdit}>Edit</button>
      </div>
    </div>
  {/if}

  {#if editing}
    <form class="edit-form" onsubmit={saveEdit}>
      <label class="field">Title <input bind:value={editTitle} required /></label>
      <label class="field">Username <input bind:value={editUsername} /></label>
      <label class="field">
        Password
        <span class="password-row">
          <input type={showPassword ? 'text' : 'password'} bind:value={editPassword} />
          <!-- Named after the entry: the always-present add-entry form has
               its own Show/Generate pair, so without this two different
               controls share one accessible name whenever an entry is being
               edited. -->
          <button
            type="button"
            class="compact"
            aria-label="{showPassword ? 'Hide' : 'Show'} password for {entryLabel}"
            onclick={() => (showPassword = !showPassword)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            class="compact"
            aria-label="Generate a password for {entryLabel}"
            onclick={() => (showGenerator = !showGenerator)}
          >
            Generate
          </button>
        </span>
      </label>
      {#if showGenerator}
        <PasswordGeneratorPanel onuse={useGeneratedPassword} onclose={() => (showGenerator = false)} />
      {/if}
      <label class="field">URL <input bind:value={editUrl} /></label>
      <label class="field">Notes <ResizableTextarea bind:value={editNotes} label="the notes for {entryLabel}" /></label>
      <div class="row">
        <button type="submit" class="primary compact">Save</button>
        <button type="button" class="compact" onclick={cancelEdit}>Cancel</button>
      </div>
    </form>
  {/if}
</li>

<style>
  /**
   * One entry, as a card. The old treatment was a bare row with a hairline
   * underneath, which worked while every row was one line tall but fell
   * apart once a row could expand into a details panel or a full edit form
   * - there was nothing to show where one entry's expanded content ended
   * and the next entry began.
   *
   * Shared control styling (buttons, inputs, `.field` labels) is in
   * src/app.css; `.compact` is the dense button variant used throughout
   * here, since a 44px control would out-weigh the content it acts on.
   */
  li {
    display: flex;
    flex-direction: column;
    padding: var(--ss-space-2);
    background: var(--ss-surface);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-lg);
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  li:hover {
    border-color: var(--ss-border-strong);
  }

  /* An open entry is the one the user is working in - lift it out of the
     stack with a stronger border and a shadow instead of leaving every
     card identical. */
  li.expanded {
    border-color: var(--ss-border-strong);
    box-shadow: var(--ss-shadow-1);
  }

  /* The row being dragged lifts further still and follows the accent, so
     it's unmistakably the thing that will land when the pointer is
     released. No transition on this one: the rows around it reflow
     instantly as it passes them, and an animated lift would lag behind the
     pointer it's supposed to be tracking. */
  li.dragging {
    border-color: var(--ss-accent);
    box-shadow: var(--ss-shadow-2);
    /* Lets the rows underneath show through just enough to see where it's
       about to land. */
    opacity: 0.9;
    transition: none;
  }

  .drag-handle {
    flex-shrink: 0;
    width: var(--ss-control-height-sm);
    min-height: var(--ss-control-height-sm);
    padding: 0;
    background: transparent;
    border-color: transparent;
    color: var(--ss-text-faint);
    cursor: grab;
    /* Required for a pointer-driven drag on touch: without it the browser
       claims the gesture for scrolling and never delivers pointermove.
       Scoped to the handle alone, so the rest of the row still scrolls the
       page normally. */
    touch-action: none;
  }

  .drag-handle:hover:not(:disabled) {
    background: var(--ss-surface-raised);
    border-color: var(--ss-border);
    color: var(--ss-text);
  }

  li.dragging .drag-handle {
    color: var(--ss-accent);
    cursor: grabbing;
  }

  /* The shared press-nudge would shift the handle out from under the
     pointer at the moment the drag begins. */
  .drag-handle:active:not(:disabled) {
    transform: none;
  }

  .drag-handle svg {
    width: 1rem;
    height: 1rem;
    fill: currentColor;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: var(--ss-space-2);
  }

  /* The whole summary line is the disclosure control, so it's a full-width
     borderless button rather than a small hit area next to the title. */
  .toggle {
    display: flex;
    align-items: center;
    /* Overrides the shared button centring from app.css - this one is a
       full-width row of content, not a label in a pill. */
    justify-content: flex-start;
    gap: var(--ss-space-3);
    flex: 1;
    min-width: 0;
    min-height: var(--ss-control-height);
    padding: 0 var(--ss-space-2);
    background: none;
    border: none;
    border-radius: var(--ss-radius-md);
    color: inherit;
    font: inherit;
    font-weight: 400;
    text-align: left;
  }

  .toggle:hover:not(:disabled) {
    background: var(--ss-surface-raised);
    border-color: transparent;
  }

  .toggle:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .caret {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    fill: none;
    stroke: var(--ss-text-faint);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 150ms ease, stroke 120ms ease;
  }

  li.expanded .caret {
    transform: rotate(90deg);
    stroke: var(--ss-accent);
  }

  .entry-title {
    flex-shrink: 0;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Secondary to the title, and the first thing to give up space when the
     card is narrower than both fields want. */
  .entry-username {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ss-text-muted);
    font-size: var(--ss-text-sm);
  }

  .delete {
    flex-shrink: 0;
    background: transparent;
    border-color: transparent;
    color: var(--ss-text-faint);
    /* Square, so the ✕ sits centred rather than in a wide pill. */
    width: var(--ss-control-height-sm);
    padding: 0;
  }

  .delete:hover:not(:disabled) {
    background: var(--ss-danger-surface);
    border-color: var(--ss-danger-border);
    color: var(--ss-danger-text);
  }

  /* Sunken relative to the card, which is itself raised from the canvas -
     the expanded content reads as inside the entry, not stacked on it. */
  .details,
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-3);
    margin-top: var(--ss-space-2);
    padding: var(--ss-space-4);
    background: var(--ss-surface-sunken);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
  }

  .detail-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
    font-size: var(--ss-text-base);
  }

  .detail-row.notes {
    align-items: flex-start;
  }

  .label {
    min-width: 5.5rem;
    flex-shrink: 0;
    color: var(--ss-text-faint);
    font-size: var(--ss-text-xs);
    font-weight: 500;
    letter-spacing: 0.06em;
    /* Small-caps-style key column: at this size, tracking and case do more
       to separate label from value than another shade of grey would. */
    text-transform: uppercase;
  }

  .value {
    min-width: 0;
    word-break: break-word;
  }

  .detail-row.notes .value {
    flex: 1;
    white-space: pre-wrap;
  }

  .password {
    flex: 1;
    font-family: var(--ss-font-mono);
    letter-spacing: 0.05em;
    word-break: break-all;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
  }

  .password-row {
    display: flex;
    gap: var(--ss-space-2);
  }

  .password-row input {
    flex: 1;
    min-width: 0;
  }

  /* The edit form is itself a sunken panel, so the default sunken field
     background would vanish into it. Setting the token rather than the
     property means the nested ResizableTextarea picks this up too, which a
     scoped `textarea` selector could never reach. */
  .edit-form {
    --ss-field-bg: var(--ss-surface);
  }

  /* Same reasoning as VaultView's add-entry form - Show and Generate crowd
     the password input off a phone-width screen. */
  @media (max-width: 32rem) {
    .password-row {
      flex-wrap: wrap;
    }
    .password-row input {
      flex-basis: 100%;
    }
    .label {
      min-width: 100%;
    }
  }
</style>
