// The indexed pass 1 of reconcileSentences.
//
// The original scanned every previous sentence for every current sentence — O(n*m),
// measured at 1.8 s for 8,000 sentences and the second-largest per-keystroke cost after
// the segmenter. The index must not change a single decision: same nearest-by-offset
// tie-breaks, same `changed` flags, same duplicate-orphan demotion. The fuzz compares
// against a verbatim copy of the original algorithm.

import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSentences, resetIds } from "../src/identity.mjs";
import { segmentSentences, trimSegment, isCompleteSentence } from "../src/segmenter.mjs";

// --- Reference: the original pass 1, scan-all-of-previous, copied verbatim. ---
// Passes 2 and 3 are shared shape; the whole function is copied so the comparison stays
// honest if the phases ever interact.

let refNextId = 1;
function refReconcile(previous, text) {
  const current = segmentSentences(text).map((segment) => {
    const trimmed = trimSegment(segment);
    return { ...trimmed, complete: isCompleteSentence(trimmed.text) };
  });
  const used = new Set();
  const matched = new Map();
  const assigned = current.map((segment) => ({ ...segment, id: null, changed: true }));
  for (const [index, segment] of assigned.entries()) {
    let best = null;
    for (const candidate of previous) {
      if (used.has(candidate.id) || candidate.text !== segment.text) continue;
      const distance = Math.abs((candidate.start ?? 0) - (segment.start ?? 0));
      if (best === null || distance < best.distance) best = { candidate, distance };
    }
    if (best === null) continue;
    used.add(best.candidate.id);
    matched.set(index, best.candidate);
    assigned[index].id = best.candidate.id;
    assigned[index].changed = false;
  }
  for (const [index, segment] of assigned.entries()) {
    if (segment.id !== null) continue;
    const candidate = previous[index];
    if (candidate && !used.has(candidate.id)) {
      used.add(candidate.id);
      segment.id = candidate.id;
    }
  }
  const duplicated = new Set();
  const orphaned = new Set();
  const seen = new Set();
  for (const candidate of previous) {
    if (seen.has(candidate.text)) duplicated.add(candidate.text);
    seen.add(candidate.text);
    if (!used.has(candidate.id)) orphaned.add(candidate.text);
  }
  for (const [index, candidate] of matched) {
    if (!duplicated.has(candidate.text) || !orphaned.has(candidate.text)) continue;
    used.delete(candidate.id);
    assigned[index].id = null;
    assigned[index].changed = true;
  }
  for (const segment of assigned) {
    if (segment.id === null) segment.id = `r${refNextId++}`;
  }
  return assigned;
}

// Ids assigned to NEW sentences differ between the two implementations (separate
// counters); identity of every MATCHED sentence and every flag must not.
function comparable(result) {
  return result.map((s) => ({
    text: s.text, start: s.start, end: s.end, complete: s.complete,
    changed: s.changed,
    id: s.changed ? "(new)" : s.id,
  }));
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("duplicate tie-break: editing one of a pair keeps the other's identity", () => {
  resetIds();
  const doc = "The cat sat here. The cat sat here. A third sentence closes.\n";
  const first = reconcileSentences([], doc);
  const edited = "The cat sat here. The cat sat differently. A third sentence closes.\n";
  const second = reconcileSentences(first, edited);
  // The untouched first copy keeps its id by nearest-offset; the edited one changes.
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, false);
  assert.equal(second[1].changed, true);
});

test("a deleted duplicate demotes the survivors rather than guessing", () => {
  resetIds();
  const doc = "Same sentence here. Same sentence here. Same sentence here.\n";
  const first = reconcileSentences([], doc);
  const second = reconcileSentences(first, "Same sentence here. Same sentence here.\n");
  for (const sentence of second) assert.equal(sentence.changed, true);
});

test("fuzz: indexed pass 1 decides identically to the scan-all original [seed 0x1DE, 300 rounds]", () => {
  const rnd = mulberry32(0x1de);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const BANK = [
    "The archive is copied weekly.", "The tool recovers files.", "A third sentence closes.",
    "Same sentence here.", "Same sentence here.", "Numbers hold 3.14 steady.",
    "Dr. Smith arrived early.", "It works!", "Does it work?",
  ];
  for (let round = 0; round < 300; round += 1) {
    const count = 1 + Math.floor(rnd() * 12);
    const before = Array.from({ length: count }, () => pick(BANK)).join(" ") + "\n";
    // Mutate: drop, duplicate, edit, or append a sentence.
    const parts = before.trim().split(/(?<=[.!?])\s+/u);
    const op = rnd();
    if (op < 0.25 && parts.length > 1) parts.splice(Math.floor(rnd() * parts.length), 1);
    else if (op < 0.5) parts.splice(Math.floor(rnd() * parts.length), 0, pick(BANK));
    else if (op < 0.75) parts[Math.floor(rnd() * parts.length)] += " Edited";
    else parts.push(pick(BANK));
    const after = parts.join(" ") + "\n";

    resetIds();
    const livePrev = reconcileSentences([], before);
    const live = reconcileSentences(livePrev, after);
    refNextId = 1;
    const refPrev = refReconcile([], before);
    // Reference previous must share ids with live previous for the comparison to mean
    // anything: rebuild it from live's output.
    const ref = refReconcile(livePrev.map((s) => ({ ...s })), after);
    assert.deepEqual(comparable(live), comparable(ref), `round ${round}: ${before} -> ${after}`);
    assert.ok(refPrev.length > 0);
  }
});
