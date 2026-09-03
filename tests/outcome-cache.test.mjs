// The persistent outcome cache: a model answer, once paid for, is never paid for again —
// across sessions. Keyed by a fingerprint of everything that could change the answer
// (model, prompts, settings) plus the sentence itself; a fingerprint mismatch drops the
// whole cache rather than serving answers a different configuration produced.

import test from "node:test";
import assert from "node:assert/strict";
import { createOutcomeCache, outcomeKey } from "../obsidian-plugin/outcome-cache.mjs";

const OUTCOME = {
  replacement: "The archive is copied weekly.",
  reason: "Shortens it.",
  stages: { mechanics: false, rule: false, model: true },
};

test("round trip: set, get, serialize, restore", () => {
  const cache = createOutcomeCache({ fingerprint: "fp1", max: 10 });
  const key = outcomeKey("The archive is copied on a weekly basis.", []);
  cache.set(key, OUTCOME);
  assert.deepEqual(cache.get(key), OUTCOME);

  const restored = createOutcomeCache({ fingerprint: "fp1", max: 10, serialized: cache.serialize() });
  assert.deepEqual(restored.get(key), OUTCOME);
});

test("a fingerprint mismatch drops everything", () => {
  const cache = createOutcomeCache({ fingerprint: "fp1", max: 10 });
  cache.set(outcomeKey("Sentence one.", []), OUTCOME);
  const restored = createOutcomeCache({ fingerprint: "fp2", max: 10, serialized: cache.serialize() });
  assert.equal(restored.get(outcomeKey("Sentence one.", [])), undefined);
  assert.equal(restored.size, 0);
});

test("keys separate by protected terms, not only by text", () => {
  const plain = outcomeKey("Run npm test now.", []);
  const protectedKey = outcomeKey("Run npm test now.", ["npm test"]);
  assert.notEqual(plain, protectedKey);
});

test("least recently used entries are evicted first", () => {
  let now = 0;
  const cache = createOutcomeCache({ fingerprint: "fp", max: 3, now: () => now++ });
  for (const s of ["a", "b", "c"]) cache.set(outcomeKey(s, []), OUTCOME);
  cache.get(outcomeKey("a", []));       // refresh "a"
  cache.set(outcomeKey("d", []), OUTCOME);   // evicts "b", the stalest
  assert.equal(cache.size, 3);
  assert.ok(cache.get(outcomeKey("a", [])));
  assert.equal(cache.get(outcomeKey("b", [])), undefined);
  assert.ok(cache.get(outcomeKey("d", [])));
});

test("serialization survives corrupt input by starting fresh", () => {
  for (const garbage of ["not json", '{"fingerprint":"fp"}', '[]', '{"fingerprint":"fp","entries":"nope"}']) {
    const cache = createOutcomeCache({ fingerprint: "fp", max: 5, serialized: garbage });
    assert.equal(cache.size, 0, JSON.stringify(garbage));
  }
});

test("null outcomes (a clean sentence) are cached and distinguishable from misses", () => {
  const cache = createOutcomeCache({ fingerprint: "fp", max: 5 });
  const key = outcomeKey("Perfectly clear already.", []);
  cache.set(key, { replacement: null, reason: null, stages: { mechanics: false, rule: false, model: true } });
  const hit = cache.get(key);
  assert.notEqual(hit, undefined, "a cached keep must be a hit");
  assert.equal(hit.replacement, null);
  assert.equal(cache.get(outcomeKey("Never seen.", [])), undefined);
});
