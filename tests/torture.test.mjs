// bench/corpus/torture.json through the FULL pipeline policy, which is what a writer
// actually meets: validateRewrite, then the deletion policy, then the verifier.
//
// The verifier here always answers "still implied" — the most permissive setting the
// product ships. A pair this file records as refused is therefore refused
// deterministically, whatever a real 2B would say; a pair recorded as surfaced reaches
// the writer under every configuration that is more cautious than this one, too.
//
// Fifteen of the sixty-seven must SURFACE. Without them the corpus could be satisfied by
// a gate that refuses everything, which is the failure mode a meaning-preservation suite
// is most likely to drift into.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeSentence } from "../src/pipeline.mjs";
import { REJECTION_REASONS } from "../src/safety.mjs";

const corpus = JSON.parse(
  await readFile(new URL("../bench/corpus/torture.json", import.meta.url), "utf8"),
);

// Everything else a refusal can be called: the pipeline's own policy verdicts, which are
// not validator reasons and so are not in REJECTION_REASONS.
const PIPELINE_REASONS = new Set([
  ...REJECTION_REASONS, "verifier-hidden", "verifier-unavailable", "invisible-edit", "unchanged",
]);

async function outcome(pair) {
  const engine = {
    rewrite: async () => ({ action: "rewrite", replacement: pair.replacement, reason: "shorter", latencyMs: 1 }),
    verify: async () => ({ verdict: "show", reason: "the stub verifier always says yes" }),
  };
  const result = await analyzeSentence(pair.source, {
    engine,
    // The deterministic tiers are off: this corpus is about what the gate does with a
    // model's answer, and a mechanical repair or a fired rule would answer for the
    // sentence before the gate was reached.
    mechanics: false,
    rules: false,
    protectedTerms: pair.protectedTerms ?? [],
  });
  return {
    surfaced: result.replacement === pair.replacement,
    reason: result.rejection ?? result.modelRejection ?? null,
  };
}

test("torture corpus: every pair is well formed", () => {
  assert.ok(corpus.pairs.length >= 55, `${corpus.pairs.length} pairs, expected at least 55`);
  const ids = new Set();
  for (const pair of corpus.pairs) {
    assert.ok(!ids.has(pair.id), `duplicate id ${pair.id}`);
    ids.add(pair.id);
    assert.ok(pair.source && pair.replacement, `${pair.id} needs both sides`);
    assert.notEqual(pair.source, pair.replacement, `${pair.id} is not an edit`);
    assert.ok(["refused", "surfaced"].includes(pair.expect), `${pair.id} has no expected outcome`);
    assert.ok(pair.note, `${pair.id} needs a note saying why`);
    if (pair.expect === "refused") {
      assert.ok(PIPELINE_REASONS.has(pair.reason), `${pair.id} records an unknown reason ${pair.reason}`);
    } else {
      assert.equal(pair.reason, undefined, `${pair.id} surfaces, so it has no reason`);
    }
  }
  assert.equal(corpus.counts.total, corpus.pairs.length);
});

test("torture corpus: the controls still reach the writer", async () => {
  const controls = corpus.pairs.filter((pair) => pair.expect === "surfaced");
  assert.ok(controls.length >= 10, "a refuse-everything gate must not be able to pass this file");
  const lost = [];
  for (const pair of controls) {
    const { surfaced, reason } = await outcome(pair);
    if (!surfaced) lost.push(`${pair.id} [${pair.class}] refused as ${reason}: ${pair.source} -> ${pair.replacement}`);
  }
  assert.deepEqual(lost, [], "these ordinary edits no longer reach the writer");
});

test("torture corpus: every meaning change is still refused", async () => {
  const escaped = [];
  for (const pair of corpus.pairs.filter((row) => row.expect === "refused")) {
    const { surfaced } = await outcome(pair);
    if (surfaced) escaped.push(`${pair.id} [${pair.class}]: ${pair.source} -> ${pair.replacement}`);
  }
  assert.deepEqual(escaped, [], "these meaning changes now reach the writer");
});

test("torture corpus: refusals are reported under the recorded reason", async () => {
  // A relabelling is not a regression, but it must be seen and agreed with rather than
  // discovered later in a ledger: (e) existed because a right refusal carried the wrong
  // name for months.
  const relabelled = [];
  for (const pair of corpus.pairs.filter((row) => row.expect === "refused")) {
    const { surfaced, reason } = await outcome(pair);
    if (!surfaced && reason !== pair.reason) relabelled.push(`${pair.id}: ${pair.reason} -> ${reason}`);
  }
  assert.deepEqual(relabelled, [], "update bench/corpus/torture.json if these are right");
});
