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
  import Alert from './Alert.svelte';

  /** @type {{ email: string, onunlock: (detail: { masterPassword: string }) => void, ononline: () => void, loading: boolean }} */
  let { email, onunlock, ononline, loading } = $props();

  // See LoginForm for why fields use explicit for/id + aria-describedby.
  const uid = $props.id();

  let masterPassword = $state('');

  function submit(event) {
    event.preventDefault();
    onunlock({ masterPassword });
  }
</script>

<!-- Not dismissible: this describes why the screen looks different, and
     closing it wouldn't make the device any less offline. -->
<div class="offline-banner">
  <Alert variant="notice">You're offline - unlocking from the last vault cached on this device.</Alert>
</div>

<form onsubmit={submit}>
  <p class="account">Signed in as <strong>{email}</strong></p>

  <div class="field">
    <label for="{uid}-master-password">Master Password</label>
    <PasswordField
      id="{uid}-master-password"
      describedby="{uid}-master-password-hint"
      bind:value={masterPassword} fieldName="Master Password"
      autocomplete="off"
      required
    />
    <!-- Only one of the two secrets is needed here, which looks like an
         inconsistency unless it's explained: the login password proves
         identity to a server this device currently can't reach, while the
         Master Password decrypts a local copy and needs nobody's help. -->
    <small id="{uid}-master-password-hint">
      Your login password isn't needed offline - only the Master Password can unlock the cached copy.
    </small>
  </div>

  <div class="actions">
    <button type="submit" class="primary" disabled={loading}>{loading ? 'Unlocking…' : 'Unlock vault'}</button>
    <button type="button" onclick={ononline}>Try signing in online instead</button>
  </div>

  <small class="hint">Changes made offline can be viewed and edited, but won't sync until you're back online and sign in again.</small>
</form>

<style>
  /* The banner reuses the shared `.notice` treatment from src/app.css
     rather than carrying its own near-identical copy of the amber box -
     one status colour, defined once. */
  .offline-banner {
    margin-bottom: var(--ss-space-4);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
  }

  /* Identity chip: this screen's whole job is "unlock as *this* account",
     so the email is a distinct object rather than a line of prose. */
  .account {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
    padding: var(--ss-space-3) var(--ss-space-4);
    background: var(--ss-surface-raised);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
    color: var(--ss-text-muted);
    font-size: var(--ss-text-sm);
  }

  .account strong {
    color: var(--ss-text);
    font-weight: 600;
    word-break: break-all;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
  }

  .actions button.primary {
    flex: 1;
    min-width: 10rem;
  }
</style>
