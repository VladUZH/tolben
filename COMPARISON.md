# Head-to-head with Grammarly

Run on 2026-08-27 against the user's Grammarly document (1,131 words, 54 sentences,
three registers: NASA accident-report prose, informal Slack messages, dense engineering
notes) plus a 12-sentence battery of classic clarity constructions typed into the same
document so both engines saw identical input. Grammarly's verdicts were read from its
**Clarity** filter; its Correctness/Engagement/Delivery categories are different features
and were excluded.

## 1. Whole document: which sentences get flagged

| | Grammarly (Clarity) | Ours |
|---|---|---|
| Sentences flagged | **11 of 54 (20%)** | **20 of 54 (37%)** |
| Both agree | 7 | 7 |
| Only that engine | 4 | 13 |

Adjudicating our 13 extra flags by hand: **7 are genuinely useful**, **6 are noise or harm**.

Useful and Grammarly-missed: comma-splice repairs the informal register is full of
("One risk worth calling out, our only person…" → "…is that our only person…"),
`can't actually submit` → `can't submit`, `Due to the late release` → `Because of the
late release`, `is there someone else I should be talking to` → `should I talk to
someone else`.

Harmful: `90-degree, pie-shaped wedge` → dropped "pie-shaped"; `not a scenario a user
walks into by using the product` → dropped "by using the product"; `won't be ready until
end of day tomorrow` → dropped "end of day". **Every one of our worst failures is a
deletion.** Grammarly did not delete a clause anywhere in this document.

## 2. Battery of 12 classic clarity constructions

| | Grammarly | Ours |
|---|---|---|
| Flagged | **12 of 12** | **7 of 12** |
| Useful | 12 | 5 |

We got: `gave consideration to` → `considered`; `In the event that` → `If`;
`completely and totally inconclusive` → `inconclusive`; `Each and every one of the forms`
→ `Each form`; `make a determination regarding` → `determine`.

We missed five, and **three of those were our own safety layer refusing a reasonable
model rewrite**:

| Sentence | Model proposed | Refused as |
|---|---|---|
| Due to the fact that the sensor failed, the line stopped. | The sensor failure caused the line to stop. | `word-substituted` |
| There are a number of issues that need to be addressed by the team. | There are several issues that need… | `quantifier-changed` |
| The new process is more efficient than the old process was. | …than the old one. | `tense-changed` |

The other two (`are in agreement` → `agree`, `It is our expectation that` → `We expect`)
the model simply kept.

**This includes a regression.** Earlier today the reference case
"Due to the fact that the server was unavailable, the job failed." produced a suggestion.
The `word-substituted` guard, added to stop `passed` → `expired` and `confusing` → `clear`,
now also refuses it, because the model recasts to "The server being unavailable **caused**
the job to fail" and "caused" has no antecedent in the sentence. The guard is doing its job;
the model is choosing a recast where the prompt asked for `due to the fact that → because`.

## 3. Same sentence, both engines

**The reference sentence from the original screenshot**

- Source: `Guidance, navigation and control subsystems data were reviewed, and it appears that the subsystems performed properly.`
- Grammarly: `Guidance, navigation, and control **subsystem** data were reviewed, and **the subsystems appear to have performed** properly.`
- Ours: `Guidance, navigation, and control subsystems data were reviewed, and it appears the subsystems performed properly.`

We match the serial comma and drop the wordy `that`; we **miss** `subsystems` → `subsystem`,
the attributive-noun fix. Grammarly restructures the second clause; we make the smaller edit.

**A sentence only Grammarly flags**

- `Preflight data gave no evidence of any propellant leaks (fuel or oxidizer) in the aft compartment.`
- Grammarly: `gave` → `showed`, `oxidizer` → `oxidiser`.

The second is British-English localisation, and `percent` → `per cent` on another sentence
is the same thing. **Some of what Grammarly files under Clarity is dialect conversion**,
which our engine deliberately does not do. Counting those as misses overstates our gap.

## 4. Findings that matter more than the counts

1. **Over-flagging is the dominant difference.** 37% of sentences underlined versus
   Grammarly's 20%. On clean technical prose that reads as noise.
2. **Our failure mode is deletion; Grammarly's is not.** The clause-deletion guard added
   today catches the worst of it, but `pie-shaped`, `end of day`, and `by using the
   product` still slipped through — each below the guard's threshold.
3. **The explanation text is often fabricated even when the edit is right.** "Removes
   redundant 'the' before 'archive'" described an edit that removed no such thing;
   "Replaces a nominalized subject ('she')" is simply wrong. The rewrite passes safety
   validation, but the *reason* shown to the writer is unchecked model prose. Grammarly's
   labels are terse and accurate. This is a trust problem we have not addressed.
4. **The safety layer is now costing real recall** — three of twelve battery sentences.
   The trade was chosen deliberately, but the balance has moved too far toward refusal.
5. **Grammarly is minimal and surgical**; we recast more than we should, which is what
   both the deletions and the `word-substituted` refusals have in common.

## Verdict

On detection of genuine clarity problems in prose neither engine had seen, Grammarly is
clearly ahead: it found every construction in the battery and we found seven, and it
flagged less than we did while being right more often. Where we agree, our rewrites are
usually reasonable and occasionally better suited to the writer's original wording.
The gap is not the model's knowledge — it is restraint on clean prose, discipline about
deletion, honesty in the explanation text, and a safety layer that currently refuses too
much.
