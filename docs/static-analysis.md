# Static analysis - local, on demand only

Deliberately **not** wired into CI (there is no CI yet at all - see
[docs/todo.md](todo.md)). This is intentional, not a placeholder for a
future workflow file: the ask was tools you run yourself, when you want
them, with nothing running unattended. Neither tool below is installed as
a build dependency of any module - nothing here changes what `mvn package`
or `npm run build` do.

## Semgrep - code pattern scanning

Free, no account/server needed. Install once per machine:

```bash
pip install --user semgrep
# or: brew install semgrep / docker run --rm -v "$PWD:/src" semgrep/semgrep ...
```

Run on demand from the repo root:

```bash
# This repo's own rules only - fast, zero network calls, tailored to the
# zero-knowledge invariant (see semgrep/custom-rules.yml for what each
# rule catches and why).
semgrep scan --config semgrep/custom-rules.yml

# Add Semgrep's free community rulesets (OWASP Top 10, secrets, etc.) in
# the same pass - slower, needs network access to pull rules the first
# time:
semgrep scan --config auto --config semgrep/custom-rules.yml
```

`semgrep/custom-rules.yml` covers what the generic community rulesets
don't already know about this specific app: logging variables that look
like Master Password/vault key/plaintext material (browser console *or*
backend logs - either one defeats zero-knowledge), `Math.random()`
anywhere near crypto code (must be `crypto.getRandomValues()`, i.e.
`web/src/lib/bytes.js`'s `randomBytes`), hardcoded/static IVs or salts,
and references to weak algorithms (MD5, SHA-1, DES, RC4, AES-ECB) that
have no legitimate reason to appear anywhere in this codebase's crypto
path (Argon2id + AES-256-GCM only, see
[docs/architecture.md §3](architecture.md#3-encryption-model-client-side-only-zero-knowledge)).

Verified 2026-09-13: all 5 rules confirmed to actually fire (tested
against deliberately-bad throwaway snippets, not just checked for valid
YAML), then run clean (0 findings) against the real repo.

`.semgrepignore` at the repo root keeps it off `target/`, `web/dist/`,
`infra/cdk.out/`, `node_modules/`, and `docs/learning-notes/` (gitignored
anyway - see [`learning-notes-not-committed`] memory).

## OWASP Dependency-Check - vulnerable dependency scanning

Free, runs entirely locally as a Maven plugin invocation - no server, no
pom.xml changes (nothing to keep in sync across the four independent
Maven projects in this repo - see CLAUDE.md's Repo map). It downloads its
own copy of the NVD vulnerability database on first run, which is
genuinely slow (many minutes) and needs network access; later runs only
fetch deltas and are much faster.

**Needs a free NVD API key - confirmed by actually running it, not
assumed.** Without one it fails outright (`NvdApiException: Invalid API
Key, length of 0 too short...`) rather than just running slower; NVD
started requiring a key for any real usage of this API. Request one at
<https://nvd.nist.gov/developers/request-an-api-key> (instant, no cost,
just an email address) and pass it with `-DnvdApiKey=...` - don't put it
in any file this repo tracks, same rule as every other credential here.

```bash
# From the repo root - scans common/, vault-lambda/, files-lambda/
# together in one aggregate report (they build together via the root
# aggregator pom, same as `mvn package` does).
./mvnw org.owasp:dependency-check-maven:13.0.0:aggregate -DnvdApiKey=<your key>

# infra/ is an independent Maven project (not part of that reactor - see
# CLAUDE.md), so it needs its own run:
cd infra && ../mvnw org.owasp:dependency-check-maven:13.0.0:check -DnvdApiKey=<your key>
```

Report lands in `target/dependency-check-report.html` (per module, or at
the repo root for the aggregate run). Not committed - it's a scan output,
regenerate on demand.

The version (`13.0.0`, latest on Maven Central as of 2026-09-13) is
pinned in the command itself rather than in any `pom.xml`, so there's
nothing to update in four places when a new release ships - just bump the
number typed on the command line.

For npm dependencies (`web/`), no extra tool is needed - `npm audit` is
already built into npm and free:

```bash
cd web && npm audit
```

## Why not SonarQube or Black Duck

Discussed and rejected for this project - see chat history / commit
history around 2026-09-13 for the reasoning. Short version: SonarQube's
self-hosted mode is a server + database to run and patch, which is real
ongoing operational weight even if only invoked "on demand" (there's no
serverless local mode); Black Duck is SaaS-backed SCA that needs an
account/Hub to report findings to, so it isn't a standalone local CLI
either. Both contradict this project's explicit near-zero-cost,
low-operational-burden stance ([CLAUDE.md](../CLAUDE.md)). Semgrep +
Dependency-Check + `npm audit` cover the same ground (code patterns,
dependency vulnerabilities) for free, as one-shot local commands.
