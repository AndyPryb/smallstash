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
  import {
    validateMasterPassword,
    validateLoginPassword,
    LOGIN_PASSWORD_RULES,
    MASTER_PASSWORD_RULES,
  } from '../policy.js';
  import { friendlyAuthErrorMessage } from '../errors.js';
  import PasswordField from './PasswordField.svelte';
  import PasswordRequirements from './PasswordRequirements.svelte';
  import TwoSecretsExplainer from './TwoSecretsExplainer.svelte';
  import Alert from './Alert.svelte';

  /** @type {{ oncomplete: (detail: { vaultDocument: object }) => void, oncancel: () => void }} */
  let { oncomplete, oncancel } = $props();

  // See LoginForm for why fields use explicit for/id + aria-describedby
  // instead of a wrapping <label>.
  const uid = $props.id();

  /** @type {'register' | 'confirm' | 'recovery'} */
  let step = $state('register');
  let busy = $state(false);
  let error = $state('');

  let email = $state('');
  let inviteCode = $state('');
  let loginPassword = $state('');
  let confirmLoginPassword = $state('');
  let masterPassword = $state('');
  let confirmMasterPassword = $state('');
  let code = $state('');
  let recoveryKey = $state('');
  let recoveryKeySaved = $state(false);
  let recoveryKeyCopied = $state(false);

  async function copyRecoveryKey() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      recoveryKeyCopied = true;
      setTimeout(() => (recoveryKeyCopied = false), 2000);
    } catch {
      // Clipboard access denied/unavailable - the key is still fully
      // readable and selectable on screen, nothing else to do here.
    }
  }

  // The client-side pre-check moved to policy.js's validateLoginPassword,
  // which is built from the same LOGIN_PASSWORD_RULES the live checklist
  // renders - so the rules a user sees ticking off and the rules that reject
  // the form can't drift apart. Same policy, same message as the inline
  // regex this replaced; Cognito's own rejection is still the real
  // enforcement.

  async function submitRegister(event) {
    event.preventDefault();
    error = '';

    if (loginPassword !== confirmLoginPassword) {
      error = 'Login passwords do not match';
      return;
    }
    const loginPasswordError = validateLoginPassword(loginPassword);
    if (loginPasswordError) {
      error = loginPasswordError;
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
      await registerAccount(email, loginPassword, inviteCode.trim());
      step = 'confirm';
    } catch (err) {
      // The pattern check above catches most weak passwords before this
      // point, but not a policy-compliant one Cognito's compromised
      // -credential check (Plus tier) rejects anyway - same
      // InvalidPasswordException, same friendlier substitution.
      error = friendlyAuthErrorMessage(err);
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
  <Alert variant="error" ondismiss={() => (error = '')}>{error}</Alert>
{/if}

{#if step === 'register'}
  <form onsubmit={submitRegister}>
    <!-- Open by default here, unlike the sign-in screen. This is the user's
         first encounter with the two-secret model, and the choice they're
         about to make (a Master Password nobody can reset) is irreversible -
         so the explanation is shown rather than offered. -->
    <TwoSecretsExplainer open />

    <div class="field">
      <label for="{uid}-invite">Invite code</label>
      <input
        id="{uid}-invite"
        aria-describedby="{uid}-invite-hint"
        bind:value={inviteCode}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        required
      />
      <small id="{uid}-invite-hint">Small Stash is invite-only. Ask whoever runs this instance for a code.</small>
    </div>

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
        autocomplete="new-password"
        required
      />
      <small id="{uid}-login-password-hint">This is the one you'll type to sign in, and the one you can reset by email.</small>
    </div>
    <PasswordRequirements value={loginPassword} rules={LOGIN_PASSWORD_RULES} />
    <div class="field">
      <label for="{uid}-confirm-login-password">Confirm login password</label>
      <PasswordField
        id="{uid}-confirm-login-password"
        bind:value={confirmLoginPassword} fieldName="login password confirmation"
        autocomplete="new-password"
        required
      />
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
        This is the key to your vault. It never leaves your device, so make it something you'll remember - and make it
        different from your login password, so that losing one doesn't lose both.
      </small>
    </div>
    <PasswordRequirements value={masterPassword} rules={MASTER_PASSWORD_RULES} />
    <div class="field">
      <label for="{uid}-confirm-master-password">Confirm Master Password</label>
      <PasswordField
        id="{uid}-confirm-master-password"
        bind:value={confirmMasterPassword} fieldName="Master Password confirmation"
        autocomplete="off"
        required
      />
    </div>

    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      <button type="button" onclick={oncancel} disabled={busy}>Back to sign in</button>
    </div>
  </form>
{:else if step === 'confirm'}
  <form onsubmit={submitConfirm}>
    <p class="lead">We emailed a verification code to <strong>{email}</strong>.</p>
    <div class="field">
      <label for="{uid}-code">Verification code</label>
      <input
        id="{uid}-code"
        aria-describedby="{uid}-code-hint"
        class="code-input"
        inputmode="numeric"
        autocomplete="one-time-code"
        bind:value={code}
        required
      />
      <!-- Known deliverability problem, not a guess: Cognito's default
           sender has poor reputation and these land in spam regularly (see
           docs/todo.md, "Cognito signup/verification emails land in spam").
           Until that's fixed with SES, saying so up front saves the user
           concluding the app is broken. -->
      <small id="{uid}-code-hint">If it hasn't arrived in a minute or two, check your spam folder - these emails often land there.</small>
    </div>
    <div class="actions">
      <button type="submit" class="primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
    </div>
  </form>
{:else if step === 'recovery'}
  <div class="recovery">
    <h2>Save your Recovery Key</h2>
    <p class="lead">
      This is your spare key. If you ever forget your Master Password, this is the <strong>only</strong> way back into
      your vault - there is no "reset my Master Password" email, because Small Stash has nothing on its side to reset
      it from.
    </p>

    <code class="recovery-key">{recoveryKey}</code>

    <div class="actions">
      <button type="button" onclick={copyRecoveryKey}>{recoveryKeyCopied ? 'Copied!' : 'Copy'}</button>
    </div>

    <!-- Concrete instructions, not just "keep it safe". Told to store
         something securely with no examples, people paste it into a note
         on the same device they'd lose. -->
    <div class="where-to-put-it">
      <p class="where-label">Good places to keep it:</p>
      <ul>
        <li>Printed on paper, somewhere you keep important documents</li>
        <li>In a different password manager, or written in a physical notebook</li>
        <li>Anywhere you'd still reach it if this device were lost or stolen</li>
      </ul>
      <p class="where-warning">
        It is shown here once and stored nowhere - not by Small Stash, not in this browser. Once you continue, it's gone
        from the screen for good.
      </p>
    </div>

    <label class="confirm-saved">
      <input type="checkbox" bind:checked={recoveryKeySaved} />
      I've saved this Recovery Key somewhere safe
    </label>
    <div class="actions">
      <button type="button" class="primary" onclick={finish} disabled={!recoveryKeySaved}>Continue to vault</button>
    </div>
  </div>
{/if}

<style>
  /* Field/label/hint/hr/button/`.error` styling is shared - see src/app.css.
     Only this component's layout and the Recovery Key treatment live here. */
  form,
  .recovery {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
  }

  h2 {
    font-size: var(--ss-text-lg);
  }

  /* Explanatory sentence above a step - muted so it reads as context rather
     than competing with the field labels for first attention. */
  .lead {
    color: var(--ss-text-muted);
    font-size: var(--ss-text-sm);
    line-height: 1.6;
  }

  .lead strong {
    color: var(--ss-text);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ss-space-2);
    margin-top: var(--ss-space-1);
  }

  /* The primary action takes the remaining width so it stays the obvious
     target, with any secondary ("Back to sign in") sized to its own text. */
  .actions button.primary {
    flex: 1;
    min-width: 12rem;
  }

  /* A one-time code is short and mechanical - a full-width field invites
     the wrong kind of input, and wide letter-spacing makes a mistyped
     digit easy to spot. */
  .code-input {
    max-width: 14rem;
    font-family: var(--ss-font-mono);
    font-size: var(--ss-text-lg);
    letter-spacing: 0.35em;
  }

  /**
   * The Recovery Key is shown exactly once, ever, and is the only way back
   * into the vault - so it gets the strongest emphasis in the whole app:
   * brand-tan border and text on a sunken panel, monospace, generously
   * tracked and large enough to transcribe by hand from a phone screen.
   * Deliberately not the teal accent, which everywhere else means "this is
   * a button you can press."
   */
  .recovery-key {
    display: block;
    padding: var(--ss-space-4);
    background: var(--ss-surface-sunken);
    border: 1px solid var(--ss-brand);
    border-radius: var(--ss-radius-md);
    box-shadow: inset 0 0 0 1px rgba(201, 166, 107, 0.12);
    color: var(--ss-brand);
    font-size: var(--ss-text-lg);
    line-height: 1.7;
    letter-spacing: 0.12em;
    text-align: center;
    word-break: break-all;
    /* Selectable by design - "Copy" can fail when the clipboard API is
       blocked, and hand-selecting the text is the documented fallback. */
    user-select: all;
  }

  .where-to-put-it {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    padding: var(--ss-space-4);
    background: var(--ss-surface-raised);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
    font-size: var(--ss-text-sm);
    color: var(--ss-text-muted);
    line-height: 1.6;
  }

  .where-label {
    color: var(--ss-text);
    font-weight: 600;
  }

  .where-to-put-it ul {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-1);
    margin: 0;
    padding-left: var(--ss-space-4);
  }

  .where-warning {
    padding-top: var(--ss-space-2);
    border-top: 1px solid var(--ss-border);
    color: var(--ss-warn-text);
  }

  .confirm-saved {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--ss-space-3);
    padding: var(--ss-space-3);
    background: var(--ss-surface-raised);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-md);
    font-size: var(--ss-text-base);
    cursor: pointer;
  }

  .confirm-saved:hover {
    border-color: var(--ss-border-strong);
  }
</style>
