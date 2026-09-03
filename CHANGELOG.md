# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

`REPORT.md` is the engineering log and carries the measurements, the dated findings and
the reasoning behind them. This file records only what changed between releases.

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/VladUZH/tolben/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/VladUZH/tolben/releases/tag/v1.0.0
