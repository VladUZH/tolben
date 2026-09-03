# Prior art: who else does local, model-backed clarity rewriting?

Researched 2026-08-28. Question: does anyone — commercial, platform, open-source, or
academic — ship what this project builds: **local-model, sentence-triggered clarity
rewrites surfaced as persistent underlines with a hover diff**?

Short answer: pieces of it exist in at least four ecosystems, but no found project
combines all of it, and **nobody found validates model output before showing it**.

## Platform features (closed, on-device models) — closest architecture

| Who | What | How close |
|---|---|---|
| **Chrome built-in AI** (Proofreader/Rewriter/Writer APIs, Gemini Nano) | On-device model in the browser, no server, per-issue correction annotations via JS API; origin trial as of mid-2026 | Closest architectural sibling: small local model + browser + corrections. But it is an API — no shipped as-you-type underline UX, model closed, and rewriting (Rewriter) is tone/length-oriented, not restrained clarity edits |
| **Apple Intelligence Writing Tools** | On-device Proofread (edits with explanations, review flow) and Rewrite (tones); Private Cloud Compute fallback | Same product idea, different trigger: invoked on selection, not continuous per-sentence marks. An earlier version of this row said "this project's Limatum branch measured this exact route"; Limatum is the sibling Swift port of this engine (see the header of `src/clarity-rules.mjs`), not a branch of this repository, and nothing in this repository records any such measurement, so the claim is withdrawn |
| **Gboard AI Writing Tools / Galaxy AI** | Gemini Nano on-device proofread + rephrase on mobile keyboards | One-tap whole-message, not inline underlines |

Strategic note: Chrome's Proofreader API is the thing most likely to commoditize this
category — when it exits origin trial, any web page gets local proofreading for free,
though clarity-grade rewriting and meaning-preservation gating remain unaddressed.

## Open source — closest relatives

| Project | Local? | Mechanism | Gap vs this project |
|---|---|---|---|
| **lm-writing-tool** (VS Code) | Yes (Ollama, llama3.2:3b) | Polls every 5 s for changed sections, sends to LLM, **diffs output vs original**, underlines + quick fixes, caches | Closest OSS mechanism (diff-what-changed). But: section polling, not sentence-completion trigger; **no validation of model output at all**; no keep/rewrite contract; no benchmark |
| **GemType** (Chrome/Safari ext.) | No (BYO Gemini API key) | Underlines ~1 s after typing stops, whole-sentence LLM judgment, one-click fix | Nearest UX match found, but cloud |
| **WritingTools** (theJayTea) | Optional (Ollama) | System-wide selection popup, Apple-WT style | Not inline, not sentence-triggered |
| **TextEnhanceAI** | Yes (Ollama) | Markdown editor, modal review of changed sentences | Batch workflow, not inline |
| **obsidian-proofreader / ai-annotate / Track Changes** | No (cloud APIs) | Track-changes-style accept/reject in the note | Review-pass workflow, cloud |
| **Harper** | Yes (Rust rules) | Instant rule-based linting | **Explicitly no rewriting, no LLM** — deliberate philosophy |
| **LanguageTool** (self-hosted) | Yes for rules | Rules + n-grams server | The paraphrasing/AI layer is **premium, cloud-only, closed** — the OSS part has no rewrite feature |
| Hobby Grammarly clones (Open Grammarly, LocalGrammerly, …) | Mixed | Overlay/underline UIs | Spell/rule level or cloud; none combine local LLM + validation |

## Commercial cloud

Grammarly (the reference), DeepL Write, Wordtune, ProWritingAid, Microsoft Editor — all
cloud. **Sapling** is the notable exception: ML grammar/fluency checking sold with
self-hosted/on-prem container deployment for enterprises — the only commercial product
found offering self-hosted ML checking — but closed-source, server-class, and licensed.

## Academic / models

- **CoEdIT** (benchmarked in this repo: 42% fire rate, 12.5% FP, CC-BY-NC) and the
  T5-family GEC models (Gramformer etc.) are models without products — no trigger, no UX,
  no safety gate.
- Edit-based GEC systems (GECToR, CTC-Copy, EditScorer) produce explicit edits cheaply
  but target grammatical error correction, not clarity rewriting.
- The current GEC literature ("Pillars of GEC", LLM-prompting studies) validates the
  design direction — prompted LLMs are competitive for correction — but nobody packages
  it as a local inline product.
- In-browser local inference (transformers.js v3 WebGPU, WebLLM) makes a **zero-install**
  variant of this project feasible; existing users of it do popup-style fixes, not
  underline-as-you-type.

## What remains distinctive here

The found landscape lacks, in any single project:
1. sentence-completion trigger analyzing only the finished sentence;
2. persistent word-level underline marks that survive later typing;
3. a schema-constrained keep/rewrite contract with **deterministic meaning-preservation
   validation** (numbers, names, negation, quantifiers, tense, deletion policy) that can
   refuse the model;
4. explanations derived from the computed diff rather than trusted from the model;
5. a reproducible benchmark harness with sealed holdouts;
6. all under a 2 GB open-weights local model (the optional GECToR grammar tier added
   2026-08-30 is a further 136 MB, 128 MB of it the int8 ONNX tagger, and non-commercially
   licensed; the full pinned fetch is 1.7 GB — `models/MANIFEST.json`).

Point 3 appears to be genuinely novel in this space — every found LLM-based tool shows
raw model output directly (lm-writing-tool diffs it but never gates it).

### Sources
Chrome: developer.chrome.com/docs/ai/proofreader-api, /rewriter-api, /get-started ·
Apple: support.apple.com/en-us/121582, apple.com/newsroom (2024/10) ·
Gboard: androidpolice.com, androidauthority.com (Gemini Nano writing tools) ·
lm-writing-tool: github.com/peteole/lm-writing-tool ·
GemType: github.com/riponcm/GemType · WritingTools: github.com/theJayTea/WritingTools ·
TextEnhanceAI: github.com/wenrolland/TextEnhanceAI ·
obsidian-proofreader: github.com/chrisgrieser/obsidian-proofreader ·
Harper: github.com/automattic/harper · LanguageTool: languagetool.org/paraphrasing-tool,
xda-developers.com self-host review · Sapling: sapling.ai/onprem, /docs/onprem/comparison ·
GEC: arxiv.org/pdf/2404.14914, arxiv.org/pdf/2401.07702 ·
transformers.js: huggingface.co/blog/transformersjs-v3

## Addendum (same day): the GemType-like category, researched deeper

A second sweep focused on inline-underline LLM checkers found a category the first pass
under-weighted — and two projects close enough that the "no equivalent" conclusion above
needs honest revision.

### The two closest matches found anywhere

**Grammit** (Chrome extension, free, local-only) — grammar errors underlined as you type,
fixes applied individually or all at once, and the model is **Chrome's built-in Gemini
Nano/Gemma 3n via the Prompt API by default, switchable to a local llama server**. That is
our stack shape: local small model behind an inline underline UX, llama.cpp optional.
Differences that remain: it is a grammar corrector (not a clarity rewriter), and nothing
in its documentation suggests output validation, a keep/rewrite contract, or benchmarks.

**Refine** (macOS app, $38 one-time, refine.sh) — system-wide checking through the macOS
Accessibility APIs, default **local Gemma model with Qwen 3.5 and Gemma 3n options**, plus
BYO Ollama/LM Studio/cloud keys; grammar, rewriting, translation, and explanation. This is
the commercial realization of the Limatum ambition (system-wide Mac, local model), and it
independently chose the same model family this project did. Closed source; mechanism,
validation, and quality measurements undocumented.

### The BYO-cloud-key underline extensions (the GemType family)

GemType (Gemini), TextChecker (Gemini/OpenAI/Claude), Grammai (GPT), Grammar Corrector
(GPT-4o-mini), Open Grammarly — all open source, all Grammarly-style underlines over page
text, all raw-model-output. Proofly rides Chrome's built-in Gemini Nano (fully local, but
requires Chrome 141+, ~22 GB free disk, 4 GB VRAM — the hidden cost of the "free" platform
model; this project's dedicated 1.6 GB weights are leaner).

### Mechanism insights worth stealing (mostly from GemType's documented design)

1. **"LLM character offsets are unreliable"** — GemType anchors suggestions by exact text
   snippet, located client-side and re-anchored live. Independent convergence with this
   project's compute-the-diff-locally rule. Two projects reached it separately; treat it
   as a law of the category.
2. **Re-check the surrounding sentence after an accepted fix** (cascading errors). This
   project records an accept as decided and does not re-send the replaced sentence
   (`replaceActive` in `src/app-core.mjs` records every accept; `accept` in
   `obsidian-plugin/controller.mjs` records only a model-stage one and leaves a mechanics-
   or grammar-tier accept open for a later clarity pass); neighbours are untouched. Worth considering — cheap, and a
   real class of cascade exists (pronoun/agreement knock-on).
3. **execCommand for native undo + never mutating the page's DOM** (overlay only) keeps
   React/Vue/ProseMirror hosts stable — identical conclusions to ours for the web demo
   (the Obsidian plugin instead uses CodeMirror decorations on the real text,
   `obsidian-plugin/underline.mjs`), and the documented
   route to an extension form: mirror element for textarea/input, Range.getClientRects for
   contenteditable, shadow-DOM support, Google Docs impossible (canvas rendering).
4. **Background queue + response cache + 429 backoff** — the cloud-quota version of this
   project's coordinator (dedupe + concurrency gate + stale-drop).
5. **Pluggable model backend** (Grammit: Prompt API or llama server; Refine: menu of local
   models or BYO endpoint). This engine already speaks OpenAI-compatible HTTP; a Chrome
   Prompt API backend would yield a zero-install variant of the same product.
6. **Bulk "fix all"** (Grammit) — absent here; trivially buildable from the store.

### Revised conclusion

The distinctive remainder of this project shrinks to three things, and they hold across
every project found in both sweeps: (1) **clarity rewriting** as the product target rather
than grammar correction; (2) the **deterministic meaning-preservation gate** that can
refuse the model — still found nowhere else; (3) **sealed-holdout measurement** of
recall/precision — no found project publishes any quality numbers at all.

### Status at project close (2026-09-01)

Of the six insights above, (1) and — for the web demo — (3) describe what the tree already
did when this was written. (4) was taken up on 2026-08-30: a persistent outcome cache
(`obsidian-plugin/outcome-cache.mjs`) joined the coordinator's dedupe, concurrency gate and
stale-drop. (2), (5) and (6) were not: there is no neighbour re-check after an accepted
fix, no Chrome Prompt API backend (the Obsidian plugin does expose a configurable
OpenAI-compatible endpoint), and no bulk fix-all. GECToR, listed under academic prior art
as grammar-only, was adopted the same week as the provisional grammar tier — and the
tier was deleted on 2026-09-02 (d768ad8) because its ONNX weights are licensed for
non-commercial use only; `docs/PHASE-2-GECTOR-PLAN.md` went with it, so this document
no longer links to it. The three distinctives of the revised conclusion held to
the close; REPORT.md's closing section re-measures (1) and (2) on the final tree — on the
60-row development corpus, not the sealed holdouts, whose last run is the holdout-3 row
under "Sealed holdout results".
