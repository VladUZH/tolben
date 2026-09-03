// Deterministic clarity rewrites: wordy idioms whose short form means the same thing in
// every context the phrase can appear in. Ported from Limatum's ClarityRules.swift (the
// Swift port of this very engine, returning home) and extended with substitutions mined
// from bench/corpus/grammarly-pairs.json — admitted only where the corpus shows the
// substitution reproducing Grammarly's own edit and nothing shows it misfiring.
//
// The bar, quoted from the Swift original: "a rule needing agreement, tense or referent
// is a rule that will be wrong somewhere it was never run."

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyClarityRules } from "../src/clarity-rules.mjs";
import { validateRewrite } from "../src/safety.mjs";

// The rules that survived the adversarial review; the removed ones ("in the event
// that", "at the end of the day", bare "put forward", was/were-able-to) have their
// counter-examples pinned in the review-pinned block below.
const CASES = [
  // From the Limatum sixteen.
  ["The delay was due to the fact that the cache was cold.", "The delay was because the cache was cold."],
  ["In spite of the fact that it rained, we shipped.", "Although it rained, we shipped."],
  ["At this point in time we are blocked.", "Now we are blocked."],
  ["In order to ship, we tested.", "To ship, we tested."],
  ["The tool has the ability to recover files.", "The tool can recover files."],
  ["They have the ability to retry.", "They can retry."],
  ["A large number of users left.", "Many users left."],
  ["For the purpose of testing, we forked.", "For testing, we forked."],
  ["We will migrate in the near future.", "We will migrate soon."],
  ["Please revert back to the old version.", "Please revert to the old version."],
  ["The estimate is based off of last year.", "The estimate is based on last year."],
  ["The design is very unique.", "The design is unique."],
  ["The copies are completely identical.", "The copies are identical."],
  ["Backups are absolutely essential.", "Backups are essential."],
  // Mined from the corpus, each reproducing Grammarly's own edit.
  ["The majority of requests succeed.", "Most requests succeed."],
  ["We paused on account of the fact that costs rose.", "We paused because costs rose."],
  ["In light of the fact that costs rose, we paused.", "Because costs rose, we paused."],
  ["Everyone attended with the exception of Priya.", "Everyone attended except for Priya."],
  ["The router sits in the vicinity of the desk.", "The router sits near the desk."],
  ["The report makes mention of the outage.", "The report mentions the outage."],
  ["The board gave approval to the plan.", "The board approved the plan."],
  ["Please give consideration to the alternative.", "Please consider the alternative."],
  ["The service makes use of a queue.", "The service uses a queue."],
  ["The document provides a description of the flow.", "The document describes the flow."],
  ["We carried out a review of the draft.", "We reviewed the draft."],
  ["We are able to filter the noise.", "We can filter the noise."],
  ["She is able to reproduce it.", "She can reproduce it."],
  ["In order for the test to pass, mock the clock.", "For the test to pass, mock the clock."],
  ["The job ran for a period of two weeks.", "The job ran for two weeks."],
];

for (const [source, expected] of CASES) {
  test(`rewrites: ${source}`, () => {
    const result = applyClarityRules(source);
    assert.ok(result, "expected a rule to fire");
    assert.equal(result.replacement, expected);
    assert.ok(result.reason.length > 0);
  });
}

// Sentence-initial hedge openers: deleted, with the next word recapitalised. Anchored to
// the sentence start so the deletion cannot orphan a mid-sentence clause.
const OPENERS = [
  ["It should be noted that the cache is cold.", "The cache is cold."],
  ["It is worth noting that the test is flaky.", "The test is flaky."],
  ["It is important to note that the disk is full.", "The disk is full."],
  ["It is worth mentioning that the queue is empty.", "The queue is empty."],
  ["It must be noted that the token expired.", "The token expired."],
  ["Please note that the office is closed.", "The office is closed."],
];
for (const [source, expected] of OPENERS) {
  test(`drops the opener: ${source}`, () => {
    assert.equal(applyClarityRules(source)?.replacement, expected);
  });
  test(`leaves the phrase alone mid-sentence: ${source}`, () => {
    const embedded = `He said that ${source[0].toLowerCase()}${source.slice(1)}`;
    const result = applyClarityRules(embedded);
    // Mid-sentence the opener rule must not fire; other rules may, but nothing may
    // delete the phrase and leave "He said that the cache..." reading as two clauses.
    if (result) assert.ok(/\b(?:noted|noting|mentioning|note)\s+that\b/u.test(result.replacement));
  });
}

test("capitalisation follows the phrase it replaces", () => {
  assert.equal(applyClarityRules("Due to the fact that it rained, we stayed.")?.replacement,
    "Because it rained, we stayed.");
});

test("two idioms in one sentence get one combined rewrite, first reason named", () => {
  const result = applyClarityRules("In order to ship, the tool has the ability to retry.");
  assert.equal(result.replacement, "To ship, the tool can retry.");
  assert.match(result.reason, /In order to/u);
});

test("clean prose is untouched", () => {
  for (const s of [
    "The archive is copied weekly.",
    "Order the parts by size.",                       // "order" is not "in order to"
    "The event that follows is optional.",            // "the event that" is not "in the event that"
    "We were able, in the end, to ship.",             // split phrase must not match
    "Costs rose 5% in March.",
  ]) {
    assert.equal(applyClarityRules(s), null, s);
  }
});

// The corpus is the referee: the rules must reproduce Grammarly's own edits where they
// claim to, and must never fire on a sentence Grammarly left alone.
const corpus = JSON.parse(await readFile(new URL("../bench/corpus/grammarly-pairs.json", import.meta.url), "utf8"));

// Every sentence where a rule fires and Grammarly's own wording differs, with what the
// rules produce instead. A count threshold used to stand here, and a count is the wrong
// instrument: it says how MANY divergences there are and nothing about whether any of
// them is defensible, so adding rules could quietly buy new ones under the ceiling. Each
// row below has been read. In every case Grammarly made a BROADER edit in the same
// sentence and ours is a strict subset of it — except the socialize/socialise row, where
// Grammarly also changed the writer's dialect and ours deliberately does not.
const CORPUS_DIVERGENCES = new Map([
  ["The migration was delayed for a period of three weeks.",
    "The migration was delayed for three weeks."],
  ["In the near future we intend to replace the queue with a stream.",
    "Soon we intend to replace the queue with a stream."],
  ["We need to revert back to the previous version of the schema.",
    "We need to revert to the previous version of the schema."],
  ["We should socialize the proposal with stakeholders prior to the deep dive.",
    "We should socialize the proposal with stakeholders before the deep dive."],
  ["Users are able to filter the results by date, status, and owner.",
    "Users can filter the results by date, status, and owner."],
  ["Prior to running the script, ensure that the environment variables are set.",
    "Before running the script, ensure that the environment variables are set."],
  ["Further research will be required in order to establish causality definitively.",
    "Further research will be required to establish causality definitively."],
  ["Ensure that all of the tests are passing prior to merging the branch.",
    "Ensure that all of the tests are passing before merging the branch."],
]);

test("corpus: rules reproduce Grammarly's exact rewrite, and every divergence is a reviewed one", () => {
  let exact = 0;
  const unreviewed = [];
  for (const pair of corpus.pairs.filter((p) => p.changed)) {
    const result = applyClarityRules(pair.original);
    if (!result) continue;
    if (result.replacement === pair.grammarly) { exact += 1; continue; }
    if (CORPUS_DIVERGENCES.get(pair.original) === result.replacement) continue;
    unreviewed.push(`${pair.original}\n  ours:      ${result.replacement}\n  Grammarly: ${pair.grammarly}`);
  }
  assert.deepEqual(unreviewed, [], `a rule diverged from Grammarly in a way nobody has read:\n${unreviewed.join("\n")}`);
  assert.ok(exact >= 18, `only ${exact} exact reproductions`);
});

// The two tiers have to mean the same thing by "this edit is safe". They are checked by
// different machinery — the rule tier by a hand audit against the admission bar, the
// model tier by the guards in safety.mjs — and nothing forced them to agree, so they did
// not: the rule tier deleted "there is no doubt that" while the safety layer refused the
// identical edit from the model, and the writer saw the suggestion only when the
// deterministic pass happened to fire. This is the check that catches the next one.
test("the rule tier never emits an edit the safety layer would refuse", () => {
  const disagreements = [];
  const sources = [
    ...corpus.pairs.map((pair) => pair.original),
    ...CASES.map(([source]) => source),
    ...OPENERS.map(([source]) => source),
  ];
  for (const source of sources) {
    const result = applyClarityRules(source);
    if (!result) continue;
    const verdict = validateRewrite(source, { action: "rewrite", replacement: result.replacement, reason: "" });
    if (!verdict.accepted) disagreements.push(`[${verdict.reason}] ${source}\n   -> ${result.replacement}`);
  }
  assert.deepEqual(disagreements, [], `the tiers disagree:\n${disagreements.join("\n")}`);
});

test("corpus: rules never fire on a sentence Grammarly left unchanged", () => {
  const fired = corpus.pairs.filter((p) => !p.changed && applyClarityRules(p.original) !== null);
  assert.deepEqual(fired.map((p) => p.original), []);
});

// --- Pipeline integration: a fired rule replaces the model call outright. ---

import { analyzeSentence } from "../src/pipeline.mjs";

function countingEngine() {
  let calls = 0;
  return {
    engine: { rewrite: async () => { calls += 1; return { action: "keep", replacement: "", reason: "" }; } },
    count: () => calls,
  };
}

test("rules on + idiom: the rule is the floor, and the model is still asked", async () => {
  const { engine, count } = countingEngine();
  const result = await analyzeSentence("The tool has the ability to recover files.", {
    engine, rules: true, gate: true,
  });
  // The model IS consulted: a rule repairs only the wordiness it matched, so ending the
  // sentence here shipped any other fault in it — "In order to ship, the tests was run."
  // was answered "To ship, the tests was run." and then marked decided.
  assert.equal(count(), 1);
  // It kept, so the rule's answer surfaces unchanged.
  assert.equal(result.replacement, "The tool can recover files.");
  assert.equal(result.stages.rule, true);
  assert.equal(result.stages.model, false);
  assert.match(result.reason, /ability/u);
});

test("rules on + idiom: a model rewrite supersedes the rule's answer", async () => {
  // The model sees the writer's own sentence, never the rule's output, so its rewrite is
  // validated against the original text and wins on its own merits.
  const engine = {
    rewrite: async (shown) => {
      assert.equal(shown, "In order to ship, the tests was run.", "the model is shown the pre-rule text");
      return { action: "rewrite", replacement: "In order to ship, the tests were run.", reason: "Agreement.", latencyMs: 1 };
    },
  };
  const result = await analyzeSentence("In order to ship, the tests was run.", { engine, rules: true });
  assert.equal(result.replacement, "In order to ship, the tests were run.");
  assert.equal(result.stages.model, true);
  assert.equal(result.stages.rule, false);
});

test("rules on: the local pass still answers with no engine at all", async () => {
  // The plugin's fast card and the server-down path both rely on this.
  const result = await analyzeSentence("The tool has the ability to recover files.", { engine: null, rules: true });
  assert.equal(result.replacement, "The tool can recover files.");
  assert.equal(result.stages.rule, true);
});

test("rules compose with mechanics: both repairs in one suggestion", async () => {
  const result = await analyzeSentence("The workshop on wednesday has the ability to run late.", { rules: true });
  assert.equal(result.replacement, "The workshop on Wednesday can run late.");
  assert.equal(result.stages.mechanics, true);
  assert.equal(result.stages.rule, true);
});

test("a rule never edits inside a protected term", async () => {
  const { engine, count } = countingEngine();
  // The idiom lives inside inline code (the probe passes its contents as protected).
  const result = await analyzeSentence("Run the script in order to test locally.", {
    engine, rules: true, protectedTerms: ["script in order to test"],
  });
  assert.equal(result.stages.rule ?? false, false, "the rule edited a protected span");
  assert.equal(count(), 1, "with the rule suppressed, the model should be consulted");
});

test("a rule never eats markup", async () => {
  const { engine } = countingEngine();
  const result = await analyzeSentence("We shipped **in order to** learn.", { engine, rules: true });
  // The bold delimiters wrap exactly the phrase; replacing it would rip them out or
  // orphan them. Either the rewrite keeps the markup intact or the rule stands down.
  if (result.stages.rule) {
    const stars = (result.replacement.match(/\*\*/gu) ?? []).length;
    assert.equal(stars, 2, result.replacement);
  }
});

test("rules off (the default): the model is consulted as before", async () => {
  const { engine, count } = countingEngine();
  await analyzeSentence("The tool has the ability to recover files.", { engine });
  assert.equal(count(), 1);
});

// --- The adversarial review's confirmed repros, pinned forever. ---
// Every sentence below produced a wrong or broken rewrite; each must now be left alone
// or rewritten correctly. The admission bar is not a comment, it is these tests.

const MUST_NOT_TOUCH = [
  "They will put forward a proposal for reform.",                    // "will proposed"
  "We plan to put forward a proposal for merging the teams.",
  "Everyone who took part in the event that evening got a medal.",   // literal noun + deictic
  "She was interested in the event that year.",
  "Put your affairs in order to spare your family the paperwork.",   // predicate "in order"
  "Keep your finances in order to prepare for retirement.",
  "Everything is in order for the launch.",
  "The board gives approval to proceed with the plan.",              // infinitival "to"
  "He gave approval to launch the product.",
  "The store closes at the end of the day.",                         // literal temporal
  "We count the cash at the end of the day.",
  "The system was down for a period of time.",                       // "for time"
  "Firefighters were able to rescue the family from the roof.",      // accomplishment, not ability
  "After hours of trying, she was able to open the safe.",
  "There is no doubt that remains in my mind about his guilt.",      // relative "that"
  // Withdrawn deliberately, not by accident: dropping "there is no doubt that" flattens
  // emphasis, which docs/GRAMMARLY-BEHAVIOUR.md §3 records as a difference from
  // Grammarly the project keeps, and which src/safety.mjs refuses from the model. The
  // rule tier emitting it meant the writer saw the suggestion only when the
  // deterministic pass happened to fire.
  "There is no doubt that the fix works.",
  "It is worth noting that point again before we move on.",
  "It should be noted that iPhone sales fell.",                      // case-sensitive name
];

for (const sentence of MUST_NOT_TOUCH) {
  test(`review-pinned, untouched: ${sentence}`, () => {
    assert.equal(applyClarityRules(sentence), null, JSON.stringify(applyClarityRules(sentence)));
  });
}

const MUST_STILL_WORK = [
  // The safe slices of the narrowed rules keep working.
  ["The committee puts forward a proposal for reform every year.", "The committee proposes reform every year."],
  ["We tested in order to ship.", "We tested to ship."],
  ["In order to ship, we tested.", "To ship, we tested."],
  ["The board gave approval to the plan.", "The board approved the plan."],
  ["The majority of requests succeed.", "Most requests succeed."],
  ["The majority of the students passed.", "Most of the students passed."],
  ["The majority of us agree.", "Most of us agree."],
  ["A large number of the complaints were resolved.", "Many of the complaints were resolved."],
  ["The job ran for a period of two weeks.", "The job ran for two weeks."],
  ["She is able to reproduce it.", "She can reproduce it."],
  ["It should be noted that the cache is cold.", "The cache is cold."],
];

for (const [source, expected] of MUST_STILL_WORK) {
  test(`review-pinned, still works: ${source}`, () => {
    assert.equal(applyClarityRules(source)?.replacement, expected);
  });
}
