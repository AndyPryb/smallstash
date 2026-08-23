<script>
  /**
   * Self-service signup, three steps:
   *   1. register  - Cognito SignUp (login password only)
   *   2. confirm   - emailed verification code -> ConfirmSignUp
   *   3. recovery  - sign in + mint vault key material, show the Recovery
   *                  Key exactly once (never stored anywhere)
   *
   * email/loginPassword/masterPassword only ever live in this component's
   * own state between steps - never written to any store, cache, or the
   * server, beyond what each step's own API call needs.
   */
  import {
    registerAccount,
    confirmAccount,
    signUpAndInitializeVault,
  } from '../session.js';
  import { validateMasterPassword, MIN_MASTER_PASSWORD_LENGTH } from '../policy.js';

  /** @type {{ oncomplete: (detail: { vaultDocument: object }) => void, oncancel: () => void }} */
  let { oncomplete, oncancel } = $props();

  /** @type {'register' | 'confirm' | 'recovery'} */
  let step = $state('register');
  let busy = $state(false);
  let error = $state('');

  let email = $state('');
  let loginPassword = $state('');
  let confirmLoginPassword = $state('');
  let masterPassword = $state('');
  let confirmMasterPassword = $state('');
  let code = $state('');
  let recoveryKey = $state('');
  let recoveryKeySaved = $state(false);

  // Client-side pre-check only, mirroring the Cognito pool's actual policy
  // (infra/.../SmallstashStack.java: minLength 12 + upper/lower/digit/symbol)
  // - Cognito's own rejection is still the real enforcement; this just gives
  // faster feedback than a round trip.
  const LOGIN_PASSWORD_PATTERN =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

  async function submitRegister(event) {
    event.preventDefault();
    error = '';

    if (loginPassword !== confirmLoginPassword) {
      error = 'Login passwords do not match';
      return;
    }
    if (!LOGIN_PASSWORD_PATTERN.test(loginPassword)) {
      error = 'Login password needs 12+ characters with upper, lower, a digit, and a symbol';
      return;
    }
    if (masterPassword !== confirmMasterPassword) {
      error = 'Master Passwords do not match';
      return;
    }
    const masterPasswordError = validateMasterPassword(masterPassword);
    if (masterPasswordError) {
      error = masterPasswordError;
      return;
    }
    if (masterPassword === loginPassword) {
      error = 'Use a different Master Password than your login password - they are two independent secrets';
      return;
    }

    busy = true;
    try {
      await registerAccount(email, loginPassword);
      step = 'confirm';
    } catch (err) {
      error = err.message ?? String(err);
    } finally {
      busy = false;
    }
  }

  async function submitConfirm(event) {
    event.preventDefault();
    error = '';
    busy = true;
    try {
      await confirmAccount(email, code);
      const result = await signUpAndInitializeVault(email, loginPassword, masterPassword);
      recoveryKey = result.recoveryKey;
      step = 'recovery';
      // Only needed to reach this point - drop from memory once we're done
      // authenticating with them.
      loginPassword = confirmLoginPassword = masterPassword = confirmMasterPassword = '';
    } catch (err) {
      error = err.message ?? String(err);
    } finally {
      busy = false;
    }
  }

  function finish() {
    oncomplete({ vaultDocument: { entries: [] } });
  }
</script>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

{#if step === 'register'}
  <form onsubmit={submitRegister}>
    <label>
      Email
      <input type="email" bind:value={email} autocomplete="username" required />
    </label>

    <label>
      Login password
      <input type="password" bind:value={loginPassword} autocomplete="new-password" required />
      <small>12+ characters, upper + lower case, a digit, and a symbol.</small>
    </label>
    <label>
      Confirm login password
      <input type="password" bind:value={confirmLoginPassword} autocomplete="new-password" required />
    </label>

    <hr />

    <label>
      Master Password
      <input type="password" bind:value={masterPassword} autocomplete="off" required />
      <small>Encrypts your vault. Never sent to the server - keep it different from your login password, and don't lose it (that's what the Recovery Key on the next screen is for). At least {MIN_MASTER_PASSWORD_LENGTH} characters.</small>
    </label>
    <label>
      Confirm Master Password
      <input type="password" bind:value={confirmMasterPassword} autocomplete="off" required />
    </label>

    <div class="actions">
      <button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      <button type="button" onclick={oncancel} disabled={busy}>Back to sign in</button>
    </div>
  </form>
{:else if step === 'confirm'}
  <form onsubmit={submitConfirm}>
    <p>We emailed a verification code to <strong>{email}</strong>.</p>
    <label>
      Verification code
      <input inputmode="numeric" bind:value={code} required />
    </label>
    <div class="actions">
      <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
    </div>
  </form>
{:else if step === 'recovery'}
  <div class="recovery">
    <p><strong>Save this Recovery Key now.</strong> It's the only way back into your vault if you forget your Master Password - it is shown here once and never stored anywhere, by you or by smallStash.</p>
    <code class="recovery-key">{recoveryKey}</code>
    <label class="confirm-saved">
      <input type="checkbox" bind:checked={recoveryKeySaved} />
      I've saved this Recovery Key somewhere safe
    </label>
    <div class="actions">
      <button type="button" onclick={finish} disabled={!recoveryKeySaved}>Continue to vault</button>
    </div>
  </div>
{/if}

<style>
  form,
  .recovery {
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
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  button {
    padding: 0.6rem;
    font-size: 1rem;
    cursor: pointer;
  }
  .error {
    background: #3a1d1d;
    color: #ffb4b4;
    border: 1px solid #6b2c2c;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
  .recovery-key {
    display: block;
    font-size: 1.1rem;
    letter-spacing: 0.05em;
    padding: 1rem;
    background: #14171b;
    border: 1px solid #333;
    border-radius: 6px;
    word-break: break-all;
    text-align: center;
  }
  .confirm-saved {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
</style>
