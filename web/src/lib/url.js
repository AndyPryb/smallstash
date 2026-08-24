/**
 * Safe rendering of the free-typed `url` field on a vault entry.
 *
 * Extracted out of EntryListItem.svelte specifically so it can be tested -
 * there's no component-test runner in this project yet (see docs/todo.md,
 * "Add Svelte component tests"), and a function whose whole job is refusing
 * dangerous input shouldn't be the one piece with no coverage.
 */

/**
 * Turn whatever the user typed into something safe to put in an `<a href>`.
 *
 * Two jobs, in priority order:
 *
 * 1. **Never emit a non-http(s) scheme.** A saved `javascript:alert(1)` would
 *    otherwise become a working XSS payload on click. That matters more here
 *    than in most apps: the crypto is client-side, so a script running in the
 *    page can read the Master Password / Vault Key out of memory - an entry
 *    that executes code defeats the entire zero-knowledge model. Same applies
 *    to `data:`, `vbscript:`, and friends.
 * 2. **Make scheme-less input work.** `example.com` in an href resolves as a
 *    *relative* path against this app's own origin, which just looks like a
 *    broken link. Assume https.
 *
 * Anything that isn't plainly http(s) has its scheme stripped and is treated
 * as a bare hostname, so the worst outcome is a dead link, never execution.
 * The caller still displays the raw `entry.url` as the link *text* - the user
 * sees exactly what they typed, only the destination is sanitised.
 *
 * @param {string} url raw, as typed by the user
 * @returns {string} safe to use as an href
 */
export function normalizedUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Strip any other scheme-looking prefix rather than trusting it.
  return `https://${trimmed.replace(/^[a-z][a-z0-9+.-]*:\/*/i, '')}`;
}
