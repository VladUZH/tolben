# Grammarly's correctness engine — 200 planted errors, measured

200 sentences with deliberately planted grammar, punctuation, spelling and usage errors were typed into Grammarly's editor, each paired with what it produced after accepting every suggestion it offered. **164 were changed, 36 were left alone.**

> The pairs themselves (`bench/corpus/grammarly-correctness-pairs.json`) were removed from the tree on 2026-09-02: no instrument read them, and they carried more third-party text than any published number needs. The probe sentences that were typed in are the author's own and remain, in `bench/corpus/grammarly-correctness-probes.json`. The findings below are what the collection was for; they cannot be re-derived from this repository as it now stands. See `bench/corpus/THIRD-PARTY.md`.

This is a different engine from the clarity one studied in `GRAMMARLY-BEHAVIOUR.md`: correctness fires on *errors*, is far more aggressive, and — unlike clarity — will split a sentence in two when the grammar demands it.

## Hit rate by error class

| Fixed | Error class |
|---|---|
| 10/10 | subject–verb agreement |
| 9/10 | articles & countability · prepositions · tense & sequence · irregular verbs · commas · apostrophes · confusables · hyphenation · capitalization · comparatives · quotes/colons/semicolons · double negatives & auxiliaries · word order · spelling · messy multi-error prose |
| 7/10 | pronoun case (3 "misses" are deliberate permissiveness — see below) |
| 7/10 | fragments/run-ons (all 6 run-ons and splices fixed; all 3 fragments ignored) |
| **4/10** | **numbers, dates and units** |
| **1/10** | **dangling and misplaced modifiers** |

## What they are genuinely excellent at

The depth here is real, and it is not shallow pattern-matching:

- **Agreement through intervening material.** `The engineer, along with the analysts, are joining` → `is joining`. `Neither the manager nor the engineers was aware` → `were` (the proximity rule — agreement with the *nearer* subject). `A number of requests was` → `were`, which is the opposite of `The number of…is`.
- **Subjunctive.** `He suggested that she goes` → `that she go`.
- **Conditionals and sequence.** `If I would have known` → `If I had known`; `If it rains…we would cancel` → `we will cancel`; `She has worked here since three years` → `for three years`; `We are working on this since Monday` → `We have been working`.
- **Irregular verbs with semantics.** `The picture was hanged` → `was hung` (hanged is for people), `She laid on the couch` → `lay`, plus drunk/swum/written/began/saw.
- **Restrictive vs non-restrictive commas.** `My colleague Sarah who lives in Zurich leads the team` → `Sarah, who lives in Zurich, leads` — it worked out the clause is non-restrictive because Sarah is already uniquely identified. Conversely it *removed* the wrong comma in `The engineer who wrote the parser, is on holiday`.
- **Possessives of every shape.** `teams'` (plural), `Chris's`, `children's`, its/it's and whose/who's in both directions.
- **Syntax reordering.** Embedded-question inversion (`Do you know where is the config file` → `where the config file is`), negative inversion (`Never I have seen` → `I have never seen`, `Not only he was late` → `Not only was he late`), do-support (`What time starts the meeting` → `What time does the meeting start`), and adverb placement (`Always we deploy` → `We always deploy`).
- **Locale-correct typography.** With the account set to American English it moved periods and commas *inside* the quotation marks, added Oxford commas, and converted `;` to `:` before a list. (Under British English the same engine had produced logical punctuation and `-ise` spellings — the locale genuinely drives the rules.)
- **Dense multi-error repair.** `Me and Sarah will handle the migration, we should of started earlier.` → `Sarah and I will handle the migration; we should have started earlier.` — pronoun case, conjunct order, comma splice and `should of` in one pass. Elsewhere it turned `cant login` into `can't log in`, distinguishing the verb from the noun.

## Where they are weak — and it is where we could win

Two categories collapsed, and both had **zero pending suggestions** when the batch finished, so these are true negatives rather than artefacts of the collection method:

**1. Dangling and misplaced modifiers — 1/10.** Nine of these went completely unflagged:

- `After reviewing the logs, the cause was obvious.` (the cause did not review the logs)
- `Having deployed the fix, the errors stopped completely.`
- `Covered in dust, I found the old server.`
- `While waiting for the build, the coffee got cold.`
- `Being late, the meeting started without him.`
- `He served sandwiches to the guests on paper plates.`

The single "fix" was cosmetic: `Running the tests, the server crashed` → `While running the tests, the server crashed`, which leaves the dangler fully intact. This makes sense — detecting a dangler requires knowing *who can plausibly do what*, which is semantic, not syntactic. It is exactly the kind of judgment a language model is good at and a rule engine is not. **This is the clearest opening for a model-based correctness feature.**

**2. Number, date and unit formatting — 4/10.** Untouched: `1000000` (no thousands separators), `3 hrs and 20 mins`, `20c`, `5 %`, `31.12.2026`, `$ 500`, and a sentence-initial `20 people`. It did fix `5gb` → `5 GB` and `in the year of 1990` → `in the year 1990`. This gap is the mirror image of the first one: it is purely mechanical and deterministic, so **it belongs in our rule layer, not the model** — and it is cheap to add.

## Deliberate permissiveness (do not mistake these for misses)

Grammarly is descriptivist about several contested points, and stayed silent on all of them:

- **`whom` is not enforced.** `Who did you give the credentials to?` was left alone, and `Whom is responsible…` was corrected to `Who`, not the reverse.
- **Singular *they* is accepted.** `Each developer must test their own code.`
- **Collective nouns take plural agreement.** `The committee published their findings.` — unchanged under *both* American and British settings.
- **`most unique` is allowed**, even though the clarity engine strips `very` from `very unique`.
- **Sentence fragments are left alone** (`Because the disk was completely full.`), while every run-on and comma splice in the same batch was fixed. Fragments are a style choice; splices are an error.

## Method, and one honest caveat

Ten sentences per batch, every suggestion accepted with real clicks, document text read back and aligned by index. Batches 2–20 ran under American English; batches 1 and 3 ran under British English before the switch, both in dialect-neutral categories, and batch 2 was run under both dialects and produced byte-identical output.

**Caveat on the 36 "uncorrected":** ten of the twenty batches finished with exactly one suggestion card still pending, meaning my accept sweep ran out before the last card. So roughly ten of the 36 unchanged sentences may have had a fix on offer that I simply did not apply (`preformed`, `refere`, `an advice`, `The alarm was rang`, and `The tests passes locally` are the likely ones). The two headline weaknesses are unaffected: batches 12 and 16 both ended with **zero** pending cards.

## What we should take from this

1. **Add a deterministic number/unit/date formatter.** Grammarly doesn't have one; it is mechanical, safe, and needs no model.
2. **Dangling modifiers are the highest-value model-shaped correctness feature** — high real-world frequency in the exact prose our users write (`After reviewing the logs, the cause was obvious` is native meeting-note style), and the market leader misses ~90% of them.
3. **Copy their permissiveness list verbatim** (whom, singular they, collective plurals, fragments). Flagging those would make us feel wrong to users even when a style guide agrees with us.
4. **Locale must be a first-class setting** if we ever ship correctness: quote placement, serial commas and spelling all flip on it.
5. **Correctness may split sentences; clarity may not.** Our sentence-scoped architecture is right for clarity, but a correctness feature would need to handle one-in/two-out.
