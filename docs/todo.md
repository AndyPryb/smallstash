# smallStash — TODO / parked notes

Things raised in conversation that are decided-but-not-built, or
deliberately deferred. Check items off / delete them as they land instead
of leaving them stale.

## 🚀 DEPLOYED 2026-08-25 — read this before trusting any "not deployed" tag below

Everything from the security review (Phases 0–3), MFA removal, the CSP
enforcing flip, the offline-boot fix, and the null-bug friendlier message
is now **live** on the same stack (in-place update — pool/API/bucket IDs
unchanged, see "Live stack outputs" below). Verified post-deploy, not
assumed: `Content-Security-Policy` header is the real enforcing one,
Cognito `MfaConfiguration: OFF`, all 5 registered users survived
untouched. Individual `**not deployed**` annotations scattered through
this file below are now stale — they were accurate when written, during
the several-day gap between implementing and deploying, and are kept as
historical record rather than mass-edited. Treat this banner as the
override.

One deploy attempt failed first, self-corrected within the same session:
CloudFront rejects `Content-Security-Policy` set via a custom header (the
name is reserved for `securityHeadersBehavior.contentSecurityPolicy`
instead) - confirmed against AWS's own docs, fixed, rolled back cleanly
with zero data/downtime impact before the fix landed (commit `ee294f3`).

**Not yet done, first thing worth picking up next session**: re-run
`npx playwright test` (in `web/`) against the live URL. Several specs were
written to assert the *post-deploy* state and were last known failing
only because the deploy hadn't happened yet - `security-headers.spec.js`'s
CSP-enforcing check, `change-login-password.spec.js`'s friendly-message
check, and `offline-unlock.spec.js` (still carries a `test.fail()`
annotation from before its fix was deployed - remove it once confirmed
passing for real). Expect close to 16/16 clean; anything still red is a
real, new finding worth investigating rather than an artifact of the
undeployed state.

## Restyle the UI - visual pass done (2026-08-25)

The open question above ("token pass or structural rework?") was settled
as **a design-token pass plus component-level restyling, no structural
rework** - navigation, view flow, and every piece of copy are unchanged.
Scope was explicitly *visual only*; UX was deferred by the user to a
separate pass (see the next section).

**What landed:**

- **New `web/src/app.css`** - the first shared stylesheet in the project,
  imported from `main.js`. Holds design tokens (an elevation ladder of
  surface colours, a teal accent, semantic danger/warn/success triples, a
  4px spacing grid, a 5-step type scale, radii, shadows, a focus ring) plus
  base styling for `input`/`textarea`/`button`/`hr` and the shared
  `.error`/`.notice`/`.success`/`.field` blocks.
- **De-duplication was most of the work.** The same button rule was
  written nine times across components and the `.error` box six times, and
  they had already drifted - buttons were `0.6rem/1rem` in the auth forms
  and `0.3rem/0.85rem` inside a vault entry, with no shared idea of a
  spacing or type scale. Those copies are deleted; components now hold
  only their own layout.
- **Button variants** (`.primary`, `.danger`, `.ghost`, `.link`,
  `.compact`) replace nine visually identical buttons per screen, so each
  view now has exactly one obvious primary action.
- **Real focus states.** Nothing styled `:focus` before - the app relied on
  the UA default, which is close to invisible on a dark background. Now
  one `:focus-visible` ring, defined once.
- **Touch targets**: controls have a 44px minimum height (`.compact` is
  36px where a full-size control would out-weigh the content it acts on),
  which is the "broader mobile/touch-target pass" the old note asked for.
- **Component-level restyling**: auth views share one elevated card; the
  Show/Hide toggle now sits *inside* the password input instead of beside
  it; vault entries are cards with a rotating disclosure caret rather than
  hairline-separated rows; the vault toolbar is sticky (so "Save vault"
  can't scroll away) with "Unsaved changes" as a status pill; the Recovery
  Key gets the strongest treatment in the app (brand-tan on a sunken
  panel, monospace, tracked, `user-select: all`); the generator's password
  preview is accent-coloured and its checkboxes are a 2-column grid.
- **Canvas colour changed** to `#0f1317`. Kept in sync in all three places
  it appears: `--ss-canvas` in `app.css`, the `theme-color` meta in
  `index.html`, and `theme_color`/`background_color` in `vite.config.js`'s
  PWA manifest - a mismatch there shows as a visible seam above an
  installed PWA on launch.

**CSP constraints this had to respect** (worth knowing before the next
styling change): the deployed policy is `style-src 'self'` and
`font-src 'self'` with no `'unsafe-inline'`. So no external webfonts (the
system stack is used), and **no `style=""` attributes in markup** - they
would be blocked outright. Dynamic sizing must go through the CSSOM
instead, the way `ResizableTextarea.svelte` already sets
`el.style.height`. Verified against the built output, not assumed: `npm run
build` emits an external `<link rel="stylesheet">` and zero inline
`<style>` blocks, and there are no `style="` attributes anywhere in
`web/src`.

**Verified**: `npm test` 97/97, `npm run build` clean with no unused-CSS
warnings, and the login/signup/forgot-password/vault views driven in a
headless Chromium at both 900px and 390px wide with no console errors.
Two defects were found that way and fixed rather than shipped - vault
entry summaries were centre-aligned (the shared `button` rule's
`justify-content: center` leaking into the disclosure row) and the
add-entry card was narrower than the entry list above it.

- [ ] **Not visually verified: the signup Recovery Key screen.** It's the
      one view that can't be reached without completing a real signup
      against the live pool, so its restyle (the brand-tan key panel and
      the "I've saved this" checkbox card) has only been checked by build
      and code read. Worth a look on the next real signup run-through.
- [ ] **Not verified on real hardware.** Everything above is headless
      Chromium at two viewport widths - no real phone, no Safari/Firefox.
      Fold into the existing manual-verification list further down this
      file rather than treating it as separate work.

## UX pass - first slice done, not committed, not deployed (2026-08-26)

Two specific asks, both done: **dismissible message boxes**, and **more
explanation of how the app works** (starting with the two-password model,
which was singled out as unclear to a non-technical user).

⚠️ **Uncommitted and undeployed by request.** The visual restyle above is
committed (`27c8ae8`); everything in this section is working-tree only.

**Three new components:**

- **`Alert.svelte`** - one message box for errors, notices and
  confirmations, replacing three near-identical copies that had drifted.
  Adds a close button, a per-variant icon, and the right ARIA role
  (`alert`/assertive for errors, `status`/polite for the rest).
  Two deliberate rules, both following how mainstream apps behave:
  - **Dismissal is parent-owned.** The component has no internal "hidden"
    flag - it calls `ondismiss` and the parent clears the state rendering
    it. Had it hidden itself, the *next* error with the same text would be
    swallowed: still hidden, while the parent believed it had shown
    something.
  - **A message with no `ondismiss` renders with no close button**, for
    conditions a user can't acknowledge away ("You're offline" - closing it
    wouldn't make it false). Errors never auto-dismiss; the one success
    confirmation (vault saved) auto-retires after 4s *and* can be closed.
- **`TwoSecretsExplainer.svelte`** - the "why two passwords?" answer in
  plain language: what each one does, why the split makes the vault private
  even from whoever runs the server, and the consequence that matters most
  (a forgotten Master Password cannot be reset by anyone). Progressive
  disclosure, matching 1Password/Bitwarden's handling of their equivalent
  account-password-plus-Secret-Key problem: **collapsed** on sign-in, where
  a returning user doesn't need it re-explained daily, **open** at signup,
  where it's first contact and the choice is irreversible. Native
  `<details>`/`<summary>` - keyboard/screen-reader accessible for free, no
  inline styles (which the CSP forbids).
- **`PasswordRequirements.svelte`** - live checklist ticking off as you
  type, replacing "submit, get rejected, work out which part failed."

**Rules moved into `policy.js` as data**, not a regex.
`LOGIN_PASSWORD_RULES` (+ `validateLoginPassword`, same message as before -
`signup-negative.spec.js` asserts on the "12+ characters" substring) and
`MASTER_PASSWORD_RULES`. The checklist and the submit-time rejection now
read the same list, so they can't disagree - **6 new tests** cover exactly
that, including one asserting each rule fails in isolation so no rule is
dead or duplicating another. Still mirrors the Cognito pool policy in
`SmallstashStack.java` **by hand**; nothing enforces that.

**`ChangeLoginPasswordForm` deliberately still has no blocking pre-check** -
only the non-blocking checklist. `change-login-password.spec.js` depends on
a weak password reaching Cognito so its compromised-credential screening
answers. Adding a client-side gate there would have broken that spec and
weakened the check.

**Accessibility fix, found by trying to break it.** Fields wrapped their
inputs in `<label>`, which makes the *whole* label subtree the input's
accessible name - so PasswordField's "Show" button and every word of hint
text got announced as part of the field's name. Adding hints made it much
worse, and it showed up concretely: a new hint ending "…reset by email"
made the login-password field also match `getByLabel('Email')`, which would
have broken the specs. Now explicit `for`/`id` + `aria-describedby`
(`$props.id()` for collision-free ids - load-bearing where both
change-password panels can be open at once), so the accessible name is the
label text and nothing else. The `✕` glyph on the close button became an
SVG for the same class of reason: it was leaking into `textContent`, which
`change-login-password.spec.js` reads.

**Other explanations added:** what "Forgot password" does *not* reset;
what changing the Master Password does and doesn't touch (the Recovery Key
survives); that verification emails often land in spam (a known, tracked
deliverability problem, see below); why offline unlock needs only one of
the two secrets; concrete places to keep the Recovery Key; and that nothing
leaves the browser until "Save vault" is pressed.

**Verified**: `npm test` **103/103** (97 + 6 new), `npm run build` clean, no
inline `<style>` or `style=""` in the output (CSP still satisfied), and a
script replicating **every** `getByLabel`/`getByRole` selector the e2e suite
uses, asserting each resolves to exactly one element - all pass against the
running app. Alert variants and the checklist confirmed by headless
screenshot.

**Follow-up fixes in the same slice (2026-08-26), also uncommitted:**

- **Only one settings panel can be open at a time.** Reported: opening
  "Change Master Password" and then "Change Login Password" left both
  expanded, pushing the second panel below the fold with nothing on screen
  to suggest it had opened - it read as the button doing nothing. Fixed by
  replacing the two independent booleans with a single
  `openPanel: 'master-password' | 'login-password' | null`, which makes
  both-open *unrepresentable* rather than something every future toggle has
  to remember to prevent. The toggles also gained `aria-expanded`.
  Verified by driving the real component: open A, open B, assert A is gone
  and A's `aria-expanded` flipped to `false`, then the reverse, then that
  re-clicking the same button closes it.
- **"Sign out" is now the danger-outline variant.** It's the only control in
  the toolbar that ends the session and, with unsaved changes, can lose work
  (hence its `confirm`). Outline rather than solid red on purpose: a filled
  danger button sitting next to the primary "Save vault" would fight it for
  attention on a screen where signing out is the rarest action.

- [x] **Duplicate accessible names - fixed (2026-08-26).** Found while
      testing the panel change: the toolbar's "Change Master Password"
      *toggle* and that panel's *submit* button had byte-identical
      accessible names, so `getByRole('button', …)` was ambiguous (a
      Playwright strict-mode violation) and a screen reader announced two
      different actions identically.
      **Fixed by making the copy actually different**, not by scoping the
      query: submit buttons now read **"Update Master Password"** /
      **"Update login password"** against the toolbar's "Change …" toggles.
      This also retires the fragile trick the login pair depended on -
      `change-login-password.spec.js` used to tell them apart by
      *capitalisation alone* ("Change login password" vs "Change Login
      Password"), which was one styling tweak away from breaking silently.
      **`e2e/change-login-password.spec.js` was updated to match** (it now
      clicks "Update login password") - the only spec that referenced the
      old string.
      Auditing for the same defect class turned up more of it, all fixed the
      same way (visible text unchanged, `aria-label` carries the context):
      - Every `PasswordField` toggle was just **"Show"**, so a form with four
        password fields had four identically-named buttons. New optional
        `fieldName` prop → "Show new Master Password", "Show current login
        password", and so on.
      - The add-entry form and an entry's edit form are **both on screen at
        once**, and each had a "Show", a "Generate" and a Notes resize
        handle - three collisions whenever any entry was being edited. Now
        named per context ("Generate a password for GitHub" vs "…for the new
        entry"); `ResizableTextarea` grew a `label` prop for the same reason.
      - Per-entry "Delete entry" → "Delete GitHub", so it doesn't repeat
        across rows now that its siblings are entry-named.
      **Verified** by driving the real component and asserting *no two
      buttons anywhere on screen share an accessible name*, in each state:
      master panel open, login panel open, and an entry being edited
      alongside the add form. Zero duplicates in all three.
- [x] **`Alert.svelte` reactivity bug - fixed before it shipped.** `role`
      was a plain `const` reading the `variant` prop, which captures it once
      and never updates (Svelte's `state_referenced_locally` warning - I
      initially mistook it for grep noise in the build output). Every caller
      passes a fixed variant so it worked by luck; now `$derived`. The build
      is warning-free again, which is the check that would have caught it.

- [ ] **Run `npx playwright test` before committing this.** The selector
      check above is a good proxy but not the suite itself; the specs that
      need real credentials (login-authenticated, change-login-password,
      offline-unlock) were not run.
- [ ] **Consider whether the two-password explainer belongs on the sign-in
      screen at all** once a user is past onboarding. It's collapsed, so
      it costs one row - but the honest alternative is showing it only at
      signup and from a help link.

## Reorder vault entries by dragging (2026-08-26)

Requested: hold and drag an entry to move it up or down the list - long-press
on touch, press-and-drag with the mouse.

**This needs no backend or database change.** That was the open question when
it was raised, and the answer is no - checked against the code rather than
assumed:

- `vaultDocument.entries` is a plain **JS array**, and `crypto/vault.js`'s
  `encryptVault` persists the vault as `JSON.stringify(vaultDocument)`. JSON
  arrays are ordered, so **array position already *is* the stored order** -
  it round-trips through save/load today without anything being added.
- The backend never sees entries at all. `VaultController` takes a single
  `ciphertextBase64` string, size-checks it, and hands the opaque bytes to
  S3 (`S3VaultRepository`). It cannot parse, index or order vault contents -
  that's the zero-knowledge guarantee, not an implementation gap. There is
  no per-entry row anywhere to add a `position` column to.

So this is entirely client-side: reorder the array, mark the vault dirty,
and the existing "Save vault" writes the new order like any other edit.

- [x] **Implemented (2026-08-26), uncommitted.** Entirely client-side, as
      predicted above - not one line of backend or infra changed.

**How it works:**

- **`lib/reorder.js`** holds the two pure functions: `moveItem` (splice-out /
  splice-in, always returning a **new** array) and `dropIndexFor` (which row
  index a pointer position implies). Kept out of the components because the
  index arithmetic is the part that's easy to get subtly wrong - especially
  moving an item *down* past its own vacated slot - and this way it's
  testable without a DOM or a gesture. **15 new tests** (118 total).
- **Pointer Events, not HTML5 drag-and-drop**, so it works on touch at all,
  with `setPointerCapture` so a fast drag can't escape the handle - the same
  pattern `ResizableTextarea.svelte` already uses.
- **A dedicated drag handle, and no long-press timer.** The earlier note here
  assumed dragging the whole row, which would need a long-press on touch to
  be distinguishable from scrolling. A handle *is* that disambiguation, and
  it also avoids colliding with the row's existing tap-to-expand. The handle
  carries `touch-action: none` (without it the browser claims the gesture for
  scrolling and never sends `pointermove`), scoped to the handle so the rest
  of the row still scrolls normally.
  **Deviation from the request worth flagging**: this is left press-and-drag,
  not the right-click-and-hold that was asked for. Right-press-drag is a very
  unusual binding and would have to suppress the context menu; a handle is
  the convention and satisfies "hold and move" without either problem.
- **Keyboard reordering** via arrow keys on the focused handle - drag-only
  would be unusable without a pointer. Moves are announced through an
  `aria-live` region, since reordering has no other confirmation.
- **Escape cancels an in-progress drag** and restores the original order.
- The list reorders **live** under the pointer rather than computing a final
  position on release, so what you see is what will be committed. Order is
  persisted by the ordinary "Save vault" - reordering goes through the same
  `vaultDocument.entries = [...]` reassignment as every other edit, so
  `dirty` and the unsaved-changes guards pick it up for free.
- The handle is hidden entirely when there's only one entry.

**Two real bugs found by driving it in a browser, not by inspection:**

- ⚠️ **The whole list jumped ~48px the moment a drag started.** Reordering
  makes the vault dirty → the "Unsaved changes" pill appeared → the sticky
  toolbar wrapped to a second line → every row shifted down out from under
  the pointer, and the drag couldn't reach further than one position. This
  was **not only a drag bug**: the same jump happened on *any* first edit,
  including typing into the add-entry form. Fixed at the cause - the pill is
  now always rendered with its width reserved (`min-width`) and only its
  *text* toggles, so the toolbar's height no longer depends on dirty state.
  Keeping the text (rather than the element) conditional preserves the
  `role="status"` announcement.
- ⚠️ **Keyboard reordering only worked once.** The each block is keyed by
  `entry.id`, so the row's DOM node survives a move - but *moving* a focused
  element still blurs it, so every arrow press after the first went to
  `<body>` and did nothing. Fixed by re-focusing the same node after `tick()`.

**Verified** by driving the real component in headless Chromium: drag down,
drag up, live preview mid-drag, Escape-cancels-and-restores, dirty state set
on reorder and *not* set after a cancel, keyboard arrows in both directions
including the no-op at the ends, focus surviving a keyboard move, the
`aria-live` announcement text, a genuine **touch** drag via CDP
`Input.dispatchTouchEvent` (which is what proves `touch-action: none` is
right), and the handle disappearing at one entry. All pass; `npm test`
118/118; warning-free build.

- [ ] **Not verified on real touch hardware.** The touch path is synthesized
      CDP events, which exercises the code but not a real finger on a real
      phone - the same caveat as the Notes resize handle above. Worth
      checking the handle is comfortably grabbable at 36px.

## UX pass - remaining, not started

The items below were **not** touched by the slice above.

- [ ] **Do the rest of the UX pass.** Things visible from the work so far:
      - **No search or filter over entries**, and no sort - the vault is
        whatever order entries were added in. Fine at three entries,
        not at fifty. This is the single biggest one.
      - **Saving is manual and easy to lose.** "Save vault" is a discrete
        button; unsaved edits are guarded only by a `beforeunload` prompt
        and a sign-out `confirm()`. The sticky toolbar makes the button
        reachable, which is a paint fix for a behaviour question that
        remains open (autosave? save-on-blur? leave it explicit?).
      - **Destructive and confirmation dialogs are native `confirm()`**
        (delete entry, sign out with unsaved changes) - functional, but
        unstyleable and inconsistent with everything around them. Now the
        *only* remaining un-restyled UI surface, since every inline message
        went through `Alert.svelte`.
      - [x] ~~**Add-entry is a permanent form at the bottom of the list**~~ -
        **done 2026-08-27 (uncommitted).** It's now a collapsible panel behind
        a "New entry" toolbar button, joining the same one-at-a-time
        `openPanel` model as the two change-password panels and Export, so
        opening any one closes the others. Reading existing entries is the
        common visit, and a permanently expanded form made every session look
        like it was asking you to create something.
        Details worth knowing: the form moved **above** the entry list so it
        renders directly under the button that opens it (the two
        change-password panels already taught that a panel opening far from
        its trigger reads as nothing having happened); the toolbar button is
        **"New entry"** while the submit stays **"Add entry"**, deliberately
        distinct accessible names after the duplicate-name work; the panel
        **collapses after a successful add** (one line in `addEntry` to flip
        if batch-adding turns out to be common); and half-typed input
        survives switching to another panel and back, because the field state
        lives in `VaultView` rather than in the removed DOM.
        `login-authenticated.spec.js` and `offline-unlock.spec.js` both
        asserted the heading "Add entry" was visible after unlock - they now
        assert the "New entry" **button** instead, since the form is no longer
        on screen by default.
      - **Error messages are raw `err.message` in several places** (see
        `errors.js`'s `friendlyAuthErrorMessage` for the pattern that
        exists but isn't applied everywhere). Unchanged by the slice above -
        those messages are now *dismissible and better presented*, but the
        wording is still whatever the underlying error said.
      - **Field-level validation feedback is still form-level** - errors
        appear in one box at the top rather than against the field that
        caused them. Partly mitigated for passwords by the live checklist,
        which turns the most common case into guidance before submit; the
        mismatch/duplicate-secret errors are still top-of-form. Overlaps
        with the already-tracked "UI input validation review" item below;
        do them together.

## Notes field resize handle unusable on Android - fixed (2026-08-25)

Reported: the native `<textarea>` resize corner (bottom-right, drag to
resize) was "almost a dot" on an Android phone - not a CSS sizing tweak
away, since the browser draws that handle itself and mobile Chrome renders
it near-invisibly.

Fixed with a custom, oversized resize affordance instead of relying on the
native one: `web/src/lib/components/ResizableTextarea.svelte` turns off
`resize` on the `<textarea>` and adds a 32x32px handle driven by Pointer
Events (one implementation covers mouse/touch/pen), using pointer capture
so a fast drag can't "escape" the small handle mid-gesture on a touch
screen. Wired into both places a Notes field exists - `VaultView.svelte`'s
add-entry form and `EntryListItem.svelte`'s edit form.

32px was a deliberate compromise, not the ideal 44-48px Android/iOS touch
target guideline - a full-size handle would eat into the textarea's own
corner, where a user legitimately wants to place their text caret.

- [ ] **Verify on a real Android device** - build/tests verified clean
      (97/97, `npm run build`), but this is exactly the class of bug that
      only really shows up on real touch hardware. If 32px still isn't
      comfortable to grab, size it up.

## Export secrets feature - implemented 2026-08-26 (uncommitted)

Every open question below is now settled: **plaintext CSV**, gated behind an
explicit acknowledgement, all core fields, entirely client-side.

**Sequencing note**: export was deliberately built *before* file attachments,
on the reasoning that (a) it needs no backend or infra change at all while
attachments need both, (b) building it first means file-export later extends
a working exporter rather than writing one under pressure, and above all
(c) `RemovalPolicy.DESTROY` means there is no server-side recovery path, so a
working export is the only backup this app can have - and it's wanted
*before* the storage model changes under it, not after.

**What was built:**

- **`lib/export.js`** (pure, 18 tests): RFC 4180 CSV with CRLF endings,
  quote-when-needed escaping, doubled inner quotes, and correct handling of
  the case that actually bites - multi-line Notes, which must not split a
  record. Emits a UTF-8 BOM, because Excel assumes the legacy system codepage
  for a BOM-less CSV and mangles every non-ASCII character. Filename uses the
  **local** date, not `toISOString()`, so an evening export in UTC+2 isn't
  stamped tomorrow.
- **`lib/saveFile.js`**: `showSaveFilePicker` when available, `<a download>`
  otherwise, feature-detected rather than UA-sniffed. Dismissing the picker
  rejects with `AbortError` and is treated as a **cancellation, not a
  failure**. The writable is closed in a `finally`, so a mid-write error
  can't leave a zero-byte file holding the name the user chose.
- **`ExportPanel.svelte`**: opens from the toolbar via the existing
  one-panel-at-a-time model. Warning styled as an *error* box rather than a
  notice - this is the one action that removes every protection the rest of
  the app provides - plus a "what gets exported" summary and a checkbox gate
  (same pattern as the signup Recovery Key, for the same reason). Afterwards
  it reminds the user the file is unprotected.

**Decisions worth not re-litigating:**

- **Formula injection is deliberately not mitigated.** A field starting `=`,
  `+`, `-` or `@` can be evaluated by Excel/Sheets. The standard fix is to
  prefix with an apostrophe - but that *changes the exported password*, and
  silently returning a wrong password is a worse failure for a password
  manager than a spreadsheet quirk. Values export verbatim; the panel says to
  prefer a text editor. Same call Bitwarden and 1Password make.
- **Artifacts are a list, not a single file**, even though there's exactly
  one today. When attachments land an export becomes "a CSV plus N files" and
  the writer switches to a directory picker or an archive - the seam exists
  so that's additive.
- **Mobile gets no destination picker, by decision.** `showSaveFilePicker` is
  Chromium-desktop only - not Firefox, not Safari, and **not Chrome for
  Android** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker),
  [Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)).
  Agreed behaviour: picker on desktop, straight to Downloads on Android. The
  panel's copy changes to match which one the browser will actually do.

**Verified** in a real browser, both paths: the download fallback (bytes read
off the actual download, BOM present, quoting/unicode/multi-line notes byte-
exact), the picker path against a stubbed API (content, `suggestedName`,
stream closed), cancellation showing a notice and *no* error, a genuine
failure still surfacing as an error, the acknowledgement gate, and Export
closing when another panel opens. `npm test` **136/136** (118 + 18 new), warning-free build.

**CSP checked, not assumed**: the `<a download href="blob:…">` fallback was
run under the deployed policy injected as a meta tag - the download starts
and produces **no `blob:` violation**, so `default-src 'self'` doesn't block
it. (The `style-src-elem inline` reports seen during that run are Vite's
dev-server style injection plus the harness's own `<style>`; the production
build was re-confirmed to emit zero inline `<style>` and an external
stylesheet.)

### Mobile CSV viewer mojibake - diagnosed and half-fixed (2026-08-26)

Reported after the first real use: on desktop the export is fine, but a
mobile CSV app showed the header as `ï»¿title` and a password `haha-lolф` as
`haha-lolÑ`. Same file on Windows was correct.

**Diagnosis, confirmed by reproducing both symptoms byte-for-byte rather than
inferred**: that app decodes the file as **Latin-1/Windows-1252** and ignores
UTF-8 entirely.

- `ï»¿` is exactly the UTF-8 BOM bytes `EF BB BF` read as Latin-1
  (`EF`→`ï`, `BB`→`»`, `BF`→`¿`).
- `ф` is UTF-8 `D1 84`; as Latin-1 that's `Ñ` plus an invisible control byte -
  precisely the reported `Ñ`.

**Fix: the BOM is now a checkbox** ("Add a compatibility marker for Microsoft
Excel"), defaulting to *on* where a save picker exists (desktop) and *off*
where it doesn't (mobile). A CSV carries no way to declare its own encoding -
the `charset` in the MIME type is gone the moment the bytes are on disk - so
Excel-on-Windows and BOM-unaware readers want genuinely opposite things and
there is no single output that satisfies both. Hence a user-visible choice
rather than a guess, with the copy describing the symptom (`ï»¿`) rather than
the jargon.

⚠️ **This only fixes half of it, and the limit is worth recording.** Verified
explicitly: with the BOM off, the header reads `title` even in Latin-1 - but
`ф` is *still* mangled to `Ñ`, because the app is not decoding UTF-8 at all.
**Nothing this app can write to a `.csv` fixes that** short of refusing to
export non-ASCII, which would be worse. The remedy is a reader that honours
UTF-8 (Google Sheets, or a text editor that lets you pick the encoding). If
this keeps biting, the real options are a JSON export (still no help against
a hard-coded Latin-1 reader) or naming the file `.txt` to steer it toward a
text editor - neither is obviously worth it for one viewer.

- [ ] **Not verified**: a real save dialog on a real desktop browser (the
      picker path was exercised against a stub, since headless can't show the
      dialog), and a real Android download. **Also unverified: whether
      turning the marker off actually makes that particular mobile app happy
      about the header** - the byte-level behaviour is proven, the app's
      reaction to it is not.
- [ ] **Re-import is not built and not planned yet.** The export is one-way.
      If it should ever round-trip, the CSV needs a decision about entry ids
      (currently excluded - they're internal) and about merge-vs-replace.
## UI theming nod to the name's origin - done (2026-08-24)

"smallStash" was inspired by the "Small Stash" storage item from the game
Rust ([wiki.facepunch.com/rust/item/stash.small](https://wiki.facepunch.com/rust/item/stash.small) -
a hidden, buried cloth pouch you dig up to retrieve your loot).

Went with the "full illustrated nod" option, then simplified: first pass
had `web/public/icon.svg`/`icon-maskable.svg` show a tan pouch tied with
rope, half-buried in a dirt mound, with a small teal keyhole accent (a
holdover from the old plain-padlock icon). The dirt mound read as
cluttered/unclear at actual favicon size, so the tab/PWA icon was
simplified to just the tied pouch (no mound, no keyhole) - the same
glyph `App.svelte`'s header `<h1>` already showed next to the "Small
Stash" text, now kept in sync between the two rather than being two
different designs. Header glyph still has its hover tooltip explaining
the reference. Deliberately did **not** touch functional/error copy
elsewhere (offline banner, lock messages, etc.) - kept the nod contained
to the icon/logo mark rather than sprinkling "buried" language through
security-critical text where clarity matters more than a joke.

Verified via headless-browser screenshot (both the full `/icon.svg` and
the header glyph render as intended, no console errors); `npm test`
90/90, `npm run build` clean.

## Document/attachment feature for secrets entries - requirements unclear (2026-08-24)

Idea: let a vault entry hold a document/file attachment (e.g. a scanned
ID, a recovery-codes printout), not just text fields. Raised in
conversation only - not scoped yet.

### 📋 Full plan: [file-storage-plan.md](file-storage-plan.md) - 9 of 10 questions answered 2026-08-27

A deep read of the existing backend, infra and client, plus the architecture
this feature needs. **Nothing is implemented.** The user answered nine of the
ten open questions in the same session; one remains, below. Read the plan doc
before starting - the headlines, updated for the answers:

- Files cannot go through the API at all. **Lambda's synchronous payload limit
  is 6 MB and API Gateway's is 10 MB** (verified, not assumed), and Micronaut
  here is set to 1 MB with Base64 inflating bodies by a third. The browser
  must upload **directly to S3 via presigned URLs**; the backend only mints
  them. **Presigned POST**, agreed - its signed `content-length-range` is the
  only variant where the *server* can enforce a size limit it didn't carry the
  bytes for. **Neither PUT nor POST is single-use** - checked against AWS's
  own docs, a presigned URL is reusable for its full lifetime by design; the
  real boundary is a short TTL, not one-time use.
- Files are **standalone documents** (decision 4), not attached to entries -
  own "Files" tab in the UI. That means they don't need a foothold in the
  vault blob at all: proposed a **second encrypted index blob**,
  `files-index.json.enc`, mirroring `vault.json.enc`'s GET/PUT pattern
  exactly. **The existing vault blob and its 512 KiB cap are untouched by this
  feature.**
- Per-file data key, **wrapped by the Vault Key, not the Master Key** - so
  changing the Master Password (which only re-wraps the Vault Key) doesn't
  have to re-wrap every file, and the Recovery Key reaches files for free.
- **Separate, unversioned bucket** (decision 6) - and unversioned turns out to
  matter beyond "less coupling": versioning would fight "deletion means
  deletion" (decision 5), so the new bucket gets `s3:DeleteObject` scoped to
  `users/*/files/*` with none of the `DeleteObjectVersion` concern that keeps
  the *vault* bucket's Lambda role without delete permission. The vault
  bucket's IAM is untouched.
- Two infra gaps that will look like bugs if missed: the new bucket needs its
  own **CORS configuration**, and the CSP's `connect-src` needs the new
  bucket's S3 origin added. Either one missing makes uploads fail looking like
  a network error rather than a policy error.
- **Quota enforcement comes back**, against the agreed ~500 MB/user (decision
  2). It was dropped from Phase 1 because storage was bounded at ~2 MB by the
  vault cap alone - false the moment files exist.
  `UserProfile.storageBytesUsed` already exists in the model, unused.
- **No `cdk destroy` required** (decision 9 resolved) - a new bucket, new IAM
  statements on the existing role, and new routes are all additive
  CloudFormation changes, deployable the same way the frontend-only work has
  shipped so far.
- **Export gets extended to include files, plaintext** (decision 8) -
  `buildExportArtifacts` already returns a list specifically so this would be
  additive; that moment has arrived.

### ⚠️ Correction (2026-08-27): the plan's Lambda-count reasoning was built on a wrong claim

The earlier version of this section, and of file-storage-plan.md §1/§3a, said
"there is no API Gateway authorizer in this stack." **That was wrong** - the
stack already has `HttpUserPoolAuthorizer` set as `HttpApi`'s
`.defaultAuthorizer()` (`SmallstashStack.java`), live and deployed. Every
request is already validated against Cognito by API Gateway before any Lambda
runs; `micronaut-security-jwt` re-checks in-Lambda too, deliberately, as
defense-in-depth on top. The plan doc's §1 table and §3a are corrected in
place, not left stale - see there for the full rewrite.

### ✅ Phase 0.5 done 2026-08-27 - Maven restructured, zero behaviour change

On branch `feature/file-storage` (created 2026-08-27 off `master`, per the
user's instruction to keep this whole feature isolated until it's polished
- see file-storage-plan.md's top for branch policy). Uncommitted.

`common`/`vault-lambda`/aggregator-root split done, `CurrentUser` and the
`ResourceNotFoundException` family moved into `common` with git history
preserved (`git mv`, confirmed as renames not delete+add). Verified as a true
zero-behaviour-change refactor, not just "it compiled": the final shaded
jar's class list diffs byte-for-byte identical against a pre-restructuring
baseline build (21,266 classes, zero-line diff), three individual class
files hash identical before/after including one from the moved module, and a
clean local CDK synth shows the `BackendFunction`'s handler/runtime/memory/
timeout/env-vars unchanged - only the asset hash differs, as expected for a
rebuilt zip. Full method and evidence recorded in
[file-storage-plan.md](file-storage-plan.md) §10 rather than duplicated here.

`files-lambda` was deliberately **not** created in this step - no code for
it yet, and wiring an empty module's `Function` into the stack is Phase 1
scope. `SmallstashStack.java`'s jar path and `CLAUDE.md`'s repo map/cheat-
sheet were updated in the same change rather than left stale.

**Correction (2026-08-27, post-Phase-4)**: this originally said `mvn test`
wasn't run because Docker was unavailable, checked via `docker info`. That
check was a false negative - `docker` just isn't on this shell's `PATH`,
which isn't the same as the engine being unreachable. `./mvnw test` (the
actual check) reaches it fine and passes: `Tests run: 5, Failures: 0,
Errors: 0, Skipped: 0` - both pre-existing LocalStack-backed tests.

Not done: no `cdk deploy` (needs explicit per-instance confirmation
regardless of how much local verification precedes it, per standing project
rules).

### ✅ Phase 1 done 2026-08-27 - files backend + infra, with one significant correction

Same branch, still uncommitted. New `files-lambda` module (mirrors
`vault-lambda`'s patterns deliberately - `FilesIndexController`/
`S3FilesIndexRepository` are a close copy of `VaultController`/
`S3VaultRepository`), new `FilesBucket` (unversioned, CORS, a lifecycle rule
expiring abandoned `state=pending` uploads after 1 day), new `FilesFunction`
with its own execution role, new `/files-index`/`/files`/`/files/{id}/commit`/
`/files/{id}` routes.

⚠️ **The plan's upload mechanism didn't survive contact with the actual
SDK.** §3 called for presigned **POST** specifically for its
`content-length-range` server-side size enforcement - but **AWS SDK v2's
`S3Presigner` turns out to have no presigned-POST support at all**,
confirmed by listing every class in the SDK's own
`presigner.model` package rather than assumed. Hand-rolling AWS's raw
POST-policy SigV4 signing was deliberately not attempted - too easy to get
subtly wrong, with no live AWS or LocalStack available here to verify it
against. **Shipped instead: presigned PUT**, with size/quota enforcement
moved to `commit` time (checked against what S3 actually received, not what
the client declared - oversized or over-quota objects get deleted
immediately rather than accepted then left in place). Real enforcement,
just after the fact rather than before it. Full record, including the exact
evidence and the ordering puzzle this also created for the CSP/CORS
construction sequence, in
[file-storage-plan.md](file-storage-plan.md)'s "Phase 1" section - not
duplicated here.

Also resolved during implementation: the plan named DynamoDB's
`UserProfile.storageBytesUsed` for quota, in tension with `files-lambda`
having zero DynamoDB access. Resolved in favour of the stronger, more
specific decision - usage is computed **live** via `s3:ListBucket` over each
user's prefix, no ledger to keep in sync, one new IAM action not in the
original §8 enumeration.

**Verified**: all three backend modules build together; `vault-lambda`'s
shaded jar is still byte-for-byte identical to the Phase 0.5 baseline
(confirming Phase 1 didn't disturb it); `files-lambda`'s jar has its Lambda
entry point and every bean's generated definition present; a clean local
synth's template was read directly to confirm the bucket config, the new
role's exactly-three-statements policy (no DynamoDB, no reference to
`VaultBucket` anywhere), every new route's authorizer wiring (inherited
automatically from `HttpApi`'s existing default, zero per-route code -
exactly what the §3a spike predicted), the CORS methods, and the CSP.
`BackendFunction`'s own policy was independently re-checked as unchanged.

**Correction (2026-08-27, post-Phase-4)**: same wrong "Docker unavailable"
claim as Phase 0.5's, corrected there. What was actually true at the time,
and a real, separate gap: `files-lambda` had zero test files - not blocked
by Docker or anything else, never written. **Closed the same day**: three
new LocalStack integration test classes, mirroring `vault-lambda`'s existing
pattern (`@MicronautTest`, `@Inject` the real bean, LocalStack via
Micronaut's test-resources service) rather than inventing a new one -
`S3FilesIndexRepositoryTest` (get/put round-trip, overwrite-not-append,
not-found), `FilesUsageServiceTest` (summation, prefix-scoping so one user's
usage never counts another's, pending-tagged objects still counting), and
`FilesControllerTest` (mint's size-cap pre-check, commit's real HeadObject-
based size enforcement **with a real 26 MiB oversized object**, the tagging
flip to `live`, delete's idempotency). The ~500 MiB user quota's overflow
branch is *not* exercised with real bytes - would mean actually storing that
much data in LocalStack per test, impractical weight for a fast suite,
documented as such rather than silently skipped; `FilesUsageServiceTest`'s
summation coverage is the closest practical substitute. `./mvnw test`:
**20/20** (5 pre-existing `vault-lambda`, 15 new `files-lambda`),
`BUILD SUCCESS`.

Not done: no `cdk deploy` (needs explicit confirmation, not requested yet).

### ⚠️ Real `cdk deploy` circular-dependency failure, fixed 2026-08-27 - and a verification-strength lesson

A real `cdk deploy` (run by the user) failed at changeset creation:
`Circular dependency between resources`, listing ~35 resources. Genuine
CloudFormation-level cycle, not a Java ordering bug: `SiteSecurityHeaders`'
CSP named `filesBucket.getBucketRegionalDomainName()` exactly, making
`SiteDistribution` depend on `FilesBucket`; `FilesBucket`'s own CORS rule
already depended on `SiteDistribution`'s domain name the other way. Two
resources needing each other, pulling in nearly the whole stack.

**Neither local synth (`CDK_OUTDIR=... exec:java`) nor the real `cdk synth`
CLI catches this** - confirmed directly, `cdk synth` exits 0 with the bug
still present. The check only runs at `cdk deploy`'s changeset step. Every
"local synth confirms X" claim across the file-storage phases was true as
far as it went, but wasn't strong enough to catch a cross-resource cycle -
worth remembering for anything that references another construct's token
going forward.

**Fixed** the same way the CSP already handles the API Gateway endpoint for
the identical reason: wildcarded (`*.s3.<region>.amazonaws.com`) instead of
naming `filesBucket`'s domain exactly, removing the token reference that
created the cycle. The other edge (`FilesBucket`'s CORS needing the real,
exact distribution origin) was deliberately left alone - broadening that
one would be an actual security loosening, not a false economy like the
already-accepted wildcard tradeoff on the CSP side.

**Verified without deploying** (still needs separate explicit confirmation):
read the synthesized template's resource graph directly - confirmed the CSP
is now a plain string with no reference into `FilesBucket`, confirmed
`FilesBucket`'s CORS still correctly references `SiteDistribution`, and
walked every resource for any remaining reference either direction -
found none. Full record in
[file-storage-plan.md](file-storage-plan.md)'s "Phase 1 addendum #2".

Not done: an actual `cdk deploy` to confirm this resolves the real
changeset error, not just the template graph.

### ✅ Live `s3:ListBucket AccessDeniedException` on `FilesFunction`, root-caused and fixed (2026-08-27/28)

The circular-dependency fix above deployed successfully, but the very first
live use of `FilesFunction` failed with `s3:ListBucket AccessDeniedException`,
reproduced multiple times.

**Extensive elimination, with the user's help granting `smallstash-deployer`
temporary read-only IAM diagnostics** (reverted after use) ruled out: policy
drift (`cloudformation get-template` byte-identical to the Console view),
the `s3:prefix` condition itself (`iam:simulate-principal-policy` with the
real-shaped value returned `allowed`), a permissions boundary, hidden/extra
policies, Service Control Policies (account isn't in an Organization at
all), and `FilesBucket`'s own bucket policy (no `Deny`, doesn't even
reference this role).

**Everything IAM-observable said this should work; it didn't, live.** A
temporary diagnostic log line in `FilesUsageService.currentUsageBytes()`
(since removed - see below) plus **CloudWatch Logs Insights queries
correlating exact request windows across both the Lambda's own log group
and the API Gateway access log** found the real explanation, and it wasn't
intermittent at all - it was 100% deterministic, just not on the code path
this whole investigation had been assuming:

**The failing requests were all `GET /files-index`, never an upload.**
`mint`/`commit` (which call `FilesUsageService.currentUsageBytes()`, the
only code path this investigation had considered) succeeded every time.
`FilesIndexController.get()` doesn't call `currentUsageBytes()` at all - it
only calls `s3:GetObject`, which *is* granted - but hit a well-documented,
deliberate S3 behavior: **`GetObject` on a key that doesn't exist, without
`s3:ListBucket` covering it, returns `403 AccessDenied` (blaming
`ListBucket`) instead of a clean `404`**, specifically so an unauthorized
caller can't use the 403-vs-404 distinction to probe whether a key exists.
The test account had never uploaded a file, so `files-index.json.enc`
genuinely didn't exist - and the `ListBucket` grant's `s3:prefix` condition
was scoped to `users/*/files/*` (the `files/` subfolder, for the
quota-listing use case) while the index blob lives one level up, directly
under `users/<sub>/` - outside that condition entirely. Every brand-new
user opening the Files tab for the first time would have hit this.

**Fix**: widened the `ListBucket` condition from `users/*/files/*` to
`users/*` in `SmallstashStack.java`, matching the scope `GetObject`/
`PutObject` already cover - not a loosening, since this role already has
`GetObject`/`PutObject` across that same `users/*` tree; it just lets S3
answer "doesn't exist" honestly across the same keyspace those actions
already reach. The temporary diagnostic log line was removed once the real
root cause was found (it wasn't the path that actually mattered here, but
ruling it out was real progress, not wasted effort - it's what forced
looking at *which endpoint* was actually failing instead of *which prefix
value* was being sent). **Verified**: `./mvnw test` 20/20, local `cdk synth`
confirms the widened condition in the synthesized template. **Not yet
deployed** - needs explicit confirmation, as always.

**Lesson for future incidents like this**: correlating logs by AWS Lambda's
own `@requestId` field in CloudWatch Logs Insights doesn't work for this
app's application-level log lines (confirmed directly - it's populated for
the platform's own `START`/`END`/`REPORT` sentinel lines, but consistently
`MISSING` for anything Micronaut/Logback prints, including both the ERROR
and the temporary INFO diagnostic line). Timestamp-window correlation
against the `START`/`END` boundaries *does* work reliably and is what
actually solved this - worth reaching for that method first next time,
rather than filtering by `@requestId` on non-platform log lines.

**Temporary IAM diagnostic policy on `smallstash-deployer`**: added
`iam:SimulatePrincipalPolicy` + read-only role-inspection actions, scoped to
just this one role's ARN, alongside a fix for a pre-existing
`iam:PassRole`-with-wildcard-resource warning (Access Analyzer recommended
`iam:PassedToService` condition instead of narrower ARNs, which aren't
practical here since CloudFormation-generated role names are unknown ahead
of time). **Should be reverted back to the PassRole-fixed-only version now**
- the investigation is closed, nothing further needed from those diagnostics.

### ⚠️ Discovered while investigating the above: `./mvnw test` has been silently hitting real AWS, not LocalStack (accepted for now, 2026-08-28)

Confirmed directly, not assumed: the real account has two buckets
(`smallstash-files`, `smallstash-vaults`) and the real production
`smallstash-users` DynamoDB table contains ~18 fake `user-<nanotime>`-shaped
items alongside the 6 real users' `KEYS`/`PROFILE` pairs. None of those are
CDK-managed (CDK's real bucket names are auto-generated,
`smallstashstack-filesbucket...`; the literal names here are each module's
own `application.properties` default). Micronaut Test Resources is supposed
to transparently redirect `S3Client`/`DynamoDbClient` to an isolated local
LocalStack container during `./mvnw test`, with no code change needed -
that injection has been unreliable in this environment, and its failure
mode is silent: when it doesn't apply, the AWS SDK's default credential
chain falls through to real AWS using the ambient `smallstash-deployer`
credentials, with each property's literal default name (since no env var
substitutes it). **Checked carefully - no real user's data was touched**:
every fake item's PK is `user-<nanotime>`-shaped, never a UUID, so nothing
collided with a real Cognito sub.

**Deliberately not fixed right now** - the user's call, not an oversight:
comfortable using real AWS during this development phase, plans a full
`cdk destroy`/`cdk deploy` cycle plus a rotated invite code once the feature
set is polished, which clears all of this (and the manually-cleaned
orphaned file objects from the earlier incident) for free. If that plan
changes before then, the actual fix is giving test runs their own
obviously-test-only bucket/table names (`application-test.properties`) that
don't collide with any real default - makes a future LocalStack-injection
failure fail loud (`NoSuchBucket`/`ResourceNotFoundException`) instead of
silently mutating production.

### ✅ File tagging done 2026-08-28 - "Option B" from three grouping options discussed

The single/nested-folder "explorer" idea was deliberately rejected as
overkill for the file counts this app will ever hold (low tens, bounded by
the 500 MiB quota - see FilesController's own reasoning for the same
"doesn't need to scale further" judgment). Three options were discussed:
(A) a single flat folder-like label per file, (B) free-form multi-value
tags, (C) no new taxonomy at all, just date-grouping plus filename search.
User picked B.

**Data model**: `FileMetadata` (crypto/files.js) gained an optional
`tags?: string[]` field - optional, not defaulted to `[]`, specifically so
every file uploaded before this feature needs no migration; every reader
treats a missing `tags` the same as an empty array (`file.tags ?? []`)
rather than assuming the field exists. No backend/infra change of any kind:
the files index is opaque client-side-encrypted JSON the backend never
inspects (only the 64 KiB ciphertext cap applies), so a new field is free.

**`session.js`**: `uploadFile` gained an optional `tags` parameter (tags can
be set at upload time, but don't have to be - equally addable later); a new
`updateFileTags(fileId, tags)` does the same read-decrypt-mutate-encrypt-PUT
round trip `removeFile` already established as this module's pattern for
index mutations, including the same non-transactional caveat (two
independent requests, no transaction across them) `removeFile`'s own doc
comment already flags. A shared, unexported `normalizeTags()` (trim, drop
empties, de-duplicate) keeps a tag typed as `"Taxes"` and `"Taxes "` from
silently becoming two different filter buckets, used by both functions so
there's exactly one place that decides what a "valid tag" looks like.

**UI**: `FileListItem.svelte` shows a file's tags as small pills, with an
inline "Edit tags"/"+ Add tags" affordance (comma-separated text input,
Save/Cancel) - genuinely editable in place, unlike everything else on a
file row, since tags are metadata *about* the file rather than something
baked into what was encrypted at upload time. `FilesView.svelte` gained a
tag filter bar above the list: one toggle chip per distinct tag currently
in use (computed live from `files`, never tracked separately), multiple
selectable at once with **OR** semantics ("show anything tagged `taxes` OR
`2026`", not AND) plus a "Clear filter" action. Empty-state message
distinguishes "no files at all" from "no files match the selected tags."

**Verified**: `npm test` **180/180** (180 - 8 new: tag normalization on
upload including the dedupe/trim/empty-drop cases, `updateFileTags`'s happy
path confirming one file's tags change while a second file's are untouched,
clearing all tags, the not-found/no-session/offline rejection paths), `npm
run build` clean.

**Not yet done**: nothing in this feature has been exercised in a real
browser, same standing gap as the rest of the Files tab.

### ✅ Logging cleanup, 2026-08-27/28 - found while investigating the above

**Real, permanent fix, not incident-specific**: both Lambdas' `logback.xml`
used a color-coded console pattern (`%cyan`/`%highlight`/etc.) meant for a
local terminal, and let exceptions print with logback's default
one-stack-frame-per-line behaviour. Neither is right for CloudWatch: ANSI
codes render as raw meaningless escape bytes there, and - the real
problem - CloudWatch's log capture splits on every literal newline in
stdout, so a single exception with a 15-20 frame stack trace showed up as
15-20 disconnected, confusing CloudWatch log events instead of one
coherent record (see the raw log dump the user pasted for `21:29:43.880Z`
- that whole wall of `at ...` lines was **one exception**). Fixed in both
`vault-lambda`'s and `files-lambda`'s `logback.xml` identically: dropped
the colour codes, and added `%replace(%xEx){'[\r\n]+\t*', ' | '}` to squash
a stack trace onto the same line as its message, `|`-joined - one
CloudWatch event per log call now, still fully greppable (message and every
frame remain literal substrings). Verified: `./mvnw test` still 20/20,
clean single-line output confirmed directly in the test run's own console
capture.

**Separately raised by the user**: whether it's time to add actual
application-level logging at critical points, given this investigation
surfaced that **neither Lambda has ever had a single application log
statement** - everything before this was Micronaut/AWS SDK framework
default output only. Genuinely a real gap, but deliberately **not** done as
part of this incident - "what's worth logging, at what level, with which
fields safe to include" (e.g. `userSub` is fine per architecture.md §5,
ciphertext/tokens never are) is a real design decision worth a dedicated
pass, not something to bolt on reactively mid-incident. Tracked as its own
item below.

### ✅ Phase 2 done 2026-08-27 - client crypto + upload/download plumbing

Same branch, still uncommitted. ⚠️ **Found and fixed a real Phase 1 gap
before it caused a problem**: `FilesBucket` is `BLOCK_ALL` public access, and
Phase 1 never added a way to fetch file bytes at all - §5's original route
list simply never included a download endpoint, and Phase 1 was faithful to
that list. Fixed as part of Phase 2: a new `GET /files/{fileId}/url` route,
presigning a `GetObject` the same way `mint` presigns a `PutObject`.
Re-verified with the same rigor as the rest of Phase 1 (clean compile, and
the synthesized template confirms the new route carries the same JWT
authorization as every other one).

New `crypto/files.js` (DEK generate/wrap/unwrap + file/index encrypt-decrypt,
all built on the *existing* `seal`/`open` envelope - no new crypto), new
`api/filesIndex.js`/`api/files.js` (mirroring `api/client.js`'s shape for
the JSON calls; the raw upload/download calls deliberately bypass
`apiRequest` since they talk straight to a presigned S3 URL with no
`Authorization` header and a binary body), and `session.js` gained
`listFiles`/`uploadFile`/`downloadFile`/`removeFile` - same orchestration
shape as `saveVault`/`changeMasterPassword`. Deliberately **no local
caching** of files, unlike the vault - §0.7 already declined offline file
access, so every function round-trips to the server.

One acknowledged, documented gap: `removeFile` isn't transactional across
its delete-then-save-index calls - a process dying between them leaves an
orphaned index entry pointing at a now-gone object. Noted in the code, not
silently accepted; a stale entry surfaces as a 404 on download today rather
than being cleaned up automatically.

**Verified**: real crypto throughout, mirroring how `crypto/vault.js` is
treated in existing tests - only the network boundary is mocked. New
`crypto/files.test.js` (round-trips, wrong-key-fails cases, the size cap,
empty-index case) plus 12 new `session.test.js` tests covering all four
orchestration functions, including a full encrypted-upload-then-download
round trip through the mocked "server" that asserts the recovered bytes
match the original plaintext exactly, and that uploaded bytes are genuinely
ciphertext, not plaintext passed through. **161/161 tests pass** (149
before this phase), `npm run build` clean. Full record in
[file-storage-plan.md](file-storage-plan.md)'s "Phase 2" section.

Not done: nothing UI-facing exists yet (Phase 3), and none of this has been
exercised against a real deployed backend.

### ✅ Phase 3 done 2026-08-27 - the Files tab

Same branch, still uncommitted. New `FilesView.svelte`, a **sibling** to
`VaultView.svelte`, not a merge into it - `VaultView` itself was **not
touched at all**, zero regression risk to a component with extensive
existing verification history. `FilesView` is also structurally simpler:
there's no "Save vault"/dirty-tracking model, since `uploadFile`/
`removeFile` (Phase 2) already round-trip to the server before returning,
so nothing is ever unsaved. `FileListItem.svelte` mirrors `EntryListItem`'s
card look but is much simpler - file metadata isn't a secret to mask, and
nothing about a file is editable in place. New `formatFileSize.js` (6 new
tests) for human-readable sizes, and App.svelte gained a Secrets/Files tab
switcher, resetting to Secrets on sign-out and inactivity auto-lock.

`saveFile.js` (built for CSV export) was **generalised** for arbitrary
downloaded files, reused rather than copied - which surfaced two real bugs
in it, not just a call-site change:

- Its save-picker `types` filter was hardcoded to `text/csv` - harmless
  while CSV was the only caller, wrong for a downloaded PDF or image. Now
  derived from the artifact's own `mimeType`/`path`.
- Fixing that surfaced a **second, pre-existing bug**: `export.js`'s real
  `mimeType` is `'text/csv;charset=utf-8'`, and the picker's `accept` map
  requires a bare MIME type with no parameters - passing the real value
  through would have broken the *existing* CSV export's save dialog (the
  old hardcoded `'text/csv'` had accidentally been dodging this). Fixed
  with a small `bareMimeType()` helper; the CSV export's own behaviour is
  unaffected, it was just quietly relying on the bug's absence by luck.

**Verified**: `npm test` **167/167** (161 before this phase), warning-free
build - including a real warning fixed, not ignored: `FileListItem`'s
`uploadedOn` was a plain `const` reading a prop once, the exact same class
of bug `Alert.svelte` had earlier in this project (Svelte's
`state_referenced_locally`), fixed the same way with `$derived`. Visual
verification via a temporary preview harness: `FileListItem` with
realistic fake data (confirmed long-filename truncation actually
truncates) and the `downloading` state, plus `FilesView` mounted with no
session state to confirm its chrome renders sanely in that condition - a
state a real user can hit (an expired token mid-session), not a contrived
one. A fully populated `FilesView` (upload → list → download → delete
against a live session) wasn't screenshotted - doing so would have needed
briefly overwriting the *uncommitted* `session.js` with a fake, judged too
risky for a temporary check. That data-layer path is already proven by
Phase 2's `session.test.js` (real crypto, mocked network) - this phase's
screenshots verify layout/CSS only, deliberately not claimed as more.
Full record in [file-storage-plan.md](file-storage-plan.md)'s "Phase 3"
section.

Not done: Phase 4 (extending export to include files), and nothing in this
feature has touched a real deployed backend.

### ✅ Phase 4 done 2026-08-27 - export includes files

Same branch, still uncommitted. `export.js` stayed pure/synchronous as
designed - the artifact list was deliberately a list from the start so this
could be additive - and gained a `files` option that spreads one artifact
per uploaded file (as `files/name.ext`) onto the existing CSV-only list;
omitting it reproduces the exact prior output byte-for-byte (tested). A real
bug the file case surfaced that CSV alone couldn't: two files can share a
name (two `receipt.pdf`s), which would have silently dropped one in a
directory export - fixed with a new `deduplicatePaths()` helper (`receipt
(1).pdf`, `receipt (2).pdf`, ...).

`saveFile.js` gained `saveArtifacts` (plural) and `supportsDirectoryPicker`,
alongside the unchanged `saveArtifact`/`supportsSaveFilePicker`: one
artifact still delegates straight to `saveArtifact` (CSV-only export is
byte-for-byte the same path it always was); multiple artifacts either go
through one `showDirectoryPicker()` dialog (Chromium-desktop-only, same
support boundary as `showSaveFilePicker` - confirmed via MDN) writing each
into it preserving the `files/` subfolder, or fall back to a sequential loop
of `saveArtifact` calls (which reuses its existing `<a download>` fallback,
since a browser missing one picker API is missing the other too). No
dedicated test file, consistent with Phase 3's precedent - `saveFile.js` is
`document`/`Blob`/File-System-Access-shaped, which `node:test` can't exercise
without a jsdom dependency this project doesn't have.

`ExportPanel.svelte`: the "no network calls, works offline" claim in its
header comment is now false and was rewritten to say so. UI: files list
fetched eagerly on open for an accurate "what gets exported" summary;
button/copy/empty-state now account for files as well as entries (a vault
with 0 passwords but some files is exportable now).

A real risk this raised was **fixed, not just documented** (2026-08-27,
after a self-review pass): fetching/decrypting files before opening a
picker could let a large/slow file set's transient activation expire before
the picker opened. Fixed by reordering - when a directory picker is
available and there are files to include, the picker now opens *first*
(`pickExportDirectory`, new in `saveFile.js`), and files are downloaded and
written one at a time straight into it (`writeArtifactToDirectory`)
afterwards; a new `fileArtifactPaths()` in `export.js` lets the panel know
each file's final path before its bytes exist. The other two export paths
(no files, or files with no directory picker) were never exposed to this
risk in the first place.

**Verified**: `npm test` **173/173** (167 before this phase, 6 new tests -
5 for the files-in-export feature, 1 for `fileArtifactPaths`), `npm run
build` clean. Full record in
[file-storage-plan.md](file-storage-plan.md)'s "Phase 4" section.

Not done: nothing in this feature has touched a real deployed backend or a
real browser (standing gap since Phase 0.5).

### ✅ File storage - spike done 2026-08-27: one open item resolved, now just a preference

- [x] **Spike run**: does `micronaut-function-aws-api-proxy` (already a
      dependency) turn API-Gateway-pre-validated JWT claims into a Micronaut
      `Authentication` automatically? **Yes, confirmed by decompiling the
      actual dependency jar** (`javap -v` on the class file, not just docs).
      It contains `MicronautLambdaAuthenticationFetcher`
      (`@Singleton @Requires(classes = AuthenticationFetcher.class)`, active
      purely by classpath presence), whose bytecode reads
      `event.getRequestContext().getAuthorizer().getJwt().getClaims()` and
      calls `Authentication.build(claims.get("sub"), claims)` - exactly the
      shape the existing authorizer already produces, and exactly what
      `CurrentUser.subOf()` (`authentication.getName()`) already reads.
      **No code changes needed anywhere in `CurrentUser`, `VaultController`,
      or `KeysController` for a second Lambda to authenticate correctly.**
- [x] **Decided: two Lambdas**, sharing a new `common` Maven module. Since
      `.defaultAuthorizer()` applies API-wide, including routes added later
      via `addRoutes(...)`, the second Lambda inherits the exact same Cognito
      validation automatically, with zero new auth code - the original
      objection to splitting is gone, and the user's standing preference for
      two Lambdas stands.
      **The actual "duplication" to eliminate turned out to be smaller than
      first framed**: the JWT-checking logic itself lives entirely inside
      `micronaut-security-jwt` (third-party, nothing bespoke to duplicate),
      and both Lambdas' `COGNITO_JWKS_URL`/`ISSUER`/`CLIENT_ID` values already
      come from the same CDK `userPool`/`userPoolClient` objects, so there's
      no hand-retyped value to drift. What a shared `common` module actually
      buys: a single home for genuinely reusable code (`CurrentUser` moves
      there) and, via a shared parent POM's `<dependencyManagement>`,
      **guaranteed-identical dependency versions** across both Lambdas -
      the more meaningful drift risk for security-sensitive code than the
      config values ever were.
      **Real security upside of splitting, not just isolation-in-the-abstract**:
      each Lambda gets its own IAM execution role by default. The files
      Lambda's role would have **zero** access to the vault bucket or the
      DynamoDB users table, full stop - stronger than "scoped narrowly within
      a shared role," since a shared Lambda's one role would necessarily be
      the *union* of both permission sets.
      **Sequencing matters**: the Maven restructuring (aggregator +
      `common` + `vault-lambda` + `files-lambda`) is proposed as its own
      first step - Phase 0.5, deployable, verified to be a zero-behaviour-
      change refactor of the existing vault/keys Lambda before any
      files-specific code lands on top of it. Touches three coordinated
      places: `infra/cdk.json`'s app command (stays one command, since
      `mvn package` at an aggregator root builds every module), the CDK
      `Function` code asset path(s) (one jar becomes two), and CLAUDE.md's
      dev cheat-sheet, which currently documents the single-jar output path
      and would otherwise go stale.
- [x] **TTL for presigned URLs: 5 minutes**, confirmed. Not single-use by
      design (checked against AWS docs) - the TTL is the real boundary.
- [x] **Clarified, not a new decision**: deferring chunked/streaming
      encryption (item 10) does **not** mean files go unencrypted. Every file
      is still fully client-side AES-256-GCM'd before upload, via a per-file
      key wrapped by the Vault Key - "deferred" refers only to *how* very
      large files would be encrypted (whole-file in one WebCrypto call, vs.
      processed in chunks), which only matters well above the agreed 25 MB
      cap. See the plan doc's reworded §4 for the disambiguated version.

### ✅ File storage - answered 2026-08-27

1. **Per-file size cap: 25 MB.**
2. **Per-user total quota: ~500 MB.**
3. **Allowed file types: anything.**
4. **Standalone documents**, not attached to entries - a dedicated "Files" tab
   alongside "Secrets". Drove the files-index-blob design above.
5. **Deletion: immediate.** `s3:DeleteObject` scoped to
   `<files-bucket>/users/*/files/*` only.
6. **Separate bucket**, not a prefix on the vault bucket - and it should be
   **unversioned** (a refinement that fell out of combining this with
   decision 5: versioning would work against "deletion means deletion").
7. **No offline file access.** Export (decision 8) covers the
   without-a-connection case instead.
8. **Yes, export includes files** - plaintext, saved to the device, the
   user's responsibility from that point on. Same acknowledgement-gated
   pattern the CSV export already uses.
9. **No `cdk destroy` needed** to build this - confirmed, see the plan doc
   §0.9. Every change is additive.
10. **Chunked/streaming encryption: later.** WebCrypto AES-GCM needs the whole
    file in memory (~2x the file size at peak); fine at the 25 MB cap,
    deferred until there's a reason to raise it.

### Storage model - decided 2026-08-26: separate per-file S3 objects

The inline-vs-separate question below is **settled**, and the existing size
cap settles it rather than taste:

- `VaultController.MAX_CIPHERTEXT_BYTES` caps the **whole vault** at 512 KiB,
  and there is exactly one blob per user
  (`users/<sub>/vault.json.enc`, see `S3VaultRepository`). A single phone
  photo is 2-5 MB - several times the entire budget for everything the user
  owns. Attachments **cannot** live inline in the vault blob.
- So: **one encrypted S3 object per file**, at `users/<sub>/files/<fileId>`,
  with only *metadata* (file id, original name, size, MIME type, and the
  per-file key material) stored inside the vault JSON. Zero-knowledge holds
  the same way it does today - client-side AES-256-GCM before the bytes ever
  leave the browser; the backend stores opaque ciphertext and a name it
  cannot read.
- **The Lambda's IAM already fits this** without widening: it holds
  `s3:GetObject`/`s3:PutObject` scoped to `<bucket>/users/*`, so
  `users/<sub>/files/<id>` is already in scope. Verified against
  `SmallstashStack.java`, not assumed.
- ⚠️ **Deleting an attachment needs a real decision, not an assumption.**
  There is deliberately **no `s3:DeleteObject`** on the execution role - it
  was removed in the Phase 3 least-privilege work specifically so a
  compromised Lambda cannot destroy the vault's version history. Adding it
  back for attachments would undo part of that. Options to weigh when this is
  built: grant `s3:DeleteObject` narrowed to `users/*/files/*` only (not the
  vault blob), or don't delete at all - drop the metadata from the vault and
  let an S3 lifecycle rule expire orphaned objects. The second keeps the
  role's current shape and is probably right.
- Per-file size cap and total-per-user quota still need choosing; the vault's
  512 KiB cap says nothing about these, and they're the real cost-abuse
  control for this feature.

- [ ] **Remaining open questions before implementing**: what counts as a
      "document" (arbitrary upload vs. a constrained type like PDF/image),
      the per-file and per-user size limits noted above, the delete decision
      above, and UI/UX for upload/download/preview. The storage shape itself
      is no longer open - see above. Note
      [ADR-0001](decisions/0001-storage-s3-vs-dynamodb.md) reasoned about a
      single whole-vault blob; per-file objects are an addition to that model,
      not a reversal of it, and the ADR is worth a short amendment when this
      lands.
## PWA build/deploy gotcha - fixed structurally (2026-08-24)

Discovered live: registration on the deployed site failed with `User pool
client <old-id> does not exist` after a stack recreate. Root cause: Vite's
`define` used to bake `AWS_REGION`/`COGNITO_USER_POOL_ID`/
`COGNITO_CLIENT_ID`/`API_BASE_URL` into the JS bundle at **build time**, so
a `web/dist/` built before a stack recreate kept pointing at IDs that no
longer existed, even with `.env` already correct.

**Fixed by switching to runtime config** instead of a rebuild-discipline
workaround:
- `web/src/lib/config.js` now fetches `/config.json` once at startup
  (`main.js`, before the app mounts) instead of reading baked-in
  constants. Covered by a new `config.test.js` (5 tests, mocks
  `globalThis.fetch`).
- `web/vite.config.js`'s `runtimeConfigPlugin` serves `/config.json` from
  the local `.env` for `npm run dev` (a dev-server middleware) and writes
  a real `dist/config.json` for `npm run preview` - both dev-only.
- `infra/`'s `SmallstashStack` generates the **real** `config.json` from
  live, resolved stack values (`Source.jsonData`, a new `ConfigDeployment`
  `BucketDeployment`) on every `cdk deploy` - `userPool.getUserPoolId()`,
  `userPoolClient.getUserPoolClientId()`, `httpApi.getApiEndpoint()`,
  `this.getRegion()`. `SiteDeployment` (the one uploading `web/dist/`)
  explicitly `.exclude(["config.json"])` so the dev-only copy never
  overwrites the real one, regardless of upload order.
- Net effect: `web/dist/` is now ID-agnostic. A future stack recreate
  regenerates `config.json` automatically on `cdk deploy` - **no frontend
  rebuild required**, this class of bug can't recur.

Verified: local CDK synth shows `ConfigDeployment`'s `SourceMarkers`
correctly referencing `Ref`/`Fn::GetAtt` (not literal values) for the pool/
client/API IDs, and `SiteDeployment`'s `Exclude: ["config.json"]`; full
`npm test` (84 tests) and `npm run build` both clean; built bundle
confirmed to contain no hardcoded pool/client ID strings.

- [ ] **Deploy this** - not yet pushed live (needs `cdk deploy`, your call
      per usual).

## Backend logging - not comprehensive yet (2026-08-24)

No dedicated review of what the Lambda actually logs has been done.
Right now it's whatever Micronaut's defaults produce - not a deliberate
strategy for a security-sensitive backend (this is the one boundary
that's *not* zero-knowledge - it sees Cognito identity, request metadata,
ciphertext sizes, and any error detail a bug might accidentally leak into
a stack trace).

- [ ] **Design and add comprehensive backend logging** - structured
      (JSON) request logs (auth outcome, route, status, latency, `sub` -
      never plaintext/ciphertext body), error logging with enough context
      to debug without ever logging secrets or the Master Password (which
      the backend never sees anyway, but double-check no dependency logs
      raw request/response bodies by default), and a decision on
      retention/cost for CloudWatch Logs (a log group with no retention
      policy keeps everything forever - cheap at this scale but still
      worth setting explicitly). Ties into the security hardening pass
      above - logs are also what you'd need to notice a brute-force/abuse
      pattern in the first place.

## UI input validation review - not yet audited (2026-08-24)

No dedicated review has been done of client-side input validation across
the PWA's forms (signup/login email format, password fields, vault entry
fields, etc.) - e.g. whether email fields use a real validation regex vs.
just `type="email"`'s loose browser-native check, what happens on
malformed/edge-case input, whether validation errors are surfaced clearly
to the user. Not a security boundary (the backend/Cognito enforce the
real constraints; zero-knowledge means client validation is UX, not a
trust boundary) but worth a pass for correctness/quality.

- [ ] **Audit and tighten client-side form validation** across
      `src/lib/components/` - email format, password/master-password field
      constraints, vault entry field limits, and how validation errors are
      shown to the user.

## Follow-ups from PWA hosting work (2026-08-24)

- [ ] **Cognito signup/verification emails land in spam.** Default Cognito
      email (no SES, shared `no-reply@verificationemail.com` sender) has
      poor deliverability out of the box. Fix is likely `UserPool`'s
      `email` prop pointing at a verified SES identity (custom domain or at
      least a verified address) instead of Cognito's default sender -
      needs an SES identity verified first (console or CDK
      `SesVerifiedIdentity`), then wiring `UserPool.Builder.email(...)` to
      it. Low urgency while it's just the one test user, but blocks a real
      multi-user rollout.
- [ ] **Custom domain for the S3/CloudFront site** - currently only the
      auto-generated `*.cloudfront.net` URL (see "PWA hosting" below).
      Needs a Route 53 hosted zone + ACM cert (must be in `us-east-1`
      regardless of the stack's region, CloudFront requirement) +
      `Distribution`'s `domainNames`/`certificate` props. Not blocking a
      first working deploy.
- [ ] **Custom domain for the backend HTTP API** - currently only the
      auto-generated `*.execute-api.eu-west-1.amazonaws.com` URL. Needs an
      ACM cert (this one *can* be `eu-west-1`, matches the API's region)
      + API Gateway v2 custom domain + base path mapping. Same Route 53
      zone as the site domain if done together.
- [ ] **Security research pass: DDoS/brute-force/API-abuse/AWS-cost-abuse
      hardening.** Goal is best-practice defence in depth across API,
      AWS account, and client - not just "it works." Root and the `Andy`
      IAM user already have MFA; scope is everything else. Things to
      evaluate, roughly in order of likely impact:
      - **AWS WAF** in front of the HTTP API and/or CloudFront - rate-based
        rules, managed rule groups (common exploits, bad bot lists) - was
        previously deferred as unnecessary cost/complexity for a ~20-user
        app (see "Deferred" below); worth revisiting specifically for the
        brute-force/DDoS angle now that there's a real public URL.
      - **Cognito-side brute-force protection** - advanced security
        features (adaptive auth, compromised-credentials check) vs. cost;
        at minimum confirm Cognito's built-in per-IP/per-user throttling
        on `InitiateAuth`/`RespondToAuthChallenge` is actually adequate for
        SRP.
      - **API Gateway throttling** already exists (`rateLimit(10)`,
        `burstLimit(20)` in `SmallstashStack`) - re-check these are the
        right numbers now that there's a public URL and not just
        internal testing, and consider a WAF rate-based rule as a second
        layer (API Gateway throttling alone doesn't block a single bad
        actor from consuming the whole budget before the 429s kick in).
      - **Lambda cost-abuse ceiling** - reserved/provisioned concurrency
        limits or account-level Lambda concurrency caps, so a flood of
        requests (even throttled 429s upstream slipping through, or a
        future bug) can't run up a large bill or peg concurrency for
        legitimate use. Also re-check `Function`'s `memorySize`/`timeout`
        aren't more generous than the workload needs.
      - **DynamoDB/S3 cost-abuse ceiling** - PAY_PER_REQUEST DynamoDB and
        S3 both scale cost with request volume; consider CloudWatch
        billing alarms (may already exist as an account-level safety net -
        check "Account-level safety nets" below) as the actual backstop
        here rather than trying to hard-cap either service.
      - **Client-side**: CSP headers (via CloudFront response headers
        policy), Cognito token storage location (confirm it's not
        `localStorage` in a way that widens XSS blast radius beyond
        what's already necessary for offline unlock), dependency audit
        (`npm audit`) as a recurring check, not a one-time pass.
      - Write findings + decisions to a new doc or a dedicated
        architecture.md section once this research is done - this bullet
        list is a starting point, not the final scope.

## Security review 2026-08-24 - decisions made, not yet implemented

Full review (AWS-account-level checks against the live stack + code read)
found H-1 (open self-signup + published Cognito IDs let anyone register),
H-2 (unbounded S3 version growth, no size limit, no per-user quota - a
cost-abuse vector), H-3 (all data resources are DESTROY with no PITR - one
`cdk destroy` or bad CFN update permanently loses every vault), plus
several medium/low items (no CSP/security headers, MFA optional, user
enumeration via `InitiateAuth`, no access logging). Decisions made so far,
to implement together as one pass:

- [x] **Close self-signup, replace with PreSignUp Lambda trigger + invite
      code** (implemented 2026-08-24, **not deployed**).
      `selfSignUpEnabled(false)` is *not* the plan - instead, a
      small second Lambda wired via `userPool.addTrigger(...)`, invoked by
      Cognito's PreSignUp event before account creation. The client passes
      an invite-code field as `validationData` on the `SignUp` call
      (Cognito's real, purpose-built passthrough for this - only `SignUp`/
      `AdminCreateUser` forward `validationData` to the trigger); the
      trigger checks it against a hardcoded `INVITE_CODE` env var and
      rejects account creation if it doesn't match. Chosen over
      `admin-create-user`-only onboarding because it lets a small number
      of trusted people (family/friends) self-register with a code you
      hand them, without you running a CLI command per person.
      **Nuance to remember**: if `INVITE_CODE` is ever rotated by editing
      the Lambda's env var directly (console or `aws lambda
      update-function-configuration`) rather than in the CDK source, the
      *next* `cdk deploy` silently overwrites it back to whatever's
      hardcoded in `SmallstashStack.java` - CDK treats environment
      variables as the full declarative set, not a diff. Rotate it in the
      CDK source and redeploy as the normal path; console/CLI rotation is
      only for "kill the current code immediately, can't wait for a
      build" and must be followed by updating the source to match before
      the next deploy, or the rotation silently reverts.
      **Where the code actually lives**: the trigger is an inline Node
      function in `SmallstashStack.java` (`PreSignUpFunction`, ~20 lines,
      no separate Maven module - a Java Lambda's cold start would add
      seconds to every signup for nothing). Client side, the code travels
      as Cognito `validationData` (`web/src/lib/auth/cognito.js`'s
      `signUp`), threaded through `session.js`'s `registerAccount` from a
      new "Invite code" field in `SignupForm.svelte`. It is *not* a user
      attribute - nothing about it persists on the account.
      **Where the code value lives**: `SMALLSTASH_INVITE_CODE` in the
      repo-root `.env` (gitignored; `.env.example` carries the key blank as
      a template). `SmallstashStack.resolveInviteCode()` parses `.env`
      directly at synth time - CDK doesn't read `.env` itself - so a plain
      `cdk deploy` works with no extra flags. Precedence: CDK context
      (`-c inviteCode=<value>`) > `SMALLSTASH_INVITE_CODE` env var > `.env`
      > **hard failure**. Deliberately not hardcoded in
      `SmallstashStack.java`: that would commit a shared secret to git,
      which CLAUDE.md forbids. The hard failure is also deliberate - a
      default invite code shipping by accident would silently reopen the
      exact hole this mechanism exists to close.
      `PreSignUp_AdminCreateUser` is deliberately let through untouched so
      `admin-create-user` still works as a manual fallback (it can't send
      `validationData`, and already requires IAM credentials).
- [x] **`RemovalPolicy.RETAIN` - evaluated and rejected, not planned
      (decided 2026-08-25).** Was implemented then reverted 2026-08-24 as a
      "temporarily reverted, flip before real secrets" item; re-evaluated
      and dropped from the plan entirely rather than deferred. RETAIN
      leaves resources orphaned-not-deleted on `cdk destroy`, and bringing
      them back under stack management afterward is real work: S3 buckets
      and DynamoDB tables support CloudFormation resource import
      (`cdk import`), but **Cognito User Pools do not** - a known,
      longstanding AWS gap
      ([tracking issue](https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/1485)),
      confirmed via AWS's own docs rather than assumed. So RETAIN wouldn't
      have delivered full recovery even if used correctly - a retained
      pool just sits there, unusable, forever.
      **Accepted risk, decided explicitly**: `dataRemovalPolicy` stays
      `DESTROY` permanently. Once real secrets are stored, `cdk destroy` -
      accidental or deliberate - permanently deletes every vault, with no
      recovery path. `SmallstashStack.java`'s comment above
      `dataRemovalPolicy` carries this reasoning inline so it isn't
      re-litigated from a stale "still owed" framing later.
      **If this risk tolerance ever changes**: `deletionProtection(true)`
      on the table and the pool (both support it natively) is the
      lighter-weight guard to reach for, not RETAIN - it blocks the delete
      outright rather than leaving an orphan to untangle afterward. Not
      implemented; flagged as the fallback option, not a plan.
- [x] **S3 lifecycle rule** on the vault bucket (implemented 2026-08-24,
      **not deployed**): `NoncurrentVersionExpiration` 90 days with
      `NewerNoncurrentVersions: 3`, plus
      `AbortIncompleteMultipartUpload` after 7 days. Verified in the
      synthesized template.
      **Correction (2026-08-24, found in review):** this was originally
      described here and in architecture.md as capping a user at ~4
      versions / ~2 MB. That is wrong. S3 applies `NoncurrentDays` and
      `NewerNoncurrentVersions` as **AND**, not OR - a noncurrent version
      is deleted only when it is *both* older than 90 days *and* has >=3
      newer noncurrent versions behind it. Inside a 90-day window the
      version count is therefore unbounded, and this rule limits long-term
      accumulation from normal use rather than a deliberate burst. The
      real burst bounds are invite-gated signup, the 10 rps stage
      throttle, `reservedConcurrentExecutions(5)`, and the 512 KiB
      per-write cap.
- [ ] **Consider tightening the vault bucket's retention window.** Given
      the AND semantics above, 90 days is generous for a personal app -
      the realistic reason to keep an old vault version is "I broke
      something last week", not last quarter. Dropping `NoncurrentDays` to
      ~14-30 would shrink the accumulation window substantially at no
      practical cost to recoverability. Not urgent (invite-gating means
      only trusted accounts exist), just a cheap tightening whenever the
      lifecycle rule is next touched.
- [x] **512 KiB ciphertext size limit** on `PUT /vault` (implemented
      2026-08-24, **not deployed**). Set to 512 KiB rather than the 1 MiB
      first tried - a realistic vault is single-digit kilobytes, so this is
      still ~100x headroom while bounding the worst case an order of
      magnitude tighter. `VaultController.MAX_CIPHERTEXT_BYTES` checks the
      Base64 length first (rejects without allocating the decoded array)
      then the decoded byte count as the authoritative check;
      `micronaut.server.max-request-size=1MB` is the second layer (room for
      a max-size vault's ~700KB Base64 expansion plus its JSON envelope).
      Also fixed the unhandled-500 path this touched: a malformed Base64
      body used to throw `IllegalArgumentException` out of the controller
      as a 500, now a deliberate 400; oversized is 413. Client mirrors the
      limit in `policy.js`'s `MAX_VAULT_CIPHERTEXT_BYTES`/
      `validateVaultSize`, called from `api/client.js`'s `putVault` so an
      oversized vault fails with a readable message instead of uploading
      the whole thing to earn a bare 413 - UX only, the backend check is
      the real enforcement. **Keep the two constants in sync by hand** -
      nothing enforces that today.
- [ ] **Per-field input limits in the vault UI** (raised 2026-08-24, not
      implemented). The 512 KiB ceiling above is a whole-vault limit, so
      the way a normal user would realistically hit it is one enormous
      Notes field - and the failure would surface as "your entire vault
      won't save" with no clue which entry caused it. A `maxlength` on the
      Notes textarea (say 10-20 KB) plus something modest on
      title/username/URL would turn that into immediate, local feedback.
      Worth being clear this is **UX, not a security control**: the vault
      is encrypted client-side, so the backend cannot see or enforce
      anything about individual fields - the whole-blob size limit is the
      only real enforcement point, and it already exists. Fold into the
      already-tracked "UI input validation review" item below rather than
      doing it standalone.
- [x] **Enable DynamoDB PITR** on `smallstash-users` (implemented
      2026-08-24, **not deployed**) - cheap (~$0.20/GB-month, table is
      currently ~0 bytes), and it's the difference between "recoverable"
      and "every vault permanently undecryptable" if the KEYS item
      (wrapped Vault Key) is ever lost - unlike the S3 vault blob, that
      item has no versioning today. Uses
      `pointInTimeRecoverySpecification` (the non-deprecated form).
      Verified in the synthesized template.
- [ ] **AWS Budgets Action: "blunt kill switch" on cost-threshold breach**
      (chosen over the narrower "deny writes only, keep reads" option -
      full outage acceptable for a personal app, simplicity preferred over
      graceful degradation). Implementation detail worth getting right:
      attach the Deny policy to the **Lambda's execution role**
      (`BackendFunctionServiceRole...`), not `smallstash-deployer` -
      `smallstash-deployer` is the local/deploy identity, never in the
      live request path, so denying it would do nothing to stop
      traffic-driven cost. Deny `s3:*`/`dynamodb:*` on the execution role
      (not `lambda:InvokeFunction` - that permission lives on a *resource*
      policy granted to API Gateway, not the execution role's own
      identity policy, so denying it there wouldn't block invocation
      anyway). Denying the data-plane actions breaks every vault
      read/write for all users, which is the intended full-stop, while
      root and `smallstash-deployer` stay untouched so investigation/
      recovery is immediate. **Explicitly not** `reservedConcurrentExecutions:
      0` - AWS Budgets Actions natively support only "apply an IAM/SCP
      policy" or "stop specific EC2/RDS instances," not a Lambda
      concurrency change; achieving that would need a separate custom
      remediation (a CloudWatch alarm triggering another Lambda that calls
      the concurrency API) - more moving parts, another privileged Lambda
      as new attack surface, for a personal project where the native
      IAM-Deny option already achieves the same practical outcome.
- [x] **CloudFront security headers + CSP** (implemented 2026-08-24, **not
      deployed**). A `ResponseHeadersPolicy` (`SiteSecurityHeaders`,
      attached to the distribution's default behaviour) sets HSTS
      (1 year, includeSubdomains), `X-Content-Type-Options`,
      `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`, plus a
      hand-written CSP.
      Written **strict**, and that's justified rather than optimistic -
      checked against the real build output, not assumed: Vite emits no
      inline `<script>` or `<style>` (both external with `src`/`href`),
      there are no inline `style=""` attributes in `web/src`, and there are
      no Svelte transitions - which are the usual reason a Svelte app needs
      `'unsafe-inline'` in `style-src`. Every network origin was likewise
      enumerated from source and the built bundle; everything is
      same-origin except Cognito and the API.
      `'wasm-unsafe-eval'` is in `script-src` because `hash-wasm` runs
      Argon2id as WebAssembly. **Without it unlock fails in a way that
      looks like "wrong Master Password", not like a CSP problem** - worth
      remembering if unlock ever breaks right after a CSP change.
      The API host is a `*.execute-api.<region>.amazonaws.com` wildcard
      rather than the exact endpoint: the real one isn't known until
      `HttpApi` is constructed, and `HttpApi`'s CORS needs the
      distribution's domain name, so naming it exactly would be a circular
      dependency.
- [ ] ⚠️ **Flip the CSP from report-only to enforcing.** It currently ships
      as `Content-Security-Policy-Report-Only` via `customHeadersBehavior`
      (`securityHeadersBehavior.contentSecurityPolicy` only emits the
      enforcing variant, hence the custom header). **Until it's flipped it
      is documentation, not protection** - the browser logs what it would
      have blocked and blocks nothing. The flip itself is one string in
      `SmallstashStack.java` (marked with a `!! FLIP TO ENFORCING !!`
      comment) plus a redeploy.
      **Validating it first is deferred to the browser-testing work below**
      (decision 2026-08-24) - see "Browser/E2E testing with Playwright".
      Doing it by hand was considered and deliberately postponed: the whole
      security-fix sequence lands first, then testing validates all of it in
      one pass rather than a manual click-through per phase.
- [x] **`preventUserExistenceErrors: true`** on the user pool client
      (implemented 2026-08-24, **not deployed**) - closes the
      confirmed-live user-enumeration gap (unauthenticated
      `InitiateAuth` against a nonexistent email currently returns
      `UserNotFoundException` rather than a generic error).
- [x] **Cognito Plus tier (Threat Protection)** (implemented 2026-08-24,
      **not deployed**) - compromised-credential detection (login password
      checked against known-breach corpora) + risk-based adaptive auth
      (IP-reputation/device signal scoring on sign-in) + exportable auth
      event logs. $0.02/MAU, no free tier - confirmed ~$0.40/month at 20
      users, **approved as the one recurring paid item in this stack**.
      `featurePlan(FeaturePlan.PLUS)` +
      `standardThreatProtectionMode(FULL_FUNCTION)`; verified in the
      synthesized template as `UserPoolTier: PLUS` and
      `UserPoolAddOns.AdvancedSecurityMode: ENFORCED`.
      Note `FULL_FUNCTION` means threat protection **acts** (blocks/
      challenges) rather than just recording - `AUDIT` mode is the
      log-only alternative if it ever proves too aggressive.
- [ ] **Before any of the above ships**: confirm `LoginForm.svelte`
      handles Cognito's `NEW_PASSWORD_REQUIRED` challenge - currently
      unverified, and relevant if `admin-create-user` is ever used as a
      manual fallback alongside the invite-code flow. (Known: `cognito.js`'s
      `signIn` currently *rejects* on `newPasswordRequired` with a generic
      error rather than driving a set-new-password step, so an
      admin-created user can't complete first login through the PWA today.)

### Phase 0 deploy notes (read before the next `cdk deploy`)

- **`cdk destroy` still works as before** - `DESTROY` is the permanent
  decision (see above), so the destroy/recreate loop is unchanged. This
  also means real secrets are stored at the accepted risk that a `cdk
  destroy` deletes them permanently, with no recovery - not gated on any
  planned future change.
- **`SMALLSTASH_INVITE_CODE` must be set in `.env` first.** It's currently
  blank - deliberately, secrets don't get written by an AI session. `cdk
  deploy` fails fast at synth with an explanatory error until it's filled
  in, rather than deploying an ungated signup endpoint. Pick something
  long and random.
- **Not yet verified end-to-end**: the PreSignUp trigger has only been
  verified structurally (synthesized template shows the `LambdaConfig
  PreSignUp` wiring and the `cognito-idp.amazonaws.com`
  `lambda:InvokeFunction` permission). The actual reject-on-wrong-code and
  accept-on-right-code behaviour is untested against a live pool - worth a
  manual run-through of both paths on first deploy, since a trigger that
  throws on *every* signup and one that silently lets everything through
  look identical from the CDK template.

- [ ] **XSS hardening beyond CSP** (CSP is the primary lever - see above -
      but layer these too, since CSP mitigates delivery, not every
      injection path):
      - [x] Confirmed `{@html ...}` is used **nowhere** in `web/src`
        (2026-08-24, by grep). `{expression}` auto-escapes; `{@html}`
        deliberately opts out and is the most common way a Svelte app
        introduces XSS. Worth re-checking if it ever appears.
      - [x] **Fixed a live `javascript:` XSS** (commit `45ccec5`), not a
        hypothetical one: `normalizedUrl` passed any scheme-looking prefix
        straight into the `<a href>`, so an entry saved with
        `javascript:alert(1)` executed on click. Now only `http`/`https`
        keep their scheme; anything else is stripped and treated as a bare
        hostname, so the worst case is a dead link. Moved to `lib/url.js`
        to make it testable (`url.test.js` covers `javascript:`/`data:`/
        `vbscript:`/`file:`, case variants, and the `javascript://`
        comment-smuggling form).
      - [x] `npm audit` + Dependabot (2026-08-24). `npm audit --omit=dev`
        reports **0 vulnerabilities**; `.github/dependabot.yml` now covers
        `web/` (npm) and both Maven projects, weekly, with dev-dependency
        updates grouped to keep routine noise to one PR. Security updates
        still arrive individually regardless of grouping.
      - [x] Confirmed the Master Key/session key material never touches
        `localStorage`/`sessionStorage` (2026-08-24, verified by grep, not
        assumed): the only `localStorage` use in `web/src` is
        `getLastAccount`'s `{email, sub}` for the offline-unlock flow -
        both non-secret. Key material is a module-level variable in
        `session.js` with a 15-minute inactivity auto-lock.
      - Trusted Types (`require-trusted-types-for 'script'` CSP directive)
        considered and deliberately skipped for now - strongest available
        DOM-XSS defense, but more setup/browser-support fiddling than a
        20-user app needs; revisit only if the CSP rollout turns up a
        specific gap that warrants it.

### Brute-force / IP-blocking research (2026-08-24) - mostly already covered

Asked whether we can "lock after 10 failed passwords and block the IP", and
whether fail2ban / CrowdSec / endlessh-go apply. Findings, so this isn't
re-researched later:

- **Cognito already does per-user lockout, automatically and for free.**
  After 5 failed password attempts it locks the user for `2^(n-5)` seconds
  (n = cumulative failures), escalating to a ~15 minute cap. Resets on a
  successful sign-in, or after 15 minutes with no attempts. **It is not
  configurable** - "make it 10 attempts" isn't a setting that exists. It's
  also per-user, not per-IP,
  so it blunts credential-stuffing against one account but not spraying one
  password across many accounts.
- **AWS WAF rate-based rules can't express "10 failures".** They count
  *requests* per IP over a 5-minute window and cannot distinguish a failed
  sign-in from a successful one, and the **minimum threshold is 100
  requests / 5 min** - so a 10-attempt rule is impossible by construction.
  Still useful as a volumetric backstop (a real brute-forcer makes
  thousands of requests), just not as a precise lockout.
- **WAF's purpose-built credential-stuffing rule groups are unavailable
  here.** `AWSManagedRulesATPRuleSet` (account takeover prevention) and
  `AWSManagedRulesACFPRuleSet` (account creation fraud prevention) are
  exactly the "detect credential stuffing / fake signups" rulesets, and AWS
  explicitly **forbids associating a web ACL containing either with a
  Cognito user pool**. So WAF-on-Cognito gets you rate limiting and IP
  reputation, not ATP.
- **Cognito Threat Protection (Plus tier, already approved above) is the
  right tool** and covers most of what was actually wanted: compromised
  -credential detection (the login password checked against known-breach
  corpora - directly the "retrying a compromised passwords database"
  scenario) plus risk-based adaptive auth that scores IP reputation and
  device signals and can block outright on high risk (no step-up MFA to
  fall back to instead - this app deliberately runs `Mfa.OFF`, see
  architecture.md §5). ~$0.40/month at 20 users.
- **fail2ban / CrowdSec / endlessh-go: none apply.** All three assume a
  long-lived host you control. fail2ban tails log files and writes
  iptables/nftables rules - there is no host and no firewall in a
  Lambda/API Gateway/Cognito stack. CrowdSec is the same shape (agent parses
  logs, "bouncers" enforce), and while it does ship an AWS WAF bouncer,
  running the agent means paying for an always-on EC2/container - which
  contradicts the near-zero-idle-cost constraint, to enforce a blocklist AWS
  already sells as a managed rule group (`AWSManagedRulesAmazonIpReputationList`).
  endlessh-go is an **SSH tarpit**; there is no SSH anywhere in this
  architecture. The generalizable idea behind CrowdSec - a crowd-sourced
  known-bad-IP feed - maps onto AWS's managed IP reputation list and
  Cognito Threat Protection, both of which are already in this plan.
- **Net: no new work item.** Cognito's built-in lockout + Threat Protection
  + the existing API Gateway throttle cover this. WAF stays deferred (see
  "Deferred" below) - it can't do the precise thing that was wanted, and
  the ~$7-8/month baseline is disproportionate here.

### Phase 1 - implemented 2026-08-24, not deployed

- [x] **Lambda `reservedConcurrentExecutions(5)` - implemented, then
      reverted 2026-08-24 on the first real deploy attempt.** Intended as a
      hard ceiling on concurrent execution (the cost control the API
      Gateway throttle can't be - throttling caps requests/second,
      concurrency caps how many run at once). **`cdk deploy` failed
      `CREATE_FAILED`**: this account's total Lambda concurrency limit in
      `eu-west-1` is **10**, not AWS's default 1000 (confirmed via
      `aws lambda get-account-settings`), and AWS enforces a hard floor of
      >=10 `UnreservedConcurrentExecutions` for the rest of the account at
      all times - with a total of 10 there's no room to reserve *any*
      amount. Stack rolled back cleanly (`ROLLBACK_COMPLETE`, fresh create
      so nothing partial was left behind).
      **Reverted rather than worked around** - the account-wide ceiling of
      10 is itself already a real (if coarser) concurrency cap while this
      is the only Lambda in the account, so removing the per-function
      reservation isn't a bare regression; the invite gate, throttle, and
      per-write size cap are unaffected.
      **To restore**: request a Lambda concurrent-execution Service Quota
      increase (e.g. to 100 - typically auto-approved within minutes for
      an increase this size), then reinstate
      `.reservedConcurrentExecutions(5)` in `SmallstashStack.java` (marked
      there with an inline comment explaining all of this).
- [x] **Conditional write on `PUT /keys`.** `saveKeys` now writes with
      `attribute_not_exists(pk) OR #kv < :newKeyVersion`, so a stale or
      replayed write can't clobber newer key material. A rejected write
      raises `KeyVersionConflictException` -> **HTTP 409** (new
      `KeyVersionConflictExceptionHandler`, following the existing
      `ResourceNotFound` pattern). Guards the single most destructive
      write in the system: the KEYS item is the only copy of the wrapped
      Vault Key, and overwriting it with material from a different Master
      Password makes every vault version - current *and* historical -
      permanently undecryptable.
      **Required a client change, done**: `keyVersion` is unix-seconds
      from the local clock, so a device whose clock lagged the last writer
      (or two changes inside the same second) would produce a version the
      backend now rejects - leaving that device permanently unable to
      change its Master Password. `nextKeyVersion(previousKeyVersion)` in
      `crypto/vault.js` now returns
      `max(nowSeconds, previousKeyVersion + 1)`;
      `rewrapWithNewMasterPassword` takes `previousKeyVersion` and
      `session.js`'s `changeMasterPassword` passes the version it already
      fetched. Two new tests cover the clock-skew and normal cases (92
      frontend tests, up from 90).
- [x] **Log retention (30 days)** on an explicit `LogGroup` for the Lambda
      (CDK's implicit one never expires) **and API Gateway access logging**
      to its own 30-day group. Access logs record source IP, time, method,
      route, status, response length, request id, and authorizer error -
      **deliberately no request/response bodies**: they're ciphertext, but
      logging them would put vault contents in CloudWatch for no benefit.
      This is the only place a wave of 401s (the actual signal that someone
      is probing) becomes visible - the Lambda's own logs start *after* the
      JWT authorizer has already accepted or rejected. `accessLogSettings`
      has no L2 property on `HttpStage` yet, so it's set through the
      underlying `CfnStage`.

- [ ] **`storageBytesUsed` quota enforcement - reconsidered and
      deliberately dropped from Phase 1.** It was on the plan as a
      cost-abuse backstop, but that reasoning no longer holds now that the
      other two controls are in: with one blob per user, per-user storage
      *is* the blob size, which is already capped at 512 KiB by
      `VaultController.MAX_CIPHERTEXT_BYTES`, and the S3 lifecycle rule
      bounds retained noncurrent versions at 3. Worst case per user is
      therefore ~4 x 512 KiB = ~2 MB, and signup is invite-gated, so total
      storage is bounded at (invited users) x 2 MB regardless. Adding
      quota tracking would mean `VaultController` taking a dependency on
      `UserKeysRepository` - crossing a package boundary the design keeps
      separate on purpose - to enforce a limit that's already enforced
      twice over. Still worth doing eventually as *displayed information*
      if `GET /profile` ever gets built; tracked in the "Profile feature"
      section below, not here.

### Phase 3 - implemented 2026-08-24, not deployed

- [x] **Cost/abuse CloudWatch alarm.** Lambda `Invocations`, Sum over 1
      hour, `> 200` -> SNS topic `smallstash-alerts` -> email
      (`SMALLSTASH_ALERT_EMAIL` in `.env`; the topic and alarm are still
      created if it's unset, but nothing is subscribed so it fires
      silently). `treatMissingData: NOT_BREACHING` because idle is the
      normal state. 200/hour is far below the API stage ceiling (10 rps =
      36,000/hour) so it fires long before throttling alone would bound the
      damage. This is the piece the AWS Budgets can't be: Budgets are
      notification-only and evaluate a few times a day, so a runaway could
      burn most of a day before they notice. **AWS emails a confirmation
      link on first deploy - the subscription delivers nothing until it's
      clicked.**
- [x] **Least-privilege IAM for the Lambda**, replacing
      `grantReadWrite`/`grantReadWriteData` with explicit statements:
      `s3:GetObject`/`s3:PutObject` scoped to `<bucket>/users/*`, and
      `dynamodb:GetItem`/`dynamodb:PutItem`. The app never deletes
      anything. What this removes matters: `grantReadWrite` includes
      `s3:DeleteObject*`, which on a versioned bucket covers
      `DeleteObjectVersion` - i.e. the ability to destroy the version
      history that is the vault's only rollback path - and
      `grantReadWriteData` includes `dynamodb:DeleteItem`, which could drop
      the wrapped Vault Key. Verified in the template that the role's
      inline policy now contains exactly those four actions, and that
      `AWSLambdaBasicExecutionRole` is still attached so CloudWatch Logs
      access survives.
- [x] **`localhost:5173` removed from the deployed API's CORS allowlist**,
      now opt-in via `SMALLSTASH_ALLOW_LOCALHOST_CORS=true` (or
      `-c allowLocalhostCors=true`) for when `npm run dev` needs to reach
      the real backend. Verified the template drops to a single origin by
      default. CORS is a weak boundary for a bearer-token API - no cookies,
      so a malicious origin can't ride an ambient session - but there's no
      reason for production to advertise a development origin.
- [x] **Refresh token TTL 30 days -> 7.** That window is how long a stolen
      refresh token stays usable; any use inside it slides it forward, so
      normal users rarely re-authenticate.

Not done in Phase 3: the AWS Budgets Action "blunt kill switch" (see
below).

- [x] **AWS Budgets Action kill switch** (implemented 2026-08-24, **not
      deployed**). Automatic *containment*, where the CloudWatch alarm above
      is detection. On breach, AWS Budgets attaches a Deny
      (`s3:*`/`dynamodb:*`) to the **backend Lambda's execution role** and
      every vault read/write starts failing - a full outage, deliberately,
      on the reasoning that for a personal app an unexplained bill is worse
      than downtime. Root and `smallstash-deployer` are untouched (neither
      is in the live request path), so investigation and recovery are
      unaffected; **recovery is detaching the policy, no redeploy needed**.
      **The budget is created by CDK** (`smallstash-app`, $10/month) rather
      than referencing a console-made one. A `CfnBudgetsAction` must name its
      budget, and pointing at a hand-made budget would silently break every
      future deploy the moment it was renamed. Personal budgets stay
      completely independent of this one.
      Design details worth not re-deriving: `ACTUAL` not `FORECASTED` (a
      forecast can spike early in the month off very little real spend, and
      this action is destructive); `AUTOMATIC` approval (`MANUAL` would just
      be another email needing a human, which the alarm already covers);
      threshold `ABSOLUTE_VALUE` $10, well above the ~$0.40/month floor.
      IAM is scoped tighter than AWS's own example, which grants
      attach/detach on `*` for users, groups **and** roles: this execution
      role may attach only *that* policy (`iam:PolicyARN` condition) to only
      *that* role (resource-scoped), and its trust policy carries AWS's
      documented `aws:SourceArn`/`aws:SourceAccount` confused-deputy
      conditions. Permissions verified against AWS's "Allow AWS Budgets to
      apply IAM policies and SCPs" example, not assumed.
      Requires `SMALLSTASH_ALERT_EMAIL` - a budget action must have at least
      one subscriber, and a containment control that fires with nobody
      informed turns an outage into a mystery. The whole thing is skipped if
      that's unset.
      **Deployability confirmed 2026-08-24** (an earlier note here guessed
      this would be a first-deploy failure point on deployer permissions -
      that was wrong, see "How deploys actually authorize" below).

## How deploys actually authorize (checked 2026-08-24)

Worth writing down, because reasoning about `smallstash-deployer`'s policy
alone leads to the wrong conclusion - it did once already in this repo.

`cdk deploy` does **not** create resources as the deployer user. With
bootstrap v32 (`CDKToolkit`, `CREATE_COMPLETE`), the CLI assumes
`cdk-hnb659fds-deploy-role-<account>-<region>`, and CloudFormation then
executes the changeset as
`cdk-hnb659fds-cfn-exec-role-<account>-<region>` - **which has
`AdministratorAccess` attached** (verified via
`aws iam list-attached-role-policies`). So resource creation is bounded by
that role, not by the user's own policy.

Practical consequences:

- `smallstash-deployer`'s `PowerUserAccess` + `smallstash-deployer-iam-scope`
  are enough to deploy this stack. The IAM resource scoping
  (`role/smallstash-*`, `role/cdk-*`, `policy/smallstash-*`, ...) doesn't
  need to match CDK's generated logical names (`SmallstashStack-...`,
  which wouldn't match `smallstash-*` anyway - IAM ARN matching is
  case-sensitive), because those roles are created by CloudFormation as
  admin, not by the user directly.
- Confirmed separately that the deployer *can* read Budgets
  (`aws budgets describe-budgets` succeeds), so billing access is activated
  for IAM principals and `budgets:*` falls under `PowerUserAccess` - the
  cost kill switch has no special permission prerequisite.

- [ ] ⚠️ **Security observation: the deployer's IAM scoping is weaker than
      it looks.** Because the CFN execution role holds
      `AdministratorAccess`, anyone able to run `cdk deploy` with these
      credentials can effectively do anything in the account by putting it
      in a template - the carefully scoped
      `smallstash-deployer-iam-scope` policy constrains *direct* IAM calls
      but not what CloudFormation will do on their behalf. This is CDK's
      default bootstrap posture, not a misconfiguration, and it's a
      reasonable trade for a solo project. Worth knowing rather than
      assuming the scoping protects more than it does. If it ever matters,
      `cdk bootstrap --cloudformation-execution-policies <arns>` re-creates
      the exec role with a narrower policy - at the cost of having to widen
      it again every time the stack grows a new resource type.

## Live stack state - DESTROYED as of 2026-08-24

`SmallstashStack` is `DELETE_COMPLETE` (last deleted 2026-08-24 14:43 UTC;
several earlier destroy/recreate cycles before that). Verified gone:
Cognito pool `eu-west-1_fuVsnnUma`, DynamoDB `smallstash-users`, the vault
bucket, and the `smallstash-backend` Lambda. Deliberate - the stack is
being torn down between pre-production iterations, which is exactly what
the DESTROY removal policy is for.

⚠️ **Every "Live stack outputs" value recorded further down this file, and
in the repo-root `.env`, is therefore dead** - pool id, client id, API URL,
bucket names. This has already caused one confusing incident (a "you're
offline" error in local dev that was really a deleted API Gateway). After
the next `cdk deploy`, refresh both from:
`aws cloudformation describe-stacks --stack-name SmallstashStack --query "Stacks[0].Outputs"`.

`SMALLSTASH_INVITE_CODE` and `SMALLSTASH_ALERT_EMAIL` in `.env` are *not*
stack-derived and stay valid across recreates.

## Full teardown capability - always DESTROY, permanently (2026-08-24, decision finalized 2026-08-25)

`SmallstashStack.java` used to read a `destroyData` CDK context flag to
decide the `RemovalPolicy` on the 3 data-bearing resources (S3 vault
bucket, DynamoDB table, Cognito pool), defaulting to `RETAIN`. That flag
was removed - the account is currently 100% dev/test with no real user
data, so `dataRemovalPolicy` is now hardcoded to `RemovalPolicy.DESTROY`
(+ `autoDeleteObjects(true)` on the bucket) unconditionally. `cdk destroy`
now tears down everything cleanly in one command, with no orphaned
S3/DynamoDB/Cognito resources left behind to hunt down and clean up by
hand (see the RETAIN-vs-orphan discussion this replaced, earlier in this
file's history/git log if needed).

Verified with a local synth that `DeletionPolicy: Delete` is now baked
into all three resources unconditionally, not just assumed from the code.

- [x] **Closed, not deferred (2026-08-25): no RETAIN safety net planned.**
      Re-evaluated (see the security-review section above for the full
      reasoning - Cognito User Pools can't be re-imported into
      CloudFormation at all, so RETAIN wouldn't have delivered full
      recovery anyway) and the answer is DESTROY stays permanently, real
      secrets included, as an accepted risk rather than a gated one. The
      lighter-weight `deletionProtection(true)` fallback (table + pool
      only, not RETAIN) remains available if this tolerance changes, but
      is not itself planned.

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

## Post-deploy smoke test - security review, 2026-08-24 redeploy

Full pass against the live stack after the Phase 0-3 security work
actually shipped (all 50 resources `CREATE_COMPLETE`, none in a bad
state). Every item below hit the real API/Cognito/AWS APIs, not read from
the template:

- [x] `GET /vault`, `PUT /keys` unauthenticated → 401; garbage bearer
      token → 401; undefined route → 404.
- [x] All four CloudFront security headers present: HSTS
      (`max-age=31536000; includeSubDomains`), `X-Frame-Options: DENY`,
      `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- [x] CSP present as `Content-Security-Policy-Report-Only` (not yet
      enforcing, as intended) with the exact directives from
      `SmallstashStack.java`.
- [x] `config.json` matches the new stack's actual outputs.
- [x] Cognito pool: `UserPoolTier: PLUS`,
      `AdvancedSecurityMode: ENFORCED`, `PreSignUp` trigger wired to
      `smallstash-presignup`, `AllowAdminCreateUserOnly: false` (self-signup
      still enabled, gated by the trigger instead - as designed).
- [x] App client: `PreventUserExistenceErrors: ENABLED`, refresh token
      10080 minutes (7 days).
- [x] **User enumeration fix confirmed live and working exactly as
      intended**: an `InitiateAuth` for a nonexistent user no longer
      returns `UserNotFoundException` - it now returns an indistinguishable
      simulated SRP challenge (a real `USER_ID_FOR_SRP`), so an attacker
      gets no signal either way.
- [x] **Invite gate confirmed live**: `sign-up` with a wrong invite code
      is rejected by the PreSignUp trigger with
      `UserLambdaValidationException: ... That invite code is not valid.`
      - the exact message written into the trigger.
- [x] Lambda: no `ReservedConcurrentExecutions` (confirms the revert
      shipped), `COGNITO_ISSUER`/`COGNITO_CLIENT_ID` present in env (JWT
      claim validation wired), log group retention **30 days** (confirms
      this is the fresh CDK-managed group, not the old orphan with no
      retention).
- [x] S3 vault bucket: lifecycle rule live exactly as configured
      (`NoncurrentDays: 90`, `NewerNoncurrentVersions: 3`,
      `AbortIncompleteMultipartUpload: 7 days`).
- [x] DynamoDB: PITR `ENABLED`.
- [x] Cost kill switch: budget `smallstash-app` exists at $10; its
      `BudgetsAction` is `APPLY_IAM_POLICY`, `AUTOMATIC` approval, status
      `STANDBY` (healthy/watching, hasn't tripped).
- [x] CloudWatch alarm `smallstash-backend-invocation-spike`: state `OK`,
      threshold 200 as configured.
- [x] API Gateway: throttle live (10 rps / 20 burst), access logging
      wired to `/aws/apigateway/smallstash-api`, CORS allowlist is a single
      origin (the CloudFront domain) - `localhost:5173` confirmed absent
      from the deployed API.
- [x] `iam:ListRolePolicies` denied for `smallstash-deployer` when
      checking the Lambda's inline policy directly - **expected**, same
      scoping seen before this deploy; not a regression, just means that
      one specific read isn't independently verifiable from here (the
      policy's *effect* - the 401s/etc. above - is what's actually being
      tested).

- [x] **SNS subscription confirmed (2026-08-24)** - was flagged as the one
      real follow-up from the smoke test, now closed. Confirmed via
      `aws sns list-subscriptions-by-topic`: `SubscriptionArn` is a real
      ARN, not `PendingConfirmation`. Both the invocation-spike alarm and
      the cost kill switch will actually notify `andystarrrr@gmail.com` now.

The full security review (Phases 0-3) is deployed, smoke-tested against
the live stack, and its one loose end (the SNS confirmation) is closed.

Live stack outputs (account `060795901917`, region `eu-west-1`) - **updated
2026-08-24, redeploy after the security review (Phases 0-3, minus reserved
concurrency - see "Full teardown capability" and the reserved-concurrency
revert above). This is the first deploy carrying the invite gate, threat
protection, the CSP (report-only), and the cost kill switch - all
verified live below, not just assumed from the code. `SiteBucketName`
confirmed via `aws cloudformation describe-stack-resources` (it isn't a
`CfnOutput`, the others are from `describe-stacks`):**
```
ApiUrl            = https://g0bbiheo9k.execute-api.eu-west-1.amazonaws.com
SiteUrl           = https://ds9wv7ctss47x.cloudfront.net
UserPoolId        = eu-west-1_PWU4xOAuS
UserPoolClientId  = 2hiuf3q0tvrep45rtst0iei3nv
VaultBucketName   = smallstashstack-vaultbucket95cbf29a-9ydlr8li6uc0
SiteBucketName    = smallstashstack-sitebucket397a1860-uq9w1b4lylc0
```
`.env` at the repo root updated to match (gitignored, not shown here).

Previous outputs (now stale, kept only as a record - every value below
stopped resolving once that stack was destroyed 2026-08-24):
```
ApiUrl            = https://ep63h3wj01.execute-api.eu-west-1.amazonaws.com
SiteUrl           = https://d3gmlgyc7u2r6p.cloudfront.net
UserPoolId        = eu-west-1_fuVsnnUma
UserPoolClientId  = 26dt3ssngkenbj8kq66c8eanrn
VaultBucketName   = smallstashstack-vaultbucket95cbf29a-1qobdurmi9gc
SiteBucketName    = smallstashstack-sitebucket397a1860-ayivkugarcbb
```
**Reminder for next time this happens**: `.env` doesn't auto-update on
redeploy - if local dev suddenly can't reach the API/Cognito, check
`.env` against `aws cloudformation describe-stacks --stack-name
SmallstashStack --query "Stacks[0].Outputs"` before assuming a real
network problem.

Previous outputs (now stale, kept only as a record - every value below
stopped resolving once the stack above was destroyed):
```
ApiUrl            = https://prk5kj0aq8.execute-api.eu-west-1.amazonaws.com
SiteUrl           = https://d3pzt5m3kmghz7.cloudfront.net
UserPoolId        = eu-west-1_Ol6ed2DbJ
UserPoolClientId  = 7g2krg0h01l25ud3eqqkh1sb17
VaultBucketName   = smallstashstack-vaultbucket95cbf29a-gjcce2ynr0zz
SiteBucketName    = smallstashstack-sitebucket397a1860-qqtuwnnfao9m
```

## Manual test user (2026-08-23) — stand-in, not the real signup flow

Created via `admin-create-user` + `admin-set-user-password --permanent`
(bypasses email verification entirely - fine for a one-off manual test
account, **wrong for real users**). See architecture.md §9 for why this
isn't the real flow: the PWA must use the actual self-service `SignUp` +
`ConfirmSignUp` APIs instead.

**Gone as of the 2026-08-24 deploy** - that pool was destroyed and
recreated fresh (see "Live stack outputs" above), so the `sub` recorded
below (from the 2026-08-23 pool) no longer resolves to anything.
**Deliberately not recreated** (2026-08-24) - not needed right now, and
the stack is about to go through another destroy/recreate cycle anyway
(see "Full teardown capability" above) which would just orphan it again.
`.env`'s `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` are left blank until
there's an actual need. Previous (now-stale) identity, kept only as a
record of the pattern:
```
email (sign-in alias) = test@example.com
password               = <was in TEST_USER_PASSWORD - never committed>
sub (real identity)    = 2275b414-90e1-704f-8271-e318f8ced185   # STALE - old pool, gone
```

- [ ] **Recreate the manual test user** (`admin-create-user` +
      `admin-set-user-password --permanent` against whatever `UserPoolId`
      is live at the time) only once `tests/api/` or manual sign-in
      testing is actually needed again.
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

## PWA: offline access to key material - fixed in code, not yet deployed (updated 2026-08-25)

🔴 **Was CONFIRMED BROKEN (2026-08-25)**, found by the first real-browser
test of this flow. The original "resolved 2026-08-23" claim was true only
of the unlock *logic* (`session.js`/`cache/db.js`), verified by unit test
at the time - `web/e2e/offline-unlock.spec.js` was the first time this ran
end-to-end in a real offline browser, and it failed before ever reaching
the offline-unlock code path at all.

**Root cause, confirmed by reading the code, not guessed from the
symptom**: `vite.config.js`'s service-worker precache glob was
`['**/*.{js,css,html,svg,woff2}']` - `.json` was never in it, and there was
no `runtimeCaching` rule for `/config.json` either. `config.js`'s
`fetch('/config.json')` therefore always went straight to the network with
zero offline fallback. Going offline and reloading showed the app's own
"Small Stash failed to load its configuration. Please try refreshing the
page." error (screenshot captured during the test run) - the app couldn't
finish booting offline, so `App.svelte` never even reached the
`showOffline`/`OfflineUnlockForm` branch this feature depends on.

- [x] **Fixed (2026-08-25, not deployed)**: `vite.config.js` gained a
      `runtimeCaching` entry for `/config.json` (Workbox `NetworkFirst` -
      try the network first so an online session always gets the current
      config, fall back to the cached response once the network fails;
      `networkTimeoutSeconds: 3` so a slow-but-present connection doesn't
      hang boot; `maxEntries: 1`, there's only ever one config.json).
      Confirmed compiled into `dist/sw.js` (`grep` for `NetworkFirst`/
      `smallstash-config`).
      **Verified working at the mechanism level**, not just "should work":
      a standalone script against `npm run preview` showed
      `fetch('/config.json')` returning **200 while fully offline**
      (`context.setOffline(true)`), and the "failed to load its
      configuration" error no longer appearing.
      **Could not be verified via the full `offline-unlock.spec.js` flow
      locally** - CORS blocks `localhost:4173` from reaching the real API
      (only the CloudFront origin is in the deployed allowlist), so a
      local run fails earlier, on the online sign-in step, for a reason
      unrelated to this fix.
- [ ] **`web/e2e/offline-unlock.spec.js` still carries `test.fail()`,
      deliberately** - the live deployed site doesn't have this fix until
      the next frontend redeploy, so against the suite's default target
      (the live URL) this genuinely still fails. Remove `test.fail()` only
      after re-running this spec against the live URL post-deploy and
      seeing it pass for real.

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
      Covers sign-in (happy path, wrong Master Password),
      offline unlock (happy path, never-cached guard, wrong
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

## Browser/E2E testing with Playwright - negative pre-login specs passing live (2026-08-25)

**Decision:** all browser-level verification is being collected into one
piece of work that runs *after* the security-fix phases are complete,
rather than a manual click-through after each phase. Playwright is the
chosen vehicle.

- [x] **Harness installed (2026-08-24)**, while the first real deploy was
      running in parallel. `@playwright/test` added as a `web/`
      devDependency; `web/playwright.config.js` (bundled Chromium project,
      `PLAYWRIGHT_BASE_URL` left unset by design - see below);
      `web/e2e/README.md` carries this same priority list so it's visible
      from the test directory, not just here; `npm run test:e2e` script
      added; `test-results/`/`playwright-report/`/`blob-report/` gitignored.
      **No specs exist yet** - `npx playwright test --list` correctly
      reports zero tests; writing them is the still-deferred part.
      Verified end-to-end: a real `chromium.launch()` + page load succeeded
      using the **existing local browser cache with zero download** (the
      cached version, `chromium-1234`, happened to match what
      `@playwright/test` 1.62.1 requires). The config deliberately does
      **not** rely on that being true generally - it uses Playwright's own
      bundled Chromium project rather than `channel: 'chrome'`, so a
      fresh machine or CI runner would just need one `npx playwright
      install chromium`, not a specific local Chrome/Edge install. `npm
      test` re-verified unaffected (still 97/97).
- [x] **Pre-login negative specs (2026-08-25) - 13/13 passing against the
      live site**, not assumed from a template diff: actually run, twice.
      `web/e2e/fixtures.js` (a `page` fixture that captures every
      `securitypolicyviolation` DOM event - fires for both `Report-Only`
      and enforcing CSP, `event.disposition` distinguishes them, which is
      the whole reason this suite exists), `web/e2e/env.js` (reads
      `SMALLSTASH_INVITE_CODE` from the repo-root `.env`, never logged),
      `security-headers.spec.js`, `login-negative.spec.js`,
      `signup-negative.spec.js` (wrong invite code rejected by the
      PreSignUp trigger, every client-side validation path, no CSP
      violations on any of it).
      **What the first run actually caught - worth remembering for any
      future spec against this app**: `getByLabel('Login password')`
      matched *two* fields, not one. Playwright's `getByLabel` does a
      substring match against the entire computed label text - which in
      this app includes the `<small>` hint nested inside the same
      `<label>` - and the Master Password field's own hint text says
      "kept separate from your login password on purpose". So a bare
      `'Login password'` string matched both the Login Password field and
      the Master Password field. Not an app bug - fixed by anchoring the
      regex to the start (`/^Login password/i`), no markup changes needed.
      A second false start: `{ exact: true }` against the same wrong
      assumption doesn't error, it just finds nothing and times out after
      30s waiting for an element that will never appear - slower to debug
      than the strict-mode-violation the substring version threw
      immediately. Same anchored-regex fix applies to Master
      Password/Confirm login password/Confirm Master Password.
- [ ] **Registration, in progress.** Real self-service signup through the
      browser (not `admin-create-user` - this suite is scoped to only
      interact with the app the way a real user would, per the 2026-08-25
      testing-session ground rules). A spec can fill and submit the signup
      form, but the emailed confirmation code needs the human in the loop -
      test account `prybaten-demo@proton.me`.
- [ ] **The actual point of this whole suite, still ahead**: assert **zero**
      CSP violations across every *authenticated* flow, particularly
      `'wasm-unsafe-eval'` (hash-wasm's Argon2id) - only reachable after a
      successful login (`unlockWithMasterPassword`/`createKeyMaterial`),
      so nothing the pre-login specs cover exercises it. Then flip the CSP
      header in `SmallstashStack.java` from `Report-Only` to enforcing (the
      `!! FLIP TO ENFORCING !!` comment there) and redeploy.
- [ ] **The features that have never been run in a real browser.** Per
      CLAUDE.md, most of the UI is verified only by unit test + build:
      offline unlock (Playwright's `context.setOffline(true)` makes this
      genuinely testable - and already found a real bug, see above), the
      15-minute inactivity auto-lock, change-Master-Password, the password
      generator's clipboard behaviour, and the 409 conflict on a stale
      `PUT /keys`.
- [ ] **Password reset** (`ForgotPasswordForm.svelte`) - same shape as
      registration above, needs an emailed code, human in the loop again.
- [x] **The `null`-in-error-message bug - fixed (2026-08-25, not
      deployed).** Reported on Change Login Password
      ("Password did not conform with policy: null"); confirmed by grep
      that `"did not conform with policy"` appears nowhere in this repo's
      source, so it's AWS Cognito's own `InvalidPasswordException.message`
      (the "null" is AWS's backend leaving a template slot unfilled),
      passed straight through by `err.message ?? String(err)` - not a
      client-side formatting bug, and not fixable by changing a template
      string that doesn't exist in our code.
      `web/src/lib/errors.js`'s `friendlyAuthErrorMessage()` matches on the
      Cognito client library's `error.code`/`error.name` (confirmed both
      are set to `'InvalidPasswordException'` by reading
      `node_modules/amazon-cognito-identity-js/lib/Client.js`, not
      guessed) and substitutes a real, useful message. Wired into all
      three places a new Cognito login password is submitted -
      `ChangeLoginPasswordForm`, `SignupForm`'s `submitRegister` (the
      client-side pattern check there doesn't catch a policy-compliant but
      known-breached password, which Cognito Plus/threat protection can
      still reject with the same exception), and `ForgotPasswordForm`'s
      reset-confirm step (had the identical exposure, no pattern check at
      all).
      Verified: `web/src/lib/errors.test.js` (5 tests, matches the real
      Cognito client library's error shape) plus `npm test` (97, up from
      92) and `npm run build` both clean.
      `web/e2e/change-login-password.spec.js` updated to assert the fixed
      behaviour and reconfirmed it still correctly fails against the live
      (undeployed) site - same pattern as
      `security-headers.spec.js`'s CSP-enforcing check. Will pass once
      deployed.
- [ ] **Decide whether Playwright also replaces the "Svelte component
      tests" item below**, or sits alongside it. Component tests and E2E
      answer different questions; doing both is defensible, doing neither
      is the current state.

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
      routing (login/signup/offline branches - currently only exercised by
      hand).

## PWA hosting - CDK constructs written, not yet deployed (2026-08-24)

`SmallstashStack` now defines the full S3 + CloudFront hosting path for
`web/dist/`: a private `SiteBucket` (`BLOCK_ALL`, DESTROY/auto-delete since
it's disposable build output, not user data - notably always DESTROY
regardless of whatever `dataRemovalPolicy` governing `VaultBucket` is set
to, see the security-review section above), a `SiteDistribution`
(CloudFront) reaching it via Origin Access Control (no public bucket
policy), `index.html` as both
default root object and the 403/404 error-response fallback (so client-side
routing survives a refresh), and a `BucketDeployment` that uploads
`web/dist/` and invalidates the cache on every `cdk deploy`. The HTTP API's
CORS `allowOrigins` now includes the distribution's domain name (a
same-stack CloudFormation token, resolved automatically - no manual step)
alongside `localhost:5173` for local dev. Verified with a local `cdk synth`
equivalent (`../mvnw compile exec:java` from `infra/`, after `npm run build`
in `web/` so `web/dist/` exists) - produces a clean CloudFormation template,
no AWS calls made.

- [ ] **Not deployed yet** - this is an AWS-account-mutating change once it
      reaches `cdk deploy` (creates a new bucket + CloudFront distribution).
      Needs explicit go-ahead per CLAUDE.md, same as every other stack
      change. Remember to run `npm run build` in `web/` before deploying -
      CDK doesn't build it for you, same as the backend jar.
- [ ] **No custom domain yet** - CloudFront's own `*.cloudfront.net` URL
      (the `SiteUrl` stack output) is fine to start; a real domain
      (Route 53 + ACM cert) is a separate, later decision, not blocking a
      first working deploy.
- [ ] **Deploy coupling**: `BucketDeployment` bakes the frontend upload into
      `cdk deploy`, so a frontend-only change currently still needs a full
      CDK deploy (fast/cheap, but couples the two). Fine for a ~20-user app;
      revisit only if that friction becomes real (e.g. split into a CI step
      doing `aws s3 sync` + CloudFront invalidation instead).

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
- [ ] **Application-level logging at critical points, both Lambdas**
      (raised 2026-08-27/28, while investigating the live `s3:ListBucket`
      AccessDenied incident above). Neither Lambda has ever had a single
      application log statement - everything so far is Micronaut/AWS SDK
      framework default output, plus the one temporary diagnostic line added
      for that incident (meant to be removed once it's resolved, not kept).
      Worth doing deliberately, not reactively: needs a real decision on
      what's worth logging (request received/completed with outcome? every
      S3 call? just error paths?), at what level, and which fields are safe
      to include (`userSub` is fine - architecture.md §5 already treats it
      as non-secret - but nothing ciphertext/token-shaped ever should be).
      The logging *pipeline* itself (`logback.xml` in both modules) was
      already fixed the same day - see the entry above - so whatever gets
      added here will actually read cleanly in CloudWatch from day one.

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
