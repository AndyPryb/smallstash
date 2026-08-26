<script>
  import { generatePassword } from '../generator.js';
  import Alert from './Alert.svelte';

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
    <Alert variant="error" ondismiss={() => (error = '')}>{error}</Alert>
  {/if}

  <code class="preview">{password}</code>

  <div class="row">
    <button type="button" class="compact" onclick={regenerate}>Regenerate</button>
    <button type="button" class="compact" onclick={copy} disabled={!password}>{copied ? 'Copied!' : 'Copy'}</button>
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
    <label class="wide"><input type="checkbox" bind:checked={excludeAmbiguous} /> Exclude ambiguous (I l 1 O 0)</label>
  </div>

  <div class="row">
    <button type="button" class="primary compact" onclick={use} disabled={!password}>Use this password</button>
    <button type="button" class="compact" onclick={onclose}>Cancel</button>
  </div>
</div>

<style>
  /* Button and `.error` styling is shared - see src/app.css. */
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
    /* Accent-tinted left edge marks this as a transient tool that opened
       inside the form, rather than another permanent section of it. */
    border: 1px solid var(--ss-border);
    border-left: 3px solid var(--ss-accent-quiet);
    border-radius: var(--ss-radius-md);
    padding: var(--ss-space-4);
    margin: var(--ss-space-1) 0;
    background: var(--ss-surface-raised);
  }

  h2 {
    font-size: var(--ss-text-base);
    color: var(--ss-text-muted);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  /**
   * The generated password is the whole point of this panel, so it's the
   * largest, brightest thing in it: accent-coloured monospace on the
   * sunken surface, sized to stay legible when it's 64 random characters
   * wrapped over three lines.
   */
  .preview {
    display: block;
    min-height: 3.25rem;
    padding: var(--ss-space-3);
    background: var(--ss-surface-sunken);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
    color: var(--ss-accent);
    font-size: var(--ss-text-lg);
    line-height: 1.5;
    letter-spacing: 0.04em;
    text-align: center;
    word-break: break-all;
    user-select: all;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
  }

  .length {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    font-size: var(--ss-text-sm);
    font-weight: 500;
    color: var(--ss-text-muted);
  }

  /* Two columns: the four character-class toggles are short and pair
     naturally, which halves the panel's height inside an already-long
     form. The ambiguous-characters toggle spans both. */
  .checkboxes {
    display: grid;
    /* max-content columns, not 1fr: "a-z" and "A-Z" are three characters
       each, and equal fractions stranded them at opposite ends of the
       panel with a chasm between the box and its own label. */
    grid-template-columns: repeat(2, minmax(0, max-content));
    justify-content: start;
    column-gap: var(--ss-space-5);
    row-gap: var(--ss-space-1);
    font-size: var(--ss-text-sm);
  }

  .checkboxes label {
    display: flex;
    align-items: center;
    gap: var(--ss-space-2);
    padding: var(--ss-space-2);
    border: 1px solid transparent;
    border-radius: var(--ss-radius-sm);
    cursor: pointer;
  }

  .checkboxes label:hover {
    background: var(--ss-surface-hover);
    border-color: var(--ss-border);
  }

  .checkboxes label.wide {
    grid-column: 1 / -1;
  }
</style>
