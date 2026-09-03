// The bounded lookbehind in isAbbreviation.
//
// The original read `text.slice(0, index)` and ran an end-anchored regex over the entire
// document prefix at every terminator — accidentally quadratic, measured at 2.85 s of a
// 3.1 s per-keystroke sync on a 40k-word note. The window is sound because the longest
// entry in ABBREVIATIONS is 6 characters: any letter-run longer than the window can be
// neither an abbreviation nor a single initial, so truncating it changes no decision.
// The fuzz at the bottom compares against a reference copy of the original algorithm so
// the byte-identical claim stays pinned, not just asserted once.

import test from "node:test";
import assert from "node:assert/strict";
import { segmentSentences } from "../src/segmenter.mjs";

test("a letter run longer than the window still ends a sentence", () => {
  const text = "He studied antidisestablishmentarianism. It took years.";
  assert.equal(segmentSentences(text).length, 2);
});

test("a letter run exactly the window width still ends a sentence", () => {
  // "collaborate" + context — 12 letters before the period.
  const text = "They metacollabor. Next one starts.";
  const twelve = "abcdefghijkl";
  assert.equal(twelve.length, 12);
  assert.equal(segmentSentences(`Word ${twelve}. Next.`).length, 2, text);
});

test("abbreviations near the window boundary still hold the sentence together", () => {
  for (const text of [
    "See approx. five items in the list.",     // longest abbreviation in the set
    "He has a Ph.D. in chemistry today.",
    "Ask Dr. Smith about it tomorrow.",
    "Tolkien signed as J. R. R. Tolkien always.",
    "The meeting is at 9 a.m. sharp as agreed.",
  ]) {
    assert.equal(segmentSentences(text).length, 1, text);
  }
});

test("an abbreviation inside the first window-width of the document", () => {
  assert.equal(segmentSentences("Dr. Smith arrived.").length, 1);
  assert.equal(segmentSentences("E.g. the first case.").length, 1);
});

// --- Reference fuzz: the original, unbounded algorithm, copied verbatim. ---

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "rev", "hon",
  "inc", "ltd", "co", "corp", "dept", "est", "fig", "no", "vol", "ed", "eds",
  "al", "etc", "vs", "approx", "min", "max", "ca", "cf", "ibid", "op",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "a.m", "p.m", "e.g", "i.e", "u.s", "u.k", "ph.d", "d.c",
]);
const TERMINATORS = /[.!?…]/u;
const CLOSERS = /["'’”)\]}]/u;

function refIsInsideToken(text, index) {
  const before = text[index - 1];
  const after = text[index + 1];
  if (!before || !after) return false;
  if (/\d/u.test(before) && /\d/u.test(after)) return true;
  if (/[\w/\\-]/u.test(before) && /[\w/\\-]/u.test(after)) return true;
  return false;
}

function refIsAbbreviation(text, index) {
  if (text[index] !== ".") return false;
  const head = text.slice(0, index);
  const word = head.match(/[\p{L}.]+$/u)?.[0];
  if (!word) return false;
  if (ABBREVIATIONS.has(word.toLowerCase())) return true;
  return /^\p{Lu}$/u.test(word);
}

function refSegmentSentences(text) {
  const segments = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!TERMINATORS.test(char)) continue;
    if (refIsInsideToken(text, index) || refIsAbbreviation(text, index)) continue;
    let end = index + 1;
    while (end < text.length && TERMINATORS.test(text[end])) end += 1;
    while (end < text.length && CLOSERS.test(text[end])) end += 1;
    while (end < text.length && /[ \t]/u.test(text[end])) end += 1;
    if (end < text.length && text[end] === "\n") end += 1;
    segments.push({ text: text.slice(start, end), start, end });
    start = end;
    index = end - 1;
  }
  if (start < text.length) {
    segments.push({ text: text.slice(start), start, end: text.length });
  }
  return segments.filter((segment) => segment.text.trim().length > 0);
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

test("fuzz: bounded lookbehind is byte-identical to the unbounded original [seed 0x5E6, 400 docs]", () => {
  const rnd = mulberry32(0x5e6);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const PIECES = [
    "The archive is copied weekly", "Dr", "Mr", "approx", "e.g", "i.e", "Ph.D", "a.m",
    "J", "R", "Tolkien wrote it", "pi is 3.14", "open report.csv", "see /srv/a.log",
    "antidisestablishmentarianism", "supercalifragilisticexpialidocious",
    "OK", "wait", "he said “stop”", "it cost $4.50", "v2.1 shipped", "IT WORKS",
  ];
  const JOINERS = [". ", "? ", "! ", "… ", ".\n", " ", ", ", ".” ", ".) ", "... ", ".. "];
  for (let doc = 0; doc < 400; doc += 1) {
    let text = "";
    const parts = 2 + Math.floor(rnd() * 20);
    for (let i = 0; i < parts; i += 1) text += pick(PIECES) + pick(JOINERS);
    assert.deepEqual(segmentSentences(text), refSegmentSentences(text), JSON.stringify(text));
  }
});
