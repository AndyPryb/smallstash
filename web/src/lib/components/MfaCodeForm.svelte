<script>
  /**
   * Shown mid-login when Cognito demands an MFA code (session.js's
   * MfaRequiredError/completeMfaLogin) - the login password and Master
   * Password have already been supplied and are held by session.js's
   * pending-MFA state, not re-collected here.
   */

  /** @type {{ onverify: (code: string) => void, oncancel: () => void, loading: boolean }} */
  let { onverify, oncancel, loading } = $props();

  let code = $state('');

  function submit(event) {
    event.preventDefault();
    onverify(code);
  }
</script>

<form onsubmit={submit}>
  <p>Enter the code from your authenticator app.</p>
  <label>
    MFA code
    <input inputmode="numeric" autocomplete="one-time-code" bind:value={code} required />
  </label>
  <div class="actions">
    <button type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify'}</button>
    <button type="button" onclick={oncancel} disabled={loading}>Cancel</button>
  </div>
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
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  button {
    padding: 0.6rem;
    font-size: 1rem;
    cursor: pointer;
  }
</style>
