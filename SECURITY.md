# Security Policy

## Status: decommissioned

This project is no longer deployed or maintained. It ran with real users from
2026-08-23 to 2026-09-19, when the stack was deliberately destroyed and every
AWS resource removed. There is no supported version and no release to patch.

This repository is archived and kept as a record of the work.

## Reporting a vulnerability

There is no active deployment to protect and no version that will be patched,
so there is deliberately no disclosure process here. The repository is
archived, so issues are closed.

## If you run this yourself

This is a personal project, published as a record of how it was built rather
than as software to deploy. It has never had an independent security review.
Two design decisions are deliberate, documented, and worth knowing before you
run it anywhere real:

- **All three data resources use `RemovalPolicy.DESTROY`.** A single
  `cdk destroy` permanently deletes every vault, with no recovery path. This
  was an accepted trade-off rather than an oversight — the reasoning is in
  [CLAUDE.md](CLAUDE.md) and `infra/src/main/java/andriy/prybaten/infra/SmallstashStack.java`.
- **Losing the Master Password means losing the data.** That is the design,
  not a gap in it: the backend stores only ciphertext it has no means to
  decrypt, and no recovery path exists that does not start with a secret only
  the user holds.

The security review carried out during development, including findings and
the controls that turned out to be impossible to implement, is in
[docs/todo.md](docs/todo.md).
