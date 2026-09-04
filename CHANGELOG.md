# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

`REPORT.md` is the engineering log and carries the measurements, the dated findings and
the reasoning behind them. This file records only what changed between releases.

## [Unreleased]

Nothing yet.

## [1.0.1] - 2026-09-04

A point release for three defects in the managed-server path, all found on 2026-09-04 by
running the shipped bundle against a real `llama-server` for the first time, none of them
visible to the 928 tests 1.0.0 shipped with. `REPORT.md` under that date has the run that
found them and the run that shows them fixed.

Published the same day by `release.yml`, dispatched by the owner after this session's token
was refused both a tag push and a dispatch; the six assets hash to the `SHA256SUMS` attached
and to the tree at `c9db03f`, and the lifecycle rig ran clean on those bytes. Tagged
`v1.0.1`, a prefix Obsidian's directory installer does not accept and the workflow no longer
adds; the release has to carry the tag `1.0.1` before the directory submission.

### Fixed
- **The setup pane could not download.** The plugin's own fetch followed no redirect and
  exposed no body, and GitHub and Hugging Face both answer a release URL with a 302, so
  every download ended in "HTTP 302". It now follows redirects (bounded, with the
  authorization header dropped across origins), streams the body, and lands the 1.5 GB
  model at line speed — 53 MB/s here, verified against its pin.
- **The first sentence on a fresh server failed at the 12 s timeout, twice.** The warm-up
  loaded the weights only; the 1,587-token clarity prompt was read in by the writer's
  first sentence, which took about 40 s and was cut off at 12. The connection now reads
  both prompts in under `Tolben: starting the model`, sentences finished meanwhile wait
  for it, and the first sentence after answers in about 5 s.
- **A server Tolben started was never started again** after the idle unload or an
  Obsidian restart: the plugin connected to a port whose process was gone and every
  sentence failed until the setup command was run by hand. `data.json` now records that
  the runtime is managed, and the plugin re-provisions it from the files on disk at
  launch and on the sentence after an unload — never downloading on its own.

### Changed
- "Unload the model when idle" defaults to sixty minutes rather than ten. Coming back
  costs about 50 s on a 4-core CPU (files re-verified, server restarted, prompts read in),
  and ten minutes made every short break pay it.
- The setup pane says "Reading the prompts in" for the forty seconds that now happen
  there instead of on the first sentence.

### Added
- `tools/plugin-lifecycle.mjs`: the shipped bundle through setup, the first sentences,
  the idle unload, a restart and recovery, against a real server, with every step timed.
  It is run before a release is tagged; `--fresh` makes it download both artefacts
  through the plugin's own fetch.
- `tests/plugin-node-fetch.test.mjs` (a real redirecting server on loopback) and
  `tests/plugin-lifecycle.test.mjs` (the bundle against a fake model server and an
  injected provisioner): 15 tests for what 1.0.0 had none of.

## [1.0.0] - 2026-09-03

First release. Tagged by the owner from the Releases page; `release.yml` built and
attached `main.js`, `manifest.json`, `styles.css`, `LICENSE`, `NOTICE` and `SHA256SUMS`,
and the hashes in that file match the committed tree at `352100d`. The gate playground
went live the same day at <https://vladuzh.github.io/tolben/>.

### Added
- Sentence-completion trigger: only the sentence you just finished is analysed.
- Word-level blue underlines that survive later typing, with a hover card carrying the
  full proposed sentence, inline insertions and deletions, a reason, Replace and Dismiss.
- A deterministic meaning-preservation gate with 24 rejection reasons, able to refuse the
  model outright rather than show its output.
- A runtime provisioner that fetches and verifies a `llama-server` build and a model, both
  pinned by sha256, and reports itself unavailable rather than downloading on trust.
- An Ollama adapter alongside the bundled `llama-server`, and support for any
  OpenAI-compatible endpoint.
- Deterministic mechanics and clarity-rule tiers ahead of the model, and a persistent
  outcome cache so a model answer is never paid for twice.
- Three reproducible control instruments and a benchmark harness with sealed holdouts.

### Changed
- The product was renamed from **Stet** to **Tolben** before first release. Stet was
  abandoned on a preliminary trademark clearance assessment: at least five other active
  2026 STET writing and AI products exist, and the proofreader's-mark sense that made the
  name apt is also what made it vulnerable as merely descriptive. `REPORT.md`,
  "2026-09-02 — Stet becomes Tolben", has the detail.

### Removed
- The provisional GECToR grammar tier, whose ONNX weights are licensed for non-commercial
  use only and so could not ship in an Apache-2.0 release. It bought roughly 5 ms of first
  paint, not recall.

[Unreleased]: https://github.com/VladUZH/tolben/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/VladUZH/tolben/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/VladUZH/tolben/releases/tag/v1.0.0
