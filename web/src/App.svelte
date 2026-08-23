<script>
  import LoginForm from './lib/components/LoginForm.svelte';
  import SignupForm from './lib/components/SignupForm.svelte';
  import VaultView from './lib/components/VaultView.svelte';
  import { signInAndUnlock, clearSession } from './lib/session.js';

  /** @type {'login' | 'signup'} */
  let authMode = $state('login');

  /** @type {object | null} */
  let vaultDocument = $state(null);
  let error = $state('');
  let loading = $state(false);

  /** @param {{ email: string, loginPassword: string, masterPassword: string }} detail */
  async function handleLogin(detail) {
    error = '';
    loading = true;
    try {
      vaultDocument = await signInAndUnlock(detail.email, detail.loginPassword, detail.masterPassword);
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
