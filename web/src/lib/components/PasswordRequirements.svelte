<script>
  /**
   * Live checklist of password requirements, ticking off as the user types.
   *
   * Replaces the "type a password, submit, get told it was wrong, guess
   * which part" loop. The old flow surfaced the policy only *after* a failed
   * submit, as one combined sentence ("12+ characters with upper, lower, a
   * digit, and a symbol"), leaving the user to diff that against what they'd
   * typed. Showing the rules up front and resolving them individually is the
   * standard treatment (Google, Apple, 1Password, GitHub all do it).
   *
   * Purely informational - this component never blocks anything. Whether a
   * form refuses to submit is the form's decision, and deliberately differs:
   * SignupForm pre-checks, ChangeLoginPasswordForm does not (it lets Cognito
   * answer, so that its compromised-credential check can also weigh in - see
   * e2e/change-login-password.spec.js, which depends on that).
   *
   * Rules come from lib/policy.js so the checklist and the submit-time
   * validation can't drift apart.
   */

  /**
   * @type {{
   *   value: string,
   *   rules: ReadonlyArray<{ label: string, test: (password: string) => boolean }>,
   *   label?: string,
   * }}
   */
  let { value = '', rules, label = 'Must include:' } = $props();

  let results = $derived(rules.map((rule) => ({ label: rule.label, met: rule.test(value) })));
  let metCount = $derived(results.filter((r) => r.met).length);
  let allMet = $derived(metCount === results.length);
  // Untouched field: show the rules as neutral guidance rather than as a
  // list of failures. Nobody has got anything wrong yet.
  let pristine = $derived(value.length === 0);
</script>

<div class="requirements" class:pristine class:complete={allMet}>
  <p class="requirements-label">
    {label}
    <!-- The running count earns its place against the login password's five
         rules; against the Master Password's single rule it's just "0/1"
         restating what the one row below already says. Progress is announced
         politely rather than assertively - a live count that interrupted on
         every keystroke would be unusable with a screen reader. -->
    {#if results.length > 1}
      <span class="count" role="status" aria-live="polite">{metCount}/{results.length}</span>
    {/if}
  </p>
  <ul>
    {#each results as rule (rule.label)}
      <li class:met={rule.met}>
        <svg class="tick" viewBox="0 0 16 16" aria-hidden="true">
          {#if rule.met}
            <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" />
          {:else}
            <circle cx="8" cy="8" r="2.25" />
          {/if}
        </svg>
        <!-- The visual state is carried by colour + icon, which a screen
             reader can't see - so each row spells its state out in text. -->
        <span>{rule.label}</span>
        <span class="sr-only">{rule.met ? '- met' : '- not met yet'}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .requirements {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    padding: var(--ss-space-3);
    background: var(--ss-surface-sunken);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-sm);
    font-size: var(--ss-text-xs);
    font-weight: 400;
    letter-spacing: 0;
    transition: border-color 150ms ease;
  }

  /* Once every rule passes the panel has done its job - fade it back rather
     than leaving a bright green block competing with the fields below. */
  .requirements.complete {
    border-color: var(--ss-success-border);
  }

  .requirements-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ss-space-2);
    color: var(--ss-text-muted);
    font-weight: 500;
  }

  .count {
    font-variant-numeric: tabular-nums;
    color: var(--ss-text-faint);
  }

  .requirements.complete .count {
    color: var(--ss-success-text);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--ss-space-2);
    color: var(--ss-text-faint);
    line-height: 1.5;
    transition: color 150ms ease;
  }

  li.met {
    color: var(--ss-success-text);
  }

  /* Before the user types anything these are instructions, not verdicts -
     so an unmet rule shouldn't look like a failure yet. */
  .requirements.pristine li {
    color: var(--ss-text-muted);
  }

  .tick {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Visually hidden but read aloud - the standard clip-rect pattern rather
     than display:none, which would remove it from the accessibility tree
     along with the visual layout. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
