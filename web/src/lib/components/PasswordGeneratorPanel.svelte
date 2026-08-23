<script>
  import { generatePassword } from '../generator.js';

  /** @type {{ onuse: (password: string) => void, onclose: () => void }} */
  let { onuse, onclose } = $props();

  let length = $state(20);
  let lowercase = $state(true);
  let uppercase = $state(true);
  let digits = $state(true);
  let symbols = $state(true);
  let excludeAmbiguous = $state(false);

  let password = $state('');
  let error = $state('');
  let copied = $state(false);

  // Re-generate whenever any option changes, so the preview always matches
  // what "Use this password" would insert - no separate "Apply" step needed.
  $effect(() => {
    regenerate();
  });

  function regenerate() {
    error = '';
    copied = false;
    try {
      password = generatePassword({ length, lowercase, uppercase, digits, symbols, excludeAmbiguous });
    } catch (err) {
      password = '';
      error = err.message ?? String(err);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      copied = true;
    } catch {
      error = 'Could not copy - your browser may be blocking clipboard access here';
    }
  }

  function use() {
    onuse(password);
  }
</script>

<div class="panel">
  <h2>Generate password</h2>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <code class="preview">{password}</code>

  <div class="row">
    <button type="button" onclick={regenerate}>Regenerate</button>
    <button type="button" onclick={copy} disabled={!password}>{copied ? 'Copied!' : 'Copy'}</button>
  </div>

  <label class="length">
    Length: {length}
    <input type="range" min="8" max="64" bind:value={length} />
  </label>

  <div class="checkboxes">
    <label><input type="checkbox" bind:checked={lowercase} /> a-z</label>
    <label><input type="checkbox" bind:checked={uppercase} /> A-Z</label>
    <label><input type="checkbox" bind:checked={digits} /> 0-9</label>
    <label><input type="checkbox" bind:checked={symbols} /> !@#$…</label>
    <label><input type="checkbox" bind:checked={excludeAmbiguous} /> Exclude ambiguous (I l 1 O 0)</label>
  </div>

  <div class="row">
    <button type="button" onclick={use} disabled={!password}>Use this password</button>
    <button type="button" onclick={onclose}>Cancel</button>
  </div>
</div>

<style>
  .panel {
    border: 1px solid #333;
    border-radius: 6px;
    padding: 1rem;
    margin: 0.5rem 0 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 360px;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .preview {
    display: block;
    font-size: 1rem;
    letter-spacing: 0.03em;
    padding: 0.75rem;
    background: #14171b;
    border: 1px solid #333;
    border-radius: 6px;
    word-break: break-all;
    text-align: center;
    min-height: 1.2em;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .length {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }
  .checkboxes {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
  }
  .checkboxes label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  button {
    padding: 0.5rem;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .error {
    background: #3a1d1d;
    color: #ffb4b4;
    border: 1px solid #6b2c2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
</style>
