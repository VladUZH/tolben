# Contributing to Tolben

Thank you for looking. This document is short, and most of it is about the two or three
things in this project that are unusual.

## The bar

Tolben's central claim is that it **refuses any rewrite it cannot prove keeps your
meaning**. Everything below exists to keep that claim true. A change that makes the
product faster, prettier or more capable but weakens that claim will not be merged.

## Before you open a pull request

```bash
npm install          # no network beyond the registry; there is no postinstall step
npm test             # 862 tests
```

Six of those tests need a real model server on `127.0.0.1:8080`. **Without one they skip,
and a run that skips them has not tested the thing the product is** — those six are the
only tests that exercise schema-constrained decoding, the stop string, and a verifier that
answers. `README.md` has the two commands that give you a server.

If you touched anything the model talks to, run it against a real `llama-server` *and* a
real Ollama before you call it done. The projects' behaviours differ in ways that a mock
written by the person changing the code will not predict: on 2026-09-02 the Ollama adapter
had eighteen passing tests and could not analyse a single sentence, because the engine
assumed a JSON schema's properties come back in the schema's order — llama.cpp does that
and Ollama does not.

## Three rules that are not negotiable

1. **Nothing is fetched that is not pinned by sha256.** Not fetched-and-checked — not
   fetched. `obsidian-plugin/runtime/manifest.json` is the record, and an entry with a
   null hash makes the provisioner report itself unavailable rather than download on
   trust.
2. **Nothing is written into the user's vault except `data.json`.**
   `tests/plugin-vault.test.mjs` enforces this against the committed bundle as well as the
   source, because a mocked Obsidian API proves only that the mock was not called.
3. **The three control instruments must not move silently.** `bench/oracle.mjs`,
   `bench/precision-check.mjs` and `bench/unlock-check.mjs` are controls, not benchmarks:
   they print the same figures every run unless a guard changed. If your change moves one,
   **say why in the commit message**. A re-baseline goes through `--write --note "why"` so
   the reason lives in the baseline file rather than only in a commit nobody re-reads.

## Style

Match the surrounding code: same comment density, same naming, same idioms. The codebase
explains *why* a guard exists, usually with a citation to the measurement that produced
it. Keep that up — a guard without a reason is a guard nobody can safely remove later.

`REPORT.md` is an append-only engineering log. New findings go at the end as a dated
section. Earlier sections are history: annotate them, never rewrite them.

## Sign your commits off

This project has no CLA. Instead, contributions carry a
[Developer Certificate of Origin](https://developercertificate.org/) sign-off, which
records that you have the right to submit the work:

```bash
git commit -s
```

That appends a `Signed-off-by:` line. Pull requests without it will be asked for one.

## Reporting a wrong answer

Two issue types matter more than any other here, and both have templates:

- **A wrong refusal** — the tool refused a rewrite that actually preserved the meaning.
- **A reported miss** — the tool accepted or proposed a rewrite that changed the meaning.

The second is a defect in the product's core claim, and is treated as such. Include the
exact original sentence and what the tool did with it; that is enough to reproduce.

## Licence

Code contributions are under Apache-2.0 (`LICENSE`). Corpus and label contributions are
under CC-BY-4.0 (`LICENSE-DATA`). Do not add third-party text to `bench/corpus/` without
reading `bench/corpus/THIRD-PARTY.md` first — some of what is already there is quoted
under narrow terms and is not offered to anyone under any licence.
