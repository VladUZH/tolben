# Register diversity — measured 2026-08-28, before the guard families

Every corpus in `bench/corpus/` before this one is written in one voice: neutral technical
and operational prose. `bench/corpus/registers.json` asks what happens when the same
engine meets five voices it was never tuned on. 60 rows, five registers, each with 4
rewrite-expected rows carrying a planted clarity or grammar fault in that register's own
voice and 8 keep-expected rows of prose that is genuinely clean *for that register*.

Nothing was tuned for this run. Prompt and validator are exactly as shipped.

```
node bench/run.mjs --corpus bench/corpus/registers.json \
  --prompt src/clarity-prompt.txt --verifier src/verifier-prompt.txt \
  --model-path models/Qwen3.5-2B-Q6_K.gguf --output bench/results/registers-v1.json
node bench/score.mjs bench/results/registers-v1.json
```

Model `models/Qwen3.5-2B-Q6_K.gguf`, prompt `53ef1a58`, corpus `cdc468b3`,
run 2026-08-28T10:51:44Z. 60/60 rows scored, 0 engine failures.
Latency p50/p95/max 208/603/1130 ms; 14.1 s wall for the corpus.

## Per register

"Gate-refused" counts rows where the model *did* produce a rewrite and `src/safety.mjs`
threw it away — split by whether the row was a miss (a fault the engine should have
surfaced) or a clean row (a false positive the gate prevented).

| register | surfaced / rewrite-expected | false positives / clean | gate-refused on misses | gate-refused on clean |
|----------|-----------------------------|-------------------------|------------------------|-----------------------|
| fiction   | 3/4 | 1/8 (`r-fiction6`)  | 0/1 | 2/8 |
| academic  | 1/4 | 1/8 (`r-academic8`) | 2/3 | 2/8 |
| casual    | 2/4 | 0/8                 | 2/2 | 6/8 |
| marketing | 1/4 | 0/8                 | 3/3 | 2/8 |
| esl       | 1/4 | 0/8                 | 3/3 | 2/8 |
| **total** | **8/20 (40.0%)** | **2/40 (5.0%)** | **10/12** | **14/40** |

Refusal reasons across the whole corpus:
`word-substituted` 7, `information-dropped` 3, `unchanged` 3, `certainty-changed` 2,
`name-changed` 2, `trivial-edit` 1, `dropped-content` 1, `content-dropped` 1,
`protected-token-changed` 1, `negation-changed` 1, `quantifier-changed` 1,
`tense-changed` 1.

## Reading

The headline number is not recall, it is *where* the recall went. On 10 of the 12
rewrite-expected rows the engine missed, the model found the planted fault and wrote a
repair; `src/safety.mjs` then refused it. Only two rows (`r-fiction2`,
`r-academic3`) are genuine model keeps. So the register experiment is mostly a measurement
of the validator, not of the 2B model, and the validator's invariants are tuned for
operational prose where facts, tense, quantifiers, and exact wording are all load-bearing.

ESL is where that tuning is most clearly wrong. Three of the four L2 repairs were refused
by the exact invariant the repair had to violate: `Yesterday I go` → `Yesterday I went` is
refused as `tense-changed`, `discussed about the budget` → `discussed the budget` as
`quantifier-changed`, `a information` → `information` as `word-substituted`. A grammar
correction for a second-language writer is *definitionally* a change to tense, article, or
word choice, so the gate that keeps this engine safe on technical prose blocks nearly all
of its value for the audience that needs it most. Marketing fails the same way for a
different reason — `is able to sync` → `syncs` reads to the validator as
`certainty-changed`, and `Each and every plan includes unlimited storage at no extra cost`
→ `Each plan includes unlimited storage` correctly trips `negation-changed` on the dropped
"no extra cost", which is the validator working exactly as intended on a bad model rewrite.

The two false positives are the more worrying half, because both slipped the gate with
real information loss. `r-fiction6` drops "twice" from "He counted the coins twice and then
pushed them across the table" — the deletion verifier was asked about "twice" and answered
*show*, even though its own prompt names "again" as a word that must be kept for exactly
this reason. `r-academic8` reorders an adverb and turns a coordinated clause into a "with"
phrase, an edit that is pure style. Fiction and academic prose invite that kind of
"improvement" in a way operational prose does not; casual, marketing, and ESL clean rows
drew zero false positives, though six of the eight clean casual rows had a model rewrite
that only the gate stopped. The engine at that date was therefore honest but timid outside its
training register, and slightly too eager inside literary and academic prose.
