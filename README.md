# Tolben — a local blue-underline rewrite engine

A writing checker that refuses any rewrite it cannot prove keeps your meaning, running
entirely on your own machine.

Finish a sentence with `.`, `!` or `?` and only that sentence is checked. Words that
would change get a blue underline; hover one for the full proposed sentence with
inline insertions and deletions, a reason, Replace, and Dismiss. Marks on earlier
sentences stay put while you keep writing. Nothing leaves the machine — no account,
no network call, no telemetry.

## Run it

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
npm test               # 696 tests; the 6 that need a running model server skip without it
node bench/oracle.mjs           # Grammarly-replay ceiling of the safety gate     (no model needed)
node bench/precision-check.mjs  # meaning-changing rewrites that reach the writer (no model needed)
node bench/unlock-check.mjs     # refusals that a change quietly unlocked         (no model needed)
node bench/run.mjs --corpus bench/corpus/development.json --prompt src/clarity-prompt.txt \
  --verifier src/verifier-prompt.txt --model-path models/Qwen3.5-2B-Q6_K.gguf --output /tmp/run.json
node bench/score.mjs /tmp/run.json
```

`--reasoning off` is load-bearing: without it the model returns its thinking and an
empty answer.

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

See `REPORT.md` for measured recall, false-positive rate, latency, memory, and limits —
its closing section names the command behind every number.

## Licence

Apache-2.0 for the code (`LICENSE`). The author-written corpora and labels under `bench/`
are CC-BY-4.0 (`LICENSE-DATA`). The model weights are Apache-2.0 and are fetched, not
redistributed; `NOTICE` names every third-party artefact and the Grammarly-derived files
kept for reproducibility, which neither licence covers.
