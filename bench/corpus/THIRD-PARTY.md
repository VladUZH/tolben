# Third-party text in this directory

Two files here quote text produced by Grammarly's hosted service. They are **not** the
author's work, are **not** covered by `LICENSE` (Apache-2.0) or `LICENSE-DATA`
(CC-BY-4.0), and are **not** offered to anyone under any licence. This note says exactly
what they are, why they are in the repository, and what was left out.

## What is here

### `grammarly-pairs.json`

200 sentences written for this project, typed into `app.grammarly.com` on 2026-08-29 with
every suggestion card accepted by hand, and the resulting document read back. 118 came
back changed; 82 were left untouched. Each row is `{ batch, theme, original, grammarly,
changed }`, so the third-party content is one short sentence per changed row — 118
sentences in all, the longest 31 words.

The originals and the 20 construction themes are the author's. Only the `grammarly` field
of the 118 changed rows is Grammarly's output.

### `oracle-labels.json`

54 hand-written meaning labels, one per refusal that `bench/oracle.mjs` produces when it
replays those pairs. Each label quotes the Grammarly rewrite it judges, in its
`grammarly` field. **The labelling is the author's work and is the point of the file;**
the quoted rewrite is what the label is about.

## Why they are in the repository rather than kept privately

They are the inputs to three of the four published instruments, and the project's central
claim is that its numbers can be re-derived by a reader rather than believed:

| Reads them | What it prints |
|---|---|
| `bench/oracle.mjs` | the replay ceiling: 88/118, hard-accept 73, verifier 15, hard-refuse 30 |
| `tests/oracle.test.mjs` | that the safety-probe rows stay refused, and that no `ALIGNED` label silently becomes accepted |
| `tests/gate.test.mjs` | that `src/gate.mjs`'s patterns still separate the flagged from the untouched |
| `tests/clarity-rules.test.mjs` | that a first-party rule is admitted only where the corpus shows the short form is safe |

Removing them would leave the repository asserting a comparison nobody can check, which is
the failure mode the whole project is arranged against.

The use is nominative and factual: short quotations of a competitor's published output,
used to measure and criticise it, attributed, not repackaged as a product, and not
substituting for the service. Grammarly is a trademark of its owner; this project is not
affiliated with, endorsed by, or derived from it. `docs/GRAMMARLY-BEHAVIOUR.md` and
`COMPARISON.md` are the findings; these files are the evidence for them.

## What was deliberately left out

Removed from the tree on 2026-09-02, because no instrument reads them and they carry more
third-party text than any published number needs:

- `grammarly-reference.json` — 50 sentences with **every suggestion card** transcribed
  individually: Grammarly's own category labels, its exact delete/insert spans, and the
  alternative fixes it offered for the same span. This is the closest thing here to a
  transcription of the product's interface, and nothing in the repository read it.
- `grammarly-correctness-pairs.json` — the same accept-everything method applied to 200
  sentences carrying planted grammar, punctuation, spelling and usage errors. Its findings
  survive in `docs/GRAMMARLY-CORRECTNESS.md`; the pairs themselves are not needed to
  reproduce anything the project publishes.

Both remain in this repository's git history until the history is rewritten before the
repository is made public. **Removing them from history is a release-checklist item, not
something this commit accomplishes.** Keep a private copy first if the underlying data is
still wanted.

Two related files are the author's own and stay under `LICENSE-DATA`:
`grammarly-probe-sentences.json` and `grammarly-correctness-probes.json` hold the probe
sentences written here and typed in — inputs, not output.

`grammarly-dev.json` holds 66 benchmark rows: 54 whose source sentences come from
Grammarly's published documentation and blog, and a 12-row comparison battery. The rows'
labels and structure are the author's; the 54 source sentences are quoted from published
material.

## Caveats recorded with the harvest, repeated here

- The document language was British English, so a few edits are en-GB spelling
  normalisations (`analyse`, `socialise`, `operationalise`, `summarises`) rather than
  clarity edits.
- Where several mutually exclusive fixes were offered for one span, accepting them in
  sequence applies the first offered; the alternatives are not captured.
- One observed Grammarly error is preserved verbatim rather than corrected:
  `a brand new innovation` → `a brand innovation`.
- Tone-suggestion cards are a separate feature and were dismissed, not accepted.
