# ADR-0001: Storage — S3 vs DynamoDB for smallStash

**Status:** Accepted and implemented — see docs/architecture.md §9 for what's built.
**Date:** 2026-08-16
**Context doc:** [smallStash-session-summary.md](../smallStash-session-summary.md), [architecture.md](../architecture.md)

## Context

The original plan (see session summary) stores everything in S3: one encrypted
whole-vault blob per user (`vault.json.enc`) plus a companion metadata object
(`keys.json` — Argon2id salt, KDF params, wrapped Vault Key, wrapped Recovery
Key). DynamoDB was explicitly rejected in favor of S3.

The question raised: should DynamoDB be used instead — specifically, would it
support **custom fields** (arbitrary user-defined fields on a vault entry,
e.g. "PIN", "Security Question") better than a flat S3 blob?

## Key insight

**smallStash is zero-knowledge: the backend never sees plaintext field data,
regardless of which storage engine holds it.** The whole vault (including any
custom fields the user adds) is serialized to JSON and AES-256-GCM-encrypted
*client-side* before it ever reaches AWS. Whether the ciphertext bytes sit in
an S3 object or a DynamoDB item attribute, the backend still only ever
stores/returns an opaque blob — it cannot read, index, filter, or validate
individual fields either way, and must never be given the ability to.

So **"DynamoDB for flexible custom fields" does not actually apply here** —
that reasoning is valid for a backend that parses/queries plaintext records,
which is precisely what this project's threat model forbids. Custom fields
are purely a client-side JSON schema concern inside the encrypted blob; the
storage engine is irrelevant to that flexibility.

That said, there's a *different*, legitimate reason to bring in DynamoDB —
not for the vault content, but for the small pieces of **structured,
frequently-read, backend-visible (but still non-secret) metadata** the
system needs:

- KDF params + salts + wrapped keys (`keys.json` equivalent) — small
  (<1 KB), read on every login, natural single-item key-value lookup.
- Future per-user app metadata once multi-user exists: created date,
  storage usage, plan/tier, device list, last-login audit trail.
- A future option (not v1) to store vault *entries* as individual items for
  incremental sync and per-entry conflict resolution across multiple
  devices, instead of clobbering the whole blob on every save.

None of this requires reading plaintext — it's either non-secret metadata
(timestamps, counters) or itself ciphertext/opaque key material, just shaped
as small structured items instead of one big blob.

## Decision

**Hybrid storage:**

1. **DynamoDB** (on-demand billing, no capacity planning) — single table
   `smallstash-users`:
   - PK `USER#<cognito-sub>`, SK `PROFILE` → createdAt, plan/tier, storage
     usage counters, (optionally) display name.
   - PK `USER#<cognito-sub>`, SK `KEYS` → Argon2id salt, KDF params
     (memory/iterations/parallelism), wrapped Vault Key (via Master Key),
     wrapped Vault Key (via Recovery Key), key-material version number.
   - Single-table design leaves room to add `SK ENTRY#<id>` items later
     without provisioning a new table.

2. **S3** (bucket `smallstash-vaults`, versioning on) — unchanged from the
   original plan for the bulk secret payload:
   - `users/{cognito-sub}/vault.json.enc` — the whole encrypted vault blob.
   - Versioning gives free rollback/undo if a client ever uploads a corrupt
     or malicious overwrite.

3. Vault content stays a **single whole-blob per user** in S3 for v1 — no
   per-entry DynamoDB storage yet. Revisit only if/when multi-device
   simultaneous-edit conflicts become a real, observed problem (v2+); the
   single-table design above already leaves room for that migration.

## Consequences

- Two AWS services instead of one, marginally more IaC/config — but both
  are effectively free at this usage scale (see cost table in
  [architecture.md](../architecture.md)).
- Login flow becomes **1 DynamoDB `GetItem`** (fast, ~5-10 ms, no S3
  `GetObject` latency/cold overhead) **+ 1 S3 `GetObject`** for the vault
  blob — same or fewer round trips than the original two-S3-object plan,
  and a cleaner separation of concerns (identity/key metadata vs. bulk
  secret payload).
- Establishes a DynamoDB single-table home for multi-user app metadata
  (needed regardless of the vault-storage question once registration
  opens up) without adding new AWS resources later.
- No change to the zero-knowledge guarantee: every attribute DynamoDB
  stores is either non-secret metadata or ciphertext/wrapped key material,
  never a plaintext vault field.

## Alternatives considered

- **S3-only (original plan).** Simplest possible v1, and *not wrong* for
  the vault blob itself — kept for that part. Rejected as the answer for
  the keys/metadata piece only because DynamoDB measurably fits that
  access pattern better (single small item, frequent reads, no need for
  object versioning on a few hundred bytes of key material).
- **DynamoDB-only (vault entries as items too).** Rejected for v1: adds
  real complexity (400 KB per-item limit forcing multi-item vaults for
  large entry counts or attachments, more query/merge logic, more IAM
  surface) without a concrete driving need yet. The "custom fields" case
  that prompted this ADR turned out not to require it — see Key insight
  above.
