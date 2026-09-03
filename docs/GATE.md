# The gate — how Tolben refuses a rewrite

Tolben is an Obsidian plugin that offers clarity rewrites one finished sentence at a
time. A rewrite reaches the writer from one of two places: a local model — Qwen3.5-2B,
Q6_K, 1,556,390,368 bytes, sha256-pinned in `models/MANIFEST.json`, served by
`llama-server` on loopback (pinned to build b10760 on six platforms) — or the
deterministic clarity-rules table in `src/clarity-rules.mjs`, first-party code refereed by
its own tests and, in the pipeline, by `ruleRewriteSafe`. Nothing leaves the machine.

This document is about the part that says no: `src/safety.mjs`, 24 named refusals, and
the deletion policy in `src/pipeline.mjs` that sits behind them. What that gate judges is
the model's work: everything it accepts or refuses was produced by the model, and a rule's
rewrite — whether it surfaced on its own merits or because the model was unreachable or
its answer refused — is not put to it (`src/pipeline.mjs:137`). It is the part the
product's claim rests on, and the part most worth arguing with.

A note on the word *gate*, because the tree uses it twice. `src/gate.mjs` is the **clarity
gate**: a list of surface constructions that decides whether a sentence is worth a model
call at all. It never edits anything. Everything below is about the **safety gate** in
`src/safety.mjs`, which runs after the model and decides whether its answer may be shown.

---

## 1. The problem

A 2B model told to make a sentence clearer is being asked to shorten it. Most of the time
the shortening is harmless. Some of the time the sentence comes back saying a different
thing, and it reads better than the original, which is the whole difficulty: fluency is
not evidence.

`bench/corpus/torture.json` is 67 adversarial pairs across 24 classes, each recorded with
the outcome a reader should get. Fifty-two must be refused. These are real:

| Class | The sentence | What came back |
|---|---|---|
| role-swap | The landlord sued the tenant. | The tenant sued the landlord. |
| role-swap | The buyer indemnifies the seller. | The seller indemnifies the buyer. |
| bound | At least five reviewers must approve the change. | Five reviewers must approve the change. |
| bound | More than 40% of the tests failed. | 40% of the tests failed. |
| direction | The alert fires before the threshold is reached. | The alert fires after the threshold is reached. |
| scope | Everyone except the intern signed off. | Everyone signed off. |
| scope | The job runs unless the queue is empty. | The job runs if the queue is empty. |
| count-adverb | He counted the coins twice before locking the drawer. | He counted the coins before locking the drawer. |
| repeated | The right Solid Rocket Booster struck the right wing. | The Solid Rocket Booster struck the right wing. |
| conjunct | The service is fast and reliable under load. | The service is fast under load. |
| content-dropped | We paused the rollout because the metrics regressed. | We paused the rollout. |
| instruction | Delete every temporary file in the cache. | Deleted. |
| refusal | The panel came to the conclusion that the request should be denied. | I will not revise it. |

Two things are worth noticing about that list.

The first is that every one of them is *shorter*, and several are better English. "The
tenant sued the landlord" is a perfectly good sentence. Nothing about the output marks it
as wrong; only the input does.

The second is the last two rows. A model asked to rewrite an imperative sometimes obeys
it, and a model that has decided the request is objectionable sometimes answers the
request instead of the sentence. Neither is a rewrite, and both arrive through the same
channel as one.

None of this is hypothetical. Six of the 67 pairs passed this gate before 2026-09-02 and
are the reason `tests/gate-fixes.test.mjs` exists. Earlier, one meaning inversion reached
the writer during a sealed holdout — `in a manner that was confusing` →
`in a clear manner` — and the `word-substituted` guard was written in response
(`REPORT.md` §Safety).

---

## 2. The claim

**Tolben shows a rewrite only when a deterministic check cannot find a way it changed the
meaning.**

Four properties make that sentence mean something:

**It runs after the model.** The model produces a schema-constrained `keep`/`rewrite`
decision; the gate then judges the text it produced. It is not a prompt, not a
constraint on decoding, and not a preference expressed to a model that may or may not
honour it. Whatever the model returns, the same code runs on it.

**Refusing is the default.** `validateRewrite` is a fall-through: every guard returns a
refusal, and the accepting path is the line at the bottom that no guard reached. (Two
narrow shortcuts accept early — a deleted attention frame and a lone confusable repair —
and both are described below.) A guard that crashes, a class nobody anticipated, an
engine failure, a verifier that cannot be reached — all of them end with nothing shown.
The pipeline's verifier branch says so explicitly: an unreachable verifier is reported as
an outage (`verifier-unavailable`) and the suggestion is withheld, rather than approved by
default.

**It never authors anything.** The file's header says so: `// These rules never generate a
suggestion; they only refuse one.` The gate has no vocabulary of its own and no opinion
about what the sentence should say. Its entire output is `{ accepted: true, replacement }`
or `{ accepted: false, reason }`. This is why a bad guard costs recall and cannot cost
correctness.

**It is deterministic and free.** `safety.mjs` imports two local modules and no Node
built-in; it runs in the browser, in the plugin, and in the bench, and it costs
microseconds. That is what makes the control instruments in §7 possible: the same 118
pairs can be replayed through it on every commit without a model.

### The order of the gauntlet

Order is load-bearing, and the source says why at each step. A candidate is judged
against `base` — the mechanically repaired original, not the raw one — so the gate is
never blamed or credited for the spacing and capitalisation pass ahead of it.

1. **Is this a rewrite at all?** Action, emptiness, identity, assistant prose, a
   self-contradicting reason, more than one sentence.
2. **Span scoping.** If the writer opened with a formulaic attention frame — `It should
   be noted that X` — the frame may be deleted outright, and any *further* edit is then
   put to the whole gauntlet again against the surviving proposition. Without this,
   deleting a frame containing the word "should" was refused as a change of commitment,
   while the identical edit on a frame that happened to contain no counted word was
   accepted. Epistemic frames (`it could be argued that`) are deliberately absent from
   the list: those carry the claim's strength.
3. **Tokens that must survive verbatim.** Numbers, protected tokens, markup.
4. **The confusable shortcut.** A lone `their`/`there` swap is a repair the gate means to
   permit, and the rules below it cannot tell one from a tense change. Checked here —
   after quantities and markup, so a spelling repair that also eats a `**` is still
   refused.
5. **What the sentence claims.** Names, certainty, quantifiers and bounds, negation,
   dropped content, discourse connectives, direction, tense, terminal punctuation.
6. **What moved.** Permutations, re-attached subordinators, flipped roles, swapped nouns.
7. **How big, and in whose words.** Trivial edits, excessive edits, introduced vocabulary.
8. **Late checks.** Pronoun referents, and `failed to notify` → `notified`, last so that a
   swap of `succeeded` for `failed` is still reported as the unsourced substitution it is.

### Nothing the model says about itself is used

The same distrust runs past the accept/refuse decision. The underline positions come from
a word-level diff computed locally (`src/diff.mjs`); offsets the model reports are never
read. And the sentence on the hover card — *Shortens "on a weekly basis" to "weekly"* — is
derived from that diff by `src/explain.mjs`, not from the model's own account of what it
did, because the model's account was measured to be false: it described edits it had not
made. Every word quoted on the card is a token that actually appears in the diff.

The model's stated reason is kept, under `modelReason`, for diagnostics. It is never
shown to the writer.

The gate's own claim is auditable from inside the plugin: **Show refusal ledger for this
note** lists what the model proposed and which rule stopped it. The ledger is held in
memory and never written — a durable record of somebody's drafting is not something to
put in their vault uninvited.

---

## 3. The refusals

`REJECTION_REASONS` is 24 entries. Twenty-three come from `validateRewrite`;
`information-dropped` is raised by the pipeline's deletion policy (§4). Several guards
share a name, because two names for one decision made the refusal ledger read as two
policies — `dropped-content` and `content-dropped` were merged for exactly that reason on
2026-09-02.

Every example below is a pair from `bench/corpus/torture.json`,
`bench/corpus/grammarly-pairs.json`, or the test suite, and each was re-run through
`validateRewrite` while this document was written.

### The answer is not a rewrite of this sentence

| Reason | Refuses | Example |
|---|---|---|
| `action-mismatch` | A decision that is not a `rewrite` — a `keep` carrying a replacement, a malformed reply | `{ action: "keep", replacement: "Something else." }` |
| `empty` | A replacement that is missing or all whitespace | — |
| `unchanged` | A replacement identical to the source after trimming | `The team met yesterday.` → `The team met yesterday.` |
| `instruction-output` | The model answered the request instead of rewriting the sentence | `The panel came to the conclusion that…` → `I will not revise it.` |
| `reason-contradicts-action` | A rewrite whose own stated reason says nothing was wrong | reason: `The sentence is already clear and direct.` |
| `multiple-sentences` | A candidate that segments into more than one complete sentence | `The team met yesterday.` → `First sentence. Second sentence.` |

`instruction-output` catches two shapes. The first is a preamble — `Here is the revised
sentence: …`. The second is a refusal *instead of* a rewrite: `That violates my
guidelines.`, `As an AI, I am unable to comply.` The second shape cannot be matched on
pattern alone, because a writer may legitimately write `I will not attend the meeting.`
and the model may legitimately rewrite it. The guard fires only when the candidate also
shares **no content word** with the source, which is what distinguishes a reply about the
request from a rewrite of the sentence.

### Tokens that must survive verbatim

| Reason | Refuses | Example |
|---|---|---|
| `numbers-changed` | Any change to the sequence of quantities, sign included | `The sample froze at -5 °C overnight.` → `…at 5 °C overnight.` |
| `protected-token-changed` | A change to a URL, path, filename, identifier, version, clock time, citation, money amount, or a term the caller marked protected | `Read the notes in /srv/reports/audit.md…` → `…/srv/reports/audit…` |
| `markup-changed` | A change to Markdown delimiters, code spans, wikilinks, links, headings, list markers, table pipes, inline maths | ``The tool has the ability to run `npm test` first.`` → `The tool can run npm test first.` |
| `name-changed` | A change to the sequence of capitalised words that could be names | `Katarina reviewed the unusually long draft…` → `Nadia reviewed the long draft…` |

Numbers and names are compared as **sequences**, deliberately not as sorted sets: `$40 to
the vendor, $60 to the client` and its reverse hold the same values and pay different
people. The same comparison is why `Priya emailed Maya about the schedule.` → `Maya
emailed Priya about the schedule.` is refused — same identities, reversed roles.

Capitalised words are treated as names unless they are on a list of words a capital at the
start of a sentence proves nothing about, so the failure direction is refusing a rewrite
rather than corrupting an identity. That list has been wrong before: `Fewer than ten tests
failed.` → `Ten tests failed.` used to be refused as `name-changed`, as though the
sentence were about someone called Ten. It is now `quantifier-changed`, which is the
right refusal under the right name.

### The claim the sentence makes

| Reason | Refuses | Example |
|---|---|---|
| `certainty-changed` | A commitment group emptied, or a hedge introduced where the writer committed | `We are fairly confident that the fix will most likely hold.` → `We are confident the fix will hold.` |
| `quantifier-changed` | A quantifier, ordinal, or comparative bound dropped, invented, or swapped | `More than 40% of the tests failed.` → `40% of the tests failed.` |
| `negation-changed` | A change to the negation count, or to the `fail`-word count | `The monitor failed to notify the on-call engineer.` → `The monitor notified the on-call engineer.` |
| `tense-changed` | A tense signature that moved without evidence in the sentence for the repair | `The cluster was decommissioned last quarter.` → `The cluster is decommissioned last quarter.` |
| `question-changed` | A question turned into a statement, or the reverse | `Do you have the bandwidth to review this?` → `You have the bandwidth to review this.` |
| `terminal-punctuation-changed` | A changed terminal mark | `The build finished.` → `The build finished!` |
| `direction-changed` | A temporal or spatial word swapped for its opposite, or a deadline preposition moved over the same time | `Send the report before Thursday.` → `Send the report by Thursday.` |

Three of these are more careful than their names suggest.

**Certainty is grouped by the commitment it expresses**, and epistemic modals are kept
apart from degree adverbs. A stack of hedges may be reduced to one, provided the group it
belongs to is still occupied: `the job could possibly time out` → `could time out` keeps
the modality exactly. What stays refused is a group emptied. Conflating the two groups had
made those cases indistinguishable.

**Bounds are their own table**, because `more` and `less` as bare words would refuse half
the comparisons in the language. A bound is only a bound when a quantity stands beside it,
so `more than happy to help` and `the decision is up to the steering group` bound nothing
and are untouched. And the count must match *exactly*, not merely not decrease: `40% of
the tests failed.` → `More than 40% of the tests failed.` invents a claim as surely as
dropping one discards it.

**Deadlines are matched as a pair over one complement.** `by` alone cannot be guarded — it
marks the agent of every passive in the language, and it would refuse `delayed for a
period of three weeks` → `delayed by three weeks`, which this guard deliberately lets
through. What is refused is the *same* time complement under a *different* preposition:
`before Thursday` excludes Thursday and `by Thursday` includes it, and no content word
moved to say so.

### Who does what to whom

| Reason | Refuses | Example |
|---|---|---|
| `order-changed` | A pure permutation, a re-attached subordinator, a compounded object and adjunct, flipped passive roles, two common nouns exchanged, an introduced agentless passive | `The auditor reviewed the vendor's controls.` → `The vendor reviewed the auditor's controls.` |
| `pronoun-changed` | A pronoun family in the candidate that the source never used | `She approved the design after the review.` → `He approved the design after the review.` |

`order-changed` is six guards under one name because they are one failure: the words all
survived and the sentence now says something else. The hardest is the common-noun
exchange, which nothing else in the file can see — neither noun is capitalised, so the
name check is silent; the word multiset differs because the possessive travels with the
noun, so the permutation check is silent; no voice changed, so the passive check is
silent; tense, numbers and negation all hold. It fires only on an exact two-for-two
exchange with the possessive clitic stripped before comparing, which is what made the swap
visible at all.

The `it` family is exempt from `pronoun-changed`: `it` names nobody, and this guard exists
to stop a rewrite changing *who* a sentence is about. What sees an `it` swallow its
antecedent is the deletion policy — `Ship the report to Maya.` → `Ship it to Maya.` loses
"report", so the policy puts it to the verifier rather than letting it through
unexamined — and refuses it outright under `deletionPolicy: "refuse"`.

### What the sentence says, and in whose words

| Reason | Refuses | Example |
|---|---|---|
| `content-dropped` | Several content words lost with nothing put back; a discourse connective that vanished | `We paused the rollout because the metrics regressed.` → `We paused the rollout.` |
| `information-dropped` | A deletion the policy in §4 refuses outright | `The service is fast and reliable under load.` → `The service is fast under load.` |
| `word-substituted` | Vocabulary introduced with no antecedent in the sentence | `…written in a manner that was confusing.` → `…written in a clear manner.` |
| `trivial-edit` | An edit with nothing substantive in it — one article, an expanded contraction | `It doesn't block the OCR delivery.` → `It does not block the OCR delivery.` |
| `excessive-edit` | An edit ratio above 0.58 — nothing of the sentence survives | `Send the file to the vendor.` → `Send it.` |

`word-substituted` is the guard the sealed holdout inversion produced, and it is the one
that most often costs recall. A word may be introduced when it is derived from a word the
rewrite removed, when it is on a small list of standard reductions (`due to the fact
that` → `because`), when it is already in the sentence, or when it is a licensed
periphrastic trade (`a number of` → `several`). Otherwise it is an invention. Protected
tokens are stripped before the check, because the `audit` inside
`/srv/reports/audit.md` is not prose the writer can be said to have used — a hole the
false-unlock control found on a recorded refusal.

Four narrower guards report under the same name: an untriggered pluralisation behind a
neutral determiner, a lone derivational swap (`tested the bonding` → `tested the bond`),
a topic complement objectified (`make a determination regarding X` → `determine X`), and
a confusable resolved by deriving from the misspelling (`before you loose the alignment`
→ `before loosening the alignment`, where the writer meant *lose*).

---

## 4. The deletion policy

Losing words is the failure mode the validator above is worst at, because a shorter
sentence that still reads perfectly well trips none of the checks that count things. So
deletions get their own tier, in `src/pipeline.mjs`, after `validateRewrite` has already
accepted the rewrite.

`lostContentWords(base, replacement)` returns the content words the candidate no longer
carries — counting *occurrences*, not membership, because English repeats content words
constantly. That distinction is what caught `The right Solid Rocket Booster struck the
right wing.` → `The Solid Rocket Booster struck the right wing.`, where the second
"right" had been excusing the deletion of the first.

Words the sentence loses nothing by are never reported at all: intensifiers, redundant
modifiers (`future plans` → `plans`), padding nouns in stock phrases, filler spans (`in
the process of`), politeness frames (`I would just like to`), and a stock phrase
compressed to the word it conventionally stands for.

What happens to the rest, in order:

| Lost | Under `verify` (shipped default) | Under `refuse` |
|---|---|---|
| A word in `NEVER_VERIFY` — `twice`, `once`, `thrice`, `repeatedly`, `rarely`, `frequently`, `again` | refused | refused |
| A conjunct the rewrite dissolved (`fast and reliable` → `fast`) | refused | refused |
| A word the sentence still contains, only fewer times | refused | refused |
| A narrowed deadline phrase (`until end of day tomorrow` → `until tomorrow`) | refused | refused |
| A scope word — `unless`, `until`, `except`, `only`, `own` | refused | refused |
| Two or more content words | refused | refused |
| One content word, eating the end of the sentence | refused | refused |
| **One content word, anything else** | **asked of the verifier** | **refused** |

Every row but the last is settled deterministically, before any model is consulted. The
five classes at the top are there because the verifier was measured getting each of them
wrong, and not for a reason a better prompt would fix. Asked whether "reliable" was already
implied by the sentence around it, the 2B said yes — but nothing is implied by the word it
was coordinated *with*; that is what "and" means. Asked about `consists of a payload
structure and a spacecraft structure` → `and a structure`, it replied that "spacecraft"
was already implied by the noun "spacecraft structure", which is true and useless: the
copy is what survives. These are not prompt problems. They are cases where the verifier's
question invites the wrong answer, so the question is not asked.

Scope words are a subtler case. None of them is a content word, so `lostContentWords`
never reports three of the five and the other two were reaching the verifier and being
waved through. One guard, `dropsScopeWord`, settles all five in the pipeline, which is why
`Hold the release until Friday.` → `Hold the release Friday.` is refused as
`information-dropped` with an empty lost-words list.

### "Never drop words" is a toggle, and it is off

`deletionPolicy: "refuse"` refuses every single-word deletion rather than asking. It is
off by default. Here is the measurement that decided it, replayed against Grammarly's own
118 rewrites:

| Deletion policy | Hard-accept | Verifier | Hard-refuse | Ceiling |
|---|---|---|---|---|
| `verify` (shipped) | 73/118 | 15/118 | 30/118 | **88/118 (74.6%)** |
| `refuse` | 73/118 | 0 | 45/118 | **73/118 (61.9%)** |

Both rows are reproducible now: `node bench/oracle.mjs` and
`node bench/oracle.mjs --refuse-deletions`.

The fifteen rows in the middle are ordinary edits. They include `During the course of the
review, we found two blocking defects.` → `During the review, …` (loses "course"), `The
service which is written in Go handles all authentication.` → `The Go service handles all
authentication.` (loses "written"), and `The customers who are located in Europe see a
different currency.` → `Customers in Europe see a different currency.` (loses "located").
Turning the toggle on gives all fifteen up.

What it buys is less than it was: when the trade was first measured on 2026-09-01,
`refuse` stopped five meaning changes and cost fifteen good rewrites. Since the guards
above were added, **`refuse` stops zero further meaning changes on the labelled corpora** —
every one it would have caught is now refused deterministically before the verifier is
reached — and it still costs the fifteen Grammarly rows plus the 48 preserving rewrites in
`bench/corpus/verifier-labels.json` that currently pass. What it still buys is
independence from a model measured at 4/9 on rewrites no label has seen yet.

The shipped default is `verify`. The measurement is recorded rather than acted on, because
which way to take that trade is the owner's decision.

---

## 5. The verifier tier

One class of rewrite reaches a second model call: the last row of the table above. The
prompt is `src/verifier-prompt.txt`, and it asks one question about one thing:

> For each removed word, ask one question: does the rest of the proposed sentence still
> tell the reader what that word told them?

It is given the original, the proposal, and the list of removed words, and told to consider
only those words. It answers `show` if every removed word was already covered by a word
that survives, and `hide` if any of them carried its own information. The prompt names the
categories that carry their own information — a shape, a time, a place, a manner, a degree
of hedging, a count, a repetition marker, a named thing — and carries seven worked
examples, four of them `hide`.

The call is schema-constrained to `{ reason, verdict }`, temperature 0, `max_tokens: 96`.
**The field order is deliberate and was measured.** With the verdict first, a constrained
schema makes the model commit and then justify: it was caught answering `show` and then
explaining that removing the word "loses specific information about how long". Reason
first turns the field into a scratchpad the decision can rest on. That change alone moved
the verifier from 3/9 to 4/9 on the labelled set at no cost.

**What it costs.** It runs only on deletions. Measured on the 60-row development corpus
on 2026-08-27, it fired on 9 of 60 sentences (15%), so the median latency barely moved; a
sentence that does trigger it costs roughly twice as long — about 1.5 s end to end in the
browser, on the machine that run was made on. The llama server runs a single slot
(`-np 1`), so the second call is serial with the first, not concurrent with it.

**What it is worth.** Less than its position in the pipeline suggests, and this is the
finding the project most wants a reader to see. `bench/corpus/verifier-labels.json`
records what the verifier *should* say on all 61 rewrites that reach it, and
`bench/verifier-check.mjs` scores the live model against it: **it catches 4 of the 9
rewrites that lose information, and wrongly refuses 1 of the 49 that do not.** Earlier,
asked about 22 single-word deletions, it said `show` to 20 — including five of six
rewrites hand-labelled as meaning-changing.

The verifier bucket is not a safety net. It is a recall device: it exists so that the
fifteen rows in the middle of the table above are not thrown away, and every class it was
measured getting wrong has
since been taken away from it. On the labelled corpora as the tree stands, all nine
rewrites it should hide are refused deterministically before it is asked. The 4/9 still
stands as a measurement of the model, because it is what a future rewrite of the same kind
— one no label has seen — would be relying on.

It fails closed. A verifier that times out, returns an unparseable body, or cannot be
reached produces `verdict: "unavailable"`, and the pipeline withholds the suggestion
exactly as it would on `hide` — but records it as `verifier-unavailable`, an engine
outage, so that a report cannot read an outage as a safety refusal.

---

## 6. What the gate does not do

**It is not a grammar checker.** `mechanics.mjs` repairs spacing and capitalisation and
never touches wording; the other deterministic tier, `clarity-rules.mjs`, rewrites only
idioms whose short form means the same thing in every context, and is refereed by its own
tests rather than by the gate this document describes. There was a GECToR-based grammar
tagger; it was removed on 2026-09-02 because its weights are licensed for non-commercial
use only, and nothing measurable was lost — on the collected corpus it had fired on 12 of
200 sentences, 5 of which made the sentence worse. Grammar is now the model's alone.
Harper is the right tool for someone who wants a dedicated local grammar checker.

**It never proposes anything, so it can only cost recall.** Of Grammarly's 118 exact
wordings, this gate hard-refuses 30. Some of those refusals are the project's documented
policy: Grammarly invents agents for agentless passives (`It was decided that…` → `We
decided…`) and strengthens hedged claims (`Perhaps it might be worth taking another look`
→ `I recommend taking another look`), and Tolben refuses both on purpose. Others are
refusals the project would rather not make. `REPORT.md` itemises twelve rows labelled
unintended and says what each one is: three turn out to be refused on purpose after all,
and the label is what is wrong; two introduce vocabulary that really is new (`nobody
maintains` → `no longer maintained` brings in "longer"); two are possessive expletive
frames rewritten to a finite verb, where the frame's aspect and the complement's
finiteness change together; and five need machinery the gate does not have.

**It cannot catch a rewrite that preserves the sentence and is wrong in context.** The
gate sees exactly one sentence. It has no paragraph, no note, no knowledge of what the
writer meant, and no facts. A rewrite that keeps every quantity, name, hedge and role, and
is nonetheless the wrong sentence for its position in an argument, passes without
resistance. Grammarly's "add missing specificity" and "resolve unclear antecedents"
categories are out of scope for the same reason: they need facts a sentence-local engine
does not have, and inventing them is forbidden.

**It counts words; it does not parse.** This is the source of its known gaps, and the
gaps are pinned as failing tests rather than described in prose. The clearest is
`tests/hunt-regressions.test.mjs` SPAN-2: a hedge dropped from one of two coordinated
clauses.

```
The tests may fail and the deploy may fail.  →  The tests may fail and the deploy fails.
```

The second clause has lost its hedge and the first still has one, so no count moves and
the gate accepts it. The alternative — exact occurrence counts — refuses the legitimate
coordination tidy, which is far commoner and which Grammarly performs. Closing it properly
needs a notion of which clause a modal governs, which means a parse.

The five oracle rows mentioned above are refused for want of the same thing, from the
other side: a reduced relative clause, a past tense inside an embedded clause the rewrite
drops, a tautological relative (`contingencies that may arise`), a future resolved to a
present, and an aspect change from past to perfect. Each is a case where the gate can see
that words moved and cannot see what they were doing.

**Some holes are deliberate.** `In the majority of cases, …` → `In most cases, …` passes.
It is a licensed periphrastic-quantity trade, it is on Grammarly's own periphrasis list,
and the oracle labels its refusal a counting artefact — a refusal the project wanted to
lose, not a hole to close.

**The labels are the author's own.** `accepted-labels.json`, `oracle-labels.json` and
`verifier-labels.json` were each committed before the guards they referee, which stops the
most obvious failure mode, but they still encode one reader's judgement about what a
sentence means. Eleven rows are marked `borderline` where that judgement was close. An
external referee, on a corpus none of these instruments has seen, is the thing that would
settle it, and this project does not have one.

**Two of the instruments are blind in one direction each.** `unlock-check` is
differential: it notices what *stops* being refused, so something wrong since the first
commit is invisible to it. `precision-check` replays rewrites the project has *recorded* as
accepted, so a defect that no recorded run happens to exhibit is invisible to it too. The
torture corpus exists partly to cover that gap, and it is a corpus somebody wrote, which
means it covers what somebody thought of.

---

## 7. How to check it yourself

Three instruments are controls rather than benchmarks: they print the same figures every
time unless a guard changed, none of them needs a model, and all three run in well under a
second. A change that moves one has to be explained in the commit message.

```bash
node bench/oracle.mjs           # what the gate would do to Grammarly's own edits
node bench/precision-check.mjs  # meaning-changing rewrites that reach the writer
node bench/unlock-check.mjs     # refusals a change quietly unlocked
```

### `bench/oracle.mjs` — the recall ceiling

Replays the 118 rewrites Grammarly itself produced, as if the model had proposed each one,
and reports which guard refused what. It prints three buckets, a 95% Wilson interval on
each, a histogram of refusals by guard, and a breakdown by construction theme:

```
  hard-accept (reaches the writer)    73/118   61.9%  [52.9%, 70.1%]
  sent to the 2B verifier             15/118   12.7%  [7.9%, 19.9%]
  hard-refuse (never reaches writer)  30/118   25.4%  [18.4%, 34.0%]
  => ceiling, if verifier says yes    88/118   74.6%  [66.0%, 81.6%]
```

The histogram is the useful half:

| Count | Guard |
|---|---|
| 10 | `certainty-changed` |
| 8 | `word-substituted` |
| 4 | `tense-changed` |
| 2 | `quantifier-changed` |
| 1 each | `content-dropped`, `name-changed`, `information-dropped`, `pronoun-changed`, `order-changed`, `numbers-changed` |

Read it, not the headline. This is a compatibility measure against one engine's phrasing
and an upper bound on recall against that phrasing — not the shipped engine's recall.
`--refusals` prints every refused pair with its guard, which is how the deliberate
refusals above were separated from the accidental ones.

### `bench/precision-check.mjs` — the other direction

Replays every rewrite the project has ever recorded as accepted against
`bench/corpus/accepted-labels.json`, where each has been read by hand and marked
preserving or changed. It exits 1 when a meaning-changing rewrite is accepted that the
baseline does not already record.

```
precision control — 281 recorded accepted rewrites
  meaning-changing and still accepted (known):    0
  meaning-changing and NEWLY accepted (must be 0): 0
  known defects closed since the baseline:        0
  meaning-changing, left to the 2B verifier:      0
  preserving rewrites newly refused (recall cost): 0
  preserving rewrites newly accepted (recall gain): 0
```

The last two lines are why tightening a guard is not free and why loosening one is not
automatically a regression: both directions are counted.

### `bench/unlock-check.mjs` — the ratchet

Mines every refusal the project has recorded and re-runs it. A refusal that has become an
acceptance is either a fix worth naming or a hole worth closing, and either way it must be
seen rather than discovered later.

```
false-unlock control — 209 recorded refusals
  newly ACCEPTED (must be zero, or hand-checked): 0
  refused -> verifier (hand-check each):          0
  still refused, different reason:                0
```

Re-baselining either control goes through `--write --note "why"`, so the reason is
recorded in the baseline file rather than only in a commit nobody re-reads.

### And the suite

```bash
npm test    # 928 tests; 925 pass and 0 skip with a model server running
```

`tests/torture.test.mjs` runs all 67 adversarial pairs through the **full pipeline
policy** — `validateRewrite`, then the deletion policy, then the verifier — with a stub
verifier that always answers "still implied", which is the most permissive configuration
the product ships. A pair the corpus records as refused is therefore refused
deterministically, whatever a real 2B would say.

Fifteen of the 67 must **surface**. They are ordinary clarity edits — a nominalisation
unpacked, an expletive dissolved, a stock phrase reduced to its adverb — and without them
the corpus could be satisfied by a gate that refuses everything, which is the failure mode
a meaning-preservation suite is most likely to drift into. A fourth test asserts that each
refusal comes back under the reason the corpus records, because a right refusal under the
wrong name (`Fewer than ten tests failed.` as `name-changed`) survived until the
2026-09-02 review.

---

*Source: `src/safety.mjs`, `src/pipeline.mjs`, `src/gate.mjs`, `src/diff.mjs`,
`src/explain.mjs`, `bench/corpus/torture.json`. Every figure in this document is
reproducible with a command named beside it, or is recorded in `REPORT.md`, whose closing
section names the command behind each of its own numbers.*
