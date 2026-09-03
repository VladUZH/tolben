// The clarity gate: decides in microseconds whether a sentence is worth a model call.
//
// The patterns were mined from bench/corpus/grammarly-pairs.json — 200 pairs harvested
// live from Grammarly's editor — and their operating point was measured and then
// independently re-derived: fires on 88.1% of Grammarly's actual rewrites, 12.2% on
// sentences Grammarly left unchanged, ~5.6µs per sentence. The corpus tests below pin
// that operating point with a safety margin, so a pattern edit that quietly degrades
// coverage or floods the model with clean prose fails here first.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkGate } from "../src/gate.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";

const FIRING = [
  ["For the purpose of testing, we created a staging environment.", "wordy-phrase"],
  ["The archive is copied on a weekly basis.", "wordy-phrase"],
  ["The tool has the ability to recover files.", "wordy-phrase"],
  ["There are three bolts that require replacement.", "expletive"],
  ["It is important to note that the deadline moved.", "wordy-phrase"],
  ["The draft was reviewed by the committee.", "passive-by-agent"],
  ["We conducted a review of the draft.", "nominalisation"],
  ["Please revert back to the previous version.", "redundant-pair"],
  ["The report, which is attached, covers March.", "relative-bloat"],
  ["Would it be possible for you to send the file?", "question-bloat"],
];

for (const [sentence, family] of FIRING) {
  test(`fires (${family}): ${sentence}`, () => {
    const hit = checkGate(sentence);
    assert.ok(hit, "expected the gate to fire");
    assert.equal(hit.family, family);
  });
}

const CLEAN = [
  "The archive is copied weekly.",
  "The tool can recover files.",
  "Three bolts require replacement.",
  "We reviewed the draft.",
  "The committee reviewed the draft.",
  "Send the file by Friday.",
  "The workshop starts on Wednesday.",
  "Costs rose 5% in March.",
];

for (const sentence of CLEAN) {
  test(`stays quiet: ${sentence}`, () => {
    assert.equal(checkGate(sentence), null);
  });
}

// --- The measured operating point, pinned against the committed corpus. ---

const corpus = JSON.parse(await readFile(new URL("../bench/corpus/grammarly-pairs.json", import.meta.url), "utf8"));

test("corpus: the gate keeps at least 85% of Grammarly's real rewrites", () => {
  const changed = corpus.pairs.filter((pair) => pair.changed);
  const kept = changed.filter((pair) => checkGate(pair.original) !== null);
  const coverage = kept.length / changed.length;
  assert.ok(changed.length >= 100, "corpus shrank unexpectedly");
  assert.ok(coverage >= 0.85, `coverage ${(coverage * 100).toFixed(1)}% — a suggestion Grammarly would make now skips the model`);
});

test("corpus: the gate fires on at most 16% of sentences Grammarly left alone", () => {
  const unchanged = corpus.pairs.filter((pair) => !pair.changed);
  const fired = unchanged.filter((pair) => checkGate(pair.original) !== null);
  const rate = fired.length / unchanged.length;
  assert.ok(unchanged.length >= 50, "corpus shrank unexpectedly");
  assert.ok(rate <= 0.16, `false-fire rate ${(rate * 100).toFixed(1)}% — clean prose is flooding the model`);
});

// --- Pipeline integration: an unfired gate means the model is never consulted. ---

function countingEngine() {
  let calls = 0;
  return {
    engine: {
      rewrite: async (sentence) => {
        calls += 1;
        return { action: "rewrite", replacement: sentence.replace("on a weekly basis", "weekly"), reason: "Shorter." };
      },
    },
    count: () => calls,
  };
}

test("gate on + clean sentence: mechanics still run, the model does not", async () => {
  const { engine, count } = countingEngine();
  const result = await analyzeSentence("The workshop starts on wednesday.", { engine, gate: true });
  assert.equal(count(), 0, "the model was consulted for a sentence the gate cleared");
  assert.equal(result.gated, true);
  assert.equal(result.replacement, "The workshop starts on Wednesday.", "the mechanical repair was lost");
  assert.equal(result.rejection, null, "a gated sentence was not refused; nothing was judged");
});

test("gate on + firing sentence: the model is consulted as before", async () => {
  const { engine, count } = countingEngine();
  const result = await analyzeSentence("The archive is copied on a weekly basis.", { engine, gate: true });
  assert.equal(count(), 1);
  assert.equal(result.gated, false);
  assert.equal(result.replacement, "The archive is copied weekly.");
});

test("gate off (the default): every sentence reaches the model", async () => {
  const { engine, count } = countingEngine();
  await analyzeSentence("The workshop starts on Wednesday.", { engine });
  assert.equal(count(), 1);
});
