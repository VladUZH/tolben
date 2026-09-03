// Text-shape robustness of the deterministic layer.
//
// Every writer's document eventually contains a smart quote, an emoji, a non-breaking
// space pasted out of a spreadsheet, or a sentence four lines long. None of that is
// exotic input; it is Tuesday. These tests pin what the segmenter, the diff, the
// mechanical pass, the explanation, the safety gates, and sentence identity actually do
// with such text, so that any change to that behaviour is visible rather than silent.
//
// Where the current behaviour is a defensible limitation it is pinned with a passing
// test and a `// LIMITATION:` note. Where it is a defect it is recorded as a
// `KNOWN-GAP` todo, which runs and reports without failing the suite. Nothing in src/
// is edited from here.

import test from "node:test";
import assert from "node:assert/strict";

import { segmentSentences, isCompleteSentence, trimSegment } from "../src/segmenter.mjs";
import { changedSourceRanges, diffWords, tokenize } from "../src/diff.mjs";
import { explainEdit } from "../src/explain.mjs";
import { repairMechanics } from "../src/mechanics.mjs";
import { validateRewrite, lostContentWords } from "../src/safety.mjs";
import { reconcileSentences, resetIds } from "../src/identity.mjs";
import { createStore } from "../src/store.mjs";

// Invisible characters are spelled out. A literal non-breaking space in a test file is
// indistinguishable from a bug.
const NBSP = " ";          // no-break space
const NNBSP = " ";         // narrow no-break space
const ZWJ = "‍";           // zero-width joiner
const RLE = "‫";           // right-to-left embedding
const PDF = "‬";           // pop directional formatting
const ACUTE = "́";         // combining acute accent
const ROCKET = "\u{1F680}";
const PARTY = "\u{1F389}";
const CODER = `\u{1F469}${ZWJ}\u{1F4BB}`;   // woman technologist, a ZWJ sequence
const FLAG_DE = "\u{1F1E9}\u{1F1EA}";       // regional indicator pair
const CAFE_NFC = "Café";
const CAFE_NFD = `Cafe${ACUTE}`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Segments the text and asserts the two offset invariants the whole UI rests on before
// comparing the sentence texts: raw and trimmed offsets must both slice back exactly.
function assertSentences(text, expected, message = "") {
  const raw = segmentSentences(text);
  for (const segment of raw) {
    assert.equal(text.slice(segment.start, segment.end), segment.text, `raw offsets ${message}`);
  }
  const parts = raw.map(trimSegment);
  for (const part of parts) {
    assert.equal(text.slice(part.start, part.end), part.text, `trimmed offsets ${message}`);
  }
  assert.deepEqual(parts.map((part) => part.text), expected, message);
  return parts;
}

// Explanations quote spans taken verbatim out of one of the two sentences. Anything
// between the curly quotes must therefore be findable in the source or the replacement.
const QUOTED = /“([^”]*)”/gu;
const quotedSpans = (explanation) => [...explanation.matchAll(QUOTED)].map((match) => match[1]);

// The cross-module contract for one plausible rewrite: the safety gate, the underline
// ranges, and the explanation all have to agree, and none of them may leave the source.
function assertRewriteConsistent(source, target, expected = {}) {
  const { accepted = true, reason = "accepted", marked, explanation } = expected;

  const validation = validateRewrite(source, { action: "rewrite", replacement: target, reason: "shorter" });
  assert.equal(validation.accepted, accepted, `accepted for ${JSON.stringify(source)}`);
  assert.equal(validation.reason, reason, `reason for ${JSON.stringify(source)}`);

  const ranges = changedSourceRanges(source, target);
  for (const range of ranges) {
    assert.ok(range.start >= 0, `range start in bounds for ${JSON.stringify(source)}`);
    assert.ok(range.end <= source.length, `range end in bounds for ${JSON.stringify(source)}`);
    assert.ok(range.end > range.start, `range non-empty for ${JSON.stringify(source)}`);
  }
  if (marked !== undefined) {
    assert.deepEqual(ranges.map((range) => source.slice(range.start, range.end)), marked);
  }

  const derived = explainEdit(source, target);
  for (const span of quotedSpans(derived)) {
    assert.ok(
      source.includes(span) || target.includes(span),
      `explanation quotes ${JSON.stringify(span)} verbatim for ${JSON.stringify(source)}`,
    );
  }
  if (explanation !== undefined) assert.equal(derived, explanation);
  return { validation, ranges, derived };
}

// ---------------------------------------------------------------------------
// UNICODE — segmentation
// ---------------------------------------------------------------------------

test("unicode: smart quotes, apostrophes, and dashes segment like their ASCII forms", () => {
  const cases = [
    ["“Stop now,” she said. Then she left.", ["“Stop now,” she said.", "Then she left."]],
    ["He called it ‘done’. We moved on.", ["He called it ‘done’.", "We moved on."]],
    ["Don’t ship it. We aren’t ready.", ["Don’t ship it.", "We aren’t ready."]],
    ["Don't ship it. We aren't ready.", ["Don't ship it.", "We aren't ready."]],
    ["The plan — which we wrote — works. It ships today.", ["The plan — which we wrote — works.", "It ships today."]],
    ["Pages 3–12 are wrong. Fix them.", ["Pages 3–12 are wrong.", "Fix them."]],
    ["«Bonjour», dit-il. Puis il partit.", ["«Bonjour», dit-il.", "Puis il partit."]],
  ];
  for (const [text, expected] of cases) assertSentences(text, expected, text);
});

test("unicode: the curly apostrophe is part of the word, not a closing quote", () => {
  // The token pattern admits ['’] inside a word, so a contraction stays one token in
  // both spellings and the two spellings tokenize identically.
  assert.deepEqual(
    tokenize("Don’t ship").filter((token) => !token.space).map((token) => token.text),
    ["Don’t", "ship"],
  );
  assert.deepEqual(
    tokenize("Don't ship").filter((token) => !token.space).map((token) => token.text),
    ["Don't", "ship"],
  );
});

test("unicode: an ellipsis ends a sentence, in either spelling", () => {
  // LIMITATION: a mid-thought ellipsis is read as a terminator, so "He paused… then
  // spoke." becomes two sentences. Both the single character and the three dots behave
  // the same way, which is the property worth keeping: the two spellings never diverge.
  assertSentences("He paused… then spoke. She left.", ["He paused…", "then spoke.", "She left."]);
  assertSentences("He paused... then spoke. She left.", ["He paused...", "then spoke.", "She left."]);
  assert.equal(isCompleteSentence("He paused…"), true);
  assert.equal(isCompleteSentence("He paused..."), true);
});

test("unicode: NBSP and narrow NBSP inside a sentence do not split it", () => {
  assertSentences(`The team${NBSP}shipped it. It works.`, [`The team${NBSP}shipped it.`, "It works."]);
  assertSentences(`It costs 3${NNBSP}000 euros. That is fine.`, [`It costs 3${NNBSP}000 euros.`, "That is fine."]);
});

test("unicode: a no-break space between sentences is trimmed away, not absorbed", () => {
  // LIMITATION: only ASCII space and tab are absorbed as a sentence's trailing run, so
  // an NBSP separator lands at the head of the next segment. trimSegment removes it and
  // the offsets stay exact, which is what the editor actually needs.
  const text = `First one.${NBSP}Second one.${NNBSP}Third one.`;
  const parts = assertSentences(text, ["First one.", "Second one.", "Third one."]);
  assert.deepEqual(parts.map((part) => [part.start, part.end]), [[0, 10], [11, 22], [23, 33]]);
});

test("unicode: composed and decomposed accents both segment, at their own lengths", () => {
  const composed = `${CAFE_NFC} opened today. It is busy.`;
  const decomposed = `${CAFE_NFD} opened today. It is busy.`;
  const a = assertSentences(composed, [`${CAFE_NFC} opened today.`, "It is busy."]);
  const b = assertSentences(decomposed, [`${CAFE_NFD} opened today.`, "It is busy."]);
  // LIMITATION: no normalisation happens anywhere, so the decomposed form is one UTF-16
  // unit longer and the two are different strings to every module downstream.
  assert.equal(a[0].end, 18);
  assert.equal(b[0].end, 19);
  assert.notEqual(a[0].text, b[0].text);
});

test("unicode: emoji mid-sentence and sentence-final keep offsets exact", () => {
  const cases = [
    [`The build ${ROCKET} shipped today. It works.`, [`The build ${ROCKET} shipped today.`, "It works."]],
    [`The build shipped today ${ROCKET}. It works.`, [`The build shipped today ${ROCKET}.`, "It works."]],
    [`The team ${CODER} shipped it. Done.`, [`The team ${CODER} shipped it.`, "Done."]],
    [`We launched in ${FLAG_DE} today. Done.`, [`We launched in ${FLAG_DE} today.`, "Done."]],
    [`Wow. ${ROCKET} Great.`, ["Wow.", `${ROCKET} Great.`]],
    [`${ROCKET}. Great.`, [`${ROCKET}.`, "Great."]],
  ];
  for (const [text, expected] of cases) assertSentences(text, expected, text);
});

test("unicode: a lone emoji is a segment but not a complete sentence", () => {
  assertSentences(ROCKET, [ROCKET]);
  assert.equal(isCompleteSentence(ROCKET), false);
  assert.equal(isCompleteSentence(`${ROCKET}.`), true);
});

test("unicode: a ZWJ sequence and a flag are never split by the segmenter", () => {
  // The segmenter walks UTF-16 units, so the guarantee worth pinning is that no
  // surrogate half and no joiner ever lands on a segment boundary.
  const text = `The team ${CODER} shipped it in ${FLAG_DE}. Done.`;
  for (const segment of segmentSentences(text)) {
    assert.ok(!/[\uD800-\uDBFF]$/u.test(segment.text), "segment does not end on a high surrogate");
    assert.ok(!/^[\uDC00-\uDFFF]/u.test(segment.text), "segment does not start on a low surrogate");
    assert.equal(segment.text.includes(CODER) || !segment.text.includes(ZWJ), true);
  }
});

test("unicode: Cyrillic sentences segment on Latin terminators", () => {
  assertSentences("Мы запустили проект. Он работает!", [
    "Мы запустили проект.",
    "Он работает!",
  ]);
});

test("unicode: CJK terminators are not recognised, so a CJK paragraph is one sentence", () => {
  // LIMITATION: TERMINATORS is /[.!?…]/ and does not include the ideographic full stop
  // 。, the fullwidth exclamation ！, or the fullwidth question mark ？. A CJK paragraph
  // therefore arrives as a single incomplete segment and is never analysed at all. The
  // failure direction is silence, not a wrong suggestion, which is why it stands.
  const chinese = "我们今天发布了。它很好。";
  assertSentences(chinese, [chinese]);
  assert.equal(isCompleteSentence(chinese), false);

  const japanese = "これはすごい！本当に？";
  assertSentences(japanese, [japanese]);
  assert.equal(isCompleteSentence(japanese), false);

  // The same text punctuated with ASCII stops does segment, which isolates the cause to
  // the terminator set rather than to the script.
  assertSentences("我们今天发布了. 它很好.", [
    "我们今天发布了.",
    "它很好.",
  ]);
});

test("unicode: mixed-script and RTL fragments inside LTR prose segment normally", () => {
  const cases = [
    ["The チーム shipped проект today. It works.",
      ["The チーム shipped проект today.", "It works."]],
    ["The sign read שלום today. It was clear.",
      ["The sign read שלום today.", "It was clear."]],
    ["He wrote مرحبا on the board. We read it.",
      ["He wrote مرحبا on the board.", "We read it."]],
    [`The sign read ${RLE}שלום עולם${PDF} today. It was clear.`,
      [`The sign read ${RLE}שלום עולם${PDF} today.`, "It was clear."]],
  ];
  for (const [text, expected] of cases) assertSentences(text, expected, text);
});

// ---------------------------------------------------------------------------
// STRUCTURE — segmentation
// ---------------------------------------------------------------------------

test("structure: one-word and two-word sentences are complete sentences", () => {
  assertSentences("Stop.", ["Stop."]);
  assertSentences("Stop now.", ["Stop now."]);
  assertSentences("Stop. Go. Wait.", ["Stop.", "Go.", "Wait."]);
  assert.equal(isCompleteSentence("Stop."), true);
});

test("structure: punctuation-only text is a segment and reads as complete", () => {
  for (const [text, complete] of [["...", true], ["…", true], ["?!", true], ["Really??!", true]]) {
    assertSentences(text, [text], text);
    assert.equal(isCompleteSentence(text), complete, text);
  }
  // Whitespace-only text produces nothing at all: there is no sentence to analyse.
  for (const text of ["", "   ", "\t\t", "\r\n", NBSP]) {
    assert.deepEqual(segmentSentences(text), [], JSON.stringify(text));
  }
});

test("structure: nested and unbalanced quotes still split at the right place", () => {
  assertSentences("She said \"he called it 'done' yesterday.\" Then left.", [
    "She said \"he called it 'done' yesterday.\"",
    "Then left.",
  ]);
  assertSentences("She said \"stop now. Then she left.", ["She said \"stop now.", "Then she left."]);
  assertSentences("He said \"stop.\" She left.", ["He said \"stop.\"", "She left."]);
  assertSentences("She said \"stop.\" \"Go,\" he said.", ["She said \"stop.\"", "\"Go,\" he said."]);
});

test("structure: a parenthetical ending in an initial is swallowed whole", () => {
  // LIMITATION: "B." is indistinguishable from a personal initial ("J. R. R. Tolkien"),
  // so the abbreviation guard suppresses the split. On its own the parenthetical is not
  // even a complete sentence, and followed by prose the whole run becomes one segment.
  assertSentences("(See appendix B.)", ["(See appendix B.)"]);
  assert.equal(isCompleteSentence("(See appendix B.)"), false);
  assertSentences("(See appendix B.) The next sentence follows.", [
    "(See appendix B.) The next sentence follows.",
  ]);
  // A digit is not an initial, so the same shape splits correctly.
  assertSentences("(See appendix 4.) The next sentence follows.", [
    "(See appendix 4.)",
    "The next sentence follows.",
  ]);
});

test("structure: inline code and markdown do not split a sentence", () => {
  assertSentences("Call `x = f(a, b)` first. Then run it.", ["Call `x = f(a, b)` first.", "Then run it."]);
  assertSentences("Use **bold** and [link](https://a.b) here. Then stop.", [
    "Use **bold** and [link](https://a.b) here.",
    "Then stop.",
  ]);
  assertSentences("Use [link](https://a.b/x.html) here. Then stop.", [
    "Use [link](https://a.b/x.html) here.",
    "Then stop.",
  ]);
  assertSentences("Open https://a.b/c.html now. Then stop.", ["Open https://a.b/c.html now.", "Then stop."]);
});

test("structure: decimals, versions, clock times, and grouped numbers stay intact", () => {
  const cases = [
    ["Pi is 3.14159 and tau is 6.28. Fine.", ["Pi is 3.14159 and tau is 6.28.", "Fine."]],
    ["Ship v2.4.1-rc1 today. It works.", ["Ship v2.4.1-rc1 today.", "It works."]],
    ["It ran at 14:30:05 exactly. Then stopped.", ["It ran at 14:30:05 exactly.", "Then stopped."]],
    ["Revenue was 1,234,567.89 last year. Good.", ["Revenue was 1,234,567.89 last year.", "Good."]],
  ];
  for (const [text, expected] of cases) assertSentences(text, expected, text);
});

test("structure: an abbreviation at a real sentence end merges the next sentence in", () => {
  // A cluster mid-sentence is handled correctly.
  assertSentences("Use fruit, e.g., apples. Then stop.", ["Use fruit, e.g., apples.", "Then stop."]);
  // LIMITATION: "etc." closing a sentence is still read as an abbreviation, so the
  // following sentence is absorbed. Under-splitting costs a missed suggestion; the
  // alternative, splitting after every "etc.", would cut sentences in half.
  assertSentences("Read the docs, etc. Then stop.", ["Read the docs, etc. Then stop."]);
  assertSentences("Use fruit, e.g., apples, i.e., pomes, etc. Then stop.", [
    "Use fruit, e.g., apples, i.e., pomes, etc. Then stop.",
  ]);
  // A run of bare initials never terminates either.
  assertSentences("A. B. C.", ["A. B. C."]);
  assert.equal(isCompleteSentence("A. B. C."), false);
});

test("structure: doubled and mixed terminal marks are absorbed into one sentence", () => {
  assertSentences("Really?! I doubt it.", ["Really?!", "I doubt it."]);
  assertSentences("Really??! Then stop.", ["Really??!", "Then stop."]);
  assertSentences("Why?! Then stop.", ["Why?!", "Then stop."]);
  assertSentences("He paused... She left.", ["He paused...", "She left."]);
});

test("structure: CRLF, tabs, and whitespace blocks leave offsets exact", () => {
  const crlf = "First line.\r\nSecond line.\r\n";
  const crlfParts = assertSentences(crlf, ["First line.", "Second line."]);
  // The carriage return is not absorbed as trailing whitespace, so it heads the next
  // segment and trimSegment drops it. The offsets still slice back exactly.
  assert.deepEqual(crlfParts.map((part) => [part.start, part.end]), [[0, 11], [13, 25]]);

  const tabs = "\tFirst one.\tSecond one.";
  const tabParts = assertSentences(tabs, ["First one.", "Second one."]);
  assert.deepEqual(tabParts.map((part) => [part.start, part.end]), [[1, 11], [12, 23]]);

  const padded = "   \n\n  The job failed.   \n\n  ";
  const paddedParts = assertSentences(padded, ["The job failed."]);
  assert.deepEqual(paddedParts.map((part) => [part.start, part.end]), [[7, 22]]);
});

test("structure: a 150+ word sentence segments, diffs, and validates correctly and quickly", () => {
  const filler = Array.from({ length: 160 }, (_, index) => `word${index % 40}`).join(" ");
  const source = `The committee came to the conclusion that ${filler} was fine.`;
  const target = `The committee concluded that ${filler} was fine.`;
  assert.ok(source.split(/\s+/u).length > 150, "the fixture really is over 150 words");

  const started = performance.now();
  const parts = assertSentences(source, [source]);
  assert.equal(parts[0].start, 0);
  assert.equal(isCompleteSentence(parts[0].text), true);
  assertRewriteConsistent(source, target, {
    marked: ["came to the conclusion"],
    explanation: "Shortens “came to the conclusion” to “concluded”.",
  });
  const elapsed = performance.now() - started;
  // Measured at roughly 10ms; the bound only has to catch a quadratic regression.
  assert.ok(elapsed < 2000, `long-sentence round trip took ${elapsed.toFixed(0)}ms`);
});

test("structure: a 200-sentence emoji document segments in linear time", () => {
  const document = Array.from(
    { length: 200 },
    (_, index) => `The build ${ROCKET} number ${index} shipped today.`,
  ).join(" ");
  const started = performance.now();
  const segments = segmentSentences(document);
  const elapsed = performance.now() - started;
  assert.equal(segments.length, 200);
  for (const segment of segments) {
    assert.equal(document.slice(segment.start, segment.end), segment.text);
  }
  assert.ok(elapsed < 3000, `segmenting 200 emoji sentences took ${elapsed.toFixed(0)}ms`);
});

// ---------------------------------------------------------------------------
// MECHANICS with unusual text
// ---------------------------------------------------------------------------

test("mechanics: repairs and refusals across scripts and structures", () => {
  const cases = [
    // [name, input, expected replacement or null, expected fix ids]
    ["cyrillic opener is capitalised", "мы запустили проект.", "Мы запустили проект.", ["sentence-capitalisation"]],
    ["caseless scripts are left alone", "שלום the sign read.", null, []],
    ["CJK is left alone", "我们今天发布了.", null, []],
    ["space before punctuation", "The build , which shipped , works.", "The build, which shipped, works.", ["space-before-punctuation"]],
    ["missing space after comma", "The build,which shipped,works.", "The build, which shipped, works.", ["space-after-punctuation"]],
    ["repeated space", "Section  A  is  ready.", "Section A is ready.", ["repeated-space"]],
    ["weekday beside a date signal", "we ship on monday.", "We ship on Monday.", ["sentence-capitalisation", "proper-noun-capitalisation"]],
    ["a URL survives capitalisation", "see https://a.b/x,y now.", "See https://a.b/x,y now.", ["sentence-capitalisation"]],
    ["a version survives capitalisation", "ship v2.4.1-rc1 today.", "Ship v2.4.1-rc1 today.", ["sentence-capitalisation"]],
    ["an ellipsis ending is preserved", "he paused…", "He paused…", ["sentence-capitalisation"]],
    ["an interrobang is closed up", "really ?!", "Really?!", ["space-before-punctuation", "sentence-capitalisation"]],
    ["a leading tab is preserved", "\tthe build shipped.", "\tThe build shipped.", ["sentence-capitalisation"]],
    ["a trailing CRLF is preserved", "the build shipped.\r\n", "The build shipped.\r\n", ["sentence-capitalisation"]],
    ["grouped numbers are not respaced", "Revenue was 1,234,567.89 last year.", null, []],
    ["clock times are not respaced", "It ran at 14:30:05 exactly.", null, []],
    ["a markdown opener is left alone", "**bold** text is here.", null, []],
  ];
  for (const [name, input, replacement, ids] of cases) {
    const result = repairMechanics(input);
    if (replacement === null) {
      assert.equal(result, null, name);
      continue;
    }
    assert.notEqual(result, null, name);
    assert.equal(result.replacement, replacement, name);
    assert.deepEqual(result.ids, ids, name);
  }
});

test("mechanics: an emoji or a smart quote opener suppresses the capital", () => {
  // LIMITATION: sentence capitalisation matches /^(\s*)(\p{Ll})/, so any non-letter
  // opener — an emoji, a curly quote, a bullet — leaves the first word lowercase. The
  // repair fires only when it is unambiguous, which is the right failure direction for
  // a pass that must never be wrong.
  assert.equal(repairMechanics(`${ROCKET} the build shipped.`), null);
  assert.equal(repairMechanics("“stop now,” she said."), null);
  // The same sentence without the opener is repaired, isolating the cause.
  assert.equal(repairMechanics("the build shipped.").replacement, "The build shipped.");
});

test("mechanics: a no-break space between two words is normalised, and then respaced", () => {
  // Was a LIMITATION: the spacing rules matched [ \t] only, so text pasted out of a word
  // processor kept its spacing faults. It could not be left to the model either, because
  // the diff filters whitespace tokens: a rewrite that only replaced the NBSP reached the
  // writer with nothing underlined and nothing said. The mechanical pass owns it, and runs
  // first so that every later rule sees an ordinary space.
  assert.equal(repairMechanics(`The build${NBSP}, which shipped, works.`).replacement,
    "The build, which shipped, works.");
  assert.equal(repairMechanics(`Section${NBSP}${NBSP}A is ready.`).replacement,
    "Section A is ready.");
  assert.equal(repairMechanics(`The build${NNBSP}, which shipped, works.`).replacement,
    "The build, which shipped, works.");
  // The ASCII equivalents are repaired the same way.
  assert.equal(repairMechanics("The build , which shipped, works.").replacement,
    "The build, which shipped, works.");
  // Only between two visible characters: the sentence's own edges are left as written.
  assert.equal(repairMechanics(`${NBSP}The build works.`), null);
  assert.equal(repairMechanics(`The build works.${NBSP}`), null);
});

test("mechanics: a comma inside an inline code span is left as the writer typed it", () => {
  // Was a LIMITATION: the untouchable spans covered URLs, e-mail, paths, and file names
  // but not backtick code spans, so `f(a,b)` gained a space it was not written with.
  // Backtick spans are now untouchable too, so a code span is quoted verbatim.
  assert.equal(repairMechanics("Call `x = f(a,b)` first."), null);
  // A comma inside a URL is protected, which is now the same behaviour.
  assert.equal(repairMechanics("Open https://a.b/x,y now."), null);
  // The span is a fence, not an amnesty: the same fault outside it is still repaired.
  assert.equal(repairMechanics("Call `x = f(a,b)` first,now.").replacement,
    "Call `x = f(a,b)` first, now.");
  // A day name inside a code span is an identifier, not a missing capital.
  assert.equal(repairMechanics("Use `wednesday` as the key."), null);
});

test("mechanics: never corrupts an emoji, a surrogate pair, or a combining mark", () => {
  const cases = [
    `the build ${ROCKET} shipped , late.`,
    `the team ${CODER} shipped , late.`,
    `we launched in ${FLAG_DE} , late.`,
    `${CAFE_NFD} opened , late.`,
  ];
  for (const input of cases) {
    const result = repairMechanics(input);
    assert.notEqual(result, null, input);
    for (const atom of [ROCKET, CODER, FLAG_DE, `e${ACUTE}`]) {
      if (!input.includes(atom)) continue;
      assert.ok(result.replacement.includes(atom), `${atom} survives in ${JSON.stringify(input)}`);
    }
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(result.replacement), "no orphaned high surrogate");
    assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result.replacement), "no orphaned low surrogate");
  }
});

// ---------------------------------------------------------------------------
// CROSS-MODULE invariants
// ---------------------------------------------------------------------------

// One rewritable frame, filled with every awkward fragment in turn. The edit itself is
// always the same — "came to the conclusion" compressed to "concluded" — so any change
// in outcome is attributable to the fragment and nothing else.
const FRAGMENTS = [
  ["smart quotes", "the “launch” report"],
  ["curly apostrophe", "the team’s report"],
  ["em dash", "the report — a long one"],
  ["no-break space", `the${NBSP}report`],
  ["narrow no-break space", `the${NNBSP}report`],
  ["composed accent", `the ${CAFE_NFC} report`],
  ["decomposed accent", `the ${CAFE_NFD} report`],
  ["emoji", `the ${ROCKET} report`],
  ["ZWJ sequence", `the ${CODER} report`],
  ["flag", `the ${FLAG_DE} report`],
  ["Cyrillic", "the отчёт report"],
  ["CJK", "the 报告 report"],
  ["Hebrew", "the שלום report"],
  ["Arabic", "the مرحبا report"],
  ["inline code", "the `x = f(a, b)` report"],
  ["markdown", "the **bold** [link](https://a.b) report"],
  ["decimal", "the 3.14159 report"],
  ["version", "the v2.4.1-rc1 report"],
  ["clock time", "the 14:30:05 report"],
  ["grouped number", "the 1,234,567.89 report"],
  ["tab", "the\treport"],
];

test("cross-module: a plausible rewrite stays consistent through every fragment", () => {
  for (const [name, fragment] of FRAGMENTS) {
    const source = `The panel came to the conclusion that ${fragment} was fine.`;
    const target = `The panel concluded that ${fragment} was fine.`;
    assertRewriteConsistent(source, target, {
      marked: ["came to the conclusion"],
      explanation: "Shortens “came to the conclusion” to “concluded”.",
    });
    // The fragment itself is untouched by the edit, in both directions.
    assert.ok(validateRewrite(source, { action: "rewrite", replacement: target, reason: "shorter" }).replacement.includes(fragment), name);
  }
});

test("cross-module: underline ranges never cut a surrogate pair or a combining mark", () => {
  const cases = [
    [`The build ${ROCKET} came to the conclusion that it works.`, `The build ${ROCKET} concluded that it works.`],
    [`The team ${CODER} came to the conclusion that it works.`, `The team ${CODER} concluded that it works.`],
    [`We in ${FLAG_DE} came to the conclusion that it works.`, `We in ${FLAG_DE} concluded that it works.`],
    [`${CAFE_NFD} came to the conclusion that it works.`, `${CAFE_NFD} concluded that it works.`],
  ];
  for (const [source, target] of cases) {
    for (const range of changedSourceRanges(source, target)) {
      const marked = source.slice(range.start, range.end);
      assert.ok(!/[\uD800-\uDBFF]$/u.test(marked), "range does not end mid surrogate pair");
      assert.ok(!/^[\uDC00-\uDFFF]/u.test(marked), "range does not start mid surrogate pair");
      assert.ok(!marked.startsWith(ACUTE), "range does not start on a combining mark");
    }
  }
});

test("cross-module: a mid-sentence ellipsis makes the candidate look like two sentences", () => {
  // LIMITATION: the multiple-sentences gate segments the candidate, and the ellipsis is
  // a terminator, so a rewrite of a sentence containing "…" is refused. The gate exists
  // to stop the model answering with a paragraph; refusing here is the safe direction.
  const source = "The panel came to the conclusion… that it works.";
  const target = "The panel concluded… that it works.";
  assertRewriteConsistent(source, target, { accepted: false, reason: "multiple-sentences" });
  // Underline and explanation are still computed correctly for the refused candidate.
  assert.deepEqual(
    changedSourceRanges(source, target).map((range) => source.slice(range.start, range.end)),
    ["came to the conclusion"],
  );
});

test("cross-module: unusual terminal punctuation is carried through a rewrite unchanged", () => {
  const endings = [
    ["plain stop", "The panel came to the conclusion that it works.", "The panel concluded that it works."],
    ["interrobang", "The panel came to the conclusion that it works!?", "The panel concluded that it works!?"],
    ["doubled marks", "The panel came to the conclusion that it works??!", "The panel concluded that it works??!"],
    ["ellipsis ending", "The panel came to the conclusion that it works…", "The panel concluded that it works…"],
    ["emoji before the stop", `The panel came to the conclusion that it works ${ROCKET}.`, `The panel concluded that it works ${ROCKET}.`],
    ["quoted terminal", 'The panel came to the conclusion that it "works."', 'The panel concluded that it "works."'],
    ["parenthesised sentence", "(The panel came to the conclusion that it works.)", "(The panel concluded that it works.)"],
  ];
  for (const [name, source, target] of endings) {
    const { validation } = assertRewriteConsistent(source, target, { marked: ["came to the conclusion"] });
    assert.equal(validation.accepted, true, name);
  }
  // Changing the terminal mark is refused outright.
  assertRewriteConsistent(
    "Did the panel come to the conclusion?!",
    "Did the panel conclude?",
    { accepted: false, reason: "terminal-punctuation-changed" },
  );
});

test("cross-module: quoted-terminal prose is refused as two sentences, ranges still sane", () => {
  // LIMITATION: 'He said "stop." She left.' is genuinely two sentences, and the safety
  // gate refuses a candidate containing both — the pipeline is supposed to be handed
  // one sentence at a time by the segmenter, which does split this correctly.
  const source = 'He said "stop." She left.';
  assertRewriteConsistent(source, 'He said "stop." She departed.', {
    accepted: false,
    reason: "multiple-sentences",
  });
  assertSentences(source, ['He said "stop."', "She left."]);
});

test("cross-module: explanations quote verbatim spans on tiny and punctuation-only sources", () => {
  const cases = [
    ["Stop.", "Halt.", "Replaces “Stop” with “Halt”."],
    ["Stop now.", "Stop.", "Removes “now”."],
    ["...", "... x", "Adds “x”."],
    [ROCKET, `${ROCKET} x`, "Adds “x”."],
    ["He paused...", "He paused.", "Changes “...” to “.”."],
  ];
  for (const [source, target, expected] of cases) {
    const derived = explainEdit(source, target);
    assert.equal(derived, expected, source);
    for (const span of quotedSpans(derived)) {
      assert.ok(source.includes(span) || target.includes(span), `${span} verbatim in ${source}`);
    }
    for (const range of changedSourceRanges(source, target)) {
      assert.ok(range.start >= 0 && range.end <= source.length && range.end > range.start, source);
    }
  }
});

test("cross-module: a quoted span containing curly quotes nests them in the explanation", () => {
  // LIMITATION: quote() always wraps in “ ”, and the span it wraps is taken verbatim
  // from the source, so a source that already contains curly quotes produces nested
  // marks. The text stays verbatim and truthful; only the nesting reads badly.
  const source = "The panel came to the “final” conclusion that it works.";
  const target = "The panel concluded that it works.";
  assert.equal(
    explainEdit(source, target),
    "Shortens “came to the “final” conclusion” to “concluded”.",
  );
  assert.ok(source.includes("came to the “final” conclusion"), "the span is still verbatim");
});

test("cross-module: a rewrite that drops an emoji is shown and explained", () => {
  // LIMITATION: an emoji is not a content word, so lostContentWords reports nothing and
  // no second model opinion is requested. The deletion is not hidden from the writer,
  // though: it is underlined and named in the explanation, which is what matters.
  const source = `The build ${ROCKET} shipped today.`;
  const target = "The build shipped today.";
  const { validation, ranges, derived } = assertRewriteConsistent(source, target, { marked: [ROCKET] });
  assert.equal(validation.accepted, true);
  assert.equal(ranges.length, 1);
  assert.equal(derived, `Removes “${ROCKET}”.`);
  assert.deepEqual(lostContentWords(source, target), []);
});

test("cross-module: names are only guarded in scripts where \\b applies", () => {
  // LIMITATION: properNouns matches /\b\p{Lu}[\p{L}’']*\b/, and \b in JavaScript is
  // ASCII-word based, so it never fires before a Cyrillic or Greek capital. A name swap
  // in those scripts is caught one gate later, by the vocabulary check, rather than by
  // the name check — still refused, but for a different stated reason.
  const latin = validateRewrite("The panel asked Maria and she agreed.",
    { action: "rewrite", replacement: "The panel asked Nadia and she agreed.", reason: "clearer" });
  assert.equal(latin.reason, "name-changed");

  const cyrillic = validateRewrite("Совет спросил Марию и она согласилась.",
    { action: "rewrite", replacement: "Совет спросил Надю и она согласилась.", reason: "clearer" });
  assert.equal(cyrillic.accepted, false);
  assert.equal(cyrillic.reason, "word-substituted");
});

test("cross-module: pathological inputs return values rather than throwing", () => {
  const inputs = ["", "   ", "\t\t", "\r\n", "...", "?!", ROCKET, "“”", "\uD800", "。", "…"];
  for (const text of inputs) {
    const label = JSON.stringify(text);
    assert.doesNotThrow(() => segmentSentences(text), label);
    assert.doesNotThrow(() => isCompleteSentence(text), label);
    assert.doesNotThrow(() => tokenize(text), label);
    assert.doesNotThrow(() => diffWords(text, `${text} more`), label);
    assert.doesNotThrow(() => changedSourceRanges(text, `${text} more`), label);
    assert.doesNotThrow(() => explainEdit(text, `${text} more`), label);
    assert.doesNotThrow(() => repairMechanics(text), label);
    assert.doesNotThrow(() => lostContentWords(text, `${text} more`), label);
    assert.doesNotThrow(() => reconcileSentences([], text), label);
    assert.doesNotThrow(
      () => validateRewrite(text, { action: "rewrite", replacement: `${text} more`, reason: "r" }),
      label,
    );
  }
  // A lone high surrogate is never split further or duplicated by the segmenter.
  assert.deepEqual(segmentSentences("\uD800").map((segment) => segment.text), ["\uD800"]);
});

test("a whitespace-only rewrite still shows nothing, and is no longer the model's to make", () => {
  // Was a KNOWN-GAP: replacing a no-break space with an ordinary space is a real change to
  // the document, but the diff filters whitespace tokens, so validateRewrite saw no ops at
  // all and accepted. changedSourceRanges returned [] and explainEdit returned "", which
  // pipeline.describe() turned into reason: "" when there was no mechanical repair to
  // borrow wording from — a live suggestion with no mark and no explanation.
  //
  // Both halves of the suggested fix were taken. The deterministic half is pinned here:
  // the mechanical pass owns NBSP normalisation and supplies the wording, so the model is
  // never asked about a sentence in this shape. The other half is a pipeline gate that
  // refuses any replacement its own diff marks nowhere, pinned in pipeline-visibility.
  const source = `The panel${NBSP}concluded that it works.`;
  const target = "The panel concluded that it works.";
  // Nothing has changed about what the diff can show for it, which is the whole point:
  // validateRewrite is a text-level gate and cannot know what the writer sees.
  assert.equal(changedSourceRanges(source, target).length, 0, "no underline is produced");
  assert.equal(explainEdit(source, target), "", "no explanation is produced");
  // The repair is made before the model is consulted, and it says what it did.
  const mechanical = repairMechanics(source);
  assert.equal(mechanical.replacement, target);
  assert.deepEqual(mechanical.ids, ["non-breaking-space"]);
  assert.match(mechanical.reason, /non-breaking space/u);
});

// ---------------------------------------------------------------------------
// IDENTITY and STORE with unusual text
// ---------------------------------------------------------------------------

// Drives reconcileSentences through successive document states and asserts the offset
// invariant the editor depends on at every step: editor.value.slice(start, end) is the
// sentence text, exactly.
function driveDocument(states) {
  const history = [];
  let previous = [];
  for (const text of states) {
    const current = reconcileSentences(previous, text);
    for (const sentence of current) {
      assert.equal(text.slice(sentence.start, sentence.end), sentence.text,
        `offsets exact in ${JSON.stringify(text)}`);
    }
    history.push(current);
    previous = current;
  }
  return history;
}

test("identity: an emoji document keeps ids and offsets exact across edits", () => {
  resetIds();
  const [first, second, third, fourth] = driveDocument([
    `The build ${ROCKET} shipped.`,
    `The build ${ROCKET} shipped. It works ${PARTY}.`,
    `The build ${ROCKET} shipped fast. It works ${PARTY}.`,
    `We began. The build ${ROCKET} shipped fast. It works ${PARTY}.`,
  ]);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, false);
  // Editing sentence one is an edit, and sentence two is untouched.
  assert.equal(third[0].id, first[0].id);
  assert.equal(third[0].changed, true);
  assert.equal(third[1].id, second[1].id);
  assert.equal(third[1].changed, false);
  // Inserting a sentence before both leaves their identities alone.
  assert.deepEqual(fourth.map((sentence) => sentence.id).slice(1), [first[0].id, second[1].id]);
  assert.equal(fourth[1].changed, false);
  assert.equal(fourth[2].changed, false);
});

test("identity: ZWJ sequences and flags survive reconciliation intact", () => {
  resetIds();
  const [first, second] = driveDocument([
    `The team ${CODER} shipped it in ${FLAG_DE}.`,
    `The team ${CODER} shipped it in ${FLAG_DE}. Done.`,
  ]);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, false);
  assert.ok(second[0].text.includes(CODER));
  assert.ok(second[0].text.includes(FLAG_DE));
});

test("identity: a no-break space document keeps offsets exact across edits", () => {
  resetIds();
  const [first, second, third] = driveDocument([
    `The team${NBSP}shipped it.`,
    `The team${NBSP}shipped it. It works.`,
    `The team${NBSP}shipped it now. It works.`,
  ]);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, false);
  assert.equal(third[0].changed, true);
  assert.equal(third[1].id, second[1].id);
  assert.equal(third[1].changed, false);
});

test("identity: a CJK paragraph reconciles as a single sentence", () => {
  // LIMITATION: with no CJK terminator support the whole paragraph is one sentence, so
  // appending a clause is an edit to that sentence rather than a new one. Identity and
  // offsets stay correct; only the granularity is coarse.
  resetIds();
  const [first, second, third] = driveDocument([
    "我们今天发布了。",
    "我们今天发布了。它很好。",
    "The build shipped. 我们今天发布了。它很好。",
  ]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, true);
  assert.equal(third.length, 2);
  assert.equal(third[1].id, first[0].id, "the CJK paragraph keeps its identity");
  assert.equal(third[1].changed, false);
});

test("identity: CRLF documents reconcile with exact offsets", () => {
  resetIds();
  const [first, second] = driveDocument([
    "First line.\r\nSecond line.",
    "First line.\r\nSecond line.\r\nThird line.",
  ]);
  assert.deepEqual(first.map((sentence) => [sentence.start, sentence.end]), [[0, 11], [13, 25]]);
  assert.deepEqual(second.map((sentence) => [sentence.start, sentence.end]), [[0, 11], [13, 25], [27, 38]]);
  assert.deepEqual(second.slice(0, 2).map((sentence) => sentence.id), first.map((sentence) => sentence.id));
  assert.equal(second[2].changed, true);
});

test("identity: normalising an accent counts as editing the sentence", () => {
  // LIMITATION: NFD and NFC spellings are different strings, so a document normalised
  // in place looks edited. The id survives by position and offsets stay exact; the cost
  // is one re-analysis, which is the safe direction.
  resetIds();
  const [first, second, third] = driveDocument([
    `${CAFE_NFD} opened today.`,
    `${CAFE_NFD} opened today. It is busy.`,
    `${CAFE_NFC} opened today. It is busy.`,
  ]);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, false);
  assert.equal(third[0].id, first[0].id);
  assert.equal(third[0].changed, true, "normalisation reads as an edit");
  assert.equal(third[0].end, second[0].end - 1, "the composed form is one unit shorter");
});

test("identity: duplicate emoji sentences receive distinct ids", () => {
  resetIds();
  const sentences = reconcileSentences([], `Ship it ${ROCKET}. Ship it ${ROCKET}.`);
  assert.equal(sentences.length, 2);
  assert.notEqual(sentences[0].id, sentences[1].id);
});

test("store: a mark on an emoji sentence re-anchors exactly when text is inserted before it", () => {
  resetIds();
  const store = createStore();
  const before = `The build ${ROCKET} came to the conclusion. It works.`;
  const after = `Intro first. The build ${ROCKET} came to the conclusion. It works.`;

  const first = reconcileSentences([], before);
  store.set({
    id: first[0].id,
    source: first[0].text,
    start: first[0].start,
    end: first[0].end,
    replacement: `The build ${ROCKET} concluded.`,
  });

  const second = reconcileSentences(first, after);
  store.reconcile(second);
  assert.equal(store.size, 1, "the untouched sentence keeps its mark");

  const [mark] = store.list();
  const anchor = second.find((sentence) => sentence.id === first[0].id);
  assert.equal(mark.start, anchor.start);
  assert.equal(mark.end, anchor.end);
  assert.equal(after.slice(mark.start, mark.end), mark.source, "the mark still covers its sentence");

  // Editing that sentence drops the stale mark.
  const third = reconcileSentences(second, `Intro first. The build ${ROCKET} concluded early. It works.`);
  store.reconcile(third);
  assert.equal(store.size, 0);
});

test("store: a dismissal on a CJK sentence lasts until that sentence changes", () => {
  resetIds();
  const store = createStore();
  const chinese = "我们今天发布了。";
  const first = reconcileSentences([], chinese);
  store.dismiss(first[0].id, first[0].text);
  assert.equal(store.isDismissed(first[0].id, first[0].text), true);

  const second = reconcileSentences(first, `The build shipped. ${chinese}`);
  store.reconcile(second);
  assert.equal(store.isDismissed(first[0].id, chinese), true, "an unchanged sentence keeps its dismissal");

  const third = reconcileSentences(second, `The build shipped. ${chinese}它很好。`);
  store.reconcile(third);
  assert.equal(store.isDismissed(first[0].id, chinese), false, "an edited sentence loses it");
});

test("identity: reconciling a long mixed-script document stays fast and exact", () => {
  resetIds();
  const filler = Array.from({ length: 160 }, (_, index) => `word${index % 40}`).join(" ");
  const long = `The committee ${ROCKET} came to the conclusion that ${filler} was fine.`;
  const first = Array.from({ length: 30 }, () => long).join(" ");
  const second = `${first} One more sentence.`;

  const started = performance.now();
  const [initial, updated] = driveDocument([first, second]);
  const elapsed = performance.now() - started;

  assert.equal(initial.length, 30);
  assert.equal(updated.length, 31);
  assert.ok(elapsed < 3000, `reconciling a 30-sentence document twice took ${elapsed.toFixed(0)}ms`);
});
