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
  .password-field {
    display: flex;
    gap: 0.4rem;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 0.5rem;
    font-size: 1rem;
  }
  button {
    padding: 0.6rem;
    font-size: 1rem;
    cursor: pointer;
    white-space: nowrap;
  }
</style>
