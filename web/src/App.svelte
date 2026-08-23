<script>
  import { onMount } from 'svelte';
  import LoginForm from './lib/components/LoginForm.svelte';
  import SignupForm from './lib/components/SignupForm.svelte';
  import OfflineUnlockForm from './lib/components/OfflineUnlockForm.svelte';
  import VaultView from './lib/components/VaultView.svelte';
  import { signInAndUnlock, unlockOffline, getLastAccount, clearSession } from './lib/session.js';

  /** @type {'login' | 'signup'} */
  let authMode = $state('login');

  /** @type {object | null} */
  let vaultDocument = $state(null);
  let error = $state('');
  let loading = $state(false);

  // navigator.onLine reflects the OS/browser's own view of connectivity -
  // reliable for "definitely offline" (e.g. airplane mode), less reliable
  // for "connected to wifi with no real internet" (captive portals etc.),
  // which is what forceOffline (set from a failed login attempt below)
  // covers instead.
  let online = $state(navigator.onLine);
  let forceOffline = $state(false);

  let lastAccount = $state(getLastAccount());
  let showOffline = $derived((!online || forceOffline) && lastAccount !== null);

  onMount(() => {
    const goOnline = () => {
      online = true;
    };
    const goOffline = () => {
      online = false;
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  });

  /** @param {unknown} err */
  function looksLikeNetworkFailure(err) {
    // fetch() rejects with a TypeError (message varies by browser, e.g.
    // "Failed to fetch" / "NetworkError when attempting to fetch resource")
    // when it can't reach the network at all - as opposed to a real HTTP
    // error response, which resolves normally and is handled elsewhere
    // (ApiError, wrong-password errors, etc.).
    return err instanceof TypeError || !navigator.onLine;
  }

  /** @param {{ email: string, loginPassword: string, masterPassword: string }} detail */
  async function handleLogin(detail) {
    error = '';
    loading = true;
    try {
      vaultDocument = await signInAndUnlock(detail.email, detail.loginPassword, detail.masterPassword);
      lastAccount = getLastAccount();
    } catch (err) {
      error = err.message ?? String(err);
      if (looksLikeNetworkFailure(err) && getLastAccount()) {
        lastAccount = getLastAccount();
        forceOffline = true;
      }
    } finally {
      loading = false;
    }
  }

  /** @param {{ masterPassword: string }} detail */
  async function handleOfflineUnlock(detail) {
    error = '';
    loading = true;
    try {
      vaultDocument = await unlockOffline(lastAccount.sub, detail.masterPassword);
    } catch (err) {
      error = err.message ?? String(err);
    } finally {
      loading = false;
    }
  }

  /** @param {{ vaultDocument: object }} detail */
  function handleSignupComplete(detail) {
    error = '';
    vaultDocument = detail.vaultDocument;
    lastAccount = getLastAccount();
    authMode = 'login';
  }

  function handleSignOut() {
    clearSession();
    vaultDocument = null;
  }
</script>

<main>
  <header>
    <h1>smallStash</h1>
  </header>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if vaultDocument}
    <VaultView bind:vaultDocument onsignout={handleSignOut} />
  {:else if showOffline}
    <OfflineUnlockForm
      email={lastAccount.email}
      onunlock={handleOfflineUnlock}
      ononline={() => (forceOffline = false)}
      {loading}
    />
  {:else if !online}
    <p class="error" role="alert">
      You're offline, and this device has never signed in to smallStash before - connect to the internet to sign in
      for the first time.
    </p>
  {:else if authMode === 'signup'}
    <SignupForm oncomplete={handleSignupComplete} oncancel={() => (authMode = 'login')} />
  {:else}
    <LoginForm onlogin={handleLogin} {loading} />
    <p class="switch-mode">
      No account yet? <button type="button" onclick={() => (authMode = 'signup')}>Create one</button>
    </p>
  {/if}
</main>

<style>
  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 1.5rem;
    font-family: system-ui, sans-serif;
  }
  header h1 {
    font-size: 1.25rem;
    margin-bottom: 1rem;
  }
  .error {
    background: #3a1d1d;
    color: #ffb4b4;
    border: 1px solid #6b2c2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
  }
  .switch-mode {
    margin-top: 1rem;
    font-size: 0.9rem;
  }
  .switch-mode button {
    background: none;
    border: none;
    color: #5ac8a8;
    cursor: pointer;
    padding: 0;
    font-size: inherit;
    text-decoration: underline;
  }
</style>
