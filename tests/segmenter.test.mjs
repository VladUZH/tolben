import test from "node:test";
import assert from "node:assert/strict";
import { segmentSentences, isCompleteSentence, trimSegment } from "../src/segmenter.mjs";

test("splits on terminal punctuation and keeps offsets exact", () => {
  const text = "The launch begins tomorrow. It ends Friday!";
  const segments = segmentSentences(text);
  assert.equal(segments.length, 2);
  for (const segment of segments) {
    assert.equal(text.slice(segment.start, segment.end), segment.text);
  }
  assert.equal(trimSegment(segments[0]).text, "The launch begins tomorrow.");
});

test("does not split decimals, file names, or paths", () => {
  for (const text of ["Pi is 3.14 exactly.", "Open report.csv now.", "Read /srv/logs/a.log first."]) {
    assert.equal(segmentSentences(text).length, 1, text);
  }
});

test("does not split common abbreviations or initials", () => {
  assert.equal(segmentSentences("Dr. Vance signed it.").length, 1);
  assert.equal(segmentSentences("See Fig. 4 for detail.").length, 1);
  assert.equal(segmentSentences("J. R. R. Tolkien wrote it.").length, 1);
});

test("recognises completion only after real terminal punctuation", () => {
  assert.equal(isCompleteSentence("The job failed."), true);
  assert.equal(isCompleteSentence('He said "go now."'), true);
  assert.equal(isCompleteSentence("The job failed"), false);
  assert.equal(isCompleteSentence("We met Dr."), false);
  assert.equal(isCompleteSentence("Is it ready?"), true);
});

test("absorbs closing quotes and following whitespace into the sentence", () => {
  const text = 'She said "stop."  Then she left.';
  const segments = segmentSentences(text);
  assert.equal(segments.length, 2);
  assert.equal(trimSegment(segments[1]).text, "Then she left.");
});
