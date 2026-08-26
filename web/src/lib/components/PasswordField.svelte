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

  /** @type {{ value: string, autocomplete?: string, required?: boolean }} */
  let { value = $bindable(''), autocomplete = 'off', required = false } = $props();

  let show = $state(false);
</script>

<span class="password-field">
  <input type={show ? 'text' : 'password'} bind:value {autocomplete} {required} />
  <button type="button" onclick={() => (show = !show)}>{show ? 'Hide' : 'Show'}</button>
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
