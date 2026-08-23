<script>
  import LoginForm from './lib/components/LoginForm.svelte';
  import VaultView from './lib/components/VaultView.svelte';
  import { signInAndUnlock, clearSession } from './lib/session.js';

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
  {:else}
    <LoginForm onlogin={handleLogin} {loading} />
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
</style>
