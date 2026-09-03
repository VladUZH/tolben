# Tolben

**An Obsidian plugin that proposes clearer sentences using a language model running on
your own machine, and refuses any rewrite it cannot prove keeps your meaning.**

Finish a sentence with `.`, `!` or `?` and only that sentence is checked. Words that
would change get a blue underline; hover one for the full proposed sentence with
inline insertions and deletions, a reason, Replace, and Dismiss. Marks on earlier
sentences stay put while you keep writing. Nothing leaves the machine — no account,
no network call after setup, no telemetry.

A small language model proposes the rewrite. Deterministic code then decides whether you
ever see it: `src/safety.mjs` holds the proposal against the original and refuses it if it
can find any way the meaning moved — a changed number, a dropped qualifier, a reversed
relation, a swapped role. Refusing is the default, and `docs/GATE.md` is the long answer
for how.

## Install it in Obsidian

The plugin is **desktop only**: it runs a model server on loopback, and Obsidian mobile has
nowhere to run one.

1. Download `main.js`, `manifest.json` and `styles.css` from a
   [release](https://github.com/VladUZH/blue-underline/releases).
2. Put all three in `<your vault>/.obsidian/plugins/tolben/`.
3. Turn off Restricted Mode, then enable **Tolben** under
   Settings → Community plugins.
4. Run the command **Tolben: Set up the model server** and read the plan it shows you
   before pressing anything.

### What setup downloads, and where it puts it

Nothing is downloaded until you press the button in the setup pane, and the pane lists
every URL, byte count and sha256 first. Two artefacts:

| Artefact | Size | From |
|---|---|---|
| The model, `Qwen3.5-2B-Q6_K.gguf` | 1.5 GB | Hugging Face |
| A `llama.cpp` **b10760** server build for your platform | 11–19 MB | GitHub |

The model comes from `lmstudio-community/Qwen3.5-2B-GGUF` and the server from
`ggml-org/llama.cpp` releases. Both are pinned by sha256 in
`obsidian-plugin/runtime/manifest.json`, down to the exact byte count, and **an artefact
whose hash is not recorded there is not fetched at all** — not fetched and checked, not
fetched. The hash is taken over the bytes on disk, and a download stays a `.part` file
until it matches.

They are written **outside your vault**, to `$XDG_DATA_HOME/tolben` if that is set,
`%LOCALAPPDATA%\tolben` on Windows, and `~/.local/share/tolben` otherwise — macOS
included. A 1.5 GB model inside a synced vault is a bad afternoon for whoever pays for the
sync.

The only thing Tolben ever writes into your vault is its own `data.json` of settings, and
`tests/plugin-vault.test.mjs` holds the committed bundle to that. In particular the record
of which sentences you finished is kept in memory and never written down.

If you already run Ollama or a `llama-server` yourself, setup finds it and offers to use
it, and then nothing is downloaded at all. Any OpenAI-compatible endpoint works.

After setup, the command **Tolben: Show what talks to the network** counts every request
the plugin has made since it loaded, by host, so the claim above is one you can check
rather than one you have to take.

## What it costs to run

Measured on 4 × Intel Xeon @ 2.10 GHz, 15 GB RAM, **CPU only, no GPU**, which is the
machine behind every figure in this file and in `REPORT.md`'s closing section. (Earlier,
superseded sections of `REPORT.md` carry latency taken on an Apple M3 Max GPU and say so;
no GPU figure is quoted here or in the plugin.) `REPORT.md` names the command behind each
number.

- `llama-server` RSS ≈ **1.96 GB** at the 4096 context the plugin uses.
- About **1.5 GB of disk** for the model, plus the server archive.
- The **first sentence after a server starts costs about 41 seconds** on this machine, and
  every one after it about 1.5 s. That is the 1,587-token clarity prompt being read in,
  once per server process.
- "Unload the model when idle" is therefore a real trade, and it is on by default at ten
  minutes: you get 2 GB back and pay that 41 seconds on your next sentence. Set it to 0 to
  keep the model resident. The KV slot is saved and restored across the unload, but
  measurement says it does not shorten that first sentence — 41.2 s with the restore
  against 41.4 s without.

## How it works

```
keystroke
   ↓  segmenter.mjs        is this sentence finished?                 (deterministic)
   ↓  identity.mjs         which sentence is this, still?             (deterministic)
   ↓  mechanics.mjs        spacing / capitalisation only              (deterministic)
   ↓  clarity-rules.mjs    first-party wordiness rules — a floor      (deterministic)
   ↓  engine.mjs           schema-constrained keep|rewrite            (LOCAL MODEL)
   ↓  safety.mjs           refuse anything that changes meaning       (deterministic)
   ↓  safety.mjs           one lost content word → ask the verifier   (LOCAL MODEL, deletion policy)
   ↓  coordinator.mjs      drop stale replies                         (deterministic)
   ↓  diff.mjs             compute underline ranges locally           (deterministic)
   → blue underline + hover card
```

`pipeline.mjs` orders those tiers. The model is the rewrite engine: a rule only offers a
candidate it supersedes, and deterministic code triggers it, refuses it, diffs it, and
keeps its answers attached to the right sentence. The same pipeline runs in the Obsidian
plugin (`obsidian-plugin/`, the engine inside a note), in the web demo and in the bench.

The gate also runs unmodified in a browser — every module under `src/` imports only
relative paths — which is what `playground/` is: the same code, the recorded benchmark
runs, and every reason the gate refuses under, with no model and no install.

## Work on it

```bash
npm install            # Node 22 was used throughout; dev dependencies only, nothing native

# 1. fetch the weights and verify every byte against models/MANIFEST.json
npm run models:fetch   # 1,556,390,368 bytes from Hugging Face into models/ (gitignored); sha256-pinned
npm run models:verify  # verify only — exit 1 if anything on disk is not the pinned artefact

# 2. serve the weights (Apache-2.0 model, MIT llama.cpp), on loopback only
npm run model          # needs llama.cpp's llama-server on PATH; -m models/Qwen3.5-2B-Q6_K.gguf ... --jinja --reasoning off

# 3. serve the demo
npm start              # http://127.0.0.1:4173

# 4. tests, controls and benchmarks
npm test               # 928 tests, 925 pass, 0 skipped with a model server; without one, 6 skip
npm run lint:prose     # the claims this repository is not allowed to make
npm run playground:build   # and `node playground/build.mjs --check`, which fails if the page would phone home
node bench/oracle.mjs           # Grammarly-replay ceiling of the safety gate     (no model needed)
node bench/precision-check.mjs  # meaning-changing rewrites that reach the writer (no model needed)
node bench/unlock-check.mjs     # refusals that a change quietly unlocked         (no model needed)
node bench/run.mjs --corpus bench/corpus/development.json --prompt src/clarity-prompt.txt \
  --verifier src/verifier-prompt.txt --model-path models/Qwen3.5-2B-Q6_K.gguf --output /tmp/run.json
node bench/score.mjs /tmp/run.json
```

`--reasoning off` is load-bearing: without it the model returns its thinking and an
empty answer.

See `REPORT.md` for measured recall, false-positive rate, latency, memory, and limits —
its closing section names the command behind every number. `CONTRIBUTING.md` has the three
rules that are not negotiable before you send a patch.

## Licence

Apache-2.0 for the code (`LICENSE`). The author-written corpora and labels under `bench/`
are CC-BY-4.0 (`LICENSE-DATA`). The model weights are Apache-2.0 and are fetched, not
redistributed; `NOTICE` names every third-party artefact and the Grammarly-derived files
kept for reproducibility, which neither licence covers.
