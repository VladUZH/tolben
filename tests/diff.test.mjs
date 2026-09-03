import test from "node:test";
import assert from "node:assert/strict";
import { diffWords, changedSourceRanges, inlineDiffParts } from "../src/diff.mjs";

test("marks only the words that change", () => {
  const source = "The panel came to the conclusion that the request should be denied.";
  const target = "The panel concluded that the request should be denied.";
  const ranges = changedSourceRanges(source, target);
  const marked = ranges.map((range) => source.slice(range.start, range.end));
  assert.deepEqual(marked, ["came to the conclusion"]);
});

test("an insertion anchors to a neighbouring word rather than vanishing", () => {
  const source = "Guidance, navigation and control data were reviewed.";
  const target = "Guidance, navigation, and control data were reviewed.";
  const ranges = changedSourceRanges(source, target);
  assert.ok(ranges.length >= 1);
  for (const range of ranges) assert.ok(range.end > range.start);
});

test("identical text produces no marks", () => {
  assert.deepEqual(changedSourceRanges("The launch begins tomorrow.", "The launch begins tomorrow."), []);
});

test("inline parts keep deletions and insertions in reading order", () => {
  const parts = inlineDiffParts("We made a decision to wait.", "We decided to wait.");
  assert.deepEqual(parts.map((part) => part.text), ["We", "made", "a", "decision", "decided", "to", "wait", "."]);
  assert.deepEqual(
    parts.filter((part) => part.type !== "equal").map((part) => [part.type, part.text]),
    [["delete", "made"], ["delete", "a"], ["delete", "decision"], ["insert", "decided"]],
  );
});

test("ranges stay inside the source string", () => {
  const source = "The report was finalised at a later point in time.";
  for (const range of changedSourceRanges(source, "The report was finalised later.")) {
    assert.ok(range.start >= 0 && range.end <= source.length);
  }
});
