// Deterministic clarity rewrites: wordy idioms replaced by their short forms, no model.
//
// Ported from Limatum's ClarityRules.swift — itself a Swift port of this engine, whose
// authors put the admission bar better than we had: a rule is admissible only when the
// short form means the same thing in EVERY context the phrase can appear in. "A rule
// needing agreement, tense or referent is a rule that will be wrong somewhere it was
// never run."
//
// An adversarial review then held this file to that bar and won 10 findings, so the bar
// is now enforced structurally rather than by taste:
//   - REMOVED outright where English refuses to be separated deterministically:
//     "in the event that" (literal "took part in the event that evening"),
//     "at the end of the day" (the store really closes then),
//     "put forward a proposal for" ("put" is base AND past — "will proposed"),
//     "was/were able to" -> "could" (erases that the thing actually happened).
//   - NARROWED with deterministic context guards where the bad readings have closed
//     shape: "in order to/for" stands down after a be-verb or a put/keep/set/get frame;
//     "gave approval to" fires only before a determiner (never "approval to proceed");
//     "the majority of"/"a large number of" keep the "of" before determiners and
//     pronouns ("most of the students", never "most the students");
//     "for a period of" refuses bare "time"; hedge openers fire only when the word
//     after "that" is a closed-class lowercase word, which is also what makes the
//     recapitalisation safe ("iPhone" is not in the list, so it is never "IPhone").
// Every finding's reproduction is pinned in tests/clarity-rules.test.mjs, alongside the
// corpus referee: exact reproduction of Grammarly's edits where claimed, zero firings on
// text Grammarly left alone.
//
// A fired rule costs ~microseconds and replaces a 300-600ms model call outright.

// The word after the phrase begins a nominal: safe to attach a verb or "of" to.
const DETERMINER = "(?:the|a|an|this|that|these|those|our|your|their|his|her|its|my)";
// Object position after "of": determiners plus object pronouns.
const OF_KEEPERS = new RegExp(`^\\s+(?:${DETERMINER.slice(3, -1)}|us|them|you|it|both|each)\\b`, "iu");
// What may follow a hedge opener's "that" for the deletion (and the recapitalisation)
// to be safe: closed-class, always-lowercase words that begin a clause.
const OPENER_FOLLOWERS = "(?:the|a|an|this|these|those|that|our|your|their|his|her|its|my|we|i|it|they|he|she|you|there|no|every|each|all|some|most|many|one)";
// The predicate reading of "in order" ("put your affairs in order to...",
// "everything is in order for..."): a be-verb right before it, or an
// arrange-verb earlier in the clause with no clause break between.
// Copulas beyond "be" take the predicate reading too: "Everything seems in order to
// me." must not lose its "in order".
const IN_ORDER_PREDICATE = /(?:\b(?:is|are|was|were|am|be|been|being|seem|seems|seemed|look|looks|looked|appear|appears|appeared|remain|remains|remained)\s+$)|(?:\b(?:put|puts|putting|keep|keeps|keeping|set|sets|setting|get|gets|getting|got)\b[^,.;:]*$)/iu;

const RULES = [
  // The Limatum rules that survived the review, verbatim.
  { id: "due-to-the-fact-that", phrase: "due to the fact that", replacement: "because", reason: "“Due to the fact that” is a long way of saying “because”." },
  { id: "in-spite-of-the-fact-that", phrase: "in spite of the fact that", replacement: "although", reason: "“In spite of the fact that” is a long way of saying “although”." },
  { id: "at-this-point-in-time", phrase: "at this point in time", replacement: "now", reason: "“At this point in time” is a long way of saying “now”." },
  { id: "in-order-to", phrase: "in order to", replacement: "to", blockedBefore: IN_ORDER_PREDICATE, reason: "“In order to” says no more than “to”." },
  { id: "in-order-for", phrase: "in order for", replacement: "for", blockedBefore: IN_ORDER_PREDICATE, reason: "“In order for” says no more than “for”." },
  { id: "has-the-ability-to", phrase: "has the ability to", replacement: "can", reason: "“Has the ability to” is a long way of saying “can”." },
  { id: "have-the-ability-to", phrase: "have the ability to", replacement: "can", reason: "“Have the ability to” is a long way of saying “can”." },
  { id: "for-the-purpose-of", phrase: "for the purpose of", replacement: "for", reason: "“For the purpose of” says no more than “for”." },
  // "the near future of X" is the literal noun: "interested in the near future of AI"
  // must not become "interested soon of AI".
  { id: "in-the-near-future", phrase: "in the near future", lookahead: "(?!\\s+of\\b)", replacement: "soon", reason: "“In the near future” is a long way of saying “soon”." },
  { id: "revert-back", phrase: "revert back", replacement: "revert", reason: "To revert is already to go back." },
  { id: "based-off-of", phrase: "based off of", replacement: "based on", reason: "The usual form is “based on”." },
  { id: "very-unique", phrase: "very unique", replacement: "unique", reason: "Unique is not a matter of degree." },
  { id: "completely-identical", phrase: "completely identical", replacement: "identical", reason: "Identical is already complete." },
  { id: "absolutely-essential", phrase: "absolutely essential", replacement: "essential", reason: "Essential is already absolute." },

  // Quantity phrases keep the "of" when object position demands it.
  { id: "a-large-number-of", phrase: "a large number of", replacement: (after) => OF_KEEPERS.test(after) ? "many of" : "many", reason: "“A large number of” is a long way of saying “many”." },
  { id: "the-majority-of", phrase: "the majority of", replacement: (after) => OF_KEEPERS.test(after) ? "most of" : "most", reason: "“The majority of” is a long way of saying “most”." },

  // Mined from the harvested Grammarly corpus.
  { id: "on-account-of-the-fact-that", phrase: "on account of the fact that", replacement: "because", reason: "“On account of the fact that” is a long way of saying “because”." },
  { id: "in-light-of-the-fact-that", phrase: "in light of the fact that", replacement: "because", reason: "“In light of the fact that” is a long way of saying “because”." },
  // After deal/end/start/begin the string is verb + "with" + the literal noun
  // "exception": "dealt with the exception of type ValueError" is about an exception.
  { id: "with-the-exception-of", phrase: "with the exception of", blockedBefore: /\b(?:deal|deals|dealt|dealing|cope|copes|coped|coping|end|ends|ended|ending|start|starts|started|starting|begin|begins|began|beginning)\s+$/iu, replacement: "except for", reason: "“With the exception of” is a long way of saying “except for”." },
  { id: "in-the-vicinity-of", phrase: "in the vicinity of", replacement: "near", reason: "“In the vicinity of” is a long way of saying “near”." },
  { id: "for-a-period-of", phrase: "for a period of", lookahead: "(?!\\s+time\\b)", replacement: "for", reason: "“For a period of” says no more than “for”." },
  { id: "makes-mention-of", phrase: "makes mention of", replacement: "mentions", reason: "“Makes mention of” is a long way of saying “mentions”." },
  { id: "make-mention-of", phrase: "make mention of", replacement: "mention", reason: "“Make mention of” is a long way of saying “mention”." },
  { id: "made-mention-of", phrase: "made mention of", replacement: "mentioned", reason: "“Made mention of” is a long way of saying “mentioned”." },
  { id: "gives-approval-to", phrase: "gives approval to", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "approves", reason: "“Gives approval to” is a long way of saying “approves”." },
  { id: "give-approval-to", phrase: "give approval to", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "approve", reason: "“Give approval to” is a long way of saying “approve”." },
  { id: "gave-approval-to", phrase: "gave approval to", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "approved", reason: "“Gave approval to” is a long way of saying “approved”." },
  { id: "gives-consideration-to", phrase: "gives consideration to", replacement: "considers", reason: "“Gives consideration to” is a long way of saying “considers”." },
  { id: "give-consideration-to", phrase: "give consideration to", replacement: "consider", reason: "“Give consideration to” is a long way of saying “consider”." },
  { id: "gave-consideration-to", phrase: "gave consideration to", replacement: "considered", reason: "“Gave consideration to” is a long way of saying “considered”." },
  { id: "makes-use-of", phrase: "makes use of", replacement: "uses", reason: "“Makes use of” is a long way of saying “uses”." },
  { id: "make-use-of", phrase: "make use of", replacement: "use", reason: "“Make use of” is a long way of saying “use”." },
  { id: "made-use-of", phrase: "made use of", replacement: "used", reason: "“Made use of” is a long way of saying “used”." },
  { id: "provides-a-description-of", phrase: "provides a description of", replacement: "describes", reason: "“Provides a description of” is a long way of saying “describes”." },
  { id: "provide-a-description-of", phrase: "provide a description of", replacement: "describe", reason: "“Provide a description of” is a long way of saying “describe”." },
  { id: "provided-a-description-of", phrase: "provided a description of", replacement: "described", reason: "“Provided a description of” is a long way of saying “described”." },
  { id: "carries-out-a-review-of", phrase: "carries out a review of", replacement: "reviews", reason: "“Carries out a review of” is a long way of saying “reviews”." },
  { id: "carry-out-a-review-of", phrase: "carry out a review of", replacement: "review", reason: "“Carry out a review of” is a long way of saying “review”." },
  { id: "carried-out-a-review-of", phrase: "carried out a review of", replacement: "reviewed", reason: "“Carried out a review of” is a long way of saying “reviewed”." },
  // "puts" is unambiguously third-person present; bare "put" is base, past and
  // participle at once, and is deliberately absent — "will proposed" is not a fix.
  { id: "puts-forward-a-proposal-for", phrase: "puts forward a proposal for", replacement: "proposes", reason: "“Puts forward a proposal for” is a long way of saying “proposes”." },
  { id: "is-able-to", phrase: "is able to", replacement: "can", reason: "“Is able to” is a long way of saying “can”." },
  { id: "are-able-to", phrase: "are able to", replacement: "can", reason: "“Are able to” is a long way of saying “can”." },
  { id: "has-the-capability-to", phrase: "has the capability to", replacement: "can", reason: "“Has the capability to” is a long way of saying “can”." },
  { id: "have-the-capability-to", phrase: "have the capability to", replacement: "can", reason: "“Have the capability to” is a long way of saying “can”." },

  // Second pass over the phrase list in docs/GRAMMARLY-BEHAVIOUR.md §1, held to the same
  // bar. What that list contains and this file still does not is recorded at the bottom.
  { id: "prior-to", phrase: "prior to", replacement: "before", reason: "“Prior to” is a long way of saying “before”." },
  { id: "in-close-proximity-to", phrase: "in close proximity to", replacement: "near", reason: "“In close proximity to” is a long way of saying “near”." },
  { id: "each-and-every", phrase: "each and every", replacement: "every", reason: "“Each and every” says no more than “every”." },
  { id: "as-to-whether", phrase: "as to whether", replacement: "whether", reason: "“As to whether” says no more than “whether”." },
  { id: "all-in-all", phrase: "all in all", replacement: "overall", reason: "“All in all” is a long way of saying “overall”." },
  // "the present moment of impact" is the literal noun, as "the near future of AI" is.
  { id: "at-the-present-moment", phrase: "at the present moment", lookahead: "(?!\\s+of\\b)", replacement: "now", reason: "“At the present moment” is a long way of saying “now”." },
  { id: "at-the-present-time", phrase: "at the present time", lookahead: "(?!\\s+of\\b)", replacement: "now", reason: "“At the present time” is a long way of saying “now”." },
  // A determiner has to follow, or "the course" is a course: "during the course of
  // Chemistry 101" is about a course, "during the course of the year" is about a year.
  { id: "during-the-course-of", phrase: "during the course of", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "during", reason: "“During the course of” says no more than “during”." },
  { id: "on-a-daily-basis", phrase: "on a daily basis", replacement: "daily", reason: "“On a daily basis” is a long way of saying “daily”." },
  { id: "on-a-weekly-basis", phrase: "on a weekly basis", replacement: "weekly", reason: "“On a weekly basis” is a long way of saying “weekly”." },
  { id: "on-a-monthly-basis", phrase: "on a monthly basis", replacement: "monthly", reason: "“On a monthly basis” is a long way of saying “monthly”." },
  { id: "on-a-quarterly-basis", phrase: "on a quarterly basis", replacement: "quarterly", reason: "“On a quarterly basis” is a long way of saying “quarterly”." },
  { id: "on-a-yearly-basis", phrase: "on a yearly basis", replacement: "yearly", reason: "“On a yearly basis” is a long way of saying “yearly”." },
  { id: "on-an-annual-basis", phrase: "on an annual basis", replacement: "annually", reason: "“On an annual basis” is a long way of saying “annually”." },
  { id: "on-a-regular-basis", phrase: "on a regular basis", replacement: "regularly", reason: "“On a regular basis” is a long way of saying “regularly”." },
  // The gerund is what makes the deletion safe: "is in the process of migrating" -> "is
  // migrating" keeps the aspect the auxiliary already carried.
  { id: "is-in-the-process-of", phrase: "is in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "is", reason: "“Is in the process of” says no more than the verb it introduces." },
  { id: "are-in-the-process-of", phrase: "are in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "are", reason: "“Are in the process of” says no more than the verb it introduces." },
  { id: "was-in-the-process-of", phrase: "was in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "was", reason: "“Was in the process of” says no more than the verb it introduces." },
  { id: "were-in-the-process-of", phrase: "were in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "were", reason: "“Were in the process of” says no more than the verb it introduces." },
  // The rest of the light-verb family already represented above by "carries out a review
  // of" and "makes use of". Each keeps its three tensed forms, because the short form has
  // to carry the tense the light verb was carrying.
  { id: "conducts-an-investigation-into", phrase: "conducts an investigation into", replacement: "investigates", reason: "“Conducts an investigation into” is a long way of saying “investigates”." },
  { id: "conduct-an-investigation-into", phrase: "conduct an investigation into", replacement: "investigate", reason: "“Conduct an investigation into” is a long way of saying “investigate”." },
  { id: "conducted-an-investigation-into", phrase: "conducted an investigation into", replacement: "investigated", reason: "“Conducted an investigation into” is a long way of saying “investigated”." },
  { id: "makes-an-assessment-of", phrase: "makes an assessment of", replacement: "assesses", reason: "“Makes an assessment of” is a long way of saying “assesses”." },
  { id: "make-an-assessment-of", phrase: "make an assessment of", replacement: "assess", reason: "“Make an assessment of” is a long way of saying “assess”." },
  { id: "made-an-assessment-of", phrase: "made an assessment of", replacement: "assessed", reason: "“Made an assessment of” is a long way of saying “assessed”." },
  { id: "undertakes-a-comparison-of", phrase: "undertakes a comparison of", replacement: "compares", reason: "“Undertakes a comparison of” is a long way of saying “compares”." },
  { id: "undertake-a-comparison-of", phrase: "undertake a comparison of", replacement: "compare", reason: "“Undertake a comparison of” is a long way of saying “compare”." },
  { id: "undertook-a-comparison-of", phrase: "undertook a comparison of", replacement: "compared", reason: "“Undertook a comparison of” is a long way of saying “compared”." },
  { id: "performs-the-validation-of", phrase: "performs the validation of", replacement: "validates", reason: "“Performs the validation of” is a long way of saying “validates”." },
  { id: "perform-the-validation-of", phrase: "perform the validation of", replacement: "validate", reason: "“Perform the validation of” is a long way of saying “validate”." },
  { id: "performed-the-validation-of", phrase: "performed the validation of", replacement: "validated", reason: "“Performed the validation of” is a long way of saying “validated”." },
  { id: "results-in-the-reduction-of", phrase: "results in the reduction of", replacement: "reduces", reason: "“Results in the reduction of” is a long way of saying “reduces”." },
  { id: "result-in-the-reduction-of", phrase: "result in the reduction of", replacement: "reduce", reason: "“Result in the reduction of” is a long way of saying “reduce”." },
  { id: "resulted-in-the-reduction-of", phrase: "resulted in the reduction of", replacement: "reduced", reason: "“Resulted in the reduction of” is a long way of saying “reduced”." },
];

// Still on Grammarly's list and deliberately NOT here, so the next reader does not have
// to rediscover why:
//   - "in terms of", "in accordance with", "the implementation of", "there is a need for",
//     "the reason why ... is that", "takes a lot of time": no single short form means the
//     same thing in every context; each needs the sentence rebuilt around it.
//   - "perform an analysis of": the short form is spelled "analyse" or "analyze", and
//     picking one imposes a dialect. Changing a writer's dialect is a documented refusal
//     (docs/GRAMMARLY-BEHAVIOUR.md §3), so a rule that has to choose cannot be admitted.
//   - "point of view" -> "perspective": a synonym swap, not a wordiness trim; it fails
//     the file's own purpose rather than its bar.
//   - "there is a chance that", "it could be argued that", "would seem to suggest":
//     these carry how strongly the writer is committed. Dropping them is the certainty
//     strengthening the project refuses on purpose (§3).

// Hedge openers: deleted, with the sentence recapitalised. Anchored to the sentence
// start, and admitted only when the word after "that" is a closed-class lowercase word —
// which excludes both the relative-pronoun reading ("no doubt that remains...") and any
// case-sensitive name the recapitalisation would corrupt.
const OPENERS = [
  { id: "it-should-be-noted-that", pattern: new RegExp(`^it should be noted that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "“It should be noted that” delays the point without adding to it." },
  { id: "it-is-worth-noting-that", pattern: new RegExp(`^it is worth noting that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "“It is worth noting that” delays the point without adding to it." },
  { id: "it-is-important-to-note-that", pattern: new RegExp(`^it is important to note that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "“It is important to note that” delays the point without adding to it." },
  { id: "it-is-worth-mentioning-that", pattern: new RegExp(`^it is worth mentioning that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "“It is worth mentioning that” delays the point without adding to it." },
  { id: "it-must-be-noted-that", pattern: new RegExp(`^it must be noted that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "“It must be noted that” delays the point without adding to it." },
  { id: "please-note-that", pattern: new RegExp(`^please note that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "“Please note that” delays the point without adding to it." },
];
// "there is no doubt that" USED to be here, and its removal is the point of the list
// above: every opener in it is one src/safety.mjs also treats as contentless
// (ATTENTION_FRAME), so the two tiers now agree about what a frame is. Dropping "there
// is no doubt that" flattens emphasis, which docs/GRAMMARLY-BEHAVIOUR.md §3 records as a
// difference from Grammarly the project keeps ON PURPOSE — and the safety layer refuses
// that exact edit from the model. Emitting it from the rule tier meant the writer saw
// the suggestion only when the deterministic pass happened to fire, and never when the
// model proposed the same thing.

const escape = (phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
// The hyphen guards keep a phrase out of compounds: \b matches before "-", so without
// them "revert back" fired inside "revert back-end changes" and glued the remainder
// onto the verb ("revert-end changes").
const compiled = RULES.map((rule) => ({
  ...rule,
  // \p{Pd}, not "-": editors substitute Unicode hyphens (U+2010, U+2011) into
  // compounds, and those glued the phrase into "revert back‑end" all the same.
  pattern: new RegExp(`(?<!\\p{Pd})\\b${escape(rule.phrase)}\\b(?!\\p{Pd})${rule.lookahead ?? ""}`, "giu"),
}));

// Case preservation, as the Swift original does it: a phrase that opened the sentence
// must not be replaced by a lowercase word.
function matchCase(matched, replacement) {
  return /^\p{Lu}/u.test(matched)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
}

// The short form of `sentence`, or null when no rule applies. Every rule is tried, so a
// sentence carrying two wordy idioms is offered one rewrite that fixes both; the reason
// names the first rule that fired, because a card explaining two things at once explains
// neither.
export function applyClarityRules(sentence) {
  let replacement = sentence;
  let reason = null;

  for (const opener of OPENERS) {
    const applied = replacement.replace(opener.pattern, "");
    if (applied === replacement) continue;
    replacement = applied.charAt(0).toUpperCase() + applied.slice(1);
    if (!reason) reason = opener.reason;
  }

  for (const rule of compiled) {
    const applied = replacement.replace(rule.pattern, (matched, ...rest) => {
      const offset = rest[rest.length - 2];
      const full = rest[rest.length - 1];
      // The guard sees the whole clause the match sits in, back to the last clause
      // break. A fixed-width window both cut clauses short (an arrange-verb 50
      // characters back escaped the put-frame guard) and could start mid-word,
      // manufacturing a spurious \b that made fragments like the "put" of "output"
      // block a rule.
      const before = full.slice(0, offset);
      const clauseStart = Math.max(
        before.lastIndexOf(","), before.lastIndexOf("."),
        before.lastIndexOf(";"), before.lastIndexOf(":"),
      );
      if (rule.blockedBefore && rule.blockedBefore.test(before.slice(clauseStart + 1))) {
        return matched;
      }
      const target = typeof rule.replacement === "function"
        ? rule.replacement(full.slice(offset + matched.length))
        : rule.replacement;
      return matchCase(matched, target);
    });
    if (applied === replacement) continue;
    replacement = applied;
    if (!reason) reason = rule.reason;
  }

  if (!reason || replacement === sentence) return null;
  return { replacement, reason };
}

// Folded into the plugin's cache fingerprint: a cache written under a different rule
// table must not answer for this one. FNV-1a over the serialised tables.
function fnv(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export const RULES_SIGNATURE = fnv(JSON.stringify([
  RULES.map((rule) => [rule.id, rule.phrase, String(rule.replacement), rule.lookahead ?? "", String(rule.blockedBefore ?? "")]),
  OPENERS.map((opener) => [opener.id, String(opener.pattern)]),
  // Behaviour-bearing constants a function replacement only names: a change to these
  // changes answers, so a cache written under other values must not survive it.
  [String(OF_KEEPERS), DETERMINER, OPENER_FOLLOWERS],
]));
