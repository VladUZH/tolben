# What Grammarly actually does — 250 sentences, measured

Two collections were made from the live Grammarly editor. Only one is still in the tree:

- `bench/corpus/grammarly-pairs.json` — 200 sentences, original → accepted-rewrite pairs
  across 20 construction types. 118 rewritten, 82 left untouched. The untouched 82 are as
  important as the 118 rewrites: they define where Grammarly deliberately stays silent.
- `grammarly-reference.json` — 50 sentences with every suggestion **card** transcribed
  individually (category label, exact delete/insert spans, and the alternatives offered
  for the same span). **Removed from the tree on 2026-09-02**: no instrument read it and
  it carried more third-party text than any published number needs. The findings below
  that draw on it are marked; the file itself is in git history until the pre-public
  history rewrite. See `bench/corpus/THIRD-PARTY.md`.

## Flag rate by construction type

Derived from the corpus, not transcribed. Regenerate with `node tools/grammarly-classes.mjs`;
`node tools/grammarly-classes.mjs --check` exits 1 if this table has drifted from the data.

| Flagged | Construction |
|---|---|
| 10/10 | wordy connectives and prepositional phrases |
| 9/10 | nominalizations and buried verbs |
| 9/10 | redundant pairs and tautology |
| 9/10 | technical documentation prose |
| 8/10 | passive voice variants |
| 8/10 | expletive constructions |
| 8/10 | academic and formal register |
| 8/10 | questions and imperatives |
| 7/10 | hedging and qualifiers |
| 6/10 | long compound and run-on sentences |
| 6/10 | corporate and business jargon |
| 6/10 | lists and parallel structure |
| 5/10 | meeting notes and status updates |
| 4/10 | relative clauses and modifiers |
| 4/10 | numbers, units, versions and entities (safety probes) |
| 4/10 | idioms and figurative language (expect preservation) |
| 4/10 | edge cases: short, fragment, quoted, mixed punctuation |
| 3/10 | email and workplace communication |
| **0/10** | **clean controls (expect no clarity suggestions)** |
| **0/10** | **negation, modality and certainty (safety probes)** |

118 of 200 came back changed.

## What this tells us

### 1. Their recall on formulaic wordiness is essentially total, and it is a fixed list

Every standard periphrasis was caught, in every register. This is the single biggest gap against us and the cheapest to close: it is a phrase list, not a reasoning problem. Confirmed catches across both collections (the list was compiled while both were in the tree; the phrases drawn only from the 50-sentence card set can no longer be re-derived here):

`due to the fact that` · `in order to` · `at this point in time` · `has the ability to` · `in the event that` · `a large number of` · `prior to` · `with regard to` · `in spite of the fact that` · `make an assessment of` · `it is important to note that` · `the reason why … is that` · `conduct an investigation into` · `give consideration to` · `perform the validation of` · `the implementation of` · `result in the reduction of` · `take into account the fact` · `on a daily basis` · `each and every` · `at the present moment` · `as to whether` · `in terms of` · `point of view` → `perspective` · `relates to` → `is` · `took the decision` → `decided` · `there was a discussion around` → `we discussed` · `all in all` → `overall` · `takes a lot of time` → `time-consuming` · `for the purpose of` · `in the majority of cases` · `on account of the fact that` · `with the exception of` · `in light of the fact that` · `for a period of` · `in accordance with` · `during the course of` · `in the vicinity of` · `made a recommendation` · `perform an analysis of` · `carried out a review of` · `undertake a comparison of` · `gave approval to` · `is in the process of` · `makes mention of` · `put forward a proposal` · `it should be noted that` · `provides a description of` · `are able to` · `has the capability of` · `in order for` · `makes use of` · `due to the … nature of` · `it seems to me that` · `there is a chance that` · `it could be argued that` · `it is worth noting that` · `would seem to suggest` · `in the near future` · `is a man who` · `in close proximity` · `there is a need for` · `it is necessary that` · `it is our expectation that` · `it has come to our attention that`

### 2. They stay completely silent on clean prose and on meaning-critical language

0/10 on clean sentences and **0/10 on the whole negation/modality battery** — `must never`, `cannot`, `should not assume`, `will not affect`, `no engineer is permitted`, `may reject`, `might fail`, `nothing in the logs suggests` all survived verbatim. Numbers, versions, units and named entities were never altered anywhere in 250 sentences (`2.5 million`, `version 3.11`, `100 ms`, `64 GB`, `99.95%`, `31 December 2026`, `Acme Corp`, `Postgres/Redis/Kafka`). Idioms survive intact; only the wordiness around them is trimmed (`went the extra mile to get the release out on time` → `…to release on time`).

**This validates our protected-token, quantifier and negation guards directly.** We are not being over-cautious in those areas; we are matching the market leader.

### 3. Where they are looser than us — deliberate differences worth keeping

They will change meaning for concision in ways our deterministic gate refuses:

- **Agent invention.** `The old cluster was decommissioned last quarter` → `**The team** decommissioned the old cluster…`; `It was decided that…` → `**We** decided…`; `There was a discussion around…` → `**We** discussed…`. They fabricate a subject that was not in the text. (Note this contradicts the tentative conclusion from the first 50-sentence sweep — agentless passives *are* activized; `Mistakes were made` was the exception, not the rule.)
- **Certainty strengthening.** `We are fairly confident that the fix will most likely hold` → `We are confident the fix will hold`. `Perhaps it might be worth taking another look` → `**I recommend** taking another look`.
- **Emphasis and nuance dropped.** `There is no doubt that X` → `X`. `in the unlikely event that` → `if`. `a brief summary of the basic fundamentals` → `the fundamentals`.
- **List semantics rewritten.** `customer, employee, or confidential details` → `…and other confidential details`.
- **An outright error**, preserved in the data: `a brand new innovation` → `a brand innovation`.

Our refusal of these is a feature and should be documented as an intentional precision-over-recall trade, not a bug to fix.

### 4. Litotes has a split policy

`did not fail to meet` → `met` (treated as verbosity), but `not uncommon` and `it is not impossible that` were preserved. The trigger appears to be the `fail to` construction specifically, not double negation in general.

### 5. Structural facts about their behaviour

- **They never split a sentence.** Even 31-word run-ons are compressed in place. Our sentence-scoped design matches theirs.
- **One card can carry several edits.** Multiple periphrases in one sentence come back as a single whole-sentence rewrite, not several cards.
- **They do long-range moves.** Trailing phrases relocate to the front (`…in some cases` → `In some cases, …`) and manner phrases become pre-verb adverbs (`in a significant manner` → `significantly`). Worth checking our diff UI renders these acceptably.
- **Overlapping alternatives.** The same span can produce a big clarity rewrite and a smaller correctness fix as separate cards (`the reason why…`).
- **Assertiveness lives in a separate feature.** Hedge-removal that changes stance is a "Team Tone Suggestion", not a Clarity card — mirroring our decision to keep certainty guards inside clarity.
- **Politeness formulas are protected.** `I am writing to inform you that`, `Please be advised that`, `Thank you in advance`, `Kindly find attached`, `I hope this email finds you well`, `At your earliest convenience` all survived. Jargon is likewise mostly untouched (`leverage core competencies`, `drive synergies`, `move the needle`, `deep dive`, `onboard`) — Grammarly targets *wordiness*, not *style*.

## Priority for us

1. **Close the periphrasis recall gap** using the list in §1 — prompt coverage, not architecture.
2. **Keep the safety gate exactly as is** for numbers, negation, modality, quantifiers, entities and idioms; §2 shows we are aligned with Grammarly there.
3. **Decide explicitly** whether to allow agent invention for agentless passives. Grammarly does; we refuse. Either choice is defensible, but it should be a recorded decision rather than an accident.
4. **Re-check the diff renderer** against long-range moves (§5).

## Method and caveats

Sentences were typed into the Grammarly web editor in batches of ten; every suggestion card was accepted with real clicks and the resulting document text was read back and aligned to the originals by index. Caveats, all recorded in the corpus files:

- The document language was British English, so a handful of edits are en-GB spelling normalisations (`analyse`, `socialise`, `operationalise`) rather than clarity edits.
- Where Grammarly offered mutually exclusive fixes for one span, accepting sequentially applies the first; the alternatives are captured only in the 50-sentence card-level file.
- Tone-suggestion cards were dismissed rather than accepted, since they are a different product feature.
- Dismissing a suggestion suppresses it for later in the same document, so the 200-sentence run used a fresh document and only ever accepted.
