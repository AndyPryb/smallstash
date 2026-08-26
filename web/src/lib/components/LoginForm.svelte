<script>
  /**
   * Two password fields are deliberately kept visually distinct here, not
   * just semantically - it's the single easiest place for a user to
   * accidentally conflate their two independent secrets
   * (docs/architecture.md §5).
   */
  import PasswordField from './PasswordField.svelte';

  /** @type {{ onlogin: (detail: { email: string, loginPassword: string, masterPassword: string }) => void, loading: boolean }} */
  let { onlogin, loading } = $props();

  let email = $state('');
  let loginPassword = $state('');
  let masterPassword = $state('');

  function submit(event) {
    event.preventDefault();
    onlogin({ email, loginPassword, masterPassword });
  }
</script>

<form onsubmit={submit}>
  <label class="field">
    Email
    <input type="email" bind:value={email} autocomplete="username" required />
  </label>

  <label class="field">
    Login password
    <PasswordField bind:value={loginPassword} autocomplete="current-password" required />
    <small>Your account sign-in password.</small>
  </label>

  <hr />

  <label class="field">
    Master Password
    <PasswordField bind:value={masterPassword} autocomplete="off" required />
    <small>Unlocks your vault. Never sent to the server - kept separate from your login password on purpose.</small>
  </label>

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
