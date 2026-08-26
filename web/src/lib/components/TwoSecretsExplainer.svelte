<script>
  /**
   * Explains the two-independent-secrets model (architecture.md §5) in plain
   * language, for someone who has never heard the words "encryption key".
   *
   * This is the app's single least obvious idea. Every other password manager
   * a user has met asks for one password; this one asks for two on the same
   * screen, and nothing on that screen previously said why. The old hints
   * ("Your account sign-in password." / "Unlocks your vault. Never sent to
   * the server") describe *what* each field is without ever explaining the
   * reason there are two, or the consequence that matters most - that a
   * forgotten Master Password cannot be reset by anyone.
   *
   * Progressive disclosure, following how 1Password and Bitwarden handle
   * their equivalent (account password + Secret Key): collapsed by default on
   * the sign-in screen, where a returning user has already internalised it
   * and a wall of explanation would be noise; open by default at signup,
   * where it's the user's first encounter and the decision they're about to
   * make is irreversible.
   *
   * Native <details>/<summary>, so it works with no JavaScript, is keyboard
   * and screen-reader accessible for free, and needs no inline styles - the
   * deployed CSP forbids those (see app.css).
   */

  /** @type {{ open?: boolean }} */
  let { open = false } = $props();
</script>

<details class="explainer" {open}>
  <summary>
    <svg class="summary-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" />
      <path d="M7.75 7.5 A2.25 2.25 0 1 1 10 10.25 L10 11.75" />
      <path class="dot" d="M10 14.5 L10 14.75" />
    </svg>
    Why does Small Stash ask for two passwords?
  </summary>

  <div class="explainer-body">
    <p>
      They do two completely different jobs, and keeping them separate is what makes your vault private even from the
      people who run Small Stash.
    </p>

    <dl class="roles">
      <div class="role">
        <dt>Your login password</dt>
        <dd>
          Proves the account is yours. Small Stash checks this one on its server, exactly like signing in to any other
          website. If you forget it, you can reset it by email.
        </dd>
      </div>

      <div class="role">
        <dt>Your Master Password</dt>
        <dd>
          Unlocks the passwords you've saved. This one <strong>never leaves your device</strong> - your browser uses it
          to scramble and unscramble your vault right here, and only ever sends the scrambled result.
        </dd>
      </div>
    </dl>

    <p>
      Because of that split, nobody running Small Stash - and nobody at Amazon, where the scrambled vault is stored -
      can read what's inside it. There is no copy of your Master Password anywhere to read it with. Someone who steals
      your login password gets an account with a vault they still can't open.
    </p>

    <p class="tradeoff">
      <strong>The trade-off:</strong> if you forget your Master Password, nobody can reset it for you - not even us, because
      there is nothing on our side to reset it from. That's what your Recovery Key is for, so keep it somewhere safe.
    </p>
  </div>
</details>

<style>
  .explainer {
    background: var(--ss-surface-raised);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
  }

  .explainer[open] {
    border-color: var(--ss-border-strong);
  }

  summary {
    display: flex;
    align-items: center;
    gap: var(--ss-space-2);
    /* Comfortably past the 44px touch target - this is a control a user is
       expected to reach for on a phone. */
    padding: var(--ss-space-3) var(--ss-space-4);
    color: var(--ss-text);
    font-size: var(--ss-text-sm);
    font-weight: 500;
    cursor: pointer;
    /* Removes the native disclosure triangle in every engine (WebKit needs
       the -webkit- pseudo-element specifically) - the icon below replaces
       it, and the triangle sat too far from the text to read as related. */
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    color: var(--ss-accent);
  }

  .summary-icon {
    width: 1.125rem;
    height: 1.125rem;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .summary-icon .dot {
    stroke-width: 2.25;
  }

  .explainer-body {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-3);
    padding: 0 var(--ss-space-4) var(--ss-space-4);
    color: var(--ss-text-muted);
    font-size: var(--ss-text-sm);
    line-height: 1.6;
  }

  .roles {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    margin: 0;
  }

  /* Each secret as its own small card, so the two are visibly parallel -
     the whole point is that they're a matched pair doing different jobs,
     which a run of prose doesn't convey. */
  .role {
    padding: var(--ss-space-3);
    background: var(--ss-surface-sunken);
    border-left: 3px solid var(--ss-accent-quiet);
    border-radius: var(--ss-radius-sm);
  }

  dt {
    color: var(--ss-text);
    font-weight: 600;
  }

  dd {
    margin: var(--ss-space-1) 0 0;
  }

  /* The one paragraph a user must not skim past - this is the irreversible
     consequence, so it gets the warning treatment rather than blending into
     the explanation above it. */
  .tradeoff {
    padding: var(--ss-space-3);
    background: var(--ss-warn-surface);
    border: 1px solid var(--ss-warn-border);
    border-radius: var(--ss-radius-sm);
    color: var(--ss-warn-text);
  }

  .tradeoff strong {
    color: var(--ss-warn-text);
  }
</style>
