<script>
  /**
   * Shown when the app is offline (or a login attempt just failed to reach
   * the network) and this device has a cached account to unlock from - see
   * docs/todo.md "PWA: offline access to key material" and
   * session.js's getLastAccount()/unlockOffline().
   *
   * Only asks for the Master Password - email/sub are already known from
   * the last successful online sign-in on this device (session.js's
   * getLastAccount()), so there's nothing else to ask for offline.
   */
  import PasswordField from './PasswordField.svelte';

  /** @type {{ email: string, onunlock: (detail: { masterPassword: string }) => void, ononline: () => void, loading: boolean }} */
  let { email, onunlock, ononline, loading } = $props();

  let masterPassword = $state('');

  function submit(event) {
    event.preventDefault();
    onunlock({ masterPassword });
  }
</script>

<div class="offline-banner">You're offline - unlocking from the last vault cached on this device.</div>

<form onsubmit={submit}>
  <p>Signed in as <strong>{email}</strong></p>

  <label>
    Master Password
    <PasswordField bind:value={masterPassword} autocomplete="off" required />
  </label>

  <div class="actions">
    <button type="submit" disabled={loading}>{loading ? 'Unlocking…' : 'Unlock vault'}</button>
    <button type="button" onclick={ononline}>Try signing in online instead</button>
  </div>

  <small>Changes made offline can be viewed and edited, but won't sync until you're back online and sign in again.</small>
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
  small {
    color: #888;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  button {
    padding: 0.6rem;
    font-size: 1rem;
    cursor: pointer;
  }
  .offline-banner {
    background: #3a2f0f;
    color: #f0d68a;
    border: 1px solid #6b5a2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }
</style>
