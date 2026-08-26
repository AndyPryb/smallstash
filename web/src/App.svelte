<script>
  import { onMount } from 'svelte';
  import LoginForm from './lib/components/LoginForm.svelte';
  import SignupForm from './lib/components/SignupForm.svelte';
  import ForgotPasswordForm from './lib/components/ForgotPasswordForm.svelte';
  import OfflineUnlockForm from './lib/components/OfflineUnlockForm.svelte';
  import VaultView from './lib/components/VaultView.svelte';
  import Alert from './lib/components/Alert.svelte';
  import {
    signInAndUnlock,
    unlockOffline,
    getLastAccount,
    clearSession,
    onAutoLock,
    resetInactivityTimer,
  } from './lib/session.js';

  /** @type {'login' | 'signup' | 'forgot-password'} */
  let authMode = $state('login');
  let notice = $state('');

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

  let lockedByInactivity = $state(false);

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

  // Inactivity auto-lock (architecture.md §5): forward real user activity
  // into session.js's timer, and react when it fires by dropping whatever
  // vault document is on screen. resetInactivityTimer() itself no-ops when
  // there's no active session, so it's cheap to call unconditionally here
  // rather than tracking unlocked-state separately in this component too.
  onMount(() => {
    // mousemove/scroll can fire dozens of times a second - throttle to at
    // most once every few seconds rather than clearTimeout/setTimeout on
    // every pixel of movement.
    const THROTTLE_MS = 3000;
    let lastReset = 0;

    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset < THROTTLE_MS) return;
      lastReset = now;
      resetInactivityTimer();
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'wheel'];
    for (const eventName of events) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }

    const unsubscribeAutoLock = onAutoLock(() => {
      vaultDocument = null;
      lockedByInactivity = true;
    });

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, onActivity);
      }
      unsubscribeAutoLock();
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
    notice = '';
    lockedByInactivity = false;
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
    lockedByInactivity = false;
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
    // Reset every transient flag rather than just vaultDocument - otherwise
    // e.g. a forceOffline latched by an earlier network hiccup would strand
    // the user on the offline-unlock screen after an explicit sign-out, even
    // if they're back online and want to sign in as someone else.
    forceOffline = false;
    lockedByInactivity = false;
    error = '';
    notice = '';
  }

  /** @param {'login' | 'signup' | 'forgot-password'} mode */
  function switchAuthMode(mode) {
    authMode = mode;
    error = '';
    notice = '';
  }

  function handlePasswordResetComplete() {
    authMode = 'login';
    notice = 'Login password reset. Sign in with your new password.';
  }
</script>

<main>
  <header class="app-bar">
    <h1 class="brand">
      <!-- Small nod to the name's origin: Rust's "Small Stash" item, a
           buried pouch you dig up to retrieve your loot - see
           docs/todo.md "UI theming nod to the name's origin". Purely
           decorative, discoverable only on hover; the padlock icon (browser
           tab/PWA install) got the fuller version of this same redesign. -->
      <svg class="stash-glyph" viewBox="0 0 512 512" aria-hidden="true">
        <path
          d="M216,150 C190,190 175,240 160,290 C150,320 150,340 150,340
             C150,380 190,400 256,400 C322,400 362,380 362,340
             C362,340 362,320 352,290 C337,240 322,190 296,150 Z"
          fill="#c9a66b"
        />
        <rect x="223" y="112" width="66" height="46" rx="22" fill="#d8b87c" />
        <rect x="203" y="140" width="106" height="26" rx="13" fill="#4a3826" />
        <circle cx="256" cy="153" r="8" fill="#2e2216" />
      </svg>
      <span title="Named after Rust's Small Stash - a buried pouch you dig up to retrieve your loot.">
        Small Stash
      </span>
    </h1>
  </header>

  <!-- Every message here is dismissible, because every one describes an
       event the user can acknowledge ("that sign-in failed", "you were
       locked out while away"). The one message that isn't dismissible is
       the never-signed-in-offline error below: closing it wouldn't make it
       stop being true, and there'd be nothing left on screen to explain the
       empty page. -->
  {#if error}
    <Alert variant="error" ondismiss={() => (error = '')}>{error}</Alert>
  {/if}

  {#if lockedByInactivity && !vaultDocument}
    <Alert variant="notice" ondismiss={() => (lockedByInactivity = false)}>
      Locked after a period of inactivity - sign in again to continue.
    </Alert>
  {/if}

  {#if notice && !vaultDocument}
    <Alert variant="notice" ondismiss={() => (notice = '')}>{notice}</Alert>
  {/if}

  {#if vaultDocument}
    <VaultView bind:vaultDocument onsignout={handleSignOut} />
  {:else}
    <!-- Every pre-unlock view shares one elevated card. Signed-in vault
         content deliberately doesn't - a list that grows to any length
         shouldn't sit inside a card that pretends it's a dialog. -->
    <section class="auth-card">
      {#if showOffline}
        <OfflineUnlockForm
          email={lastAccount.email}
          onunlock={handleOfflineUnlock}
          ononline={() => (forceOffline = false)}
          {loading}
        />
      {:else if !online}
        <Alert variant="error">
          You're offline, and this device has never signed in to Small Stash before - connect to the internet to sign
          in for the first time.
        </Alert>
      {:else if authMode === 'signup'}
        <SignupForm oncomplete={handleSignupComplete} oncancel={() => switchAuthMode('login')} />
      {:else if authMode === 'forgot-password'}
        <ForgotPasswordForm oncomplete={handlePasswordResetComplete} oncancel={() => switchAuthMode('login')} />
      {:else}
        <LoginForm onlogin={handleLogin} {loading} />
        <div class="switch-modes">
          <p class="switch-mode">
            No account yet?
            <button type="button" class="link" onclick={() => switchAuthMode('signup')}>Create one</button>
          </p>
          <p class="switch-mode">
            Forgot your login password?
            <button type="button" class="link" onclick={() => switchAuthMode('forgot-password')}>Reset it</button>
          </p>
        </div>
      {/if}
    </section>
  {/if}
</main>

<style>
  /**
   * Page theme (background, text colour, `color-scheme: dark`) now lives in
   * src/app.css alongside the design tokens - it used to be a :global block
   * here, which is why it was missing entirely for a while and produced the
   * "black text on black background" bug: several boxes assumed a dark
   * theme while nothing set the page's own background. Anything global
   * belongs in app.css now; this block is layout for the shell only.
   */

  main {
    /* 42rem, not the old fixed 640px: the auth card wants to stay narrow
       and readable, and a rem-based cap grows with a user's font size
       instead of squeezing the same line into a fixed pixel box. */
    max-width: 42rem;
    margin: 0 auto;
    padding: var(--ss-space-5) var(--ss-space-4) var(--ss-space-7);
    display: flex;
    flex-direction: column;
    /* Vertical rhythm comes from one gap on the shell rather than each
       child carrying its own margin-bottom, which is how the old spacing
       drifted per view. */
    gap: var(--ss-space-4);
  }

  .app-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ss-space-3);
    padding-bottom: var(--ss-space-4);
    border-bottom: 1px solid var(--ss-border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--ss-space-2);
    font-size: var(--ss-text-xl);
    /* Slightly tighter than the token default - a two-word wordmark reads
       as one unit at display size. */
    letter-spacing: -0.02em;
  }

  .stash-glyph {
    width: 1.5rem;
    height: 1.5rem;
    flex-shrink: 0;
    /* Lifts the pouch off the flat header without a border or plate. */
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  }

  .auth-card {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-4);
    padding: var(--ss-space-5);
    background: var(--ss-surface);
    border: 1px solid var(--ss-border);
    border-radius: var(--ss-radius-lg);
    box-shadow: var(--ss-shadow-2);
  }

  .switch-modes {
    display: flex;
    flex-direction: column;
    gap: var(--ss-space-2);
    padding-top: var(--ss-space-4);
    border-top: 1px solid var(--ss-border);
  }

  .switch-mode {
    font-size: var(--ss-text-sm);
    color: var(--ss-text-muted);
  }

  /* Tighter gutters on a phone - a 24px card inset inside a 16px page inset
     eats most of the line length these forms need at 360px wide. */
  @media (max-width: 32rem) {
    main {
      padding: var(--ss-space-4) var(--ss-space-3) var(--ss-space-6);
      gap: var(--ss-space-3);
    }
    .auth-card {
      padding: var(--ss-space-4);
    }
    .brand {
      font-size: var(--ss-text-lg);
    }
  }
</style>
