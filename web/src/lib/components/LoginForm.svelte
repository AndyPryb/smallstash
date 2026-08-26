<script>
  /**
   * Two password fields are deliberately kept visually distinct here, not
   * just semantically - it's the single easiest place for a user to
   * accidentally conflate their two independent secrets
   * (docs/architecture.md §5).
   */
  import PasswordField from './PasswordField.svelte';
  import TwoSecretsExplainer from './TwoSecretsExplainer.svelte';

  /** @type {{ onlogin: (detail: { email: string, loginPassword: string, masterPassword: string }) => void, loading: boolean }} */
  let { onlogin, loading } = $props();

  // Unique per component instance, so ids can't collide with another form's
  // if two are ever mounted at once.
  const uid = $props.id();

  let email = $state('');
  let loginPassword = $state('');
  let masterPassword = $state('');

  function submit(event) {
    event.preventDefault();
    onlogin({ email, loginPassword, masterPassword });
  }
</script>

<form onsubmit={submit}>
  <!-- Explicit `for`/`id` rather than a wrapping <label>. A wrapping label
       makes its whole subtree the input's accessible name, which swept in
       the "Show" toggle and every word of hint text below - so a screen
       reader announced the field as "Login password Show Proves the account
       is yours…". Hints are attached with aria-describedby instead, which
       is announced *after* the name, as supplementary detail. -->
  <div class="field">
    <label for="{uid}-email">Email</label>
    <input id="{uid}-email" type="email" bind:value={email} autocomplete="username" required />
  </div>

  <div class="field">
    <label for="{uid}-login-password">Login password</label>
    <PasswordField
      id="{uid}-login-password"
      describedby="{uid}-login-password-hint"
      bind:value={loginPassword} fieldName="login password"
      autocomplete="current-password"
      required
    />
    <small id="{uid}-login-password-hint">Proves the account is yours - the one you'd reset by email if you forgot it.</small>
  </div>

  <hr />

  <div class="field">
    <label for="{uid}-master-password">Master Password</label>
    <PasswordField
      id="{uid}-master-password"
      describedby="{uid}-master-password-hint"
      bind:value={masterPassword} fieldName="Master Password"
      autocomplete="off"
      required
    />
    <small id="{uid}-master-password-hint">
      Unlocks your saved passwords. Never leaves this device - not even Small Stash can read it.
    </small>
  </div>

  <!-- Collapsed by default and placed at the point of confusion rather than
       at the top of the form: a returning user has already understood this
       and doesn't need it re-explained on every sign-in, but someone
       stalling on "wait, which password goes here?" is looking at exactly
       this spot when the question occurs to them. Outside the <label> on
       purpose - inside, its text would be pulled into the field's
       accessible name. -->
  <TwoSecretsExplainer />

  <button type="submit" class="primary" disabled={loading}>{loading ? 'Unlocking…' : 'Unlock vault'}</button>
</form>

<style>
  /* Control, label, hint and hr styling all come from src/app.css now
     (`.field`, the element-level input/button rules, the hr reset that
     three components used to carry their own copy of). What's left here is
     this form's own layout. */
  form {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
  }

  /* The submit button is the one primary action on the sign-in screen, and
     the only full-width control - width is what marks it as the end of the
     form, not just its colour. */
  form button {
    width: 100%;
    margin-top: var(--ss-space-1);
  }
</style>
