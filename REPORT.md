# Local blue-underline clarity engine — measurements and honest limits

A completed sentence goes to a **local Qwen3.5-2B (Q6_K, 1,574,961,408 bytes)** served by
`llama-server` on loopback, asked for a JSON-schema-constrained `keep`/`rewrite` decision.
Deterministic code does the triggering, the safety refusal, the word diff, and the state
reconciliation. **The rewrite itself is always the model's.** There are no clarity regexes.

> **Read this header as dated 2026-08-27.** Everything from here to "Resources" describes
> the engine as first measured, on a 1,574,961,408-byte Qwen3.5-2B Q6_K file whose hash was
> never recorded. Since then the tree gained first-party clarity rules (`clarity-rules.mjs`,
> a floor the model supersedes), a provisional GECToR grammar tier in the Obsidian plugin,
> a 2B verifier behind the deletion policy, and a manifest that pins a *different*
> 1,556,390,368-byte artefact. Each of those is measured in the dated update sections
> below. **The GECToR tier was removed on 2026-09-02** — its weights were licensed for
> non-commercial use only — so every measurement of it below is history, not a
> description of this tree; the final section names the command behind every current
> number.

## Where each result comes from

| Stage | Deterministic or model | What it may do |
|---|---|---|
| `segmenter.mjs` | deterministic | decide *when* a sentence is finished |
| `mechanics.mjs` | deterministic | spacing and capitalisation only — never wording |
| `engine.mjs` + `clarity-prompt.txt` | **model** | every clarity, grammar, and wording decision |
| `safety.mjs` | deterministic | refuse a model answer; never author one |
| `diff.mjs` | deterministic | compute the underline ranges and the card diff locally |
| `identity.mjs`, `store.mjs`, `coordinator.mjs` | deterministic | identity, staleness, dismissal |

Prompt SHA-256 `53ef1a58904e7230a5f999a4abca16360066b621cd0600319f397d315b4791ee`.

## Model selection (measured, not assumed)

Scored on the frozen 60-row development corpus (36 rewrite-expected, 24 clean).

| Candidate | Fires on rewrite-expected | False positives on clean | p95 |
|---|---|---|---|
| Qwen3.5-2B, prior "conservative" prompt | **0/36 (0%)** | 0/24 | 241 ms |
| CoEdIT-Large (820 MB) | 15/36 (42%) | 3/24 (12.5%) | 188 ms |
| SmolLM3 Q4_K_M (1.92 GB) | 4/36 (11%) | 0/24 | 1000 ms |
| **Qwen3.5-2B, prompt v4 (shipped)** | **32/36 (89%)** | **0/24** | 981 ms |

The weights were never the problem: the same model went from 0% to 89% on prompt alone.
CoEdIT is disqualified twice over — **CC-BY-NC-4.0**, and having no keep/rewrite decision
it rewrites clean prose 12.5% of the time.

## Sealed holdout results (the honest numbers)

Three holdouts, authored after the prompt was frozen; no sentence appears in the prompt,
the development corpus, the fixtures, or the source. **Usefulness was adjudicated by hand
per row — "fired" is not counted as "useful".**

| Set | Useful suggestions | Clean left unchanged |
|---|---|---|
| holdout-1 (30 / 20) | 22/30 | 16/20 |
| holdout-2 (30 / 40) | 16/30 | 36/40 |
| holdout-3 (15 / 30), final code | 11/15 | 29/30 |
| **Total** | **49/75 (65%)** | **81/90 (90%)** |

Of 58 surfaced suggestions, **53 came from the model** and 5 from the mechanical path.

Holdout-1 and holdout-2 ran *before* two safety fixes they themselves exposed, so they
understate the current build; holdout-3 is the only set measured end-to-end on the shipped
code, at **11/15 useful and 1/30 false positives (3.3%)**. Fifteen positives is a small
sample — treat 73% as an estimate with wide error bars, not a headline.

## Safety

23 model answers were refused across the sealed runs:

`word-substituted` 6 · `quantifier-changed` 4 · `tense-changed` 3 · `unchanged` 3 ·
`certainty-changed` 2 · `dropped-content` 2 · `protected-token-changed` 1 ·
`negation-changed` 1 · `reason-contradicts-action` 1

Some of those refusals were wrong — several legitimate rewrites were blocked (for example
"In the majority of cases" → "In most cases" trips the quantifier guard). The trade is
deliberate: a refused suggestion costs recall, an accepted bad one corrupts the writer's
meaning. One meaning inversion did reach the UI during holdout-1 ("in a manner that was
confusing" → "in a clear manner"); the `word-substituted` guard was written in response
and now refuses it.

## Resources

- Model file **1.575 GB**, under the 2 GB limit — the August artefact; the one pinned since
  is 1,556,390,368 bytes (see the closing section).
- `llama-server` RSS ≈ **1.96 GB** at 4096 context (weights plus KV cache); Node backend **43 MB**.
- Per-sentence latency across sealed runs: **p50 396–866 ms, p95 521–1312 ms**, max 1484 ms.
  The spread is machine load, not model variance; sampling is deterministic (`temperature: 0`).
- Offline: every request in the browser trace goes to `127.0.0.1`. The backend's only
  outbound socket is to the loopback model server.

## What this is not

This is **not** one-to-one Grammarly quality, and the evidence does not support claiming it.
Grammarly surfaces roughly the same taxonomy, but at 65% adjudicated usefulness and a
3–20% false-positive rate depending on the set, this build suggests less reliably and
misfires more often on clean prose. Known weak spots, all measured: idiomatic redundancy
pairs the model reads as natural ("collaborated together", "added bonus"), `there is/are`
expletives it shortens without removing, and occasional over-deletion where it drops a
qualifier instead of repairing a verb. Grammarly's "add missing specificity" and "resolve
unclear antecedents" categories are out of scope by design — they need facts a
sentence-local engine does not have, and inventing them is forbidden.

## Update: restraint pass (2026-08-27, after the Grammarly comparison)

The comparison found two opposite faults: the engine underlined 37% of sentences where
Grammarly underlined 20%, and the safety layer refused several rewrites that were fine.
Both were addressed, and the fixes were developed on a corpus built from that comparison,
then verified on two fresh sealed sets that had been used for nothing else.

**What changed**

- A second model pass now reviews any rewrite that removes words, and is asked only the
  question a 2B model answers reliably: *is any of the removed information gone?* Asked
  to judge style or worth, the same model hallucinated; asked this, it is useful. It runs
  only on deletions, so most sentences still cost one model call.
- Losing two or more content words is refused outright without asking, because that is the
  case the verifier gets wrong most often.
- A rewrite that eats the end of the sentence ("...for a week" → nothing) is refused, even
  when it swaps in a shorter word ("reported the smell" → "smelled").
- Refused: an edit whose only change is deleting one function word.
- Closed guard gaps: hedges (`basically`, `roughly`), quantities (`a lot of`).
- Loosened, with tests: "a number of" → "several"; a stranded auxiliary
  ("...than the old process was" → "...than the old one") is ellipsis, not a tense change;
  `need` is not a past tense; prefixed irregulars (`undertook`) are; a stock phrase
  compressed to its conventional word ("due to the fact that" → "because") loses nothing;
  padding nouns and redundant modifiers ("at a later point in time", "repeated back again")
  are not lost information; "is of the opinion that" may reduce to "believes".

**Measured effect**

| | Before | After |
|---|---|---|
| Sentences flagged in the 1,131-word Grammarly document | 20 of 54 (37%) | **13 of 54 (24%)** |
| False positives, sealed holdout (40 clean sentences) | 4 of 40 (10%) | **1 of 40 (2.5%)** |
| Useful suggestions, sealed holdout (20 problems) | — | **14 of 20 (70%)** |
| Latency p50 / p95 | 396 / 521 ms | **364 / 778 ms** |

The seven suggestions dropped from the document are exactly the seven adjudicated as
harmful or pointless — the deleted "pie-shaped", the deleted "end of day", the deleted
"during the launch phase", the hedge deleted from "we're basically on track", and the
article-only edits. **No good suggestion was lost, and nothing new was flagged.**
Grammarly flags 11 of the same 54 sentences.

**What this cost.** The verifier ran on 9 of 60 sentences (15%) — only those whose rewrite
removed words — so the p50 barely moved; a sentence that does trigger it costs roughly twice
as long (about 1.5 s end to end in the browser). Adjective-redundancy fixes are the class most affected by the
deletion rules: on one sealed set the redundancy class fell to 1 of 5 before the
padding-noun and redundant-modifier exemptions brought it back partway. The engine still
misses more than it catches in that class.

**What is still wrong.** Two failures in the comparison were restructurings rather than
deletions ("Wanted to flag a risk early, if..." and "...to Liz starting Monday, who'll..."),
and nothing added here addresses those. The explanation text shown to the writer is still
unchecked model prose and is sometimes fabricated even when the edit is right.

## Update: the explanation now describes the actual edit

The card used to show the model's own account of what it did, and that account was
sometimes false. Measured example: for `on tuesday the electrician tested the bonding.`
the model returned "Replaces a nominalization with a direct verb", while the edit it
actually made capitalized two words and changed "bonding" to "bond".

The explanation is now **derived from the diff** (`src/explain.mjs`), the same diff that
draws the underlines. It classifies each run of changes — a phrase shortened to a word, a
confused word corrected, a verb changed to match its subject, an article added, a comma
added, a capitalisation repaired — and quotes the tokens involved. The model's wording is
kept in the payload as `modelReason` for diagnostics and is never shown.

Same sentence, before and after:

| | Text shown to the writer |
|---|---|
| Before | Replaces a nominalization with a direct verb. |
| After | Changes “bonding” to “bond” and capitalizes “On” and “Tuesday”. |

The second one also exposes an edit the boilerplate was hiding: `bonding` → `bond` is a
change to a technical term that the writer should see before accepting.

Two invariants are tested (`tests/explain.test.mjs`): every phrase the explanation quotes
appears in the source or the replacement, and no edit the diff contains goes unmentioned.

## Update: latency

Measured on the operator's laptop (Apple M3 Max, 36 GB, Qwen3.5-2B Q6_K on the GPU).

The model spends its time generating tokens at about 75 tok/s; the 1,587-token system
prompt is cached between calls and costs about 80 ms when warm. The schema emits
`action`, then `replacement`, then `reason` — and the writer never sees the model's
`reason`, because the explanation is derived from the diff. Generation is therefore
stopped at `,"reason"` and the JSON object is completed locally. Every token before the
stop is what the model would have produced anyway, so the decision is unchanged:
**60 of 60 outputs identical on holdout-7, 64 of 66 on the development set.**

| | Before | After |
|---|---|---|
| Clean short sentence | 281–300 ms | **124–158 ms** |
| Clean medium sentence | 408–854 ms | **116–536 ms** |
| Sentence with a suggestion | 950–1400 ms | **770–1280 ms** |
| Mean per sentence, whole document | 693 ms | **462 ms** |
| 1,019-word document, sequential | 37.4 s | **25.0 s** |

The cost: with `reason` no longer generated, the `reason-contradicts-action` guard has
nothing to read, which is why 2 of 66 development rows changed. False positives there went
from 5.6% to 8.3%; on the sealed holdout they were unchanged at 2.5%.

**Two things that did not work, measured rather than assumed.** Running `llama-server`
with four slots instead of one changed nothing for typing (39.8 s vs 38.7 s on the same
document) — a single 2B decode already saturates the GPU, and concurrent checking of a
pasted document only reached 20.1 s against 24.3 s sequential. And dropping the `reason`
field from the schema outright, rather than merely stopping before it, was much faster but
badly worse: development false positives rose from 5.6% to 19.4%, and replacing the free
text with a one-token enum was worse still at 30.6%. The model's own justification is
load-bearing for the quality of the decision even though it is discarded — which is why
the change that shipped stops the tokens without changing the schema or the prompt.

## Update: two-stage triage, measured and rejected

The obvious next speed idea was Grammarly's own shape: screen each sentence with a cheap
call, and pay for a full decision only on the sentences that need one. It was built,
measured, and removed.

**Built.** A short screening prompt (about 300 tokens against the clarity prompt's 1,587)
asking one schema-constrained question — is there a concrete wording problem, yes or no —
with an instruction to answer "yes" when unsure. A "no" ended the matter for that sentence;
anything else fell through to the existing pipeline.

**Fast, for the wrong reason.** The 1,019-word document went from 25.5 s to 20.1 s. But
recall collapsed: **70% to 10% on the sealed holdout, 60% to 16.7% on the development set.**
The screen was not triaging, it was declining to work.

**So the screen was judged on its confidence rather than its verdict**, reading the
probability the model put on "yes" from the token logprobs, which is the right way to tune
a recall-critical filter. Over 126 sentences:

| P(yes) | sentences that get a suggestion | sentences that do not |
|---|---|---|
| min | 0.307 | 0.278 |
| median | **0.453** | **0.437** |
| max | 0.630 | 0.604 |

The distributions are the same distribution. Sweeping the threshold, the share of
suggestions lost tracks the share of sentences skipped almost exactly — at 0.40, skipping
26% of sentences costs 17% of all suggestions; at 0.42, skipping 39% costs 39%. That is
what random skipping would achieve. **This model cannot tell, more cheaply than by
deciding, whether a sentence is worth deciding about.**

The code was reverted rather than left disabled. What remains true from the exercise: the
KV-cache thrash I expected from alternating two system prompts on one slot did not appear
(20.6 s on one slot against 20.1 s on three).

**The real remaining cost is writing the replacement out.** A clean sentence is already
cheap (124–158 ms) because a `keep` decision generates an empty replacement; a suggestion
costs 770–1280 ms because the model emits the whole new sentence token by token, and most
of those tokens are a copy of the input. The next idea worth measuring is asking for the
changed span only ("replace X with Y") and applying it locally after checking that X occurs
exactly once — perhaps ten tokens instead of forty. That is a change to what the model
writes, so it needs the same quality gates as everything else here.

## Update: adversarial review round (2026-08-28)

Three independent reviewers (separate agents, disjoint scopes, every finding required a
reproduced failure) audited the codebase; three fix agents repaired what they found. 33
reproduced bugs were fixed; the test suite grew from 91 to 139; the benchmark gate shows
zero quality change (identical surfaced/false-positive rows on both corpora, before and
after).

The ones that mattered most, honestly stated:

- **The safety layer had real meaning-inversion holes.** "hired"→"fired",
  "at least"→"at most", "Many"→"Few", "confirmed"→"confused", "50%"→"50" and "v2"→"v3"
  were all ACCEPTED before this round — the Levenshtein/prefix relatedness rule and two
  quantifier exemptions were far too loose, and the % pattern had an unmatchable word
  boundary. All now reject, with zero benchmark recall cost.
- **One `POST null` killed the demo server process**; so did an empty Host header. Both fixed.
- **A wedged model server read as "Looks clear"** and the sentence was never re-checked
  after recovery. Errors now surface in the status line and the sentence retries.
- **The typing debounce restarted an unchanged sentence's model request on every pause**
  (43 requests issued for one sentence in the repro); a request is now issued once.
- **The bench harness scored engine errors as clean "keep" rows** — a dead model measured
  as a flawless run. Failures are now counted and excluded from denominators, so earlier
  reports understate nothing silently: dev-v7.json contained one such mis-scored row.
- Mechanics repairs could corrupt URLs/paths; the overlay drifted one line on documents
  ending in a newline; accepted Replaces triggered a second analysis of their own output;
  duplicate sentences could inherit each other's dismissals; a verifier outage was
  indistinguishable from a deliberate safety refusal. All fixed.

Known limitations left deliberately: a sentence ending in an abbreviation ("Ship it to
the U.S.") is never analysed (conservative trigger design); "npm" at sentence start still
gets capitalised (no command dictionary); while the model server is down, mechanical-only
fixes are withheld along with everything else (fail-visible over fail-partial).

## Update: the rules tier was pre-empting the model, and the bench never saw it

Two defects found while researching how to close the remaining gap to Grammarly. Both
are measurement or precedence faults rather than model faults, and the second one means
every quality number above describes a configuration that does not ship.

**A fired clarity rule ended the sentence.** `pipeline.mjs` returned the rule's answer
outright, so the model and the grammar tagger were never asked about a sentence a rule
happened to touch — and a rule only ever repairs the wordiness it matched. With the
shipped 45-rule table, on the settings `server.mjs` and the plugin both use:

| The writer types | What was offered |
|---|---|
| In order to ship, the tests **was** run. | To ship, the tests **was** run. |
| The tool has the ability to **recovers** files. | The tool can **recovers** files. |
| A large number of **user was** affected. | Many **user was** affected. |
| We are able to **sees** the logs. | We can **sees** the logs. |

Each was then recorded as decided, so nothing looked at the sentence again. The rule's
answer is now a FLOOR: it is offered when the model has nothing better, and the model —
shown the writer's own sentence, never the rule's output, so the safety layer still
validates one delta rather than two stacked ones — supersedes it. `main.mjs` carried the
same short-circuit ahead of its cache and lost it too; the cache epoch is bumped, because
answers cached under the old precedence describe the old pipeline. The fast local card is
unchanged: with no engine the deterministic pass still answers in ~150 ms, including while
`llama-server` is down.

Cost: the model is now asked about the sentences a rule answers. The shipped table fires
on 16 of 231 rewrite-expected rows and 0 of 200 correctness rows, so this is roughly one
extra model call per 745 sentences, not a tier's worth of latency.

**The benchmark never enabled the tier at all.** `bench/run.mjs` called `analyzeSentence`
with `{engine, mechanics, deletionPolicy}` — no `rules`, no `gate`, no `tagger`, all of
which default to off. Every figure above therefore measures mechanics + model only. The
options are now explicit, default to the shipped configuration, and are recorded in
`report.options` so two runs differing only in tier configuration are distinguishable.
Re-running the sealed sets under the shipped configuration is the obvious next step; the
totals are expected to barely move (the table fires rarely), which is itself worth
knowing.

## Update: bench/oracle.mjs — measuring what the safety layer refuses, for free

The gap to Grammarly could not be attributed: a missed suggestion might mean the model
never found the edit, or that it found it and a guard threw it away. `bench/oracle.mjs`
separates the two by replaying Grammarly's own 118 accepted rewrites
(`bench/corpus/grammarly-pairs.json`) through the deterministic gauntlet as if the model
had proposed each one. No model calls; 0.17 s.

| Fate of Grammarly's own accepted rewrites | | 95% Wilson |
|---|---|---|
| Hard-accept — reaches the writer | 42/118 (35.6%) | [27.5, 44.6] |
| Sent to the 2B verifier | 22/118 (18.6%) | [12.6, 26.6] |
| **Hard-refuse — never reaches the writer** | **54/118 (45.8%)** | [37.0, 54.7] |
| **Ceiling, if the verifier approved everything** | **64/118 (54.2%)** | [45.3, 63.0] |

Refusals by guard: `certainty-changed` 16 · `word-substituted` 8 · `tense-changed` 6 ·
`quantifier-changed` 5 · `information-dropped` 4 · `order-changed` 3 · `name-changed` 3 ·
then singles.

**What the number is, and is not.** It is the share of Grammarly's EXACT WORDINGS this
gate would pass — a compatibility measure against one engine's phrasing, and an upper
bound on recall against that phrasing. It is not the shipped engine's recall, and a
refusal is not automatically a defect: the `hedging and qualifiers` theme (0 accept / 1
verifier / 6 refuse) and much of `certainty-changed` are the deliberate differences
recorded in `docs/GRAMMARLY-BEHAVIOUR.md` §3 — Grammarly invents agents for agentless
passives and strengthens hedged claims, and refusing both is the design. Equally, the
`numbers, units, versions and entities (safety probes)` theme refuses 4 of 4, which is
the correct answer and is pinned as such.

Two flat inconsistencies the histogram exposed, both artefacts of counting rather than
policy anyone chose:

```
"It is worth noting that the cache expires…"        ACCEPT
"It should be noted that the endpoint requires…"    REFUSE (certainty-changed)

"The findings were presented by the analyst…"       ACCEPT   (past passive)
"The tickets are reviewed by the on-call engineer…" REFUSE   (present passive)
```

`certainty()` is a whole-sentence bag-of-words count, so deleting a formulaic matrix
frame reads as a change to the writer's claim whenever the frame happens to contain
`should`. That is the case for span-scoped guards, and the oracle is how such a change
would be scored: refusals reached, against false unlocks, on every commit.

## Update: raising the safety layer's ceiling, measured both ways (2026-09-01)

`bench/oracle.mjs` showed that 54 of Grammarly's 118 accepted rewrites were refused
outright by this project's own gate — a recall ceiling of 54.2% that no model change
could move. This is the record of raising it, and of the instruments that made the work
safe to do.

**The number is not a defect count.** Before any guard was touched, all 54 refusals were
hand-labelled into `bench/corpus/oracle-labels.json`: **17 ALIGNED**, refused on purpose
on one of five recorded grounds — agent-invention (4), vocabulary (6), certainty-raised
(3), quantity/entity (3), dialect (1), taken from `docs/GRAMMARLY-BEHAVIOUR.md` §3 — and
**37 UNINTENDED**, artefacts of whole-sentence word counting. The labelling landed as its
own commit, first, precisely so the work could not become rationalisation of whatever the
guards happened to do. `tests/oracle.test.mjs` pins the ALIGNED set as a permanent floor.

**Every change was scored on both sides.** `bench/unlock-check.mjs` replays the 183
distinct model rewrites this project has ever refused (`rejectedText` across
`bench/results/*.json` — real 2B output, including the meaning inversions that motivated
half of `safety.mjs`) and fails the suite if a guard change lets one through. Raising the
oracle by loosening guards is trivial; this is what stops it.

| | before | after |
|---|---|---|
| Hard-accept (reaches the writer) | 42/118 (35.6%) | **52/118 (44.1%)** |
| Sent to the 2B verifier | 22 | 22 |
| Hard-refuse | 54/118 (45.8%) | **44/118 (37.3%)** |
| **Ceiling** | **64/118 (54.2%)** | **74/118 (62.7%)** |
| UNINTENDED rows reached | — | 10 of 37 |
| Recorded refusals unlocked | — | 1, hand-checked |

Five changes, each its own commit with both numbers in the message:

1. **Attention frames.** `"It should be noted that X"` -> `"X"` was refused because the
   frame contains "should", while the identical edit on `"It is worth noting that X"` was
   accepted because that frame happens to contain no counted word. The guards now judge
   the surviving proposition for a closed class of frames that direct attention and assert
   nothing. Epistemic frames ("it could be argued that") are excluded on purpose.
   `lostContentWords` is scoped to the same span, without which the two halves of the gate
   disagreed about what the sentence is and the rows landed in the verifier bucket anyway.
2. **Repetition is not information.** Comparing occurrence counts meant
   `"We could either rewrite it, or we could refactor it"` could not be tidied, though
   `gate.mjs` has a "repeated subordinator" family whose job is to find exactly that.
   Both the certainty and discourse guards now compare DISTINCT group members.
3. **In a passive, the auxiliary carries the tense.** The `-ed` branch already knew this;
   the irregular branches did not, so `"is read"` scored as past while `"reads"` did not.
   Gained no ceiling on its own — the rows moved from `tense-changed` to
   `word-substituted` — which is how the next blocker was found.
4. **An inflection of a source word is not an invention.** `vocabularyHasAntecedent`
   searched only the diff run a word was inserted in, so a voice conversion's `"reads"`
   never met the removed `"read"`.
5. **A hedge stack may reduce; an emptied group may not.** The certainty group conflated
   epistemic modals with degree adverbs, which made `"could possibly"` -> `"could"`
   indistinguishable from dropping a claim's only modal and leaving a degree word behind.

**What it cost, stated plainly.** Ignoring repetition means a modal can be dropped from
one of two coordinated clauses while the other keeps its own, and no count notices. Exact
counts refuse that, but they also refuse the legitimate tidy, which is far commoner and
which Grammarly performs. Closing it properly needs a notion of which clause a modal
governs — a parse, not a word list. It is pinned as a `todo` test rather than hidden, and
nothing in the 183 recorded refusals exhibits the bad shape.

**Three wrong turns, kept in the record.** Presence-per-word semantics broke the flagship
`"has the ability to"` -> `"can"`, because within a group the words are interchangeable by
construction; nine tests caught it and the oracle fell. Skipping a fixed number of adverbs
when looking for a governing auxiliary made the test asymmetric, so merely dropping an
adverb read as a tense flip; two MUST-ACCEPT tables caught it. And the first version of
change 4 licensed the model to introduce "the bulletin at" from the word inside
`https://example.test/bulletins` — caught by the false-unlock control, fixed by treating
protected tokens as opaque atoms rather than prose the writer used.

**Where the remaining 27 sit.** `certainty-changed` 6, `tense-changed` 5,
`quantifier-changed` 4, `word-substituted` 3, `information-dropped` 3, then singles. By
theme, the concentration is `hedging and qualifiers` (0 accept / 1 verifier / 6 refuse)
and `academic and formal register` (2/0/6). Several of the rest need a parse rather than a
list — reduced relative clauses (`"The results obtained from the experiment"`), ambiguous
base/past forms (`"They put forward a proposal"`) — and are honest limits of a
bag-of-words gate rather than bugs in it.

The safety-probe rows still refuse 4 of 4, which is the correct answer and is pinned.


## Update: the ceiling again — 62.7% to 75.4%, six guard families (2026-09-01)

A second pass over the same instruments, working the 27 UNINTENDED refusals the first
round left. The loop was unchanged and is worth restating because it is what makes this
kind of work safe: change one guard family, run `node bench/oracle.mjs` for the number,
run `npm test` — which carries both the ALIGNED floor and the 183-row false-unlock
control — and put both numbers in the commit message.

| | first round | this round |
|---|---|---|
| Hard-accept (reaches the writer) | 52/118 (44.1%) | **73/118 (61.9%)** |
| Sent to the 2B verifier | 22 | 16 |
| Hard-refuse | 44/118 (37.3%) | **29/118 (24.6%)** |
| **Ceiling** | **74/118 (62.7%)** | **89/118 (75.4%)** |
| UNINTENDED rows reached | 10 of 37 | **25 of 37** |
| ALIGNED rows still refused | 17 of 17 | 17 of 17 |

Against the starting point before either round, the ceiling has gone from 64/118 (54.2%)
to 89/118 (75.4%), and hard-accepts — suggestions that actually reach the writer without
a second model call — from 42 to 73.

**Six commits, one guard family each.**

1. **Politeness, futurity and commitment are spelled the same way.** A softening "would"
   ("would like to", "would it be possible") is stripped before the certainty groups are
   counted; a conditional or reported "would" is untouched. An evidential raising hedge
   stacked on an evidential verb ("would seem to suggest") counts as one hedge, not two.
   And a hedge INSIDE the scope of a surviving hedge may go: "I suggest that we perhaps
   delay it" is no more an assertion than "I suggest we delay it". Scope is approximated
   by position, which is exactly what keeps "The tool could recommend an action" -> "The
   tool recommends an action" refused — there the modal stands over content, not over a
   hedge.
2. **"just", "most" and "no" each carry two senses.** The softener "just" restricts
   nothing ("Just to give a quick update"); the exclusive restricts everything ("just
   three tenants"). "most" and "least" are bounds only in "at most"/"at least", and
   ungated the bound sense fired on every ordinary "most cases". "no" in "no longer" is
   temporal, not quantitative. Narrowing is now keyed by GROUP, because the same word
   means different things in different groups.
3. **The negator does not carry tense.** The walk that finds the auxiliary governing a
   participle skipped adverbs but not "not", so "is read" was present and "is not read"
   was past: negating a passive flipped its tense, and every faithful rewrite that kept
   the negation was refused for changing a tense it had not touched. Separately, a verb
   whose past and base are the same word ("put", "set", "cost") records nothing about
   tense, so resolving one to a past contradicts nobody — permitted one way only.
4. **The deletion policy was billing the writer for words the validator had excused.** A
   light verb in an unpacked nominalization carries no meaning of its own ("undertook a
   review of" -> "reviewed"); a hedge deleted while another hedge stands is a stack being
   reduced, which is the judgement `validateRewrite` had already made; "in place" is
   filler and "would just like to" is manners. This was the largest single move: 66.9% to
   72.0%.
5. **The long tail.** A posix path was recognised by a SPACE before the slash, so every
   path in brackets was invisible. The passive skeleton's deadline exclusion covered
   digits but not spelled numbers, so "delayed by three weeks" read as a passive with an
   agent called three. An expletive "it" over a that-clause has no patient noun phrase to
   move. "whether or not X" is "whether X". And "it" names nobody, so an inanimate
   anaphor cannot change who a sentence is about.
6. **The rule tier**, extended over Grammarly's phrase list — 33 rules and 4 openers,
   raising exact reproductions of Grammarly's own wording from 14 to 18 with still zero
   firings on the 82 sentences it left alone.

**Two holes found going the other way.** Neither was the point of the work, and both
matter more than the ceiling.

None of "nobody", "nothing", "nowhere" or "no one" matches `\bno\b`, so the negation
tally never saw them. The validator was **accepting** `"The service writes nothing to the
primary."` -> `"The service writes to the primary."` and `"We looked everywhere and found
nothing."` -> `"We looked everywhere."` outright. Both are meaning inversions of exactly
the kind the whole gate exists to refuse. They are now refused as `negation-changed`, and
one redteam expectation moves from `word-substituted` — that inversion had been caught
only incidentally, by the vocabulary guard.

The inversion rule inside `lostContentWords` bills every deletion in its run, which is
right for a removed failure and wrong for a preserved one: `"In the event of a failure,
the client will retry"` -> `"If the request fails, the client will retry"` keeps the
failure and was billed for it, and for the stock noun "event" alongside.

**The wrong turn, kept in the record.** The first version of the light-verb exemption
tested only that the run put back a word RELATED to a noun it removed. English builds
idioms out of the same shape, and it hard-accepted `"The engineer took the blame for the
outage."` -> `"The engineer blamed the outage."` and `"The auditor took issue with the
figures."` -> `"The auditor issued the figures."` — both inversions, neither in the 183
recorded refusals, so the control said nothing. What caught them was an adversarial probe
written before committing. The fix is the noun: a real nominalization wears a derivational
suffix or takes a nominal complement ("a review OF"), and blame, floor and issue do
neither. Both idioms are back to reporting their loss, and both are pinned.

**Three instrument repairs.** Each came out of a moment where the measurement could have
misled.

- `bench/unlock-check.mjs` now reports **refused -> verifier** moves on their own line.
  That is a real relaxation — the deterministic gate stops refusing and a 2B model decides
  instead — and the accept/refuse binary was hiding them among ordinary reason changes.
- `--write` now takes `--note` and records, in `refusal-baseline.json` itself, every
  rewrite a re-baseline has ever promoted to accepted. Four are recorded there, hand-read:
  three light-verb unpacks and one "a number of" -> "several". A baseline that quietly
  absorbs the holes it was built to catch proves nothing.
- The rule tier and the safety layer are checked by different machinery — a hand audit
  against the admission bar, and the guards in `safety.mjs` — and nothing had forced them
  to agree. They did not: the rule tier deleted "there is no doubt that" while the safety
  layer refused the identical edit from the model, so the writer saw that suggestion only
  when the deterministic pass happened to fire. A new test replays every rule firing
  through `validateRewrite`; the opener is withdrawn, per `docs/GRAMMARLY-BEHAVIOUR.md`
  §3, which records flattening that emphasis as a difference from Grammarly the project
  keeps on purpose. The rules' divergence check also stopped being a count with a ceiling
  — a count says how many divergences exist and nothing about whether any is defensible —
  and is now an explicit list of eight reviewed rows.

**Three labels are, on reflection, wrong**, and the guards are deliberately left refusing
them. `"There is no doubt that X"` -> `"X"` and `"a brief summary of the basic
fundamentals"` -> `"the fundamentals"` are both listed in `docs/GRAMMARLY-BEHAVIOUR.md` §3
under "emphasis and nuance dropped", as differences the project keeps; and `"Arguably, the
results are encouraging."` -> `"The results are encouraging."` is the same edit as the
ALIGNED row `"It could be argued that X"` -> `"X"`. The documentation predates the
labelling, which is what makes this a correction rather than a rationalisation. "Arguably"
and its siblings now sit beside "apparently" in the modal group, so that row refuses for
the reason its sibling does rather than as a change of NAME.

**Where the remaining 12 sit, and why they are not bugs.** Four need a parse: a reduced
relative clause (`"The results obtained from the experiment are presented..."`), a past
hidden inside an embedded clause the rewrite drops (`"what our costs were"`), a
tautological relative (`"contingencies that may arise"`), and a future resolved to a
present (`"will be required"` -> `"is needed"`). Two are possessive expletive frames
rewritten to a finite verb (`"It is our expectation that X will Y"` -> `"We expect X to
Y"`), where the frame's own aspect and the complement's finiteness both change at once and
the proposition would have to be compared under a normalisation this gate does not have.
Three are genuine vocabulary substitutions Grammarly made and we refuse ("demonstrated" ->
"shown", "no longer" for "nobody"). Three are the mislabelled rows above. Nothing here is
a counting artefact any longer.

Final state: **736 tests, 720 pass, 0 fail**, 13 skipped (they need a live model), 3 todo
— one pre-existing and two deliberate known-gap pins.


## Update: auditing what the gate ACCEPTS — the missing half of the measurement (2026-09-01)

Everything this project measured asked about refusals. `bench/oracle.mjs` asks how much of
Grammarly's phrasing the gate refuses; `bench/unlock-check.mjs` asks whether a change newly
accepted something previously refused; `bench/score.mjs` counts a surfaced suggestion on a
rewrite-expected row as a win and never looks at it again. **Nothing asked whether a
suggestion the gate accepted was correct.**

That gap had already cost something. The two meaning inversions found in the previous
round — `"The service writes nothing to the primary."` -> `"The service writes to the
primary."` among them — would have scored as recall *successes* in every instrument above,
and the false-unlock control could not have seen them either: it is differential, and
notices only what stops being refused, so a hole present since the first commit is
invisible to it. What caught them was a lexical audit and a hand-written probe. Luck.

`bench/results/*.json` records `replacement` for every rewrite the gate ever accepted,
exactly as it records `rejectedText` for every one it refused. That is **274 distinct pairs
across 42 reports**, and nobody had read them.

**All 274 were read, and labelled before any guard was touched.** The bar: PRESERVING means
a reader ends with the same beliefs about the world; CHANGED means the rewrite asserts
something the source did not, drops something it did assert, reverses a relation, or moves
a quantity, entity or boundary. Style, register and emphasis are PRESERVING. Eleven rows
where the call was close carry `confidence: "borderline"` rather than being rounded.

| | |
|---|---|
| Total accepted rewrites | 274 |
| PRESERVING | 257 |
| **CHANGED** | **17** |
| — still accepted by today's gate | **8** (the defect list) |
| — in the verifier bucket | 5 |
| — already refused | 4 |

`bench/precision-check.mjs` is the instrument, shaped like `unlock-check` on purpose: same
keying, same `--write --note` baseline carrying a history of what each re-baseline changed.
It reports four numbers, and only one of them fails the build — a meaning-changing rewrite
becoming *newly* accepted. The fourth line is what keeps it honest in the other direction:
**preserving rewrites newly refused**. Tightening for precision costs recall, and a change
that quietly refuses twenty good rewrites to close one defect is the same failure as
loosening, with the sign flipped.

**Seven of the eight defects are closed. Every one cost nothing.**

1. **A survivor elsewhere in the sentence is not the deleted word's meaning** (3 rows). The
   deletion policy asked whether *any* surviving content word was related to a deleted one,
   over a set — and English repeats content words constantly. In `"the right Solid Rocket
   Booster struck ... the right wing"` the second `"right"` paid for deleting the first, and
   with it which of the two boosters struck the wing; that rewrite was accepted ten times
   over. `"consists of a payload structure and a spacecraft structure"` -> `"and a
   structure"` went the same way. Comparing *counts* asks the question that was meant.
2. **A word inside a protected token is not the writer's vocabulary.** The content-word list
   strips protected tokens; the literal fallback on the line below it still read the raw
   source, so the `"audit"` inside `/srv/reports/audit.md` licensed `"the audit notes"`.
   The same hole the false-unlock control once found with a URL, closed for the list and
   left open on the fallback.
3. **A derivation read as an inflection.** `related()` treats a derivational tail as an
   inflection — right nearly everywhere, and wrong when the derivation is the whole edit:
   `"tested the bonding"` and `"tested the bond"` are different claims.
4. **A deadline preposition swapped for another.** `"before Thursday"` excludes Thursday;
   `"by Thursday"` includes it. Both are function words, so nothing noticed.
5. **An agentless passive introduced over an active verb.** `"Will the parts clear
   inspection?"` -> `"Will the parts be cleared for inspection?"` moves the subject from
   agent to patient. `rolesFlipped` exists for this class and cannot see this member of it:
   it compares participants around a `"by"` phrase, and an agentless passive has none.

**The eighth is left standing, and the reason is measured rather than asserted.** A
conditional re-attaches: `"flag a risk early, if X the flow could stall"` -> `"flag a risk
early if X, as the flow could stall"` moves the `if` from governing the stall to governing
the flagging. It belongs to the class "a connective introduced where the writer had none" —
and refusing that class would cost **14 PRESERVING rewrites in this very corpus**, because
resolving a comma splice by adding `"as"`, `"which"` or `"because"` is exactly what the
model is asked to do. Fourteen good suggestions for one defect is a bad trade. Closing it
properly needs to know which clause the connective governs, which is the same parse the
pinned `todo` on coordinated-clause hedges needs.

**Three wrong turns, kept in the record.** Removing `"process"` from `STOCK_PHRASE_NOUNS`
outright — where it made a real noun free to delete anywhere — cost two preserving
rewrites, which is how the narrower fix (a filler *span*, `"in the process of"`) got found;
the blunt version is not in the diff. The derivation guard's first version refused a
legitimate ESL repair, `"She is listen to the operator."` -> `"...is listening..."`, because
under a be-auxiliary `-ing` is the progressive rather than a derivation; the MUST-ACCEPT
table caught it. And the deadline guard worked in one direction only at first: its
complement pattern swallowed a sentence-final full stop, so `"by Friday."` and `"before
Friday."` were two different complements that never met.

**Scores, held on all three sides across every commit in this round:**

| | |
|---|---|
| Precision: standing defects | 8 -> **1** |
| Precision: newly accepted meaning changes | **0** |
| Precision: preserving rewrites given up | **0** |
| Oracle ceiling | **89/118 (75.4%)**, unchanged throughout |
| Unlock control | 0 of 183 unlocked, 0 softened |
| Tests | 748, pass 732, fail 0 |

That the oracle did not move once is the point worth stating: seven meaning-changing
rewrites stopped reaching the writer and no legitimate one was lost with them.

**What remains unmeasured, and needs a model this container does not have.** Five of the
seventeen CHANGED rows sit in the verifier bucket, where a 2B model decides — and nobody
has checked what it says. The oracle's headline is stated as *"ceiling, if verifier says
yes"* and counts its 16 verifier rows optimistically on the same assumption. Both are
honest labels on an unvalidated assumption, not a result. `llama-server` and
`models/gector` are absent here, so that stays open.


## Update: the first live end-to-end run — and what it says about the verifier (2026-09-01)

Every number above this section was produced without a model. The 13 skipped tests were
skipped for want of artefacts, and the honest caveat at the end of the last section —
that the oracle counts its verifier rows on an unvalidated assumption — was left open
because `llama-server` was not installed. It is now.

**The setup, so it can be reproduced.** llama.cpp built from source (commit `8887a48`),
CPU only, 4 threads, no GPU. Weights: `lmstudio-community/Qwen3.5-2B-GGUF` →
`Qwen3.5-2B-Q6_K.gguf` (1.56 GB), the filename the README names, served with exactly the
flags `npm run model` uses. GECToR: the four artefacts
`docs/PHASE-2-GECTOR-PLAN.md` §artifacts names, from
`Zaid-Hossain/gector-roberta-onnx`, under onnxruntime-node **1.29.0** — the same version
the goldens' provenance records.

**`--reasoning off` is load-bearing.** Started without it, two live tests fail with
"Model returned no content": Qwen3.5 emits its thinking and the `content` field comes back
empty. The README's own command is right and the flags are not decoration.

### The verifier is close to a rubber stamp

This is the finding worth the whole exercise, and it corrects a claim made in the section
above. The deletion policy sends a rewrite that loses exactly one content word to the 2B
verifier rather than refusing it. Asked about **22 such rewrites**, that verifier said
*show* to **20**:

| put to the verifier | show | hide |
|---|---|---|
| The oracle's 16 conditional rows (Grammarly's own wordings) | 15 | 1 |
| The 6 rewrites hand-labelled as MEANING-CHANGING | **5** | 1 |

So the "if verifier says yes" ceiling of 89/118 is, measured, **88/118 (74.6%)** — the
assumption was nearly right. But the same permissiveness runs the other way: of the six
meaning changes the deterministic gate hands it, the verifier lets five through. **The
verifier bucket is not a safety net.** The previous section filed those five as "handled
by a model call this container cannot make"; measured, they reach the writer.
`bench/precision-check.mjs` now counts them on their own line instead of filing them away.

The trade-off is a product decision, not a bug, so it is recorded rather than taken:

| deletion policy | oracle ceiling | meaning changes reaching the writer |
|---|---|---|
| `verify` (shipped) | 88/118 (74.6%) measured | 6 |
| `refuse` | 73/118 (61.9%) | 1 |

Refusing every single-word deletion stops five bad rewrites and costs fifteen good ones —
roughly three to one against. The better answer is a stronger verifier prompt, which is
now measurable for the first time.

### What the live run actually scored

Development corpus, 60 rows, shipped configuration (mechanics + rules, deletion policy
`verify`):

| | this run | recorded in "Model selection" above |
|---|---|---|
| Surfaced on rewrite-expected | 28/36 (77.8%) | 32/36 (89%) |
| **False positives on clean** | **0/24 (0.0%)** | **0/24** |
| Engine failures | 0 | — |
| Latency p50 / p95 | 1343 ms / 3548 ms | — / 981 ms |

The eight misses are **six model keeps and two gate refusals**, and both refusals are
correct: `"Neither of the proposed dates work"` → `"…is suitable for…"` invents
"suitable", and `"every unresolved dependency"` → `"all unresolved dependencies"` swaps
one quantifier for another. **The gate is not the bottleneck here; the model is.** The
false-positive rate reproduces the recorded figure exactly.

The eleven-point recall gap and the latency gap are not attributable from inside this
container: different hardware (4 CPU cores against an M3 Max) and possibly different
weights. Nothing pinned a hash of either artefact, which is the lesson below.

### Three test failures, all diagnosed, none a defect in this work

With the artefacts present, `npm test` runs 748 tests: **742 pass, 3 fail**, and each
failure is a fixture guard doing its job on artefacts that differ from the ones the
numbers were recorded on.

- **GECToR differential referee**: 857 of 880 goldens reproduce exactly (97.4%); 23
  differ, 4 of 220 at the production operating point. Proven not to be this work: the
  pre-hunt `src/gector.mjs`, checked out and re-run, fails identically. `labels.txt`
  matches (5,001 tags, same first three) and onnxruntime matches the provenance, so the
  ONNX weights are the only unpinned variable. sha256 of what was downloaded today:
  `92dda3a834b44def…`. One of the differences is in our favour — the golden expects a
  wrong article ("the engineering shipped") and today's weights do not insert it.
- **GECToR corpus referee**: two extra false fires on prose Grammarly left alone.
- **Live-model convergence**: two of five fixture pairs this model no longer proposes; it
  returns `keep`. The test's own comment anticipates this — "a drifted model shows up as a
  fixture failure, not a false pass". Verified separately that the gate ACCEPTS both
  rewrites, so it is the model, not the gate.

None of these were re-pinned. Re-pinning goldens to weights that cannot be shown to be
canonical would destroy the measurement they exist to protect.

### What the run fixed

- `"at the present time"` deleted outright was billed for half of itself: `"time"` is on
  the stock-phrase list and `"present"` is not. Now a filler span, like
  `"in the process of"`. One recall gain, no cost on any instrument.
- `bench/run.mjs` gains `--timeout-ms`. The 20-second per-call timeout was hardcoded,
  which is an assumption about hardware rather than about the engine: two of sixty rows
  timed out on the first run and were scored as engine failures, lowering recall for a
  reason unrelated to the model or the gate.
- `bench/precision-check.mjs` gains a recall-GAIN line. Counting only what tightening
  gives up reads as though it can never give anything back — and the fix above would have
  gone unrecorded.

### Verified working, end to end

The four-tier pipeline, live: mechanics, clarity rule, GECToR grammar tagger, and the
local model each observed firing on their own sentence. The demo server answers
`/api/status` ready and `/api/rewrite` with a correct rewrite and a derived explanation
naming both edits, in 1.9 s. The Obsidian plugin bundles (204 kB).

**The lesson worth keeping: pin the artefacts by hash.** Two of the three failures above
are unresolvable — not because the answer is hard, but because nothing recorded which
bytes the original numbers were measured on.


## Update: closing the project — every thread, and where it ended (2026-09-01)

This section exists to be checked rather than believed. Each claim below names the command
that produces it.

### The state

| | |
|---|---|
| `npm test`, artefacts on disk, `npm run model` running | **756 tests, 753 pass, 0 fail, 0 skipped**, 3 todo |
| `npm test`, artefacts on disk, no server | **756 tests, 747 pass, 0 fail, 6 skipped**, 3 todo — the six are the live-model tests |
| `npm test`, clean checkout | **756 tests, 740 pass, 0 fail, 13 skipped**, 3 todo |
| `node bench/oracle.mjs` | ceiling **88/118 (74.6%)**, hard-accept 73, verifier 15 |
| `node bench/precision-check.mjs` | **0** standing defects, 0 newly accepted, **0 deferred to the verifier**, 0 recall cost |
| `node bench/unlock-check.mjs` | 0 of 186 unlocked, 0 softened |
| `node bench/verifier-check.mjs` | catches 4/9, refuses 1/49 — and none of those nine reaches it any more: every one is refused deterministically before the verifier is asked (see below) |
| `node tools/fetch-models.mjs --verify` | all 5 artefacts match the manifest |
| `node bench/score.mjs bench/results/dev-closing-qwen3.5-2b-cpu.json` | the live run the table below is read from |

Every model number was measured on the artefacts pinned in `models/MANIFEST.json`, on
**4 × Intel Xeon @ 2.10 GHz, 15 GB RAM, CPU only, no GPU** — llama.cpp built from source
at commit `8887a48`, `llama-server` run with the flags `npm run model` uses.

Development corpus, 60 rows, shipped configuration (mechanics + rules, deletion policy
`verify`), run on the final tree:

    node bench/run.mjs --corpus bench/corpus/development.json --prompt src/clarity-prompt.txt \
      --verifier src/verifier-prompt.txt --model-path models/Qwen3.5-2B-Q6_K.gguf \
      --timeout-ms 180000 --output bench/results/dev-closing-qwen3.5-2b-cpu.json

| | this run | the run before it, same artefacts | the figure recorded in "Model selection" |
|---|---|---|---|
| Surfaced on rewrite-expected | 27/36 (75.0%) | 28/36 (77.8%) | 32/36 (89%) |
| **False positives on clean** | **0/24 (0.0%)** | **0/24** | **0/24** |
| Engine failures | 0 | 0 | — |
| Latency p50 / p95 / max | 1343 / 2532 / 14594 ms | 1239 / 2389 ms | — / 981 ms |

All three gate refusals in this run are correct, and the gate behaved identically to the
run before it: `"a smaller and more reliable component"` -> `"a smaller component"`
(information-dropped, the dissolved-coordination guard), `"Neither of the proposed dates
work"` -> `"…is suitable for…"` (word-substituted, "suitable" is invented), and — on a
**clean** row — `"every unresolved dependency"` -> `"all unresolved dependencies"`
(quantifier-changed). The third is the gate stopping a false positive the model wanted to
raise, which is the number the safety argument rests on.

The one-row recall difference between the two runs is the model, not the gate. The same
weights on the same hardware do not reproduce bit-for-bit across llama-server sessions:
`"Rina provided an explanation of"` was rewritten last time and kept this time, and
`"Despite the fact that the alarm sounded"` came back as a different sentence — one already
in the accepted-rewrite labels, so the precision control had seen it. **Recall from a live
run on this model is a ±1-row figure; the false-positive rate and every gate decision
reproduced exactly.**

### The verifier, measured rather than assumed

The deletion policy does not refuse a rewrite that loses exactly one content word; it asks
the 2B model. Nobody had measured how good that model is at the question, so
`bench/corpus/verifier-labels.json` records what it SHOULD say on all 61 rewrites that
reach it, and `bench/verifier-check.mjs` scores it.

Reading the six meaning-changing rewrites it was actually asked corrects the previous
section's account of it. For **three of the six, "show" is the right answer to the question
it was asked** — the removed word was replaced in the same slot, or was a preposition
carrying nothing, or was still in the proposed sentence and named by a loss list that was
wrong. It misses two of the three it is genuinely asked. "Shows five of six" was true as a
count and unfair as an indictment.

Two changes came out of that, and one refusal:

- **Reason before verdict.** A constrained schema emits fields in order, so with the
  verdict first the model committed and then justified — caught answering "show" and then
  explaining that removing the word "loses specific information about how long". 3/9 → 4/9
  caught, no cost.
- **A rewritten prompt was rejected**, with numbers. Starting from "hide" scored 6/9, and
  5/49 refused — every extra catch on a probe row that never reaches the verifier in
  production, four of the five false hides on rows that do. Two further variants that added
  an escape hatch to it scored 3/9; this model takes every hatch offered, and waved
  "spacecraft" through as *"the container and the thing it held is still there"*.
- **Four classes were taken off the verifier entirely**, because they are cases where its
  question invites the wrong answer, not cases a better prompt would fix.

Where that leaves it on the final tree: replaying every labelled rewrite through the gate
(`bench/precision-check.mjs`, whose `fixed` bucket now also counts a rewrite that used to
reach the verifier and is now refused outright), **all nine rewrites the verifier was
labelled to hide are refused deterministically before it is asked**, and the one preserving
rewrite it is measured to refuse in error (`"reach out and follow up"`) is the dissolved-
coordination guard's known one-row cost, not the verifier's. The 4/9 score still stands as
a measurement of the model — it is what a future rewrite of the same kind, one no label
has seen, would be relying on — but on the labelled corpora criterion 2 holds under
`verify` and under `refuse` alike. That makes the deletion-policy choice a pure recall
question, which is recorded under "Decided" below.

### The seven guards that closed the gap

Each is free unless stated: no oracle rows, no recall cost, no unlocks.

1. **A dissolved coordination.** Nothing is implied by the word it was coordinated WITH.
   Costs one Grammarly row — `"reach out and follow up"` is a synonym doublet, not a
   property pair, and telling those apart is semantics.
2. **A word the sentence still contains, only fewer times.** Here a *copy* of the removed
   word is what survives, so "already implied by what survives" is answerable yes and wrong.
3. **A deadline phrase that got shorter.** `"until end of day tomorrow"` -> `"until
   tomorrow"` keeps both ends and moves the deadline by most of a day.
4. **A comma that moved across a subordinator.** This is the clause-scope family, from the
   side that needs no parse: where the comma sits IS where the clause attaches. The
   previous round rejected catching this row by refusing introduced connectives, which
   would have cost 14 preserving rewrites; reading the comma instead costs nothing.

The last three were "documented limits" in the previous version of this section, each with
a measured cost that made the general fix unaffordable. Each closed by reading a narrower
pattern than the one that was tried, and each measured free — 0 oracle rows, 0 preserving
rewrites, 0 unlocks, `npm test` at 755/0 — in its own commit:

5. **A verb's object folded into a compound with its locative phrase.** `"documented the
   failure in the log"` -> `"the incident log failure"`: the object of a verb and the noun
   inside its `in`/`on`/`at` phrase are both still present, but the verb is gone and the
   two nouns now sit inside one compound, with the locative noun modifying the object. The
   general content-word-permutation guard cost 8 oracle rows; this one asks only whether
   a verb's object was re-attached under its own adjunct, and no legitimate rewrite does
   that (`order-changed`).
6. **A topic complement dropped while its nominal became a verb of ruling.** `"make a
   determination regarding X"` -> `"determine X"`: unpacking the nominalization is the
   family most of the recall comes from, and is kept; what changed meaning is that
   *regarding X* named the topic of a determination, and `"determine X"` makes X the thing
   determined. The guard fires only when a `regarding`/`concerning`/`about`/`on` complement
   is lost in the same edit that turns the nominal into a verb of ruling
   (`word-substituted`).
7. **A commonly confused spelling resolved by deriving from it.** `"before you loose the
   alignment"` -> `"before loosening"`: the writer meant *lose*; the model kept the wrong
   spelling and built a longer word on it. Widening the lone-derivation guard did not fire
   and cost a row; this one uses the confusable table the spelling repairs already run on —
   a removed word that is one half of a confusable pair, whose sentence keeps neither half,
   replaced in the same run by a longer word that starts with it. Repairing the spelling
   (`loose` -> `lose`), and deriving from a word that is not confusable
   (`affect` -> `affected`), both still pass.

### Every thread, and its disposition

**Fixed** — closed, with a regression test and three-sided numbers in the commit:
rule-tier pre-emption · the bench's missing tiers · 67 hunt defects · 27 review defects ·
the safety-layer ceiling (54.2% → 74.6%) · two meaning inversions the gate was accepting ·
ten precision defects, the last three of them (guards 5–7 above) the rows the previous
version of this table carried as limits · the verifier's field order · artefact pinning ·
three fixture families keyed to the artefact they describe · two hardcoded timeouts that
were really hardware assumptions · the precision control's blind spot, which did not count
a rewrite taken off the verifier as closed · the committed plugin bundle, which had fallen
seven safety guards and one verifier-schema change behind its sources with every test
green, now rebuilt and held to its sources by `tests/plugin-bundle.test.mjs`.

**Decided** — measured, recorded, not taken, because they are not mine to take:

| decision | the measurement |
|---|---|
| Deletion policy `verify` vs `refuse` | On the labelled corpora `refuse` now stops **0** further meaning changes — every one it would have stopped is refused before the verifier — and costs 15 Grammarly rows (ceiling 88/118 -> 73/118) plus the 48 preserving rewrites in `verifier-labels.json` it currently lets through. What it still buys is independence from a verifier measured at 4/9 on rewrites no label has seen yet. The shipped default is `verify`; changing it is the owner's decision and was not made here |
| Agent invention for agentless passives | refused; `docs/GRAMMARLY-BEHAVIOUR.md` §3 records Grammarly doing it and us not |

**Documented limits** — what was tried, what it cost, and what would unblock it:

| thread | tried | cost | unblocked by |
|---|---|---|---|
| A hedge dropped from one of two coordinated clauses (pinned `todo`) | exact occurrence counts | refuses the legitimate coordination tidy, which is commoner and which Grammarly performs | knowing which clause a modal governs |
| 12 of 37 UNINTENDED oracle rows | see the table below | — | — |
| Obsidian plugin in Obsidian | not runnable here | — | `npm run plugin:build`, copy `obsidian-plugin/` into a vault's plugins folder, enable it |
| GPU latency, and the M3 Max figures above | no GPU in this container | — | re-run `bench/run.mjs` on the target machine with the pinned artefact. That makes the result comparable to THIS section, not to the M3 Max figures: those were measured on a 1,574,961,408-byte file whose hash was never recorded, and the manifest pins a 1,556,390,368-byte one — a different artefact, not merely different hardware |

The 12 oracle rows, by why each is refused:

- **Three are mislabelled, and are refused on purpose**: `"Arguably, X"` -> `"X"`,
  `"There is no doubt that X"` -> `"X"`, `"a brief summary of the basic fundamentals"` ->
  `"the fundamentals"`. All three are the emphasis- and certainty-flattening
  `docs/GRAMMARLY-BEHAVIOUR.md` §3 records as differences the project keeps, and the first
  is the same edit as an ALIGNED row. The documentation predates the labelling.
- **Two are genuine vocabulary inventions**: `"nobody maintains"` -> `"no longer
  maintained"` introduces "longer"; `"demonstrated"` -> `"shown"`.
- **Two are possessive expletive frames** rewritten to a finite verb (`"It is our
  expectation that X will Y"` -> `"We expect X to Y"`), where the frame's aspect and the
  complement's finiteness change together.
- **Five need machinery this gate does not have**: a reduced relative clause, a past inside
  an embedded clause the rewrite drops, a tautological relative (`"contingencies that may
  arise"`), a future resolved to a present, and an aspect change from past to perfect.

**Still open: nothing.**

### What a reader should distrust

Two things, stated because they are the weakest joints in everything above.

The recall figure is 75.0% here — 77.8% one run earlier on the same pinned weights —
against 89% recorded on other hardware and, demonstrably, other weights: the August report
records a 1,574,961,408-byte model file, and the pinned one is 1,556,390,368 bytes. How much
of the gap to 89% is hardware, how much is the artefact, and how much is the guards added
since is not attributable from inside this container; the gap between the two local runs
is the model's own nondeterminism. Only the false-positive rate and the gate's decisions
reproduce exactly, and those are the numbers the safety argument rests on.

And the labels are mine. `accepted-labels.json`, `oracle-labels.json` and
`verifier-labels.json` were each committed before the guards they referee, which stops the
most obvious failure — but they still encode one reader's judgement about what a sentence
means. Eleven rows are marked `borderline` where that judgement was close. An external
referee, on a corpus none of these instruments has seen, is the thing that would settle it,
and this project does not have one.


## Update: the grammar tier removed (2026-09-02)

The GECToR tier is gone from the tree: `src/gector.mjs`, `src/gector-runtime.mjs`,
`src/roberta-tokenizer.mjs`, `obsidian-plugin/gector-engine.mjs`, `tools/gector-goldens.mjs`,
its three test files and two golden fixtures, its four `models/gector/*` manifest entries,
the `onnxruntime-node` dependency, `docs/PHASE-2-GECTOR-PLAN.md`, `validateGrammarFix` in
`safety.mjs`, the `tagger` option in `pipeline.mjs` and `bench/run.mjs`, and the plugin's
grammar toggle and "Grammar" card attribution.

**Why.** The weights this tree used
(`Zaid-Hossain/gector-roberta-onnx`, from `gotutiyan/gector-roberta-base-5k`) are licensed
for non-commercial purposes only. Every measurement in the sections above stands as
recorded; none of it can ship in a permissively licensed release.

**What it cost.** Nothing measurable. The tier was already provisional — the model's own
rewrite superseded it — and on the collected corpus it fired on 12 of 200 sentences, 5 of
which made the sentence worse. What it bought was a faster first paint on the grammar
band, and that is what was given up. Grammar is now the model's alone; Harper is the
right tool for a reader who wants a dedicated local grammar checker.

**What it changed in the numbers.**

| | Before | After |
|---|---|---|
| `npm test`, clean checkout | 756 tests, 740 pass, 13 skipped, 3 todo | **696 tests, 687 pass, 6 skipped, 3 todo** |
| Skipped without artefacts | 13 (7 GECToR, 6 live-model) | **6** — all six are the live-model tests |
| Runtime dependencies | `onnxruntime-node` | **none**; dev dependencies only |
| `models/MANIFEST.json` | 5 artefacts, 4 of them non-commercial | **1**, Apache-2.0 |
| Weights to fetch | 1.69 GB | **1,556,390,368 bytes** |

`npm install` on a clean clone now installs no native runtime dependency; the only
remaining install script belongs to esbuild, a dev dependency, and it resolves its binary
from the platform package already in `package-lock.json`.

The bench instruments print exactly what they printed before — the tier never touched
`bench/oracle.mjs`, `bench/precision-check.mjs` or `bench/unlock-check.mjs`, all three of
which run `validateRewrite` and the pipeline's deletion policy, neither of which changed.


## Update: seven gate fixes from the pre-launch review (2026-09-02)

Seven holes found by reading the gate against a 55-pair adversarial list. Four were
sentences that changed meaning and reached the writer; one was the right refusal under a
misleading name; two were bookkeeping. Each is now a named guard with its own test in
`tests/gate-fixes.test.mjs`.

| | What passed before | Now refused as |
|---|---|---|
| (a) | `The auditor reviewed the vendor's controls.` → `The vendor reviewed the auditor's controls.` | `order-changed` |
| (b) | `More than 40% of the tests failed.` → `40% of the tests failed.` (and `less than`, `fewer than`, `up to`, `no more than`) | `quantifier-changed` |
| (c) | `Run the migration before the deploy starts.` → `… when the deploy starts.` (and `while`, `once`) | `direction-changed` |
| (d) | `Hold the release until Friday.` → `Hold the release Friday.` (and `unless`, `except`, `only`, `own`) | `information-dropped`, at the pipeline |
| (e) | `Fewer than ten tests failed.` → `Ten tests failed.` was refused as `name-changed` — a sentence about someone called Ten | `quantifier-changed` |
| (f) | `content-dropped` and `dropped-content` were two names for one decision | one name: `content-dropped` |
| (g) | `I will not revise it.` was refused as `certainty-changed`; `INSTRUCTION_OUTPUT` sees only leading `Here is:` prefixes | `instruction-output` |

Three of these needed a design decision rather than a pattern:

- **(a)** fires only on an exact two-for-two exchange — each of two content words replaced
  by the other, nothing else substituted — with the possessive clitic stripped before
  comparing, which is what made the swap visible at all. A single substitution, a
  compression or a reordering is untouched.
- **(b)** requires a quantity beside the phrase. `more than happy` and `it is up to the
  team` bound nothing, and trapping them would refuse a family of ordinary repairs. The
  count must match exactly, not merely not decrease: inventing a bound the writer did not
  state is as much a change as dropping one.
- **(d)** was specified as five additions to `NEVER_VERIFY`. That would have worked for
  two of the five: `unless` and `except` are the only ones `lostContentWords` ever
  reports, and the other three were not reaching the verifier — they were being accepted
  silently, because they are function words and nothing counted them. One guard,
  `dropsScopeWord`, settles all five in the pipeline's `refuseOutright`, before any model
  is consulted.
- **(g)** matches refusal prose only when the candidate shares no content word with the
  source. A writer may write `I will not attend the meeting.` themselves, and the model
  may legitimately rewrite it; what marks a refusal is that it is about the request rather
  than about the sentence.

**What it cost, measured on this tree:**

| | Before | After |
|---|---|---|
| `node bench/oracle.mjs` | 88/118 ceiling; 73 accept, 15 verifier, 30 refuse | **unchanged** |
| `node bench/precision-check.mjs` | 0 defects, 0 recall cost | **0 newly accepted, 0 recall cost, 0 recall gain** |
| `node bench/unlock-check.mjs` | 0 of 186 unlocked | **0 unlocked, 0 softened**; 10 refusals renamed |
| `npm test` | 696 tests, 687 pass | **710 tests, 701 pass, 0 fail** |
| `REJECTION_REASONS` | 25 | **24**, after the (f) merge |

The ten renamed refusals are the (f) merge and nothing else: every one is
`refused:dropped-content` → `refused:content-dropped` on the same pair, listed by
`node bench/unlock-check.mjs --verbose` before the re-baseline. Both baselines were
rewritten with `--write --note`, so the change is recorded in their own `reviewed` and
`history` fields rather than only here.

Not fixed, deliberately: `In the majority of cases, …` → `In most cases, …` still passes.
It is the periphrastic-quantity trade `PERIPHRASTIC_QUANTITY` licenses, it is on
Grammarly's own periphrasis list (`docs/GRAMMARLY-BEHAVIOUR.md` §1), and
`oracle-labels.json` labels it `UNINTENDED`/`counting-artefact` — that is, a refusal the
project wanted to lose, not a hole.


## Update: the plugin becomes installable (2026-09-02)

Everything before this section describes an engine. This describes the first version of
it that a person who has not read the README could run.

### What was in the way

The plugin assumed a `llama-server` already listening on 127.0.0.1:8080, and was installed
by symlinking a checkout into a vault. Both are fine for the person who wrote it and
disqualifying for everyone else.

### The provisioner

`obsidian-plugin/runtime/`, nine modules, built around one rule: **an artefact with no
recorded sha256 is never fetched.** Not fetched-and-checked — not fetched. A model server
arriving from a URL nobody pinned is the thing this project tells people it does not do.

The order matters as much as the parts:

1. Reap an orphan from a crashed session. A force-quit leaves 2 GB resident and no handle
   on it; the PID file plus the recorded binary path is enough to recognise our own and
   not enough to kill a stranger that inherited the number.
2. Ask what is already running. Someone with Ollama has done the hard part.
3. Build a plan — every URL, size and hash — and **stop**. `provision()` throws unless it
   is called with `confirmed: true`.
4. Download, verify, extract, spawn, warm up.

Four decisions worth recording, because each was a place this could have quietly become a
different kind of software:

- **Loopback, a random port, and an API key even so.** Any process on the machine can
  reach loopback, and a web page can POST to 127.0.0.1 without asking anyone. A random key
  per launch means a page that guesses the port still cannot use the model.
- **The hash is of the bytes on disk, not the response stream.** A stream hash proves the
  server sent the right thing; a disk hash proves the file *is* the right thing, which is
  the claim being made. A resumed download re-hashes what is there before appending, and a
  server that ignores `Range` is not appended to at all.
- **A zip reader rather than a shell-out.** GNU tar cannot read zip, `unzip` is absent from
  minimal images, and Windows only gained bsdtar in 1803. A hundred lines given `node:zlib`
  behave identically everywhere — and let `../`, absolute paths and symlinks be *refused*
  rather than sanitised.
- **Named failures.** Gatekeeper kills a downloaded binary with no output at all; Windows
  SmartScreen and antivirus quarantine it; Flatpak and Snap mount the vault without exec
  permission whatever its mode. Node reports all of these as `spawn ENOENT` or a bare
  SIGKILL, which is true and useless: a person who meets it concludes the plugin is broken.

### The Ollama path

`hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K` is the same artefact `models/MANIFEST.json`
pins, so a writer on Ollama runs the bytes these numbers were measured on.

The part that needed care is that `keep_alive` and `reasoning_effort` are Ollama extensions
to an OpenAI-shaped body, and an OpenAI-compatible endpoint may ignore what it does not
know. **Neither failure is loud.** A dropped `keep_alive` unloads the model after five
minutes, so every sentence after a pause pays a fifteen-second cold load — which presents
as "it is slow sometimes" and is never reported as a bug. A dropped `reasoning_effort` puts
`<think>` in the content, the JSON does not parse, and a configuration problem is reported
as a broken model. So both are probed against the running server, and where `/v1` drops
them the native `/api/chat` endpoint is used instead.

### What the plugin now writes, and where

| | |
|---|---|
| The vault | `data.json`, the settings. **Nothing else.** |
| The OS data directory | The model and the llama.cpp binary, under `stet/`. |
| Memory only | The outcome cache and the refusal ledger, gone when Obsidian closes. |

The outcome cache used to be written into the vault as `analysis-cache.json`: a record of
every sentence the writer finished and what a model said about each one, left in their
notes. `tests/plugin-vault.test.mjs` keeps it gone, and it is a source-level guard against
the committed **bundle** as well as the sources — a mocked Obsidian API proves only that
the mock was not called.

### The claim, made checkable

Two commands, both of which show the thing rather than a summary of it:

- **Show refusal ledger for this note** — every rewrite the model produced and the gate
  stopped, with the rule that stopped it.
- **Show what talks to the network** — every request the plugin has made since it loaded,
  counted by host by a wrapper around its only request function, with the model's hash and
  whether it is the measured artefact. The first line is computed: if anything ever left the
  machine, the pane says so instead of rounding it down.

### CI, and what it found

Four workflows. `test.yml` runs the suite and the three instruments on every push, plus the
whole suite on macOS, Windows and Ubuntu. `provisioner.yml` downloads and spawns on four
runners. `live.yml` puts real weights through both llama-server and Ollama. `release.yml`
turns a tag into a GitHub Release.

The Windows job earned its place on its first run. `core.autocrlf` rewrote the committed
`main.js` to CRLF on checkout; esbuild builds it with LF; `tests/plugin-bundle.test.mjs`
compares them byte for byte. It failed for a reason that had nothing to do with the bundle
being stale — precisely the false alarm a byte-for-byte guard must not produce. Normalising
the comparison would have hidden a real property, so `.gitattributes` fixes the checkout
instead.

### The state

| | |
|---|---|
| `npm test`, clean checkout | **842 tests, 833 pass, 0 fail, 6 skipped, 3 todo** |
| macOS, Windows, Ubuntu | the same suite, on every push |
| `node bench/oracle.mjs` | 88/118, unchanged |
| `node bench/precision-check.mjs` | 0 defects, 0 recall cost, unchanged |
| `node bench/unlock-check.mjs` | 0 of 186 unlocked, unchanged |

### What is not done, and would be dishonest to imply

- **The llama.cpp binaries are not pinned.** This container cannot reach the GitHub
  releases API, so every runtime entry carries a null sha256 and the managed runtime
  reports itself unavailable on every platform. That is the designed behaviour for an
  unpinned artefact — but until `tools/pin-runtime.mjs --write` has been run, only people
  who already run Ollama or llama-server can use the plugin.
- **No real Ollama has ever answered.** The adapter picks its endpoint from a probe that
  has been tested only against a fake Ollama built for the purpose. `live.yml` is the job
  that would settle it and it has not been run.
- **Nobody has installed this who did not write it.** The exit criterion is a first
  underline within ten minutes on a 50 Mbps connection, measured by someone else. CI times
  the provisioner on a datacentre connection, which is a ceiling, not the measurement.


## Update: a real model, and two defects only a real one could find (2026-09-02)

The section above ended by saying no real Ollama had ever answered the adapter, and that
the six live-model tests had never run. Both are now false, and getting there cost two
bugs.

### Getting a model to answer, in a container with neither

No Docker daemon, and the proxy refuses GitHub release downloads — so neither Ollama nor
llama.cpp could be installed. But Go 1.24, cmake, gcc and `proxy.golang.org` are all here,
and `git clone` of a public repository works. Ollama built from source in about eight
minutes, and its build produces a `llama-server` as a by-product, so both servers this
project supports came out of one build.

The weights are the pinned artefact: `node tools/fetch-models.mjs` verified
`49e219c54fe4…` against `models/MANIFEST.json`, and Ollama pulled
`hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K`, which is the same file.

### The first live run: ten sentences, ten failures

`Model omitted replacement`, on every one.

`engine.mjs` stops generation at `,"reason"` to save the ten tokens of a reason nobody
reads — the writer sees an explanation derived from the diff, never the model's. The
comment above it said the decision is unchanged because every token before the stop is
what the model would have produced anyway. That is true, and it silently assumed the
server emits the schema's properties in the schema's order.

Same prompt, same schema, same weights, two servers:

| Server | Order returned |
|---|---|
| llama.cpp | `action`, `replacement`, `reason` — the schema's |
| Ollama 0.33.2 | `action`, `reason`, `replacement` |

So on Ollama the stop fires **before the replacement is generated**, and the answer arrives
as `{"action":"rewrite"` — a rewrite with nothing to rewrite to. On both `/v1` and
`/api/chat`, so it was never about which endpoint the probe chose.

`useReasonStop` is a capability now rather than a default. `probeDialect` asks with the
**real** decision schema — a toy one-property schema cannot show an ordering problem at
all — reads the order back, and turns the optimisation off when it is not the schema's.
The cost of turning it off is about ten tokens a sentence, which is what the optimisation
was worth in the first place.

### The second defect: the probe was measuring the wrong thing

The first live run reported `keep_alive` dropped. The second, minutes later, reported it
honoured. Nothing had changed except that the first run's own fallback to `/api/chat` had
loaded the model for thirty minutes.

The check compared the expiry against a ten-minute threshold, so **any Ollama that another
tool had left loaded read as healthy**, however thoroughly `/v1` dropped the field — and
the plugin would then have chosen `/v1` and paid a fifteen-second cold load every five
minutes, in silence, which is the exact failure the probe exists to prevent.

It now asks for a deliberately odd 23 minutes and checks the expiry landed near it. Five
minutes means `/v1` dropped the field; thirty means something else set it and this
measures nothing. Both are reported in those words.

### What a cold start now reports

Nothing resident, exactly what a new user meets:

```
  keep_alive honoured        NO (expires in 5 min)
  reasoning suppressed       yes
  response_format honoured   yes
  field order                action,reason,replacement — REORDERED, so the reason-stop is off
  => using /api/chat (native)

  10 of 10 sentences analysed, 8 agreeing with the corpus
  p50 4.2 s, max 44 s (the first, cold)
```

The two disagreements are the model keeping a sentence the corpus expects rewritten. That
is a recall question, which `bench/run.mjs` is the instrument for; this is a smoke test of
the transport.

### And the suite, with a live model

`npm test` against `llama-server` on the pinned artefact, with the flags `npm run model`
uses:

| | |
|---|---|
| Clean checkout, no server | 847 tests, 838 pass, **6 skipped** |
| With llama-server on the pinned weights | **847 tests, 844 pass, 0 fail, 0 skipped** |

Those six are the only tests that exercise the real contract — schema-constrained decoding,
the stop string, and a verifier that answers rather than a stub. They had never run in this
session. They pass, and their passing is also what confirms llama.cpp's field order, since
the stop is on for them.

### The lesson, which is the same one this report keeps learning

A unit test proves the code does what its author expected. It cannot prove the expectation
was right about somebody else's software. Eighteen tests against a fake Ollama all passed
while the adapter could not analyse a single sentence through a real one — and the fake
passed because it had been written to return a shape no server actually produces.


## 2026-09-02 — the runtime pins were written against assets that do not exist

The provisioner's second half — download the pinned llama.cpp build, verify it, unpack it,
spawn it — had ninety-three passing tests and could not have downloaded a single byte. Its
seven asset patterns matched nothing in any llama.cpp release.

CI said so plainly, in the `pins` job's first run:

```
release v0.3.0 (1 assets)
  UNMATCHED macos-arm64      no asset matches /^llama-[^-]+-bin-macos-arm64\.zip$/u
  ... 7 unmatched
```

The GitHub releases API is 403 from this container, so the question "what are the assets
actually called" could not be asked of the API. It could be asked of llama.cpp:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/ggml-org/llama.cpp /tmp/lc
cd /tmp/lc && git sparse-checkout set .github
sed -n '/name:/p' .github/workflows/release.yml
```

Its own release workflow names them:

| Platform | Asset |
|---|---|
| macOS | `llama-<tag>-bin-macos-{arm64,x64}.tar.gz` |
| Linux | `llama-<tag>-bin-ubuntu-{x64,arm64,s390x}.tar.gz` |
| Windows | `llama-<tag>-bin-win-cpu-{x64,arm64}.zip` |

Three assumptions were wrong at once, and each would have failed at a different moment:

**The tag shape.** The patterns assumed `b####` build tags — `llama-b4321-bin-…` — and
matched `[^-]+` accordingly. llama.cpp now cuts semantic versions, `v0.3.0`. This is the
failure CI reported, and the cheap one: it fails at pin time, loudly, before a release.

> **Corrected the same day, by the `--list` step of the next CI run.** This paragraph is
> wrong, and it is left standing because how it was wrong is the useful part.
>
> llama.cpp has *not* moved to semantic versions. It still cuts `b####` builds, several a
> day, and each one carries all twenty-seven assets:
>
> ```
> b10756 (prerelease): 27 assets
>     llama-b10756-bin-macos-arm64.tar.gz  11.1 MB
>     llama-b10756-bin-ubuntu-x64.tar.gz   16.7 MB
>     llama-b10756-bin-win-cpu-x64.zip     18.4 MB
>     …
> v0.3.0: 1 asset
> ```
>
> Every build is marked a **prerelease**. `v0.3.0` is the repository's only
> non-prerelease, and `/releases/latest` is defined to skip prereleases — so the tool was
> asking for the one release with no server binary in it and correctly reporting that
> nothing matched. The tag shape was never the problem; **the endpoint was**.
>
> Two things are worth taking from this. The first is that "seven patterns matched
> nothing" underdetermines its cause, and the fix — printing what the release actually
> carries — was already in hand and would have answered it in one run had it existed
> first. The second is that the wrong diagnosis produced a *correct and useful* change
> anyway: the assetShapes derived from `release.yml` match `b10756`'s assets exactly, name
> for name. Reading llama.cpp's source of truth was right even though the conclusion drawn
> alongside it was not.
>
> `pin-runtime.mjs` no longer asks for `latest`. It walks the releases newest-first and
> takes the first one carrying **all six** assets, skipping drafts — so a build still
> uploading, or one whose macOS job failed, is passed over rather than pinned with a hole
> in it. A hole would leave one platform null, which the provisioner reports to its owner
> as "no build for your machine" on a machine that is perfectly well supported.

**The archive format.** macOS and Linux ship **tar.gz**. `unpack.mjs` read zip only, so on
three of six platforms the provisioner would have downloaded 40 MB, verified its hash, and
then thrown on an archive it had no reader for — after the download, which is the worst
place to discover it. `unpack.mjs` now carries a tar.gz reader: 512-byte headers, octal and
base-256 numeric fields, GNU long names, the `prefix` field, `strip` for the `llama-<tag>/`
directory the tarballs wrap everything in, and a refusal on symlinks and on any path that
escapes the destination. It is tested against archives written by the system `tar`, not by
a writer of mine — the same reason the Ollama fake was worthless.

**The non-AVX2 fallback.** Two manifest entries, a `/proc/cpuinfo` scan and a
`requires: ["avx2"]` gate existed to send an older CPU to a `noavx` build. There is no such
build. The CPU release dispatches at runtime — the Ollama build in this container compiles
`ggml-cpu-sse42`, `ggml-cpu-haswell`, `ggml-cpu-sapphirerapids` and the rest into one
binary that picks at load. So the fallback was answering a question llama.cpp stopped
asking, and worse than useless: a machine reporting no AVX2 would have been told **no build
exists for it** when the ordinary build runs there. Both `*-noavx` entries are gone,
`linux-arm64` is added, and the feature scan is kept only as reporting. The test that
covered the fallback now covers its absence:

```
a CPU reporting no features still gets the same build
  unpinned, not cpu-unsupported: a build for this machine exists, it just has no hash yet
```

`tools/pin-runtime.mjs` no longer holds a table of regexes. Each manifest entry carries an
`assetShape` — `llama-{tag}-bin-macos-arm64.tar.gz` — and the tool substitutes the release
tag and looks the name up exactly. One place to change when llama.cpp renames something
again, and it is the manifest, which is where the rest of the pin lives. When anything is
unmatched the tool prints the release's actual asset list, so the next person to meet this
sees the answer rather than seven failed patterns; `--list` shows the last ten releases for
when the question is which release to want.

### Why CI found this and the tests did not

The tests asserted that `matchAssets` matched the patterns, and it did. Nothing in the
suite had ever seen a real llama.cpp release, for the same reason nothing had seen a real
Ollama: the fixture was written from the same belief as the code.

What changed is that the pin resolution now runs in `test.yml` on **every push**, not in a
`workflow_dispatch` a person has to remember. It costs one runner for a few seconds and no
download, and it is the only instrument that compares this repository's belief about
llama.cpp against llama.cpp. It has now caught two distinct errors in two consecutive runs
— the patterns, and then the endpoint — which is a better argument for running it on every
push than the one that put it there.

The manifest's hashes are still null in this checkout, and the provisioner still refuses to
download an unpinned asset. But the shapes it will pin are the shapes that exist, and the
release it will pin them from is one that carries them.

| | |
|---|---|
| Suite | 855 tests, 846 pass, 0 fail, 6 skipped (no server), 3 todo |
| Oracle | 73 accept / 15 verifier / 30 refuse — 88/118, unchanged |
| Precision control | 0 defects, unchanged |
| False-unlock control | 0 of 186, unchanged |

## 2026-09-02 — the extractor refused the archives it exists to open

The provisioner's unpacker was written with one rule: an archive is untrusted input even
when its sha256 is pinned, so `../`, absolute paths and **symlinks** are refused rather
than sanitised. Two of those three were right.

Before committing the tar.gz reader, the question came up of what a llama.cpp release
tarball actually contains. `release.yml` answers it:

```
tar -czvf llama-<tag>-bin-ubuntu-x64.tar.gz --transform "s,^\.,llama-<tag>," -C ./build/bin .
```

— everything flat under one directory, packed straight out of `build/bin`. And there was a
real `build/bin` in this container, left by the Ollama build:

```
lrwxrwxrwx  libggml-base.so   -> libggml-base.so.0
lrwxrwxrwx  libggml-base.so.0 -> libggml-base.so.0.22.0
-rwxr-xr-x  libggml-base.so.0.22.0
lrwxrwxrwx  libllama.so       -> libllama.so.0
lrwxrwxrwx  libllama.so.0     -> libllama.so.0.3.0
-rwxr-xr-x  libllama.so.0.3.0
```

```
$ ldd build/llama-server-local/bin/llama-server
    libllama.so.0     => .../libllama.so.0
    libggml.so.0      => .../libggml.so.0
    libggml-base.so.0 => .../libggml-base.so.0
    libmtmd.so.0      => .../libmtmd.so.0
```

**Every macOS and Linux release archive is full of symlinks, and `llama-server` is linked
against them by SONAME.** The reader would have thrown `archive entry is a symlink` on all
four of them, on the first archive it was ever pointed at — after a 16 MB download and a
hash check that passed.

The tempting repair is to skip symlinks instead of refusing them. That is worse. The
extraction then reports success, the provisioner spawns the binary, and the process dies
with `libllama.so.0: cannot open shared object file` — a failure two steps removed from
its cause, in a component whose whole job is to make the first run work.

### What the rule should have been

Not "no symlinks". The rule that carries the weight is *nothing may reach outside the
destination*, and a symlink is a name that points at another name. So a link target is
resolved against the link's own directory and refused if it leaves — the same check
`safeJoin` already made, applied to where an entry points rather than where it sits.

```
libggml.so -> libggml.so.0          inside; kept, and kept RELATIVE
bin/a.so   -> ../lib/b.so           inside by another route; kept
a.so       -> ../../../etc/passwd   refused
a.so       -> /bin/sh               refused
```

The absolute case is the one worth naming. A zip stores a symlink's target as the entry's
own content, and `7z a -snl` — llama.cpp's Windows packing command — writes them that way,
so an entry called `llama-server` whose content is `/bin/sh` extracts to something that
looks entirely ordinary. What gets spawned is then not what the hash was checked against.

Two details the archives forced:

**Links are made after every file is written, in as many passes as it takes.** tar lists
`libggml-base.so` two entries *before* the file its chain ends at. Symlink creation does
not care; the Windows fallback does.

**Windows copies.** `symlink()` fails EPERM for an unprivileged account without Developer
Mode. A copy is not a link, but it is what the loader is asking for — the point of
`libggml.so -> libggml.so.0` is that opening the first name reaches the second's bytes. It
costs a few megabytes on the one platform that cannot do better; the alternative is a
plugin that does not start.

### The tests were testing the wrong machine

The first tar tests shelled out to the system `tar`, on the principle that a hand-rolled
tar proves only that the reader agrees with a writer in the same file. The principle is
right. The execution failed on CI within a minute:

| | |
|---|---|
| ubuntu-latest | 855 tests, 0 fail |
| macos-14 | 1 fail |
| windows-latest | 3 fail |

`--transform` is GNU tar's spelling and bsdtar wants `-s`; a mode set with `chmod` means
nothing on Windows. Every failure was about the test's own tooling — which is the one
thing a test must never be about.

The fix keeps the principle and drops the shelling out: `tests/fixtures/*.tar.gz` are
**committed archives written by a real GNU tar**, with llama.cpp's own packing command, so
every platform reads the same real bytes — including the platforms where no GNU tar exists
to write any. `make-archives.sh` rebuilds them. `.gitattributes` marks them binary,
because a CRLF rewrite would not corrupt a gzip subtly, it would stop it being a gzip.

And the assertion that matters is the same everywhere, whichever way the platform provided
it: opening `libggml-base.so` returns the real file's bytes.

### What this cost, and what caught it

Nothing measured moved — oracle 88/118, precision 0, unlock 0 — because no guard is
involved. What is worth recording is that neither defect came from a test. The symlink
refusal came from reading `release.yml` and then looking at a build directory that
happened to be lying around; the test-tooling failures came from the cross-platform CI job
finding them on its first run, for the second time in two days.

| | |
|---|---|
| Suite | 860 tests, 851 pass, 0 fail, 6 skipped (no server), 3 todo |
| The provisioner's own filter, on the fixture | `llama-server` + both SONAME chains, `LICENSE` correctly left out |

## 2026-09-02 — pinned, and then actually installed

The llama.cpp runtime is pinned. `obsidian-plugin/runtime/manifest.json` records **b10760**
for all six platforms:

| | asset | bytes | sha256 |
|---|---|---|---|
| macos-arm64 | `llama-b10760-bin-macos-arm64.tar.gz` | 11,072,707 | `4451e74e…5dd782` |
| macos-x64 | `llama-b10760-bin-macos-x64.tar.gz` | 11,135,791 | `909188c4…c8e3a9` |
| linux-x64 | `llama-b10760-bin-ubuntu-x64.tar.gz` | 16,715,049 | `00cfac81…b4cc15` |
| linux-arm64 | `llama-b10760-bin-ubuntu-arm64.tar.gz` | 13,347,844 | `ea26ba26…8e666f` |
| windows-x64 | `llama-b10760-bin-win-cpu-x64.zip` | 18,373,088 | `ed409470…c37e98` |
| windows-arm64 | `llama-b10760-bin-win-cpu-arm64.zip` | 11,939,646 | `297905bb…ae785a` |

Resolved by the `pins` job, transcribed from its `--json` output, and re-verified by
`--check` against the API on the next push. Until now the plugin could only be used by
someone who already ran Ollama or llama-server; the managed runtime reported itself
unavailable on every platform, by design, because an artefact with no recorded hash is not
a download.

### And then the proxy turned out to allow the download

The GitHub *releases API* is 403 here. The release *downloads* are not — which had been
assumed rather than tested. So every claim in this report about llama.cpp archives could be
checked against one:

```
$ curl -sSL -o llama-test.tar.gz .../b10760/llama-b10760-bin-ubuntu-x64.tar.gz
http=200 size=16715049                    # the pinned byte count, exactly
$ sha256sum llama-test.tar.gz
00cfac8189ebec8d5576c2a5acfcd7bff230ec2aa4b8454a8f2fa77548b4cc15    # the pinned hash
```

The archive is what `release.yml` said and what the SONAME finding predicted: 61 entries,
flat under `llama-b10760/`, and **10 of them symlinks**.

Through this project's own extractor, with the provisioner's own filter — 39 entries, the
chains intact — and then the part that is not a test:

```
$ ldd llama-server
    libllama.so.0     => .../libllama.so.0        # a symlink this extractor wrote
    libggml-base.so.0 => .../libggml-base.so.0    # and another
$ ./llama-server --version
version: 0.3.0-dev (build 10760, commit 0f3a71be1)
```

It runs, and it resolves every library through links the extractor created. `readelf`
explains why no `LD_LIBRARY_PATH` is needed and none is set: `RUNPATH: [$ORIGIN]`.

Had the blanket symlink refusal shipped, this download would have thrown. Had it been
softened to "skip symlinks", this `ldd` would have four `not found` lines.

### The whole first run, on a machine with nothing

```
$ node tools/provision.mjs --confirm --state /tmp/stet-e2e
plan        download 1.57 GB
  runtime: llama-b10760-bin-ubuntu-x64.tar.gz   17 MB    sha256 00cfac81…
  model:   Qwen3.5-2B-Q6_K.gguf                 1.56 GB  sha256 49e219c5…
  starting on port 43091
  warming up
  ready in 409 ms
started llama-server at http://127.0.0.1:43091/v1
stopped it again
=== elapsed 36s ===
```

Downloaded, verified, extracted, spawned on a random loopback port, warmed, stopped — and
no pid file survived. A second run took **16 s** and re-downloaded nothing: *"already on
disk and verified"*.

36 seconds is a **ceiling, not the measurement**. This is a datacentre connection, roughly
44 MB/s; the exit criterion is ten minutes on 50 Mbps, and 1.57 GB on 50 Mbps is about four
minutes of transfer, which the criterion still clears — but by arithmetic, not by
observation. That measurement still needs a person on a domestic line, and remains open.

### The suite, on the binary a stranger will get

Every previous live run in this report used a llama-server built from source in this
container. This one used the **pinned release binary**, downloaded from the URL in the
manifest and verified against the hash in the manifest:

| | |
|---|---|
| No server | 862 tests, 853 pass, **6 skipped** |
| On the pinned release binary | **862 tests, 859 pass, 0 fail, 0 skipped** |

Those six are the only tests that exercise schema-constrained decoding, the reason-stop and
a verifier that answers. They have now run against the artefact the product ships.

### One test change worth naming

Three tests asserted the provisioner's *unpinned* behaviour by relying on the checkout
being unpinned. Pinning the manifest broke all three — correctly, and they must not simply
be deleted: "nothing is fetched that is not pinned by sha256" is the promise the whole
provisioner is built around, and it is now unreachable through the manifest.

`selectRuntime`, `downloadPlan`, `plan` and `provision` therefore take an optional
`runtimes` table, defaulting to the manifest's own, and the refusal is tested against a
deliberately unpinned entry — including the half-pinned cases: a size with no hash, a hash
of the wrong shape, a zero size. The test also asserts the refusal comes **before** any
request rather than after a failed one. A property this important cannot be left resting on
what the repository happens to contain this week.

| | |
|---|---|
| Suite | 862 tests, 859 pass, 0 fail, 0 skipped, 3 todo |
| Oracle | 88/118, unchanged |
| Precision / false-unlock | 0 and 0, unchanged |

## 2026-09-02 — the name, as far as a search can settle it

Asked to check "Stet" against the USPTO register myself. **I could not**, and that limit is
worth stating precisely before the findings that came out of trying:

| route | result |
|---|---|
| `tmsearch.uspto.gov` | 200, but an S3-hosted SPA behind an **AWS WAF bot challenge** |
| `tsdrapi.uspto.gov` | **401** — needs an API key this project does not have |
| `trademarks.justia.com` | **403**, Cloudflare interstitial |
| `uspto.report`, `trademarkelite.com` | 403 / results rendered client-side |

Every route to the register is bot-protected. So **nothing below is a register search**,
and none of it is legal advice; a clearance opinion is a lawyer's work and this is not one.

What an ordinary search does establish is worse for the name than a clean register would
have been good for it.

### A live commercial product, in this exact category

**Stet Writer**, by Almost Right Creative, LLC — on the US App Store, © 2026, version 1.0
released **15 March 2026** and 1.1 a week later. A markdown writing app for iPhone, iPad
and **Mac**, with iCloud sync and GitHub publishing, free to write with a $19.99 in-app
purchase.

That is a *paid writing tool for writers on macOS*, shipping six months before this would
launch. Registration is not what creates rights in the US — use does — so this is a
first-user problem whatever the register says, and it is squarely in the same class of
goods as an Obsidian plugin for people who write.

Two more, less pressing:

- **Stet** — the document-commenting software written for the GPLv3 drafting process
  (Perl/XSLT/JavaScript, on Request Tracker). Wikipedia-notable, not obviously live.
- **STET** — Mike Cowlishaw's 1977 folding editor for VM/CMS. Historical.

### And a problem no register search would have found

*Stet* is the proofreader's mark for **"let it stand"** — the instruction to ignore a
correction and leave the original text alone.

That is exactly what this program's central claim is: it refuses edits that change
meaning. The name is apt because it *describes the function*, and a mark that describes
the goods is refusable as **merely descriptive** under 15 U.S.C. §1052(e)(1). Whether it
lands as descriptive or merely suggestive is precisely the judgment a trademark attorney
is paid to make — but the risk is real, it is independent of anyone else's rights, and it
was invisible from inside the project because the aptness felt like an argument *for* the
name.

### What is clear

Two practical namespaces the release would claim, both checked and both free:

```
npm registry     "stet"  ->  404, unregistered
Obsidian plugins "stet"  ->  free; no match and no near match among 7,205 plugins
```

That is what makes the timing matter rather than the outcome: the plugin id and the npm
name are unclaimed **now**, and a 1.0.0 release claims the plugin id in
`obsidianmd/obsidian-releases` publicly. Renaming after that costs users, not just files.

**Unchanged as a person's job:** a clearance search of the register and a view on §2(e)(1).
What has changed is that it is no longer a formality to schedule — there is a named,
dated, live conflict to put in front of whoever does it.

## 2026-09-02 — Stet becomes Tolben

The section above stands as written. Its conclusion — that clearing the name was a
person's job, not a formality — was right. Its *evidence* was thinner than it read, and
the gap is the finding worth recording.

### One of at least six

A preliminary clearance assessment came back recommending against releasing under STET,
and it was stronger than the section above anticipated, because the search here had found
one conflict where several existed. Each of the following was checked directly before the
decision was taken:

| Product | What it is | Verified |
|---|---|---|
| Stet Writer — Almost Right Creative, LLC | Markdown writing app, Apple platforms, 15 Mar 2026 | found here, recorded above |
| stet.me — Naichen Deng | Mac dictation, local processing plus AI refinement; free, $6.99/mo "Stet Cloud" | 200; v0.1.8; *"The voice input method for the rest of us."* |
| `AmrZriek/Stet` | *"zero-clipboard, local-first AI autocorrect and text-refinement desktop application"*, Windows and macOS, **"all text processing occurs locally via an embedded `llama.cpp` server"** | README fetched |
| getstet.app | Markdown editor that reviews AI-proposed edits before they land; v0.7.3, beta opened **2026-09-01** | 200; *"Know what your AI wrote, review only what matters"* |
| stet.sh | AI coding-agent evals | 200; not in the assessment, found here |
| `filu123/stet` | Local-first AI writing editor | not reachable — the proxy 403s every github.com URL, including bare user pages |

The third row is the one that mattered. It is local, offline, cross-platform, rewrites
prose, and runs an embedded `llama.cpp` server — the same transport this project spent the
day pinning. The fourth is a tool for reviewing AI edits that may change meaning, which is
this project's safety gate, under this project's name, in beta since the day before.

**Why the earlier search missed them.** It searched the *name* once and got a clean,
confident answer from Apple's lookup API for the one product it did find. It did not
search each namespace and catalogue separately, and it read a thin negative result as a
strong one. The lesson is not "search harder"; it is that a negative result from a search
you could not complete — the register was behind a bot challenge — carries almost no
information, and the section above said so without acting on it.

### The crowded field cuts both ways, and not symmetrically

Six independent developers reaching for the same word for the same job does weaken every
one of their claims: in a crowded field of weak marks nobody easily stops anybody, so the
infringement exposure is lower than a single-conflict picture suggests.

But the reason the field is crowded is that the word describes the goods, which is close
to a proof of the §2(e)(1) problem the section above raised on its own. So the crowded
field does not rescue the name. It converts *"this might be contested"* into *"this cannot
be owned, and cannot be found"* — and the second half is not a legal problem at all. A
plugin called Stet ships into a search result already occupied by a dictation app, a
markdown publisher, an AI-review editor, an offline rewriter and an evals product.

### The screen that chose the replacement

60+ candidates across five vocabularies (proofreading marks, architecture, geology,
bookbinding, rigging) against four namespaces. Every ordinary English word failed: npm
holds millions of packages against a ~170k-word dictionary, so the collision is structural.
Several failed the same way Stet did — `selvedge.sh` is an AI dev tool that guards files
before an agent writes to them; Drumlin Security sells document software; Tarvo AI, Selvo,
Quoin and Vantor are all live.

```
npm       curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/<name>
.com      curl -s -o /dev/null -w '%{http_code}' https://rdap.verisign.com/com/v1/domain/<name>.com
Apple     curl -s 'https://itunes.apple.com/search?term=<name>&entity=software&limit=12&country=us'
Obsidian  community-plugins.json from obsidianmd/obsidian-releases   (7,205 plugins)
```

**Tolben** came back free on all four — npm 404, no match among the 7,205 Obsidian
plugins, nothing in Apple's software catalogue, `tolben.com` unregistered — and targeted
search found no company or product. It is coined, so it is arbitrary as to the goods:
neither the crowded-field problem nor the descriptiveness problem reaches it. That is the
whole point of giving up an apt name.

### What this does and does not settle

It is a knockout screen, not clearance. It still cannot see the USPTO register
(`tmsearch.uspto.gov` is behind an AWS WAF challenge, TSDR wants an API key, the mirrors
403), and it cannot see common-law uses that do not surface in search — which is exactly
the gap that hid four of the six STET products. The difference is method: each candidate
was searched individually rather than the name once, and those per-candidate searches are
what eliminated Tarvo, Drumlin and Selvedge. Read the result as *nothing obvious survives*,
not as *nothing exists*.

**Still a person's job:** one US clearance opinion, on one name, before the tag. That is
now a smaller and cheaper question than it was this morning — a single coined word instead
of a contested one — and it is the last thing standing between this and v1.0.0.

## 2026-09-03 — the publication pass, and a name a grep could not see

Preparing the repository to be made public, rather than preparing the product. Four
things, of which one is a finding and three are hygiene.

### The finding: a verification that could not fail

Phase 1.2 certified that every "probe"-era string was gone from the tree, and its exit
criterion was:

```
grep -ri "grammarly-style\|clarity-probe\|throwaway\|Blue_underline_exp"   # is empty
```

It was empty, and the certification was wrong. The plugin's own entry point still read:

```js
export default class ClarityProbePlugin extends Plugin {
```

`ClarityProbePlugin` contains no hyphen, so `clarity-probe` could never match it, and the
bundle inherited the name twice more. The check was written from the *strings the author
remembered writing* — kebab-case, as they appear in filenames and CSS — rather than from
the shapes a name can take in source, where camelCase is the normal one. A grep that can
only find the spelling you thought of is not a test; it is a restatement of your
assumption.

Renamed to `TolbenPlugin` and the bundle rebuilt. What survives a case-insensitive sweep
for `probe` is now only Ollama's *dialect probe* — the capability check in
`obsidian-plugin/runtime/ollama.mjs` — which is the word used correctly.

### Hygiene

- **History squashed to a single root commit** before publication. It carried three things
  the tree deliberately does not: a contributor's local filesystem paths (18 occurrences,
  including a directory named for the project's original working title), 880 recorded
  outputs of the non-commercially-licensed GECToR tagger whose tier was deleted in
  `d768ad8` for exactly that licence, and `obsidian-probe/` blobs from before the rename.
  All three are verified absent from every ref. The old objects remain in GitHub's own
  storage until it garbage-collects, which is a request to Support rather than a command.
- **Three internal documents removed** — the launch playbook, the market analysis and the
  competitor cost analysis. Two Grammarly documents were **kept**: `GRAMMARLY-BEHAVIOUR.md`
  and `GRAMMARLY-CORRECTNESS.md` are cited eight times from `src/safety.mjs` and
  `src/clarity-rules.mjs` as the measured reason particular guards exist. Removing them
  would leave published source pointing at missing files and strip the gate of its
  provenance; they are evidence, not strategy.
- **Community health files added** — CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG, a
  pull-request template and issue forms. SECURITY.md is scoped to what this product
  actually does rather than to a template: unpinned or substituted artefacts, archive path
  traversal through an entry name or a symlink target, anything written into the vault
  beyond `data.json`, and any outbound connection after setup completes. A bad rewrite is
  explicitly *not* a vulnerability — it is a reported miss, and has its own issue form.

### Also corrected

`docs/ROADMAP.md` §1 described a tree that no longer existed: it said the plugin needed an
external `llama-server`, wrote `analysis-cache.json` into the vault, and that its README
called it "not a shippable plugin". Phases 2.1, 2.3 and 1.2 had each falsified one of
those, and §1 was the last place in the repository still asserting them. Its test counts
were two phases stale as well. The measurement row was checked and left alone: 27/36 and
0/24 are the closing run's own figures, not the superseded 32/36 from model selection.

## 2026-09-03 — phase 3.2: the sealed sets, re-measured on the artefact that ships

Holdouts 1 to 3 had never been run on the bytes a writer will actually download. The
figures in the closing section above — 49/75 useful, 81/90 clean untouched — came from a
run on 2026-08-27 whose model file was **1,574,961,408 bytes**, against the
**1,556,390,368** pinned in `obsidian-plugin/runtime/manifest.json`. This section closes
that gap, and the answer is not the one the gap was expected to produce.

### The artefact was verified before it was measured, for once by downloading it

`tools/pin-runtime.mjs --check` re-verifies the pins against the GitHub releases *API*,
which proves the recorded hash matches what the API reports, not that either matches the
bytes. All six platform archives were therefore fetched and hashed:

| Asset | Bytes | sha256 matches manifest |
|---|---|---|
| `llama-b10760-bin-macos-arm64.tar.gz` | 11,072,707 | yes |
| `llama-b10760-bin-macos-x64.tar.gz` | 11,135,791 | yes |
| `llama-b10760-bin-ubuntu-x64.tar.gz` | 16,715,049 | yes |
| `llama-b10760-bin-ubuntu-arm64.tar.gz` | 13,347,844 | yes |
| `llama-b10760-bin-win-cpu-x64.zip` | 18,373,088 | yes |
| `llama-b10760-bin-win-cpu-arm64.zip` | 11,939,646 | yes |
| `Qwen3.5-2B-Q6_K.gguf` (on disk) | 1,556,390,368 | yes |

Six of six, and the model. The Linux x64 archive was then unpacked and used for
everything below: `version: 0.3.0-dev (build 10760, commit 0f3a71be1)` — the shipped
binary, not a local build. A note in `CLAUDE.md` saying the agent proxy refuses GitHub
release downloads was true when written and is no longer; it has been corrected, because
it was the reason earlier measurements were taken on a server compiled here instead.

### What the shipped configuration scores

Run with the plugin's own arguments from `obsidian-plugin/runtime/server.mjs`
(`-c 4096 -np 1 --jinja --reasoning off --slot-save-path`), the shipped prompt and
verifier, and the shipped tier defaults — mechanics on, clarity rules on, deletion policy
`verify`.

| | Surfaced on rewrite-expected | Clean sentences left alone |
|---|---|---|
| Holdout 1 (50 rows) | 22/30 | 20/20 |
| Holdout 2 (70 rows) | 19/30 | 39/40 |
| Holdout 3 (45 rows) | 10/15 | 30/30 |
| **Total** | **51/75 (68.0%)** | **89/90 (98.9%)** |

Against 58/75 surfaced and 81/90 clean on 2026-08-27. Recall fell by seven rows; false
positives fell by eight. No engine failures in 165 rows.

**The 49/75 "useful" figure is not what moved, and is not restated here.** "Useful" is an
adjudicated subset of "surfaced" — a human judged which of the 58 surfaced rewrites were
improvements, and 49 were. Nothing in this run re-adjudicates the new 51, so the honest
comparison is surfaced-to-surfaced, 58 to 51. Until someone reads the new rows, the
usefulness of this build on the sealed sets is unmeasured rather than 51.

### Three things changed at once, so a fourth run was needed

The 2026-08-27 reports carry no `options` field — it did not exist yet — so those runs
took `analyzeSentence`'s own defaults, which means **rules off**, and their invocation
passed no verifier. Reading the recall drop as a model regression would have been wrong if
the tiers caused it. Holding the tree fixed and putting the *old* tier configuration on the
*new* model file:

| Configuration | Surfaced | Clean untouched |
|---|---|---|
| 2026-08-27: old model, rules off, no verifier | 58/75 | 81/90 |
| new model, rules off, no verifier | 49/75 | 89/90 |
| new model, rules on, verifier (**ships**) | 51/75 | 89/90 |

Both movements survive the change of tiers, so the tiers did not cause them. The artefact
did.

What cannot be settled here is *which part* of the artefact, because the 2026-08-27 reports
record the model file and nothing about the server that ran it. Model file and llama.cpp
build changed together and cannot be separated after the fact. The new reports carry a
`runtime` field naming the tag and asset so the next person is not left guessing.

### How much of a two-row difference is real: not much

The tier row above appears to add two surfaced rewrites (49 to 51). It does not, or at
least this cannot say so. Holdout 3 was run twice in the shipped configuration, same
binary, same model, temperature 0, twenty minutes apart:

```
rows 45
identical action:      44/45
identical replacement: 44/45
  h3-r05
    run 1: (none)
    run 2: The crew reached an agreement about the rota.
```

One row in forty-five flips between runs. Temperature 0 is not determinism on a CPU
backend: reduction order varies with how work is scheduled, and a token near a decision
boundary lands either side of it. Scaled to the 75 rewrite-expected rows that is a noise
floor of roughly ±2.

So: the nine-row and eight-row movements attributed to the artefact are real, being four
times the noise. **The two-row tier difference is inside the noise and is not a finding.**

This does not touch `bench/oracle.mjs`, `bench/precision-check.mjs` or
`bench/unlock-check.mjs`. Those replay recorded proposals through the gate and call no
model, which is exactly why they are the controls and a live bench run is not.

### Every sealed set, and which are excluded

| Set | Corpus | Rows | Adjudicated | Recorded runs |
|---|---|---|---|---|
| 1 | `bench/corpus/holdout.json` | 50 (30 rewrite, 20 keep) | yes | `holdout-sealed`, `holdout-pinned`, `holdout-attr-oldtiers` |
| 2 | `bench/corpus/holdout-2.json` | 70 (30/40) | yes | `holdout-2-sealed`, `holdout-2-pinned`, `holdout-2-attr-oldtiers` |
| 3 | `bench/corpus/holdout-3.json` | 45 (15/30) | yes | `holdout-3-sealed`, `holdout-3-pinned`, `holdout-3-attr-oldtiers` |
| 4 | `bench/corpus/holdout-4.json` | 70 (30/40) | **no** | `holdout-4-sealed`, `holdout-4-dev-rerun` |
| 5 | `bench/corpus/holdout-5.json` | 70 (30/40) | **no** | `holdout-5-sealed` |
| 6 | `bench/corpus/holdout-6.json` | 60 (20/40) | **no** | `holdout-6-sealed` |
| 7 | `bench/corpus/holdout-7.json` | 60 (20/40) | **no** | nine runs — see below |

Every corpus hash still matches the one its sealed run recorded, so none of the corpora
drifted under the results.

Holdouts 4 to 7 are excluded from every published figure, and the reason is stronger than
"unadjudicated" in holdout 7's case. It carries **nine** recorded runs — `sealed`, `rerun`,
`noreason`, `enum`, `earlystop`, `triage`, `postfix`, `postfix2`, `postgap` — whose names
are the prompt-development sequence. A set consulted nine times while the prompt was being
tuned is a development set that was once called a holdout. Holdout 4 has a `dev-rerun`
beside its sealed run and is in the same position, less severely. Neither can be used to
estimate performance on unseen text again, and nothing here does.

### Latency, and the forty seconds nobody had measured

Timed separately from the corpus runs, because a latency figure taken on a machine that is
fighting itself is not a figure. (One was: an early attempt ran while two subagent
workflows had the same four vCPUs, and the first sentence took 67 s. It was discarded, and
`CLAUDE.md` now says to check `uptime` first.)

| | |
|---|---|
| Model load to `/health` ok | 2.3–2.5 s |
| **First sentence on a fresh server process** | **41–46 s** |
| Warm, sentence the tiers leave alone | p50 **1.5 s** (1443–2253 ms over six) |
| Warm, sentence that gets rewritten | p50 **2.4 s** (1712–2573 ms over six) |

The warm figures agree with the closing development-corpus row already in this report
(p50 1343 ms, p95 2532 ms), so nothing regressed. The first-sentence figure is new, and it
is the largest number in this document: **the clarity prompt is 1,587 tokens (REPORT.md, "Update: latency"), and
reading it in on four CPU cores costs roughly forty seconds, once per server process.**

The verifier was suspected of costing more than a second call, on the theory that a second
prompt in a single `-np 1` slot would evict the first and force a re-prefill every time.
Tested by running the same twelve sentences with the verifier enabled and disabled:
p50 1544 ms against 1534 ms on clean sentences, 2325 ms against 2405 ms on rewritten ones.
No difference — and none of those twelve reached the verifier anyway, so the theory is
not merely unsupported, it was untested by the experiment that was supposed to test it.
It is recorded here as refuted rather than deleted.

### The idle-unload saving that is not one

`obsidian-plugin/main.mjs` defaults to unloading a Tolben-started server after ten idle
minutes, and four places in the tree told the writer that the KV slot is saved first "so
coming back costs a file read rather than a full reload". One of the four was the text of
the setting itself.

Measured, on b10760, with the same sentence either side of a restart:

```
cold first sentence:          41385 ms
same sentence again (warm):    1682 ms
saveSlot()   -> {"ok":true,"status":200}   tolben-slot.bin, 39,993,924 bytes
restoreSlot()-> {"ok":true,"status":200}
first sentence AFTER restore: 41194 ms
and the one after that:        1697 ms
```

The save and the restore both work — 200 each way, forty megabytes on disk — and buy
**0.5%** of the cost they were described as removing. Whatever the restored cache
contains, the next request still pays the full prompt read. The claim has been removed
from all four places; the setting now tells the writer that the first sentence afterwards
takes about forty seconds and that 0 keeps the model resident. The save is kept, because it
costs a file write and a later llama.cpp may make the prefix hit.

A near-miss worth recording, since it is the failure mode `CLAUDE.md` opens with. The first
run of this experiment reported `404` from both calls and looked like a shipped defect.
It was not: `/slots` is a llama-server route at the server ROOT, the harness had passed the
OpenAI base URL ending in `/v1`, and `startServer()` returns both `baseUrl` and `apiBase`
one line apart. The plugin passes the right one. But `tests/runtime-server.test.mjs`
asserted the URL against a fake fetch that answers whatever it is handed, and its fixture
used a base URL with no `/v1` — so the test could not have caught the mistake if the
product had made it. `slotEndpoint()` now normalises either form and a test passes the
`/v1` shape deliberately.

### Not measured, and not claimed

The roadmap's 3.2 also lists a 2-core laptop, Apple-silicon Metal and Windows CPU. This
container is a 4-vCPU Linux x86-64 VM; none of those three was run, and no figure for them
appears anywhere in this repository. The Ollama path was measured separately on 2026-09-02
and is unchanged by this section.

## 2026-09-03 — the plugin, run in Obsidian at last

The documented-limits table earlier in this report carries the row "Obsidian plugin in
Obsidian — not runnable here". It has now been run there, and that row is superseded by
this section rather than edited.

**Method.** Obsidian 1.13.7 (Electron 43) was fetched as the Linux AppImage, unpacked
with `--appimage-extract` because the container has no FUSE, and started under Xvfb with
`--remote-debugging-port`. There is no xdotool, so the window was driven over the Chrome
DevTools Protocol from Playwright: the trust-the-vault dialog, opening the note, hovering
an underline. A throwaway vault had the plugin installed from the **`v1.0.0` release
assets themselves** — `main.js`, `manifest.json`, `styles.css` as attached by
`release.yml`, sha256 `2f1a5af5…` for the bundle — with `data.json` pointing at a
`llama-server` **b10760** on the pinned Q6_K, CPU only, on loopback. `setupDone: true`
so the setup pane did not open; the plugin connected on load and the status bar read
`Tolben: ready · local`.

**Result.** A four-sentence note. Two underlines: `In spite of the fact that` from the
rules tier, and `carried out an evaluation of` from the model, whose hover card read
"Shortens “carried out an evaluation of” to “evaluated”" with the diff, `Local model`,
Replace and Dismiss. The status bar reported **`2 suggestions · 2 refused`** — two model
rewrites the gate withheld; the refusal-ledger command names them, and this section does
not guess. The server log for the pass shows prompt evaluation of 23–32 tokens per call
(the 1,587-token prefix cached after the first) and 1.5–4.0 s per sentence end to end,
consistent with the 3.2 figures above.

**What it is evidence of.** That the bytes a user downloads load in a current Obsidian,
connect to the managed server, and put a real suggestion under a real sentence. The
screenshot at `docs/tolben-in-obsidian.png` is that window, 1180×520, unretouched. It is
not evidence about install time, about other platforms, or about a machine with a GPU.

**Not yet done.** A recording of typing a sentence and seeing the underline arrive; the
same setup produces one.

**Addendum, later the same day — the recording.** Two clips were made with the rig
above, `Page.startScreencast` feeding JPEG frames to the ffmpeg Playwright ships (which
encodes VP8 only, so WebM, and reads frames only from `pipe:0`). Keystrokes did not land
in the editor over CDP on those takes, so the characters were inserted one at a time
through `app.workspace.activeLeaf.view.editor` at 55 ms each; the plugin watches document
changes, not key events, so it cannot tell the difference and neither can the viewer.
What the clips record, against the wall clock of the take:

| Sentence typed | Tier that answered | Underline after the full stop | Card |
|---|---|---|---|
| "The committee will carry out a review of the safety protocol next month." | rules | 0.5 s | "Clarity rule" |
| "She undertook the negotiation of the lease with the landlord." | model | 3.0 s | "Local model" |

The second is the honest demonstration of the model tier on a warm server; the first
shows why the rules tier exists. The clips are not in the tree — about 200 KB each, and
a README cannot embed a video — and live with the launch material.

## 2026-09-04 — the managed server, through the plugin: three defects the tests could not see

Asked whether the code was finished, the check that was meant to settle it went the other
way. Correcting the launch copy's latency figures led to the plugin's idle-unload path; the
path stops the server and nothing in the file restarts it; and the rule at the top of
`CLAUDE.md` says that a thing read is not a thing run. So it was run. `tools/plugin-lifecycle.mjs`
loads the **shipped bundle** `obsidian-plugin/main.js` with Obsidian's five UI classes
stubbed (`tools/obsidian-stub.cjs`: a status bar that is a string, a Notice that is a log
line) and nothing else faked — the provisioner, the **b10760** binary, the pinned model and
the plugin's own `fetch` are the real ones — and walks it through setup, the first
sentences, the ten-minute unload, a reload with the saved `data.json`, and recovery:

```
node tools/plugin-lifecycle.mjs --state /tmp/lifecycle --archive llama-b10760-bin-ubuntu-x64.tar.gz
```

What had never been exercised before today: every earlier managed-runtime run went through
`tools/provision.mjs`, a Node process whose `fetchImpl` defaults to `globalThis.fetch`; the
Obsidian run of 2026-09-03 had `setupDone: true` and a server started by hand. The plugin's
own wiring of the provisioner — `this.fetch` handed to `provision()`, the timer into
`unloadIdle()`, `onload()` with a saved `data.json` — had not been run once, in a test or
by a person. Three defects, in the order the rig meets them.

### 1. The setup pane cannot download

Both hosts the manifest points at answer a release URL with a redirect:

```
$ curl -sI https://github.com/ggml-org/llama.cpp/releases/download/b10760/llama-b10760-bin-ubuntu-x64.tar.gz
HTTP/1.1 302 Found
Location: https://release-assets.githubusercontent.com/github-production-release-asset/…
$ curl -sI https://huggingface.co/lmstudio-community/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q6_K.gguf
HTTP/2 302
location: https://us.aws.cdn.hf.co/xet-bridge-us/…
```

`obsidian-plugin/node-fetch.mjs` implements, by its own header, "only the surface
`engine.mjs` actually uses: ok, status, json(), text()". It does not follow a redirect, and
it exposes neither headers nor a body stream — the whole response is buffered and decoded
as UTF-8. Through it, both URLs come back `status 302, ok=false, headers=undefined,
body=undefined`, and the provisioner's `attemptDownload` throws `HTTP 302` with kind
`failed`, three times, which the setup pane renders as "Setup failed" over that line.
Without the rig's `--archive` the run ends exactly there:

```
DownloadError: https://github.com/ggml-org/llama.cpp/releases/download/b10760/llama-b10760-bin-ubuntu-x64.tar.gz: HTTP 302
    at attemptDownload (obsidian-plugin/runtime/download.mjs:115)
    at async downloadVerified (obsidian-plugin/runtime/download.mjs:83)
    at async provision (obsidian-plugin/runtime/provision.mjs:186)
```

Had the redirect been followed, the next line to fail would have been `response carried no
body`, and a 1.5 GB model would first have been read into a JavaScript string. **No 1.0.0
install has ever downloaded anything through the setup pane.** The paths that work are
"use a server you already run" and files already on disk.

Why nothing caught it: `tests/runtime-download.test.mjs` hands `downloadVerified` a fake
fetch that returns a web `Response`, streaming body and all; `provisioner.yml` runs
`tools/provision.mjs` on three operating systems with undici, which follows redirects and
streams; and no test in the tree names `nodeFetch`. The 36-second install of 2026-09-02
was real and was not the plugin.

### 2. The first sentence on a fresh server fails at the 12-second timeout, twice

`connect()` builds the engine with `timeoutMs: 12000`, and the 3.2 section above measured
the first sentence of a server process at 41–46 s. Through the plugin those two numbers
meet, and the rig makes every attempt back to back so the cost is visible:

| Attempt | S1, after setup | S5, after setup again |
|---|---|---|
| 1 | 12.0 s, `Local model exceeded 12000 ms` | 12.0 s, the same |
| 2 | 12.0 s, the same | 12.0 s, the same |
| 3 | 18.1 s, `verifier unavailable: timeout` | **5.2 s, answered** |
| 4 | **6.4 s, answered** | |

An earlier take of the same run read 12.0 / 12.0 / 17.1 / 5.3 s. The likely mechanism,
which this run does not prove, is that the server goes on reading the prompt after the
client gives up and keeps what it has read, so each attempt resumes where the last one
stopped and the fourth finds the prefix cached; the third fails one step later, in the
verifier, whose own prompt then has to be read in the same way. The sentence after it —
warm, on a server that had answered once — took **10.6 s**, not the 1.5–2.4 s of the 3.2
table; the verifier-thrash paragraph of 2026-09-03 said none of its twelve sentences
reached the verifier, and this is a sample of what it did not measure, one sample.

What that is on screen, with the shipped controller: a transient failure gets two attempts
and is then held for a minute. The first sentence after setup therefore shows "checking…"
for 24 s and then counts as **1 unchecked**; the next sentence pays the remainder; from the
third or fourth sentence answers arrive, and the held one returns after 60 s. The README's
"the first sentence after a server starts costs about 41 seconds" describes the server. The
plugin never waits 41 seconds for anything: it fails twice and moves on.

### 3. Nothing restarts the server

`unloadIdle()` — what the ten-minute timer calls — saves the slot, stops the process, sets
`runtime` and `engine` to null and stores `idleUnloaded`, which nothing reads. The next
sentence goes through `analyze()`, which calls `connect()`, which fetches `/models` at the
saved port:

```
[  79.5s] unloadIdle(), which is what the ten-minute timer calls
[  79.8s] after it: runtime=null engine=null server unreachable (ECONNREFUSED)
[  79.8s] S3 after the idle unload: THREW after 0 ms: "connect ECONNREFUSED 127.0.0.1:35339" kind=(none)
```

An Obsidian restart is the same failure from the other side. `onunload()` stops the server
Tolben started, as it should; `onload()` with `setupDone: true` then calls `connect()` at a
port whose process is gone, and `data.json` records neither that the runtime was managed
nor how to start it again:

```
[  80.3s] loaded: baseUrl=http://127.0.0.1:35339/v1 setupDone=true runtime=null server unreachable (ECONNREFUSED)
[  80.3s] S4 first sentence of the new session: THREW after 0 ms: "connect ECONNREFUSED 127.0.0.1:35339" kind=(none)
```

So with the default settings a writer who installs, sets up and writes for ten minutes
loses the plugin for the rest of the session — and for every later session — until they
find "Set up the model server" in the command palette and run it again, which the rig also
does: the files are reused (7–17 s to re-hash 1.5 GB), the server is up in 3 s, and then
defect 2 again. `docs/ROADMAP.md` item 2.1 lists "reload on editor focus" among what was
built; it was never written, and `statusLine()` has a `starting` state that nothing sets.

### What this is and is not evidence of

The rig is Node with Obsidian's UI stubbed, so it is evidence about the bundle's control
flow and the real server, not about Obsidian's window; nothing here was seen on a screen.
The defects are in code the stub does not touch. Linux x86-64 only, like everything else in
this report.

### What has to change before 1.0.1 — proposed here, not done

1. `node-fetch.mjs` follows 301, 302, 303, 307 and 308 across a bounded number of hops,
   exposes `headers.get()` and a streaming body, and never buffers a download; the test
   for it stands up a redirecting server on loopback rather than a fake.
2. The warm-up reads both prompts in — the clarity prompt and the verifier's — with
   `max_tokens: 1` and a timeout in minutes, under the `starting the model` status that
   already exists, so the writer's first sentence meets a cached prefix. The engine's
   12 s stays: it is the right bound for a warm server.
3. `data.json` records that the runtime is managed; `onload()` and the sentence after an
   idle unload re-provision from the files on disk, under the same status, and retry the
   sentence that found the server gone.
4. The lifecycle rig runs clean, and the six model-server tests run unskipped, before the
   tag. The README and FAQ sentences about the 41 seconds are rewritten to what the plugin
   does once 2 is in.

## 2026-09-04 — 1.0.1: the three defects fixed, and measured through the plugin

Same day, same rig. Four source files changed — `obsidian-plugin/node-fetch.mjs`,
`src/engine.mjs`, `obsidian-plugin/runtime/provision.mjs`, `obsidian-plugin/main.mjs` — and
two test files were written for what had none. Then `tools/plugin-lifecycle.mjs` was run
twice against the real b10760 server and the pinned model, once with `--fresh` so that
both artefacts came down through the plugin's own fetch, and the suite was run on that
server with nothing skipped. Every number below is from those runs; the command lines are
at the end.

### The fetch

`node-fetch.mjs` follows 301, 302, 303, 307 and 308 across at most ten hops; 303, and a
301 or 302 after a POST, become a GET without the body, as browsers do; the
`authorization` and `cookie` headers are dropped when a hop changes origin, so the managed
server's bearer key can never be steered to a CDN. The response carries `headers.get()`,
`url`, `redirected`, and `body` — the Node response stream itself — with `text()` and
`json()` buffering lazily, so the engine's half is unchanged and the provisioner's half
exists. `tests/plugin-node-fetch.test.mjs` runs nine cases against a real HTTP server on
loopback rather than a fake: a relative redirect and then an absolute one to a second
origin, `downloadVerified` end to end through this fetch with a pinned sha256 and a Range
resume answered with 206, the loop limit, an abort mid-body that rejects with the
signal's own reason.

Against the real hosts, through the plugin's fetch, in the `--fresh` run:

| Artefact | Bytes | Redirect | Time | Rate | Pin |
|---|---|---|---|---|---|
| `llama-b10760-bin-ubuntu-x64.tar.gz` | 16,715,049 | github.com → release-assets.githubusercontent.com | 0.4 s | 42 MB/s | matched |
| `Qwen3.5-2B-Q6_K.gguf` | 1,556,390,368 | huggingface.co → us.aws.cdn.hf.co | 29.3 s | 53 MB/s | matched |

The 1.5 GB went through the stream to the `.part` file and the hash at once, on a Node
process whose heap never held it. This is a datacentre line, and the rate says nothing
about a domestic one; what it says is that the path works.

### The warm-up

`createEngine()` gained `warmUp()`: the clarity prompt and then the verifier prompt, each
as the real request shape with `max_tokens: 1`, under a five-minute budget, reported
rather than thrown. `connect()` in the plugin calls it after building the engine, under
`Tolben: starting the model`, and returns only when both are in; `analyze()` awaits that
connection for every sentence, unless the sentence's own signal aborts first, so nothing
is sent alongside the prefill on the single slot. The setup pane shows "Reading the
prompts in" for the same forty seconds. The engine's 12 s stays: it is the right bound
for a warm server.

| | run 1 (`--fresh`) | run 2 | back after unload | after restart |
|---|---|---|---|---|
| Server up, weights loaded, one token | 3.3 s | 3.0 s | | |
| Clarity prompt read in | 27.7 s | 27.2 s | 26.9 / 28.1 s | 27.8 / 28.4 s |
| Verifier prompt read in | 13.5 s | 13.5 s | 13.3 / 14.1 s | 13.0 / 13.7 s |
| **Both, `connect()` end to end** | **41.2 s** | **40.7 s** | | |
| First sentence after | 5.6 s | 5.7 s (reached the verifier) | 1.5 s | 1.7 / 1.8 s |
| The next eight sentences | 1.2–1.9 s | 1.0–1.8 s | | |

Against 12.0 / 12.0 / 18.1 / 6.4 s for the same first sentence in the morning's run, and
against "41–46 s" for a first sentence with no warm-up at all in the 3.2 section: the
forty seconds are the same forty seconds, paid once, before the writer types, with the
status bar saying what is happening. The first sentence after them is 5–6 s rather than
1–2 — the warm-up ends with the verifier's prompt in the slot and the first clarity
request has to get its prefix back — and that is left as it is, measured.

Two of the nine sentences in run 2 were written to reach the verifier with a single
lost word; neither did — the model kept both — so the only verifier call in either run
is inside that 5.7 s first sentence, and the verifier-alternation cost the morning's
10.6 s hinted at is still not separately measured. Everything after the first sentence
sat between 1.0 and 1.9 s.

### The lifecycle

`data.json` records `managed`. `ensureRuntime()` re-provisions a managed server that is
not running — at launch, and on the first sentence after the idle unload — sharing one
in-flight provision among every sentence that arrives meanwhile, then `connect()` reads
the prompts in as above. It provisions with `confirmed: false`: `provision()` now checks
each artefact on disk against its pin *before* refusing, and refuses only if something
would have to be fetched, so the way back never downloads and a missing file becomes the
one instruction that helps ("run Tolben: Set up the model server", kind `failed`, one
attempt). `unloadIdle()` still saves the slot and stops the process; nothing else about it
changed except that the plugin can now come back.

```
[  68.7s] after unloadIdle: runtime=null engine=null server unreachable (ECONNREFUSED)
[ 122.7s] S7 after the idle unload: 54029 ms -> null  [none]
[ 122.7s] back in 54029 ms: managed=true pid=5634 — prompts 28081 + 14059 ms of that
[ 124.2s] onload returned in 1 ms; starting=true (the server starts without waiting for a sentence)
[ 176.2s] ready 51913 ms after load: pid=5650 prompts 28378 + 13663 ms
[ 178.0s] S8 first sentence of the new session: 1806 ms -> null  [none]
```

The way back is about 52 s here (52.6 and 54.0 s): 7 s to hash 1.5 GB again, 3 s to
spawn and load, 41 s of prompts, then the sentence. A launch of Obsidian is the same
minus the sentence (50.9 and 51.9 s to ready), started from `onload()` rather than from
the first sentence, so a writer who opens a vault and reads for a minute finds it ready.

On that measurement the idle-unload default moved from ten minutes to sixty. Ten made
every short break cost the minute; sixty makes a lunch break cost it, once, under a
status that says so. ROADMAP 5.2's criterion — under 5 s after an unload, *or* the
default changed on the measured trade — is met by its second clause, and its first is
still open: getting under 5 s means a prefix cache that outlives the process, or a
process that is not stopped. The 7 s re-hash on every return is deliberate: the files are
verified before a binary is run, every time, and a sidecar that remembered a hash would
be a weaker rule.

`tests/plugin-lifecycle.test.mjs` drives the shipped bundle against a fake model server
on loopback and an injected provisioner, six cases: started at launch and warmed with both
prompts — the two `max_tokens: 1` requests carry the clarity and verifier prompts
verbatim — before any sentence; back after the unload with two concurrent sentences
sharing one provision; a restart with the saved `data.json`; files gone, so the setup
command is named and nothing is fetched; a server the writer runs is never provisioned;
a sentence the writer moves past does not wait. The first version of that file hung the
whole suite when one case failed, because a fake server left listening keeps the process
alive; every case now registers its cleanup with `t.after`, and the fake servers are
`unref()`ed, so a failure can only ever fail.

### The suite, the controls, the rig

| | |
|---|---|
| `npm test`, no server | 943 tests, 934 pass, 0 fail, 6 skipped, 3 todo |
| `npm test`, on the pinned b10760 binary with the pinned model | **943 tests, 940 pass, 0 fail, 0 skipped**, 3 todo |
| `node bench/oracle.mjs` | 73 / 15 / 30, ceiling 88/118 — unchanged |
| `node bench/precision-check.mjs` | 281 accepted, 0 meaning-changing — unchanged |
| `node bench/unlock-check.mjs` | 209 refusals, 0 unlocked — unchanged |
| `node tools/plugin-lifecycle.mjs --state … --fresh` | no findings, 199 s |
| `node tools/plugin-lifecycle.mjs --state … --archive …` | no findings, 181 s |

Nothing in the gate, the pipeline or the prompts changed, which is what the three
unchanged controls say.

### Not measured, and not claimed

The rig is Node with Obsidian's five UI classes stubbed; the modal was not clicked, the
`provision()` call was made with the arguments `runSetup()` passes. A real Obsidian
window with the managed runtime — the setup pane pressed, the status bar watched for
its fifty seconds — has still not been seen, and neither has any of this on macOS or
Windows. The 1.0.1 release itself is the owner's to publish from the Releases page; when
it exists, the rig should be run once more against the assets it attaches, which is a
`main.js` that must be byte-identical to the one these runs loaded.

```
node tools/plugin-lifecycle.mjs --state /tmp/lifecycle --fresh
node tools/plugin-lifecycle.mjs --state /tmp/lifecycle-2 --archive llama-b10760-bin-ubuntu-x64.tar.gz
LD_LIBRARY_PATH=<b10760> <b10760>/llama-server -m models/Qwen3.5-2B-Q6_K.gguf --host 127.0.0.1 --port 8080 -c 4096 -np 1 --jinja --reasoning off &
npm test
```

### Addendum, later the same day — the release exists, and its tag is one character wrong

`v1.0.1` was published at 19:51:54 UTC by `release.yml`, dispatched by the owner. This
session's token was refused a tag push (HTTP 403, as on 2026-09-03) and then a workflow
dispatch ("Resource not accessible by integration"), so the workflow gained a dispatch
path that creates the tag itself — on the checked-out commit, after the suite has passed,
with the job's own token — and the owner pressed the button. The tag is `c9db03f`. Six
assets, each hashing to the line `SHA256SUMS` carries for it and to the same file in the
tagged tree and in this working tree:

```
434156346975aff5f9bc4e6d297e7812732ccf9a0fc43fc8f1c624c0b5cbe27a  main.js
45a9cbd57757fef373e84902941603eb35b532ad2d0012d1425bd2308ea0ee83  manifest.json
60d830cfd1819a2df97c3268b7f5213c73b132d8fdf08c6170c1982d31936065  styles.css
96e642853580200a919ee6d9332a1314154f3fe244194c17c4c2075a3fd8acfc  LICENSE
64ca6a3ec34c9600b42ead5f64171760806e851be89e1468291d93000beb2b9f  NOTICE
```

`main.js` is the bundle every run in the section above loaded, byte for byte, so the rig
was run once more on it for the record rather than for a surprise: prompts read in
40.7 s, first sentence 5.7 s, the next eight 1.0–1.8 s, back 53.4 s after the unload,
ready 51.8 s after a relaunch, no findings.

**The tag.** docs.obsidian.md, "Release your plugin with GitHub Actions": *"Create a tag
that matches the version in the `manifest.json` file."* `v1.0.1` does not match `1.0.1`,
and neither did `v1.0.0`; Obsidian's directory installer will not find either. BRAT
coerces the tag before comparing, so the beta is unaffected, and a person following the
README downloads the files by name. The directory-submission packet said exactly this on
2026-09-03, about `v1.0.0`, under the heading "this is the blocker", and it was not acted
on: the roadmap's 3.4 row recorded three blockers fixed, and this was not among them. As
of this commit `release.yml` creates a bare tag on a dispatch and accepts either form on a
push; the two releases already made keep their names, and before the directory PR the
1.0.1 release has to carry the tag `1.0.1` — an edit on the release page, or a second
dispatch with the `v1.0.1` release deleted afterwards. Either is a minute for the owner
and neither is possible for this token.
