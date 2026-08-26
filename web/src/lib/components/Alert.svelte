<script>
  /**
   * One message box for the whole app: errors, notices and confirmations.
   *
   * Two things it fixes.
   *
   * 1. **Messages were undismissable.** An error stayed on screen until
   *    something else happened to clear it - a failed sign-in left "Incorrect
   *    email or password" sitting above the form with no way to acknowledge
   *    it, and the inactivity-lock notice had no way out at all. Every
   *    mainstream app lets you close a message you've read; this adds that.
   *
   * 2. **The three boxes were three near-identical copies**, so they drifted.
   *    Now the visual treatment comes from the shared `.error`/`.notice`/
   *    `.success` classes in app.css and the behaviour lives here.
   *
   * Dismissal is deliberately *parent-owned*: this component has no internal
   * "hidden" flag, it just calls `ondismiss`, and the parent clears the state
   * that was rendering it. If it hid itself instead, the next error with the
   * same text would be swallowed - the component would still be hidden while
   * the parent thought it had shown something.
   *
   * A message with no `ondismiss` renders without a close button. That's the
   * right default for a message describing an ongoing condition rather than
   * an event: "You're offline" isn't something a user can acknowledge away,
   * because closing it wouldn't make it stop being true.
   */

  /**
   * @type {{
   *   variant?: 'error' | 'notice' | 'success',
   *   ondismiss?: () => void,
   *   children: import('svelte').Snippet,
   * }}
   */
  let { variant = 'error', ondismiss = undefined, children } = $props();

  // Errors interrupt (`alert` is assertive - a screen reader announces it
  // immediately, which is right for "that didn't work"); notices and
  // confirmations wait their turn (`status` is polite). Keeping `alert` on
  // errors specifically also matches what the Playwright specs look for.
  //
  // $derived, not a plain const: a bare `const role = variant === ...` reads
  // `variant` once at setup and never again, so an Alert whose variant
  // changed would keep its original ARIA role. Every current caller passes a
  // fixed variant, so it happens to work today - which is exactly the kind
  // of latent bug that surfaces later as "the screen reader says the wrong
  // thing". Svelte flags it (`state_referenced_locally`).
  let role = $derived(variant === 'error' ? 'alert' : 'status');
</script>

<div class={variant} {role}>
  <!-- Icon carries no information the text doesn't - it's a scanning aid, so
       it's aria-hidden and the shape is redundant with the colour (which
       matters for the ~8% of men with red/green colour vision deficiency,
       who can't tell the red box from the green one by hue alone). -->
  <svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="8.5" />
    {#if variant === 'success'}
      <path class="mark" d="M6 10.5 L9 13.5 L14.5 7" />
    {:else if variant === 'notice'}
      <path class="mark" d="M10 9 L10 14.5" />
      <path class="mark dot" d="M10 5.75 L10 6" />
    {:else}
      <path class="mark" d="M10 5.5 L10 11" />
      <path class="mark dot" d="M10 14 L10 14.25" />
    {/if}
  </svg>

  <div class="body">{@render children()}</div>

  {#if ondismiss}
    <!-- An SVG rather than a "✕" text glyph so the close control adds
         nothing to the alert's textContent. e2e/change-login-password.spec.js
         reads that text and asserts on what it does and doesn't contain;
         a stray glyph in there is noise at best. -->
    <button type="button" class="dismiss" onclick={ondismiss} aria-label="Dismiss this message">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4 L12 12 M12 4 L4 12" />
      </svg>
    </button>
  {/if}
</div>

<style>
  /* The `.error`/`.notice`/`.success` colours, border and padding come from
     app.css - this component only lays out the three slots inside them. */
  .icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    /* Optical centring against the first line of text rather than the box:
       the cap height of the text sits slightly below the line box's top. */
    margin-top: 0.0625rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }

  .mark {
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .dot {
    stroke-width: 2.25;
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  /* Low-contrast until hovered. A close button that shouts competes with the
     message it's attached to, which is the thing actually worth reading. */
  .dismiss {
    flex-shrink: 0;
    align-self: flex-start;
    width: 1.75rem;
    min-height: 1.75rem;
    padding: 0;
    background: transparent;
    border-color: transparent;
    color: currentColor;
    opacity: 0.65;
  }

  .dismiss svg {
    width: 0.75rem;
    height: 0.75rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .dismiss:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: transparent;
    color: currentColor;
    opacity: 1;
  }

  .dismiss:focus-visible {
    outline-color: currentColor;
    opacity: 1;
  }
</style>
