# Tolben FAQ

For people deciding whether to install it. Every number below is either in `REPORT.md`,
`docs/ROADMAP.md`, or a file you can open in this repository; where something has not been
measured, this document says so rather than estimating.

## What does it do?

Tolben is an Obsidian plugin that suggests clarity rewrites from a model running on your
own machine. When you finish a sentence with `.`, `!` or `?`, that sentence — and only
that sentence — is sent to a local model server, which returns either "keep" or a proposed
rewrite under a constrained JSON schema. Deterministic code then decides whether the
rewrite may be shown: it checks the proposal against the original for changed numbers,
names, negation, quantifiers, tense, dropped content and eighteen other classes, and
refuses anything it cannot show preserves the meaning. What survives is drawn as a blue
underline on the words that would change; hovering one gives the full proposed sentence
with inline insertions and deletions, a reason computed from the diff rather than taken
from the model, and Replace and Dismiss buttons. Marks on earlier sentences stay put while
you keep writing, and Replace is an ordinary CodeMirror transaction, so one undo reverts it.

## Does anything leave my machine?

Setup downloads two things. Nothing else ever goes out.

| | What | Size | From |
|---|---|---|---|
| Model | `Qwen3.5-2B-Q6_K.gguf` | 1,556,390,368 bytes | huggingface.co, `lmstudio-community/Qwen3.5-2B-GGUF` |
| Server | one `llama.cpp` build `b10760` archive for your platform | 11,072,707 – 18,373,088 bytes | github.com, `ggml-org/llama.cpp` releases |

Both are pinned by sha256 in `obsidian-plugin/runtime/manifest.json` — the model at
`49e219c5…a520f8`, and one hash per platform for the server. The rule the provisioner is
built around is that **an artefact with no recorded sha256 is not fetched at all**: not
fetched-and-checked, not fetched. The hash is taken over the bytes on disk rather than the
stream, a download stays a `.part` file until it matches, and a server that ignores `Range`
is not appended to. The setup pane shows every URL, byte count and hash before the first
byte moves, and downloads nothing until you press the button.

If you already run Ollama on `127.0.0.1:11434` or `llama-server` on `127.0.0.1:8080`,
setup finds it and offers to use it, and then nothing is downloaded at all.

After setup, the plugin talks to a loopback address. The command **"Show what talks to the
network"** counts every request the plugin has made since it loaded, by host, so the claim
is checkable rather than asserted; `SECURITY.md` treats any outbound connection made after
setup completes as a vulnerability rather than a feature request. There is no account, no
telemetry, and no sign-in.

## How much disk and RAM does it need? What if I have no GPU?

**Disk.** The provisioner's own plan line for a first run reads `download 1.57 GB`. Both
files live under `tolben/` in your OS data directory, deliberately outside the vault: 1.5 GB
inside a synced vault is a bad afternoon for whoever pays for the sync.

**RAM.** `llama-server` measured at **RSS ≈ 1.96 GB** at the 4096 context the plugin uses
(weights plus KV cache). "Unload the model when idle" is on by default at 10 minutes: a
server Tolben started is stopped after that long without typing and the memory returned. A
server you started yourself is never stopped.

That setting is a real trade rather than a free saving, and it is worth knowing which side
you want. **The first sentence after a server starts takes about 41 seconds** on the
4-core CPU every figure here comes from; every sentence after it takes about 1.5 s. What
costs the 41 seconds is reading the 1,587-token instruction prompt in, once per server
process. So leaving the unload on means paying that once per idle period, and setting it
to **0** means keeping 2 GB resident and never waiting. Tolben does save and restore the
model's KV cache across the unload, but measured on 2026-09-03 it does not shorten that
first sentence — 41.2 s with the restore against 41.4 s without — so it is not offered
here as a reason to leave the setting on.

**No GPU is required.** The closing measurements were taken on 4 × Intel Xeon @ 2.10 GHz,
15 GB RAM, CPU only: per-sentence latency **p50 1343 ms, p95 2532 ms, max 14594 ms** across
the 60-row development corpus. GPU latency on the pinned artefact has not been measured,
and neither has a 2-core laptop.

**Setup time** has one honest measurement: 36 seconds end to end — downloaded, verified,
extracted, spawned, warmed and stopped — on a datacentre connection of roughly 44 MB/s, with
a second run reusing everything in 16 s. That is a ceiling, not a typical figure. 1.57 GB on
50 Mbps is about four minutes of transfer by arithmetic; nobody has timed the install on a
domestic line, and a planned third-party timed install was dropped on 2026-09-03.

## How is this different from Grammarly, LanguageTool, Harper, or the built-in spellcheck?

| | What it is | How Tolben differs |
|---|---|---|
| Obsidian's spellcheck | Marks words that are not in a dictionary | Tolben works a sentence at a time and proposes rewordings. It repairs unambiguous spacing and capitalisation faults deterministically on the way, but it is not a spellchecker and does not replace one |
| **Harper** | Local, instant, rule-based linting in Rust | Harper deliberately has no LLM and does no rewriting. It is a good thing to run alongside Tolben, not a competitor to it |
| **LanguageTool** | Rules plus n-grams, self-hostable | The self-hostable part has no rewrite feature; its paraphrasing/AI layer is premium and cloud-only |
| **Grammarly** | Cloud service, much broader product | See below |

On the one head-to-head that exists (`COMPARISON.md`, 2026-08-27, a 1,131-word document of
mixed registers, Grammarly's **Clarity** filter only), Grammarly is ahead on detection: it
flagged 11 of 54 sentences and got 12 of 12 constructions in a battery of classic clarity
problems, where this engine got 7 of 12. It flagged less and was right more often. Tolben
flagged 20 of 54 sentences there; the restraint pass that followed brought that to 13 of 54
while dropping exactly the seven suggestions adjudicated as harmful or pointless. Some of
what Grammarly files under Clarity is dialect conversion (`oxidizer` → `oxidiser`), which
this engine does not do. Grammarly's "add missing specificity" and "resolve unclear
antecedents" categories are out of scope here by design: they need facts a sentence-local
engine does not have, and inventing them is forbidden.

What is different in kind, rather than in degree, is the gate. Two sweeps of the field
(`docs/PRIOR-ART.md`, 2026-08-28) found local model-backed checkers, inline-underline
extensions and self-hosted grammar services — and no project that validates model output
before showing it. Every LLM-based tool found shows the model's answer; one diffs it, none
gates it. Tolben also publishes recall and false-positive numbers on sealed holdouts, which
no found project does.

## Will it change what I meant?

This is the question the whole product is built around, and the full answer is in
[docs/GATE.md](GATE.md).

The short version: the model proposes, and deterministic code disposes. `src/safety.mjs`
exports 24 rejection reasons — among them `numbers-changed`, `name-changed`,
`negation-changed`, `quantifier-changed`, `tense-changed`, `certainty-changed`,
`content-dropped`, `word-substituted` and `protected-token-changed` — and a rewrite that
trips any of them never reaches you. The safety layer may refuse a model answer; it never
authors one. Three control instruments re-run that gate over everything the project has
recorded, without needing a model:

- `bench/oracle.mjs` — replaying 118 rewrites Grammarly itself produced, 73 pass the gate
  outright, 15 go to the verifier, 30 are refused: a ceiling of 88/118.
- `bench/precision-check.mjs` — of **281** rewrites recorded as accepted, **0** are
  meaning-changing.
- `bench/unlock-check.mjs` — of **209** recorded refusals, **0** have been quietly unlocked.

What that does not amount to: a proof. One meaning inversion did reach the interface during
an early sealed run ("in a manner that was confusing" → "in a clear manner"); the
`word-substituted` guard was written in response and refuses it now. The labels the controls
score against are the author's own judgement, eleven rows of which are marked borderline,
and `REPORT.md` says plainly that an external referee is the thing that would settle it. If
a rewrite changes your meaning, that is a defect in the core claim — please report it.

## Why does it refuse so often?

Because refusing is the trade the product chose: a refused suggestion costs recall, an
accepted bad one corrupts your meaning. In the Grammarly replay, 30 of 118 rewrites are
refused outright, the commonest reasons being `certainty-changed` (10), `word-substituted`
(8) and `tense-changed` (4). Some of those refusals are wrong, and known to be: "In the
majority of cases" → "In most cases" trips the quantifier guard and is deliberately left
tripping it.

You can see exactly what was withheld. The command **"Show refusal ledger for this note"**
lists every rewrite the model produced and the gate stopped, with the rule that stopped it,
and has a copy button. That is the most useful bug report you can send.

There is also a setting that goes the other way: **"Never drop words"** refuses any rewrite
that loses a content word instead of asking the model whether the rest of the sentence still
says it. It is off by default, because on the labelled corpora it stops no further meaning
changes while costing 15 Grammarly rows and 48 preserving rewrites — and because every
published number was measured with it off. Turn it on for text where a lost qualifier is a
problem whatever a model thinks.

## Why did it not flag an obviously bad sentence?

Several possibilities, in the order worth checking:

- **The sentence is not finished.** Analysis is triggered by `.`, `!` or `?`.
- **It is off screen.** Only sentences near the viewport are sent to the model, because
  CodeMirror renders only the viewport and a suggestion outside it has nowhere to appear.
  Scroll to it.
- **You are in Reading view.** It does nothing there, and cannot: there is no cursor to
  Replace into.
- **It is not prose.** Code, math, HTML and frontmatter never reach the model, and a
  segment containing a code fence is excluded outright.
- **The gate is in Fast mode.** Fast skips the model on sentences that carry none of the
  wordy surface constructions — about 40% less model time, but on one real page six of
  eight suggestions were grammar-shaped and Fast silenced all six. Balanced, the default,
  checks those sentences last rather than never.
- **The model kept it.** Recall is real but partial: 27 of 36 rewrite-expected rows on the
  development corpus, and 49 of 75 adjudicated useful across three sealed holdouts. Known
  weak spots include idiomatic redundancy pairs ("collaborated together") and `there is/are`
  expletives.
- **The gate refused the rewrite.** The refusal ledger will say so, and which rule.

## Can I use my own Ollama, llama-server, or OpenAI-compatible endpoint?

Yes, and setup looks for the first two before offering to download anything. Settings →
Tolben → **Model server** takes any OpenAI-compatible base URL on loopback.

The endpoint has to support what the engine actually sends: `chat/completions` with
`response_format` of type `json_schema` in strict mode, `temperature: 0`, and a stop string
that ends generation once the replacement is closed. Ollama is handled specially — its `/v1`
is entitled to ignore `keep_alive` and the reasoning suppression, and does so silently, so
the adapter probes for both and falls back to `/api/chat` where they are dropped. Ollama was
built from source and run live for that work; a cold-start smoke of 10 sentences analysed
10 of 10 at p50 4.2 s. Only `llama-server` is measured, so quality figures from any other
backend are yours to establish.

## What is written into my vault?

`data.json` in the plugin folder, holding your settings. Nothing else. This is a product
guarantee rather than a convention, and `tests/plugin-vault.test.mjs` enforces it against
the committed bundle as well as the source, because a mocked Obsidian API proves only that
the mock was not called.

The model and the llama.cpp binary go to your OS data directory, outside the vault. The
outcome cache and the refusal ledger are held **in memory only** and go when Obsidian
closes. The cache used to be a file in the vault, and that was wrong: it is a record of
every sentence you finished and what a model said about each one, and a writing tool has no
business leaving that in your notes. The cost of holding it in memory is that reopening a
note re-asks the model, roughly a second a sentence, once per session.

## What model is it? Can I swap it?

Qwen3.5-2B, Q6_K GGUF, Apache-2.0, 1,556,390,368 bytes, sha256 `49e219c5…a520f8`. It is
fetched, not redistributed. `runtime/manifest.json` also offers Q4_K_M (1,270,808,032
bytes), labelled in the manifest and in the setup pane as **not** the artefact any published
number was measured on.

You can point Tolben at any endpoint meeting the contract above, so swapping the model is a
setting. What a swap costs is the measurements: every figure in this document is tied to
those specific bytes, which is the reason the manifest exists at all — a set of goldens once
recorded against an unhashed export reproduced 857 of 880 when the same file was fetched
again days later. Re-establishing them means re-running `bench/run.mjs` and
`bench/score.mjs` on the development corpus against the new model. The three control
instruments need no model and would not move; they measure the gate, not the weights.

## Is it free? What is the licence? Who owns it?

Free, with no paid tier, no account and no telemetry.

- **Code**: Apache-2.0 (`LICENSE`), Copyright 2026 The Tolben Authors.
- **Author-written corpora and labels under `bench/`**: CC-BY-4.0 (`LICENSE-DATA`).
- **The 118 Grammarly-derived pairs**: quoted for reproducibility, covered by neither
  licence, and offered to nobody — see `NOTICE` and `bench/corpus/THIRD-PARTY.md`.
- **Model weights**: Apache-2.0, fetched rather than redistributed. **llama.cpp**: MIT.

The plugin is authored by VladUZH; the repository is
`github.com/VladUZH/blue-underline`. There is no CLA — contributions carry a Developer
Certificate of Origin sign-off (`git commit -s`).

## How do I report a bad rewrite, or a refusal that was wrong?

Two issue templates, and they are the two the project cares most about:

- **Reported miss — a rewrite changed the meaning.** The tool proposed or accepted
  something that does not mean the same thing. This is a defect in the core claim and is
  treated as one. Give the original sentence exactly as you typed it, the full proposed
  sentence from the hover card, and one line on what the change did to the meaning.
- **Wrong refusal — a good rewrite was blocked.** The meaning was preserved and the
  suggestion should have reached you. Paste the refusal ledger's entry, including the rule
  that stopped it.

A bad rewrite is explicitly **not** a security vulnerability. Security problems go through
GitHub's private vulnerability reporting instead, never a public issue; `SECURITY.md` says
what is in scope and gives the response windows.

## Is it finished? What is next?

The Obsidian plugin is complete and tested — 928 tests, 925 passing, 0 failing and 0 skipped
against a live model server. CI runs the suite on macOS, Windows and Ubuntu on every push,
and a separate job runs the provisioner's full download-and-spawn on four runners. Version
1.0.0 is prepared; as of this writing nothing has been released, so the `CHANGELOG.md` entry
is still `[Unreleased]`.

Deliberate limits today: desktop only, Reading view does nothing, and the markdown
projection is a reader rather than a parser — tables, footnotes and HTML inside a paragraph
are not modelled. The explanation shown on the card is computed from the diff, but recall on
clean technical prose remains the weakest part of the product, and `REPORT.md`'s "What a
reader should distrust" section names the two joints its author trusts least.

`docs/ROADMAP.md` has the plan and the phase gates, each of which is a number rather than a
feeling. In outline: VS Code and other LSP editors as the second free surface, the gate
published as a library other tools can use, an independent audit of the no-outbound-traffic
claim, and a paid edition for people who cannot send text to a cloud service. A model
upgrade, whenever one comes, requires a full re-measurement before it ships.
