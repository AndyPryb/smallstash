# smallStash — TODO / parked notes

Things raised in conversation that are decided-but-not-built, or
deliberately deferred. Check items off / delete them as they land instead
of leaving them stale.

## Full teardown capability - `destroyData` context flag (2026-08-23)

`SmallstashStack.java` reads a CDK context flag to decide the
`RemovalPolicy` on the 3 data-bearing resources (S3 vault bucket,
DynamoDB table, Cognito pool) - **defaults to `RETAIN` (safe)**, only
switches to `DESTROY` (+ `autoDeleteObjects` on the bucket) when passed
explicitly:

```bash
cdk deploy -c destroyData=true   # bakes DeletionPolicy=Delete into the
                                  # resources from creation
cdk destroy                      # from then on, deletes everything in
                                  # one command - no flag needed again,
                                  # CloudFormation remembers the policy
                                  # from the last deploy, not fresh code
```

Verified both directions actually change `DeletionPolicy` in the
synthesized template (`Retain` by default, `Delete` with the flag) -
not just assumed from the code.

- [ ] **Flip back to the safe default (redeploy without the flag) before
      this ever holds real, non-test data.** Not automatic - has to be a
      deliberate `cdk deploy` (no `-c destroyData=true`) to restore
      `RETAIN` once it matters. Easy to forget since nothing forces it.

## What's built

See [architecture.md §9/§9b](architecture.md#9-implementation-status) for
the current, authoritative list of what's built vs. deployed — not
duplicated here to avoid the two drifting out of sync. Short version: all
backend code + the full CDK infra definition are written, locally
verified, **and deployed** (see below) — just no PWA client yet.

The deployer IAM user (`smallstash-deployer`) **is** created and is the
active AWS CLI default profile — `infra/scripts/create-deployer-user.sh`
already run. Its scoping caveat still applies, see "Guides owed" below.

## First deploy — done (2026-08-23)

Deployed via `cdk deploy` (SmallstashStack, 21/21 resources,
`CREATE_COMPLETE`, 91.92s). `infra/cdk.json`'s app command now rebuilds
the backend jar automatically before every `cdk` command that
synthesizes, so a stale/missing jar is no longer a manual thing to
remember (see architecture.md §9b for the exact command).

Post-deploy checklist - all verified against the live stack, not just
assumed from the code:

- [x] Deployer IAM user created and set as the AWS CLI default profile
      (`smallstash-deployer`, region `eu-west-1`).
- [x] `MICRONAUT_SECURITY_ENABLED=true` confirmed on the deployed Lambda's
      env vars (`aws lambda get-function-configuration`).
- [x] `COGNITO_JWKS_URL` resolves to the real pool (see current pool id
      below - re-verified after the full recreate), not the old placeholder.
- [x] `GET /vault` with no token → **401** `{"message":"Unauthorized"}`,
      not a leak, not a 500.
- [x] DynamoDB table `ACTIVE`, S3 vault bucket reachable, Cognito pool
      exists with `MfaConfiguration: OPTIONAL` as designed.

Live stack outputs (account `060795901917`, region `eu-west-1`) - **updated
2026-08-23 after a `cdk destroy` (manual, orphans included) +
`cdk deploy -c destroyData=true` full recreate — every ID below is new,
the ones from the first deploy no longer exist**:
```
ApiUrl            = https://7elwt9j0u0.execute-api.eu-west-1.amazonaws.com
UserPoolId        = eu-west-1_CY70Hunz3
UserPoolClientId  = es8shgod8c4glft5nrn1hennc
VaultBucketName   = smallstashstack-vaultbucket95cbf29a-jxpgfio6ua7w
```

## Manual test user (2026-08-23) — stand-in, not the real signup flow

Created via `admin-create-user` + `admin-set-user-password --permanent`
(bypasses email verification entirely - fine for a one-off manual test
account, **wrong for real users**). See architecture.md §9 for why this
isn't the real flow: the PWA must use the actual self-service `SignUp` +
`ConfirmSignUp` APIs instead.

**Recreated 2026-08-23** in the fresh pool after the full teardown/rebuild
above - same email/password as before, new `sub` (new pool = new identity,
even with identical credentials):
```
email (sign-in alias) = test@example.com
password               = <TEST_USER_PASSWORD - do not commit, see your own local notes>
sub (real identity)    = 2275b414-90e1-704f-8271-e318f8ced185
```

- [ ] Replace/remove this manual user once the PWA has a real signup flow
      - it's a test artifact, not meant to be long-lived.

## Account-level safety nets (already in place, outside CDK/this repo)

Confirmed 2026-08-23, so a future session doesn't re-raise these as gaps:

- [x] **Console MFA** enabled on the personal (`Andy`) AWS account - the
      biggest single lever against full account compromise, outside
      anything smallStash itself controls.
- [x] **Two AWS Budget alerts** configured (verified via
      `aws budgets describe-budgets`): "My Monthly Cost Budget" ($15) and
      "My Zero-Spend Budget" ($1 - given this project's expected real
      cost is ~$0, this one will catch almost any unexpected activity
      fast, not just a large spike). Neither is part of the CDK stack -
      account-level, set up independently.

Combined with the Lambda execution role's tight scoping (verified via
`cdk diff` - no EC2/compute-launch permissions, only CloudWatch Logs +
this project's own DynamoDB table + S3 bucket), the realistic "AWS
account hijacked for crypto-mining" risk is reasonably well bounded for
a personal project at this scale.

## PWA: offline access to key material - resolved 2026-08-23

**Status: implemented.** `web/src/lib/cache/db.js` caches salt, KDF params,
and both wrapped Vault Key copies in IndexedDB alongside the vault
ciphertext, keyed by Cognito `sub`. `isKeyMaterialStale()` compares cached
vs. server `keyVersion` so a Master Password change elsewhere is detected
once back online rather than silently unlocking against outdated wrapped
keys. See [ADR-0002](decisions/0002-pwa-stack.md) decision 4 for the full
reasoning (why this doesn't weaken zero-knowledge) and
`web/src/lib/session.js`'s `unlockOffline()`/`refreshCacheIfStale()` for how
it's wired into the actual unlock flow.

- [x] **Wired into the UI** (2026-08-23) -
      `web/src/lib/components/OfflineUnlockForm.svelte` + `App.svelte`.
      Two triggers: the browser's own `online`/`offline` events
      (`navigator.onLine`, reliable for "definitely offline" - airplane
      mode etc.), and a manual fallback - a failed `signInAndUnlock()` that
      looks network-related (fetch's `TypeError`, or `!navigator.onLine` at
      the time) offers "try offline unlock instead", which covers the
      "connected to wifi with no real internet" case `navigator.onLine`
      alone misses. Session.js gained `getLastAccount()` (email/sub of the
      last successful online sign-in on this device, in localStorage - both
      non-secret, same reasoning as the IndexedDB cache) so the offline form
      knows *whose* cache to unlock without asking the user to know their
      own Cognito sub. Verified: build/tests clean; **not yet manually
      tested with the browser's devtools "offline" network throttle** -
      worth a real run-through.

## PWA kickoff scaffold - done, follow-on work still open (2026-08-23)

`web/` created per [ADR-0002](decisions/0002-pwa-stack.md) - Svelte 5 +
Vite SPA, `hash-wasm` Argon2id (cross-checked against `@noble/hashes` +
RFC 9106 in `web/src/lib/crypto/kdf.test.js`), monorepo layout. `npm test`
(22 tests) and `npm run build` both verified passing/clean as of this
commit. What exists: login form (Cognito SRP + Master Password unlock),
minimal vault CRUD UI (add/remove entries, save), the full crypto/auth/
cache/session layering described in the ADR.

**Not yet built, in rough priority order:**
- [x] **Signup UI** (2026-08-23) - `web/src/lib/components/SignupForm.svelte`,
      a 3-step flow: register (Cognito `SignUp`) -> confirm (emailed code,
      `ConfirmSignUp`) -> recovery (sign in + `initializeVault()`, show the
      Recovery Key once with a "saved it" checkbox gating continue). Wired
      into `App.svelte` via a "Create one" toggle next to the login form.
      `session.js` gained `registerAccount`/`confirmAccount`/
      `signUpAndInitializeVault` to support it. Not yet tested against the
      live pool end-to-end with a real inbox (only build/unit-test verified)
      - worth a manual run-through before relying on it. The manual
      `admin-create-user` test user (see below) is no longer the *only* way
      to create an account, but is untouched/still valid for existing test
      scripts.
- [x] **Offline unlock affordance** (2026-08-23) - see the dedicated "PWA:
      offline access to key material" section above for detail.
- [x] **Change Master Password UI** (2026-08-23) -
      `web/src/lib/components/ChangeMasterPasswordForm.svelte`, reachable
      from a toolbar button in `VaultView.svelte`. Asks for the *current*
      Master Password even though the session already holds the unwrapped
      Vault Key in memory - `session.js`'s new `changeMasterPassword()`
      re-derives from it and requires it to actually unwrap the stored key
      before proceeding, so an unattended-but-unlocked tab can't have its
      Master Password changed by whoever is sitting at it without knowing
      the current one. Also requires the account's existing Recovery Key
      (unchanged afterwards, just re-wrapped under a fresh salt - see
      `rewrapWithNewMasterPassword()`'s existing tests). Verified:
      build/tests clean; **not yet manually run through in a browser.**
- [x] **Password generator** (2026-08-23, resolves open question #6) -
      `web/src/lib/generator.js` (pure, `crypto.getRandomValues()`-backed,
      zero deps) + `PasswordGeneratorPanel.svelte`, reachable via a
      "Generate" button next to the Password field in `VaultView.svelte`'s
      add-entry form. Length slider (8-64) + toggles for each character
      type + an "exclude ambiguous characters" (I/l/1/O/0) option, live
      preview, copy-to-clipboard, "Use this password" fills the entry form.
      Uses rejection sampling (not naive `byte % n`) to avoid modulo bias
      when mapping random bytes onto a character set whose size doesn't
      divide 256 evenly - covered by a dedicated distribution smoke test in
      `generator.test.js` (9 new tests, 31 total). Verified: build/tests
      clean; **not yet manually run through in a browser** (in particular,
      `navigator.clipboard.writeText` behavior across browsers/contexts is
      worth checking by hand).
- [x] **MFA UI** (2026-08-23) - `web/src/lib/components/MfaCodeForm.svelte` +
      `App.svelte`. `session.js`'s `signInAndUnlock()` now catches
      `MfaRequiredError` and stashes everything needed to resume the same
      login attempt (the mid-flow `CognitoUser`, plus the already-entered
      email and Master Password - `pendingMfa`, module-private) rather than
      making the user re-enter passwords just to supply a code.
      `completeMfaLogin(code)` finishes it; a wrong code leaves `pendingMfa`
      intact so the user can just retry, only falling back to the login
      form if something *after* a correct code fails (e.g. wrong Master
      Password). Not tested against a real MFA-enrolled account (none
      exists on the live pool yet - would need enrolling one by hand first)
      - build/tests verified clean, but **the actual Cognito MFA
      challenge/response round trip is unverified against a live pool.**
- [x] **Inactivity timeout** (2026-08-23) - `session.js` gained a
      15-minute (`DEFAULT_INACTIVITY_TIMEOUT_MS`) auto-lock timer:
      `resetInactivityTimer()` (no-ops if there's no active session, so it's
      cheap to call unconditionally), `onAutoLock(listener)`, and a private
      `setActive()` helper so every path that unlocks a session
      (`finishOnlineUnlock`/`unlockOffline`/`initializeVault`) starts the
      timer the same way. `clearSession()` (already called by the timer
      itself, sign-out, etc.) now also stops it. `App.svelte` forwards
      throttled (every 3s, not every mousemove pixel) `mousemove`/
      `keydown`/`mousedown`/`touchstart`/`scroll`/`wheel` activity into
      `resetInactivityTimer()`, and reacts to the `onAutoLock` callback by
      dropping the displayed vault and showing a "locked after inactivity,
      sign in again" banner. Tab-close was already effectively true before
      this (a plain JS variable dies with the page) - this is specifically
      the "left the tab open" half of architecture.md §5's requirement.
      Verified: build/tests clean; **not yet manually verified with the
      timeout actually elapsing** (15 minutes of real wall-clock time is
      impractical to sit through here - worth either a quick manual check
      with a temporarily-shortened timeout, or trusting the code review).
- [x] **View existing entry details** (2026-08-23, found via manual testing
      by the user, not originally on this list) - the entry list only ever
      rendered `title`/`username` + a delete button; `password`/`url`/`notes`
      were stored and round-tripped correctly but nothing in the UI ever
      surfaced them again after adding an entry - a real usability bug, not
      a regression from a later change (present since the original VaultView
      scaffold). Fixed: `EntryListItem.svelte` - click an entry to expand it,
      showing Username/Password (masked by default, "Show"/"Copy"
      buttons)/URL (as a link)/Notes.
- [x] **Edit existing vault entries** (2026-08-23) - `EntryListItem.svelte`
      gained an "Edit" button (shown in the expanded view) that swaps in an
      inline edit form for that entry - Title/Username/Password (masked by
      default with a Show/Hide toggle, same as view mode - see the
      "Frontend-only best-practice review" section below, which fixed an
      initial version of this that used an always-visible plain-text field;
      includes the same "Generate" password-generator button as the
      add-entry form)/URL/Notes, Save/Cancel. `VaultView.svelte` gained
      `updateEntry()` to replace the edited entry in place. Before this,
      add/delete/view was all that existed - no way to fix a typo or
      rotate a password without deleting and re-adding the whole entry.
      **Index-keying limitation noted here originally - since fixed**, see
      "Frontend-only best-practice review" below (entries now get a stable
      `crypto.randomUUID()` id).
      Verified: all 31 tests pass, `npm run build` clean, dev server
      compiles with no errors.
- [ ] **Deploy `web/dist/` - see the dedicated section below, not started.**

## Polish pass over the PWA client (2026-08-23)

Asked for a general review (not tied to a specific todo item) of everything
in `web/` built so far. Found and fixed several real issues, none of them
regressions from a specific commit - all present since whichever feature
first introduced the affected code:

- **Stale password mask on empty-password entries** - `EntryListItem.svelte`
  showed a row of dots for entries with no password (a notes-only entry,
  say), implying a hidden real password existed. Now shows `—` when there's
  nothing to hide, and disables the "Show" button too.
- **Broken links for scheme-less URLs** - an entry's `url` field (e.g. typed
  as `example.com`, no `https://`) resolved as a relative link against the
  app's own origin instead of navigating out - looked like a dead link.
  `EntryListItem.svelte` now assumes `https://` when no scheme is present;
  the visible link text still shows exactly what the user typed.
- **Stale error banner across auth mode switches** - switching between
  Login ⇄ Signup left a previous attempt's error message on screen,
  potentially about the wrong action ("Incorrect Master Password" showing
  over a fresh signup attempt). `App.svelte` now clears it on every mode
  switch.
- **Sign-out left stale UI flags set** - `forceOffline`/`mfaPending`/
  `lockedByInactivity` weren't reset on sign-out; a `forceOffline` latched
  by an earlier network hiccup could strand the next login attempt on the
  offline-unlock screen even after an explicit, deliberate sign-out.
  `handleSignOut()` now resets all of them.
- **No minimum-length check on the Master Password anywhere** - unlike the
  login password (enforced server-side by Cognito's pool policy), the
  Master Password never reaches the backend, so the client is the only
  place anything can be checked. Added `web/src/lib/policy.js`
  (`MIN_MASTER_PASSWORD_LENGTH`), used by both `SignupForm.svelte` and
  `ChangeMasterPasswordForm.svelte`. **Set to 4** (2026-08-23, explicit user
  choice - deliberately allows a PIN-length Master Password) - flagged once
  that this trades away real strength against offline brute-force if the
  wrapped-key blob is ever exfiltrated (Argon2id raises cost-per-guess, it
  doesn't rescue a 4-character search space), the user's call to make since
  it's their own vault.
- **Misleading doc comment on `cache/db.js`'s `clearCache()`** - said "call
  on explicit sign-out", which would have actively broken offline unlock the
  next time it was needed (the IndexedDB cache has to *survive* sign-out for
  offline unlock to be useful at all - see the file's own header comment,
  which already explained this correctly elsewhere). Comment corrected;
  `clearCache()` remains unused, reserved for a possible future "forget this
  device" action.
- **`refreshCacheIfStale()` clarified as currently unused** - not a bug (the
  normal online sign-in path already refreshes the cache unconditionally on
  every login, which covers the main case), but the function existed with no
  comment explaining that nothing calls it - could easily be mistaken for
  active behavior by a future session. Added a comment describing the
  narrower gap it would actually close if wired up (a Master Password change
  on a *different* device while this one's session stays open throughout).
- **New: offline-session banner in `VaultView.svelte`** - previously a user
  unlocked offline would only discover saves don't sync when they clicked
  "Save vault" and got an error. Added `session.js`'s `isOfflineSession()`
  and a banner shown up front instead.

**Known limitation surfaced, not fixed (real scope, not a polish-sized
fix):** editing the vault while offline-unlocked, then reconnecting and
signing in again normally (rather than clicking "Save vault" first), loses
those edits with no warning beyond the new banner above - `signInAndUnlock()`
fetches and displays the server's copy, with no merge/preservation of
whatever was sitting unsaved in memory. Proper offline edit queuing/sync is
flagged as v2+ in [ADR-0001](decisions/0001-storage-s3-vs-dynamodb.md)
("multi-device conflict resolution") - this is the same class of problem,
not a new one, just newly visible now that offline unlock exists at all.

All fixes verified: 31 tests pass, `npm run build` clean, dev server
compiles every touched file with no errors.

### Follow-up: global theme was missing entirely (2026-08-23, found by the user)

Reported as "black text on black background" when reading entries. Root
cause: `EntryListItem.svelte`'s expanded entry view, `PasswordGeneratorPanel`'s
preview box, and `SignupForm`'s Recovery Key display all use a dark
background (`#14171b`) on the assumption of a dark theme (matching the app
icon and the manifest's `theme_color`/`background_color`), but nothing had
ever actually set the *page's own* background or default text color -
browsers fell back to their own default (white background, black text), so
those dark boxes ended up with black text on a near-black background.

Fixed in `App.svelte` (the root component, so it applies everywhere):
`:global(html) { color-scheme: dark; }` + `:global(body) { background:
#1b1f24; color: #e6e6e6; }`. `color-scheme: dark` also makes native form
controls (text inputs, checkboxes, the password generator's range slider)
render with the browser's built-in dark styling automatically. Verified: no
other component sets a light background that this default text color would
now clash with (checked via grep across `web/src`); 31 tests pass, build
clean, dev server hot-reloaded the fix live.

## Frontend-only best-practice review (2026-08-23)

Asked for a general "make it a best-practice client app" pass, frontend
only - explicitly no backend/CI/CD changes, but flag anything that *would*
need one. Found and fixed several real gaps:

- [x] **Silent data loss on sign-out/tab-close with unsaved edits** - the
      biggest find. Nothing tracked whether `vaultDocument` had unsaved
      changes; clicking "Sign out" (or just closing the tab) after
      editing/adding/deleting entries without clicking "Save vault" first
      discarded those changes with zero warning. `VaultView.svelte` now
      tracks a `dirty` flag (compares current vs. last-saved JSON
      snapshot), shows an "Unsaved changes" indicator next to the toolbar,
      confirms before sign-out if dirty, and warns via the standard
      `beforeunload` browser prompt if the tab is closed/reloaded while
      dirty.
- [x] **No delete confirmation** - clicking an entry's ✕ deleted it
      immediately, no undo, no "are you sure?". `EntryListItem.svelte` now
      confirms first.
- [x] **Entry list keyed by array index, not a stable ID** - flagged as a
      known limitation in the previous "Edit existing vault entries" entry
      above; fixed now. Every entry gets a `crypto.randomUUID()` `id` at
      creation (existing entries without one are backfilled on load); the
      `{#each}` list is now keyed by `entry.id`. Purely a client-side data
      shape change - the `id` field lives inside the encrypted blob, the
      backend never sees vault entry structure at all either way.
- [x] **Edit-mode password field contradicted the component's own stated
      security principle** - `EntryListItem.svelte`'s header comment says
      "the password stays masked until explicitly shown", but the edit
      form added in the previous commit used an always-visible plain-text
      field. Now shares the same `showPassword` toggle as view mode
      (masked by default, in both modes).
- [x] **Add-entry password field had no way to verify what you typed** -
      unlike editing (plain text) or the generator preview (visible),
      adding a *new* entry's password was `type="password"` with no
      reveal toggle at all - a typo would go unnoticed until the next
      login attempt with that entry failed. Added a Show/Hide toggle,
      consistent with everywhere else a password appears.
- [x] **Newly-generated passwords required an extra click to see** - after
      "Use this password" from the generator, both the add-entry and
      edit-entry password fields now auto-reveal (`showPassword = true`),
      matching common password manager behavior (Bitwarden/LastPass do the
      same) - you just consciously generated it, you'll want to see it.
- [x] **Signup Recovery Key had no Copy button** - only a checkbox to
      confirm it was saved, forcing manual transcription; every other
      secret-reveal spot in the app (password generator, entry view) has a
      Copy button. Added one, plus `font-family: monospace` for legibility
      of the Base32 code (mirrors `EntryListItem`'s password styling).
- [x] **Minor**: `aria-expanded` on the entry expand/collapse toggle
      (screen readers previously had no way to know its state);
      `word-break: break-all` on the entry password display and
      `min-width: 0` on flex password rows (both prevent a long generated
      password from overflowing its container on narrow screens);
      `autocomplete="one-time-code"` added to the signup confirmation code
      field (already present on the MFA code field, missed here);
      `autocapitalize`/`autocorrect`/`spellcheck` disabled on the Recovery
      Key input in `ChangeMasterPasswordForm` (mobile keyboards otherwise
      fight a Base32 code); `type="button"` made explicit on `VaultView`'s
      toolbar buttons (harmless today since they're not inside a `<form>`,
      but the HTML-spec-correct default for a bare `<button>` is
      `submit`); added a `<meta name="description">` to `index.html`.

**Found, not fixed - would need a backend change:**
- [ ] **No optimistic concurrency on `PUT /vault`** - the write is a blind
      overwrite; if the same account is edited from two tabs/devices
      concurrently, the second `saveVault()` silently discards whatever
      the first one wrote, with no conflict warning either side. Fixing
      this needs backend work (e.g. `VaultController`/`S3VaultRepository`
      taking the `versionId` from the last `GET /vault` and using S3's
      conditional-write support to reject a stale `PUT`), not something
      fixable from `web/` alone. Related to, but distinct from, the
      already-documented "offline edits lost on reconnect" limitation
      above and the "multi-device conflict resolution" v2+ item in
      ADR-0001 - flagging as its own item since it's a narrower, more
      fixable slice (same-session concurrent writes, not full offline
      sync).

**Found, not fixed - asset/tooling gap, not a code change:**
- [ ] **No `apple-touch-icon` PNG for iOS "Add to Home Screen"** - iOS
      Safari ignores the web manifest's icons for the home-screen icon;
      it specifically needs a `<link rel="apple-touch-icon">` pointing at
      a PNG (traditionally 180x180). Only SVG icons exist today
      (`web/public/icon.svg`/`icon-maskable.svg`). No SVG-to-PNG
      rasterizer was available in this session's sandbox (checked for
      `rsvg-convert`/`inkscape`/ImageMagick/the `sharp` npm package - none
      present) and installing a new dependency for one asset felt
      disproportionate to do unprompted. Needs either a rasterizer
      available locally, or generating the PNG by some other means, then
      adding the `<link>` tag to `index.html`.

All fixes verified: 31 tests pass, `npm run build` clean, dev server
hot-reloaded every touched file with no errors (checked the live log, not
just assumed).

## Frontend test coverage review (2026-08-23)

Asked to review and improve `web/`'s test coverage. Before this, only
`crypto/` and `generator.js` had any tests (31 total) - `bytes.js`,
`policy.js`, `cache/db.js`, and **`session.js`** (the orchestration hub
tying Cognito auth + the API client + crypto + the cache together, and the
one place allowed to hold the live Vault Key) had zero coverage.

- [x] **`bytes.test.js`/`policy.test.js`** - straightforward pure-function
      coverage for the two previously-untested small modules.
- [x] **`cache/db.test.js`** - added `fake-indexeddb` (devDependency) so
      the IndexedDB-backed offline cache can be tested in plain Node with
      no browser. Covers put/get round-trips and `isKeyMaterialStale()`'s
      staleness logic, which had no test at all despite being the thing
      that decides whether a cached unlock is trustworthy.
- [x] **`session.test.js`** (26 tests) - the biggest gap, now the biggest
      addition. Real crypto and the real (fake-indexeddb-backed) cache are
      used throughout for honesty about what session.js actually does with
      real key material; only the network-touching boundaries
      (`auth/cognito.js`, `api/client.js`, `config.js` - the last of which
      would otherwise throw trying to read `import.meta.env` outside a
      Vite context) are replaced via `node:test`'s built-in `mock.module()`.
      Covers sign-in (happy path, wrong Master Password, MFA-required),
      MFA completion (happy path, wrong-code-is-retryable, no-pending-login
      guard), offline unlock (happy path, never-cached guard, wrong
      password), signup/`initializeVault`, `saveVault` (happy path, no
      session, offline guard), `changeMasterPassword` (happy path
      confirmed by actually re-unlocking under the new password, no
      session, offline guard, wrong current password), and the inactivity
      auto-lock timer using `node:test`'s fake timers (no real 15-minute
      wait).
      **Depends on `--experimental-test-module-mocks`** (added to
      `package.json`'s `test` script) - `mock.module()` is still an
      experimental Node API as of this writing. Test-only; doesn't affect
      the shipped browser bundle (verified: build output size unchanged,
      `fake-indexeddb` doesn't appear in it).

Verified: all 79 tests pass (`npm test`), `npm run build` clean and
unaffected by the new devDependencies.

- [ ] **Add Svelte component tests** - found during the above review,
      flagged rather than attempted unprompted (bolting on a second test
      runner felt like a decision for you to make, not a side effect of
      "improve coverage"). Zero component tests exist today - `App.svelte`,
      every form (`LoginForm`/`SignupForm`/`ChangeMasterPasswordForm`/
      `MfaCodeForm`/`OfflineUnlockForm`), `VaultView.svelte`,
      `EntryListItem.svelte`, `PasswordGeneratorPanel.svelte` - only the
      `lib/` logic underneath them is tested. The current setup (plain
      `node:test`, no DOM at all) can't render a component, so this isn't a
      "just add a file" gap - it needs new infrastructure first. Two real
      options, worth deciding rather than defaulting to one:
      - **Vitest + `@testing-library/svelte` + jsdom/happy-dom** - the more
        common pairing for Svelte projects; tests run fast (no real
        browser), interacts with the DOM via Testing Library's
        query/fire-event API. Would mean running two test runners side by
        side (`node:test` for `lib/`, Vitest for components) unless the
        existing `lib/` tests are also migrated to Vitest at the same time
        (itself a decision - Vitest is largely `node:test`/Jest-API-
        compatible, so migration is plausible but not zero-effort, and
        would mean giving up Node's built-in test runner in favor of an
        added dependency).
      - **Playwright component testing** - runs components in a real
        browser engine (actual Chromium/Firefox/WebKit), closer to what a
        user experiences (real CSS, real focus/keyboard behavior,
        catches real-browser-only bugs jsdom can miss) but slower per test
        and a heavier dependency.
      Highest-value components to cover first, whichever tool is picked:
      `EntryListItem.svelte` (view/edit/delete/mask-toggle state machine,
      the most complex UI logic in the app) and `App.svelte`'s auth-mode
      routing (login/signup/MFA/offline branches - currently only
      exercised by hand).

## PWA hosting - `web/dist/` has nowhere to live yet (2026-08-23)

`npm run build` in `web/` produces a working static bundle (verified clean,
~56 KB gzipped JS + service worker + manifest - see
[ADR-0002](decisions/0002-pwa-stack.md)), but nothing in `infra/` serves it.
Today the only way to run the PWA at all is `npm run dev` on a developer's
own machine - there is no URL a real user (i.e. not-you) could open.

- [ ] **Add S3 + CloudFront static hosting to the CDK stack** - the natural
      fit given the rest of the stack is already CDK-managed: an S3 bucket
      for the built `dist/` files, CloudFront in front of it (HTTPS,
      caching, and a single distribution URL), `index.html` as both the
      default root object and the error-document fallback (needed so
      client-side routing - if any gets added later - doesn't 404 on
      refresh). This is a **new CDK construct set**, not a reuse of the
      existing `smallstash-vaults` bucket, which is versioned/RETAIN-tagged
      secret ciphertext storage - hosting assets are public, disposable
      build output and shouldn't share a bucket or removal policy with that.
- [ ] **Update `SmallstashStack`'s HTTP API CORS origin** once a real
      CloudFront domain exists - currently only allows the Vite dev-server
      placeholder (`localhost:5173`), which is fine for local dev but wrong
      for anything else calling the API.
- [ ] **Decide a deploy step for `web/dist/` itself** - CDK can create the
      bucket/distribution, but getting fresh build output *into* the bucket
      on every change needs either a CDK `BucketDeployment` construct (asset
      upload baked into `cdk deploy`, simplest, couples FE deploys to a CDK
      deploy) or a separate CI step (`aws s3 sync` + a CloudFront
      invalidation, decoupled but one more moving part to set up). No
      decision yet - default to `BucketDeployment` unless a reason to split
      shows up, consistent with "prefer CDK code changes over manual steps"
      in CLAUDE.md.
- [ ] **No custom domain yet** - CloudFront's own `*.cloudfront.net` URL is
      fine to start; a real domain (Route 53 + ACM cert) is a separate,
      later decision, not blocking a first working deploy.
- [ ] **This is an AWS-account-mutating change once it reaches `cdk deploy`**
      - needs the usual explicit go-ahead each time per CLAUDE.md, same as
      every other stack change.

## Profile feature - not functionally wired up yet (2026-08-23)

`UserProfileItem`/`UserProfile` exist as a schema, but two of its three
fields don't do anything yet:

- [ ] **`storageBytesUsed` is never updated.** Set to `0` at creation
      (`createProfileIfAbsent`) and never touched again - `PUT /vault`
      writes the new blob to S3 but doesn't update this field. To make it
      real: after a successful S3 write in `VaultController.put()`,
      update the DynamoDB `PROFILE` item with the new ciphertext's byte
      length. Note the design tension this creates: `vault` and `keys`
      are currently deliberately independent packages (see the earlier
      "why is DynamoDbUserKeysRepository separate from S3VaultRepository"
      discussion) - wiring this means either `VaultController` taking a
      dependency on `UserKeysRepository`, or some other decoupled
      mechanism (e.g. an S3 event trigger recalculating usage
      asynchronously - more moving parts, avoids the coupling).
- [ ] **`plan` is hardcoded to `"free"` and nothing reads it.** No
      plan-based limits, no tiers, no logic anywhere depends on this
      value - it's pure scaffolding right now.
- [ ] **No `GET /profile` endpoint exists at all** - nothing lets a user
      (or the PWA) actually see their own profile data today, even the
      one field (`createdAt`) that *is* accurate.
- [ ] **Open question worth asking before building any of this**: does a
      personal/small-scale pet project actually need a plan/tier system
      at all? Given the project framing ("not enterprise," see
      architecture.md top), a full multi-tier plan feature may be
      overkill - worth deciding the real scope (maybe just "show me my
      join date and storage used," no tiers/limits) before implementing
      rather than building out `plan` further by default.

## Deferred - revisit later, not blocking anything now

- [ ] **AWS WAF** - rate-based rules, IP reputation, basic bot protection.
      Real monthly cost (~$5+/mo minimum + per-request) - reconsider once/if
      actual abuse is observed, not preemptively for a solo-user app.
- [ ] **VPC / private networking for the Lambda** - deliberately left
      questionable. Wrong shape for a public multi-device API as currently
      scoped; revisit only if a concrete reason shows up later.
- [ ] **AWS Shield Advanced** - enterprise-grade, expensive, not justified
      at this scale. Shield *Standard* is already on for free automatically
      for every API Gateway endpoint.
- [ ] **Cognito Advanced Security Features** (paid add-on: compromised-credential
      checks, adaptive auth) - skip for now, personal-scale traffic doesn't
      justify it.

## API testing approach — Postman tried and abandoned, JS automated tests next (2026-08-23)

Manual testing was briefly done via a Postman collection (created, exercised
partially, then removed). Abandoned because Postman's pre-request script
sandbox can't do SRP - no package-loading mechanism to pull in a real
implementation like `amazon-cognito-identity-js`, and no safe way to mint
tokens via `admin-initiate-auth` either (that flow needs privileged AWS IAM
credentials, which shouldn't be embedded in a Postman environment - a much
bigger secret than a 1hr JWT). The `.adminUserPassword(true)` admin-only
auth-flow workaround that briefly existed to route around this was also
reverted - back to SRP-only on the app client, the intended production
end-state.

- [x] **Automated API tests in JavaScript/Node** (2026-08-23) - `tests/api/`,
      using the real `amazon-cognito-identity-js` library for actual SRP
      authentication - a real Node environment has full `BigInt` + npm
      package access that Postman's sandbox lacks. Doubles as an early
      prototype of the PWA's own auth code. 8/8 tests passing against the
      live stack: unauthenticated 401s, `PUT`/`GET /keys` round-trip,
      `PUT`/`GET /vault` round-trip, and `auth-flows.test.js` - which
      confirms the deployed app client is SRP-only both by static config
      (`DescribeUserPoolClient`) and at runtime (a public, non-admin
      `USER_PASSWORD_AUTH` attempt is actually rejected, not just assumed
      to be). That second file caught real drift: the live client still had
      `ALLOW_ADMIN_USER_PASSWORD_AUTH` enabled from the earlier manual-testing
      workaround even though the CDK source had already been reverted to
      SRP-only - `cdk deploy -c destroyData=true` re-run to sync it, in-place
      (no resource replacement, confirmed via `cdk diff` first - pool/client
      IDs and API URL all unchanged, see "Live stack outputs" below).
- [x] **Test config lives in `.env`/`.env.example` at the repo root**
      (2026-08-23) - `.env.example` is committed as a template only (all
      values blank, including the non-secret ones - deliberately not a
      live mirror, so it can't drift when the stack gets recreated).
      `.env` is gitignored and is the one file meant to hold real current
      values, copied from docs/todo.md's "Live stack outputs".
      `TEST_USER_PASSWORD` left blank for manual entry either way -
      deliberately never written by an AI session, to avoid a secret
      passing through chat/tool output again. Fill it in yourself before
      running the test suite. Location may move once the
      JS test suite's actual folder is decided (part of the PWA kickoff).
- [ ] Cognito **Hosted UI** + OAuth2 flow is still worth setting up
      eventually for interactive/manual testing once the PWA exists - a
      separate, still-open item, not replaced by the automated tests above.

## Guides owed to you (ask when ready, not needed yet)

- [ ] How to turn on Cognito **Hosted UI** (authorization-code grant) for
      interactive/manual testing against the real deployed stack.
- [ ] Tightening the deploy IAM user's policy beyond the initial broad grant,
      once the CDK stack's actual resource set is stable.
- [ ] Moving CI/CD off the static access-key IAM user onto GitHub Actions
      OIDC federation (short-lived, no long-lived keys sitting in repo
      secrets) once CI/CD is actually set up — the access-key user is a
      fine starting point, not the long-term answer for automated deploys.

## Other useful work identified 2026-08-23 (not yet started, no AWS changes needed)

Raised alongside the PWA hosting task as things worth doing that *don't*
touch AWS - a session budget can go toward any of these without needing a
deploy go-ahead first.

- [x] **Edit existing vault entries** (2026-08-23) - see the "PWA kickoff
      scaffold" section below for what shipped; was add/delete/view only
      before this.
- [ ] **Backend: wire up the Profile feature** - see the dedicated
      "Profile feature" section below (`storageBytesUsed` never updated,
      `plan` unused scaffolding, no `GET /profile` endpoint at all). Real
      Java/Micronaut work, compiles/unit-tests locally without a deploy.
- [ ] **Set up CI (GitHub Actions)** - nothing currently runs `mvn test` or
      `web/`'s `npm test` automatically on push/PR; both are entirely
      manual today. A workflow file is pure repo content, no AWS mutation
      by itself. Natural prerequisite to the already-tracked "move CI/CD
      onto GitHub Actions OIDC" item above (that one's about *how* CI
      authenticates to deploy; this one is just "run the test suites").
