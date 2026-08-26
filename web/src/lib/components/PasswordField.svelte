<script>
  /**
   * Password `<input>` with an adjacent Show/Hide toggle - factored out
   * once the same pattern (already used for vault entry passwords in
   * EntryListItem.svelte/VaultView.svelte) was needed on every other
   * password field too (login, signup, offline unlock, change Master
   * Password). Deliberately just the input+button, not a full label
   * wrapper - callers keep their own `<label>Text <PasswordField .../></label>`
   * and `<small>` hint markup, which varies per field.
   */

  /**
   * `id`/`describedby` exist so callers can associate the field with an
   * external `<label for>` and hint instead of wrapping it in a `<label>`.
   * That matters more than it sounds: with a wrapping label, the *entire*
   * label subtree becomes the input's accessible name - so this component's
   * own "Show" button, and any hint text next to it, got announced as part
   * of the field's name ("Login password Show Your account sign-in
   * password."). Explicit association keeps the name to just the label.
   *
   * `fieldName` names what the toggle reveals, for the button's accessible
   * name only - the visible text stays the compact "Show"/"Hide". Without
   * it, a form with four password fields has four buttons all called
   * "Show", which is unusable when tabbing through by ear (and ambiguous to
   * any role-based query). Same defect as the two "Change Master Password"
   * buttons, one level down.
   *
   * @type {{
   *   value: string,
   *   autocomplete?: string,
   *   required?: boolean,
   *   id?: string,
   *   describedby?: string,
   *   fieldName?: string,
   * }}
   */
  let {
    value = $bindable(''),
    autocomplete = 'off',
    required = false,
    id = undefined,
    describedby = undefined,
    fieldName = undefined,
  } = $props();

  let show = $state(false);

  // Falls back to the visible text when no fieldName is given, rather than
  // producing "Show undefined".
  let toggleLabel = $derived(fieldName ? `${show ? 'Hide' : 'Show'} ${fieldName}` : undefined);
</script>

<span class="password-field">
  <input type={show ? 'text' : 'password'} bind:value {autocomplete} {required} {id} aria-describedby={describedby} />
  <button type="button" aria-label={toggleLabel} onclick={() => (show = !show)}>{show ? 'Hide' : 'Show'}</button>
</span>

<style>
  /**
   * The toggle sits *inside* the input's box rather than beside it: two
   * separate bordered controls read as two fields, and the button competes
   * for attention with the input it only annotates. Absolutely positioned via
   * this stylesheet, never a style="" attribute - the deployed CSP is
   * `style-src 'self'` with no 'unsafe-inline' (see src/app.css).
   */
  .password-field {
    position: relative;
    display: block;
  }

  input {
    /* Room for the widest label ("Show"/"Hide") plus its inset, so a long
       password never runs underneath the button. */
    padding-right: 4.25rem;
  }

  button {
    position: absolute;
    top: 50%;
    right: var(--ss-space-1);
    transform: translateY(-50%);
    min-height: var(--ss-control-height-sm);
    padding: 0 var(--ss-space-3);
    background: transparent;
    border-color: transparent;
    color: var(--ss-text-muted);
    font-size: var(--ss-text-sm);
  }

  button:hover:not(:disabled) {
    background: var(--ss-surface-raised);
    border-color: var(--ss-border);
    color: var(--ss-text);
    /* Re-assert the centring transform - the shared `button:active` nudge
       in app.css would otherwise replace it and drop the button by half its
       own height on press. */
    transform: translateY(-50%);
  }

  button:active:not(:disabled) {
    transform: translateY(-50%);
  }
</style>
