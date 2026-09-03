# Why the probe is slow on long notes — measured diagnosis

2026-08-29. Multi-agent investigation: 3 benchmark agents (pure-node module benches + a real
EditorView driven headless), 4 independent code audits, one adversarial verifier per major
finding, 2 fix designs. All numbers below are measured, not estimated; where a fix is named
"byte-identical" a prototype was built and its output compared against the original.

**Status at close-out (2026-09-01).** Every item of the fix plan below shipped on
2026-08-29, within an hour of this diagnosis, in commits 5ef041b, 7ffd269, 5aaedad, 1ecfd63,
a6ffaf7, 7a4cdd5 and 9733fc0; the adversarial review the same evening reworked items 5
and 7 in 497e08a. The after-numbers are in `obsidian-plugin/README.md`, "Performance, after
the diagnosis". This file is kept as the record of what was measured before.

## The three symptoms, each with a confirmed cause

### 1. Typing lag, and the delay when accepting a suggestion

Every keystroke and every Replace click runs `controller.sync()` synchronously inside
CodeMirror's dispatch. Measured cost of that call:

| document | per-keystroke / per-accept sync | real `view.dispatch` block |
|---|---|---|
| 2.5k words | 14 ms | — |
| 10k words | 200 ms | 80 ms (38k chars) |
| 40k words | **3.1 s** | **2.0 s** (193k chars) |

**~92% of it is `segmentSentences`, which is accidentally quadratic.** For every `.` in the
document, `isAbbreviation` (then at src/segmenter.mjs:28-29; now bounded by
`ABBREVIATION_LOOKBEHIND` at line 46) took `text.slice(0, index)` — the entire document
prefix — and ran the end-anchored `/[\p{L}.]+$/u` over it. V8 makes the slice free,
but the regex engine walks backwards from the anchor over the whole prefix. 4× the characters
costs ~16× the time. A 12-char bounded lookbehind produces **byte-identical segmentation**
(verified on the corpus + adversarial cases) at **4.4 ms instead of 2,850 ms** for 40k words.

The **second quadratic** is `reconcileSentences` pass 1 (src/identity.mjs): every current
sentence scans every previous sentence. Isolated: 346 ms at 4k sentences, 1,806 ms at 8k. A
`Map<text, candidates[]>` index is byte-identical (same tie-breaks, same `changed` flags) at
0.8 / 1.4 ms.

Accept feels worse than typing because the whole cost lands inside one click, between the
click and the edit painting.

### 2. "It still processes top-to-bottom, ignoring what I look at"

Correct observation, verified live in a real EditorView. Two mechanisms:

- **The window starts a full screen ABOVE the viewport and the queue is FIFO in document
  order.** `analysisRange` widens the drawn range symmetrically; `isVisible` is fed the
  *widened* range, so above-screen margin sentences rank equal to visible ones; and
  `schedulePass` iterates in document order into a FIFO coordinator. Measured after jumping
  mid-note: the first 20 model calls over 6 seconds were **all above-screen**, crawling
  from the top of the margin downwards — none reached visible text. With ~9.2k chars of
  margin at 0.3–1 s/sentence on the single llama slot, that is **30–60 s before the first
  visible underline**. The window is ~7.7× the true screen; ~87% of scheduled work cannot
  be seen without scrolling.
- **Typing starves everything.** Every sync re-arms the debounce of every unanalyzed visible
  sentence, changed or not. Measured: 600 ms of continuous typing at 50 ms cadence produced
  **zero** model calls — then released everything as one document-order burst on pause.

### 3. The single model slot is being wasted

- **Infinite retry loop on persistent failure** (timeout, unparseable output, verifier
  outage): a failed sentence is never recorded as decided, so it is re-submitted on every
  typing pause *and every scroll*, forever — one wasted call each time, serialized through
  the one slot. Empirically confirmed (10 typing pauses → exactly 10 extra calls).
- **maxConcurrent=2 into a `-np 1` server**: the second request queues server-side while its
  12 s engine timeout burns; it adds no throughput and blunts withdraw.
- **Mechanical repairs wait for the model.** `repairMechanics` is deterministic and local;
  pipeline.mjs already supports `engine: null`. Those fixes could surface in ~140 ms.

Refuted along the way (so nobody re-chases them): the flattenMarkdown re-projection is real
but linear and small (24 ms at 3k sentences — worth memoizing, not a cause); `doc.toString()`
rope flattening is ~0.03 ms at 258KB; alternating rewrite/verify system prompts does NOT bust
the llama prompt cache on this server.

## Fix plan (both designs, merged, in order) — all seven shipped 2026-08-29

1. **segmenter.mjs**: bounded 12-char lookbehind in `isAbbreviation` (longest abbreviation is
   6 chars; guard `word.length === LOOKBEHIND → false`). Boundary tests pin the invariant.
2. **identity.mjs**: Map-indexed reconcile pass 1. Duplicate-pathology tests pin tie-breaks.
3. **underline.mjs**: `docChanged` no longer calls `sync()` synchronously — map controller
   offsets through `update.changes.mapPos` and defer the resync a tick. The dispatch cost of
   a keystroke/accept drops to ~offset mapping only.
4. **controller.mjs**: memoize `project()` by raw text (swap-per-sync cache).
5. **coordinator.mjs**: priority queue — `submit({priority})`, lowest first, FIFO tiebreak,
   priority promotion when a duplicate submit joins a queued entry. maxConcurrent → 1.
   Shipped promote-only in a6ffaf7; 497e08a made the latest submit's rank win in both
   directions after promote-only was measured serving a stale screen. `maxConcurrent` is 1
   in the probe's controller; the coordinator's own default stays 2.
6. **controller/underline**: rank sentences — visible (reading order) → below screen →
   above screen; only re-arm debounces for sentences whose text changed.
7. **controller/main.mjs**: surface the mechanical repair immediately via the `engine:null`
   path while the model decision arrives later; record persistent failures as decided per
   (id, text) with a bounded retry. "Recorded as decided" shipped in 9733fc0 and was
   reversed in 497e08a: a failing sentence now gets two attempts per (id, text) — one when
   the failure is deterministic for that text — then an exponential hold of 1 to 10 minutes
   with a single retry after it, because a 4xx had marked every visible sentence decided
   for good.

Expected, tied to measurements (the dispatch figure was met — 0.3-0.6 ms in the README
table — and so was the mechanical-first branch, ~50 ms live-measured against the ~0.15 s
expected; the model-path time-to-first-underline was not re-measured as a number):
keystroke/accept dispatch at 40k words 3.1 s → **<1 ms**
(deferred resync itself ~30 ms); time-to-first-underline mid-note 30–60 s → **0.5–1.2 s**
(~0.15 s when the first fault is mechanical).
