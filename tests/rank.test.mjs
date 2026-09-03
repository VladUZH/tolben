// The scheduling rank: which sentence gets the model's single slot next.
//
// Two keys, visibility first. Position: on screen, then below (readers scroll down),
// then above. Within each position, sentences the clarity gate fires on come before
// sentences it clears — in balanced mode a cleared sentence is checked LAST, not never.
// Skipping cleared sentences outright (fast mode) silenced the model's whole grammar
// band: on a real page, six of eight suggestions were grammar-shaped ("cat and dog
// runs", "did you have"), which carry none of the gate's clarity constructions.

import test from "node:test";
import assert from "node:assert/strict";
import { sentenceRank } from "../obsidian-plugin/rank.mjs";

const visible = { from: 1000, to: 2000 };
const at = (start, text) => ({ start, end: start + 40, text });

const WORDY = "The archive is copied on a weekly basis."; // gate fires
const PLAIN = "The cat and dog runs over a bench.";       // gate clears

test("position order: visible, then below, then above", () => {
  const v = sentenceRank(at(1500, WORDY), visible, true);
  const below = sentenceRank(at(2500, WORDY), visible, true);
  const above = sentenceRank(at(100, WORDY), visible, true);
  assert.ok(v < below && below < above);
});

test("within a position, gate-firing sentences come first — but never jump a position", () => {
  const ranks = [
    sentenceRank(at(1500, WORDY), visible, true),  // visible, fires
    sentenceRank(at(1500, PLAIN), visible, true),  // visible, cleared
    sentenceRank(at(2500, WORDY), visible, true),  // below, fires
    sentenceRank(at(2500, PLAIN), visible, true),  // below, cleared
    sentenceRank(at(100, WORDY), visible, true),   // above, fires
    sentenceRank(at(100, PLAIN), visible, true),   // above, cleared
  ];
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, "expected strict uv < gv < ub < gb < ua < ga");
});

test("reading order still decides among equals", () => {
  const first = sentenceRank(at(1100, PLAIN), visible, true);
  const second = sentenceRank(at(1600, PLAIN), visible, true);
  assert.ok(first < second);
});

test("with the gate off, cleared and firing sentences rank identically by position", () => {
  assert.equal(
    sentenceRank(at(1500, PLAIN), visible, false),
    sentenceRank(at(1500, WORDY), visible, false),
  );
});
