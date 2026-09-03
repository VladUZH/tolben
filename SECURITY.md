# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That opens a private advisory visible only to the
maintainers, and it is the preferred route because it needs no email address from either
side.

If that is unavailable to you, contact the maintainer through the address on their GitHub
profile and put `TOLBEN SECURITY` in the subject line.

Expect an acknowledgement within **5 working days** and an assessment within **15**. This
is a small project maintained by one person; if you have not heard back in that window,
please chase, because it means something went wrong rather than that the report was
dismissed.

Please give a reasonable window to ship a fix before public disclosure. If a report turns
into an advisory, you will be credited by whatever name you ask for, or not at all if you
prefer.

## Supported versions

Until 1.0.0 ships, only the `main` branch is supported. After that, security fixes go to
the latest minor release.

## What is worth reporting

This project's threat surface is unusual for a writing tool, because it provisions and
runs a local inference server. The following are all in scope:

- **Anything that lets an unpinned or substituted artefact be executed.** The provisioner
  downloads a `llama-server` build and a model file, and both are pinned by sha256 in
  `obsidian-plugin/runtime/manifest.json` and `models/MANIFEST.json`. A path where a
  download is used without its hash matching, or where a null-hash entry is fetched
  instead of refused, is a serious bug.
- **Archive extraction.** `obsidian-plugin/runtime/unpack.mjs` reads tar and zip archives.
  Path traversal via an entry name or a symlink target, absolute paths, or anything that
  writes outside the destination directory is in scope.
- **Anything written into the user's vault other than `data.json`.** That boundary is a
  product guarantee, not just a convention.
- **Any outbound network connection made after setup completes.** The product's central
  privacy claim is that nothing leaves the machine. A path that contacts a remote host
  while analysing text is a vulnerability, not a feature request.
- **The local HTTP server.** It binds loopback only. Anything that exposes it beyond the
  machine, or lets another local process drive it into writing files or executing code, is
  in scope.
- **Untrusted document content escaping its context** — a note whose text is treated as
  markup, a prompt-injection path that reaches beyond the model's answer into the file
  system or the network.

## What is not a vulnerability

- **The model proposing a bad rewrite.** The gate is designed to refuse meaning-changing
  suggestions and does not catch everything. That is a correctness issue: please file it
  as a *reported miss*, which is a normal issue type and one the project takes seriously.
- **Resource use.** A 2B model on CPU is slow and holds around 2 GB.
- **Findings against a build whose artefacts do not match the pinned hashes.** Verify with
  `npm run models:verify` first.
