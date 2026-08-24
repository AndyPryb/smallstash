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
  <label>
    Email
    <input type="email" bind:value={email} autocomplete="username" required />
  </label>

  <label>
    Login password
    <PasswordField bind:value={loginPassword} autocomplete="current-password" required />
    <small>Your account sign-in password.</small>
  </label>

  <hr />

  <label>
    Master Password
    <PasswordField bind:value={masterPassword} autocomplete="off" required />
    <small>Unlocks your vault. Never sent to the server - kept separate from your login password on purpose.</small>
  </label>

  <button type="submit" disabled={loading}>{loading ? 'Unlocking…' : 'Unlock vault'}</button>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }
  input {
    padding: 0.5rem;
    font-size: 1rem;
  }
  small {
    color: #888;
  }
  button {
    padding: 0.6rem;
    font-size: 1rem;
    cursor: pointer;
  }
</style>
