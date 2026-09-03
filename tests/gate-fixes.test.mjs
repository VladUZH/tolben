// The seven guards added in the pre-launch gate review, each with the pair that motivated
// it and the pairs that must stay untouched. Every REFUSED case here passed the gate
// before its guard existed, or was refused under a label that named the wrong thing.
//
// This file is the unit level: what validateRewrite and the scope-word guard decide on
// their own. The pipeline-level policy those decisions feed — the deletion policy and the
// verifier — is exercised by the torture corpus.

import test from "node:test";
import assert from "node:assert/strict";
import { validateRewrite, dropsScopeWord } from "../src/safety.mjs";

const rewrite = (replacement) => ({ action: "rewrite", replacement, reason: "A restrained edit." });
const verdict = (source, replacement) => validateRewrite(source, rewrite(replacement));

// --------------------------------------------------------------------- (a) role swap

test("(a) two common nouns exchanged for each other is refused", () => {
  // The pair from the review. No name is capitalised, the word multiset differs because
  // the possessive travels with the noun, and no voice changed — so before this guard,
  // nothing in the gate saw a sentence that says the opposite of the writer's.
  assert.equal(verdict(
    "The auditor reviewed the vendor's controls.",
    "The vendor reviewed the auditor's controls.",
  ).reason, "order-changed");
  assert.equal(verdict(
    "The supplier invoiced the contractor.",
    "The contractor invoiced the supplier.",
  ).reason, "order-changed");
});

test("(a) the guard needs an exact two-for-two exchange, so ordinary edits survive", () => {
  const kept = [
    // One substitution, not an exchange.
    ["The department will conduct an investigation into the missing inventory.",
      "The department will investigate the missing inventory."],
    // Two substitutions that are not each other.
    ["The tool has the ability to recover the files.", "The tool can recover the files."],
    // A repeated word cannot be swapped with itself.
    ["The report cites the report from March.", "The report cites March's report."],
  ];
  for (const [source, replacement] of kept) {
    assert.notEqual(verdict(source, replacement).reason, "order-changed", `${source} -> ${replacement}`);
  }
});

// ---------------------------------------------------------------- (b) comparative bounds

test("(b) dropping a comparative bound over a quantity is refused", () => {
  const bounds = [
    ["More than 40% of the tests failed.", "40% of the tests failed."],
    ["Less than half the team replied.", "Half the team replied."],
    ["Fewer than ten tests failed.", "Ten tests failed."],
    ["Up to twelve users can join.", "Twelve users can join."],
    ["No more than three retries are allowed.", "Three retries are allowed."],
  ];
  for (const [source, replacement] of bounds) {
    assert.equal(verdict(source, replacement).reason, "quantifier-changed", `${source} -> ${replacement}`);
  }
});

test("(b) inventing a bound the writer did not state is refused too", () => {
  assert.equal(verdict("40% of the tests failed.", "More than 40% of the tests failed.").reason,
    "quantifier-changed");
});

test("(b) a bound with no quantity beside it bounds nothing", () => {
  // "more than happy" and "up to the team" are idioms, not inequalities. Trapping them
  // would refuse a family of ordinary repairs.
  assert.equal(verdict("We were more than happy to assist with the request.",
    "We were more than happy to assist.").accepted, true);
  assert.equal(verdict("The decision is up to the steering group at this point in time.",
    "The decision is up to the steering group now.").accepted, true);
});

// -------------------------------------------------------- (c) temporal subordinators

test("(c) exchanging one temporal subordinator for another is refused", () => {
  const swaps = [
    ["Run the migration before the deploy starts.", "Run the migration when the deploy starts."],
    ["Check the log when the meeting starts.", "Check the log before the meeting starts."],
    ["Log the result while the job runs.", "Log the result once the job runs."],
    ["Archive the build after the release ships.", "Archive the build once the release ships."],
  ];
  for (const [source, replacement] of swaps) {
    assert.equal(verdict(source, replacement).reason, "direction-changed", `${source} -> ${replacement}`);
  }
});

test("(c) the frequency 'once' and the noun 'while' are not subordinators", () => {
  // "once a day" counts occurrences and "a while" is a duration; neither places an event
  // relative to another, so neither may make a later "before" read as a reversal.
  assert.equal(verdict("The job runs once a day and the report is generated at the end of the day.",
    "The job runs once a day and the report is generated at day's end.").accepted, true);
  assert.equal(verdict("We waited a while for the results of the analysis.",
    "We waited a while for the analysis results.").accepted, true);
});

// ------------------------------------------------------------------- (d) scope words

test("(d) dropping a scope word is a loss, whatever the content words do", () => {
  // None of these is a content word, so lostContentWords never reports one and the
  // deletion policy never sees it — which is how they reached the writer.
  const dropped = [
    ["Hold the release until Friday.", "Hold the release Friday."],
    ["The job runs unless the queue is empty.", "The job runs if the queue is empty."],
    ["Everyone except the intern signed off.", "Everyone signed off."],
    ["She used her own laptop.", "She used her laptop."],
    ["Only the lead may approve it.", "The lead may approve it."],
  ];
  for (const [source, replacement] of dropped) {
    assert.equal(dropsScopeWord(source, replacement), true, `${source} -> ${replacement}`);
  }
});

test("(d) keeping the scope word, or adding one, is not a loss", () => {
  assert.equal(dropsScopeWord("Only the lead may approve it.", "Only the lead approves it."), false);
  assert.equal(dropsScopeWord("The lead may approve it.", "Only the lead may approve it."), false);
  assert.equal(dropsScopeWord("We reviewed the draft.", "We reviewed the draft carefully."), false);
});

// ------------------------------------------------------- (e) number words are not names

test("(e) a capitalised number word is not a name", () => {
  // The right refusal under the wrong label: this used to report `name-changed`, as
  // though the sentence were about someone called Ten.
  assert.equal(verdict("Fewer than ten tests failed.", "Ten tests failed.").reason, "quantifier-changed");
  assert.equal(verdict("Approximately three hundred rows were affected by the change.",
    "Three hundred rows were affected.").reason, "quantifier-changed");
});

test("(e) an actual name is still preserved", () => {
  assert.equal(verdict("Katarina reviewed the unusually long draft before dinner.",
    "Nadia reviewed the long draft before dinner.").reason, "name-changed");
});

// -------------------------------------------------------- (f) one name for one class

test("(f) both content-drop paths report the same reason", () => {
  // A dropped clause and a dropped connective are the same finding — the candidate says
  // less than the source — and used to be reported as `content-dropped` and
  // `dropped-content`, which read as two policies in the refusal ledger.
  assert.equal(verdict("The archive is stored offsite, and the index is stored locally.",
    "The archive is stored offsite.").reason, "content-dropped");
  assert.equal(verdict("The review was brief, but thorough.",
    "The review was brief and thorough.").reason, "content-dropped");
});

// ---------------------------------------------------------------- (g) refusal prose

test("(g) a model that refuses instead of rewriting is reported as such", () => {
  const source = "The panel came to the conclusion that the request should be denied.";
  const refusals = [
    "I will not revise it.",
    "That violates my guidelines.",
    "I'm sorry, but I can't help with that.",
    "As an AI, I am unable to comply.",
    "Unfortunately, I cannot assist.",
  ];
  for (const replacement of refusals) {
    assert.equal(verdict(source, replacement).reason, "instruction-output", replacement);
  }
});

test("(g) the writer's own sentence about refusing is still rewritten", () => {
  // The pattern alone is not evidence: what distinguishes a refusal from a rewrite is
  // that a refusal shares no content word with the sentence it was asked about.
  const kept = [
    ["I will not be able to attend the meeting due to the fact that I am travelling.",
      "I will not be able to attend the meeting because I am travelling."],
    ["Sorry for the delay in the event that you were waiting on me.",
      "Sorry for the delay if you were waiting on me."],
    ["I am sorry that I cannot provide an estimate at this point in time.",
      "I am sorry that I cannot provide an estimate now."],
  ];
  for (const [source, replacement] of kept) {
    assert.equal(verdict(source, replacement).accepted, true, `${source} -> ${replacement}`);
  }
  // These two are refused, but by guards that predate this one: the point is that a
  // sentence the writer wrote about refusing is never mistaken for the model refusing.
  assert.notEqual(verdict("I will not be able to attend the meeting on Tuesday.",
    "I cannot attend the meeting on Tuesday.").reason, "instruction-output");
  assert.notEqual(verdict("I am sorry for the delay in responding to your request.",
    "I am sorry for the delayed response.").reason, "instruction-output");
});
