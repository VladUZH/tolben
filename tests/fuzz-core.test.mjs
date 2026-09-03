// Deterministic property-based fuzzing of the engine's local, non-model core.
//
// Every generator draws from a seeded mulberry32 PRNG and never from Math.random, so a
// failure here is a failure anyone can reproduce: the seed is in the test name, and
// re-running the file feeds the checkers the identical corpus. Iteration counts sit in the
// 500-2000 band, which is enough to reach the awkward corners (a URL glued to a comma, an
// emoji before a full stop, a decomposed accent astride a segment boundary) while keeping
// the whole file well under a second.
//
// The properties are written as standalone checker functions rather than inline assertions
// for one reason: a fuzz test that cannot fail is worse than no test, because it reads as
// coverage. Each checker is therefore also driven by a `teeth` test that hands it a
// deliberately corrupted value and asserts it complains. If a checker is ever weakened
// into a tautology, its teeth test goes red.
//
// Where fuzzing found a real invariant violation it is recorded as a `todo` KNOWN-GAP with
// its seed, exactly as in redteam-safety.test.mjs. No production source was changed.

import test from "node:test";
import assert from "node:assert/strict";
import { segmentSentences, trimSegment, isCompleteSentence } from "../src/segmenter.mjs";
import { tokenize, diffWords, changedSourceRanges, inlineDiffParts } from "../src/diff.mjs";
import { validateRewrite, REJECTION_REASONS } from "../src/safety.mjs";
import { explainEdit } from "../src/explain.mjs";
import { repairMechanics } from "../src/mechanics.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";

// ---------------------------------------------------------------------------
// Seeded PRNG and generators.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "the", "team", "shipped", "build", "valve", "report", "audit", "queue", "vendor", "archive",
  "Maya", "Priya", "Wednesday", "March", "data", "review", "not", "never", "all", "some",
  "may", "must", "only", "because", "however", "don't", "isn't", "café", "naïve", "Zürich",
  "monday", "may", "march", "Dr", "e.g", "etc",
];
const NUMBERS = [
  "3", "18", "50%", "3.14", "1,200", "14:30", "2023", "v2", "Q3", "[12]", "500 ms", "2 TB",
  "$40", "€1,200", "12.5 kg", "09:00 UTC", "3rd", "1.2.3",
];
// Kept verbatim in a list so the mechanics property can assert they survive untouched.
const REFERENCES = [
  "https://example.test/a?x=1&y=2", "http://a.b/c,d", "ops@example.test",
  "/srv/reports/q4.csv", "C:\\data\\input.txt", "report.json", "API_V2", "retry_limit",
];
const UNICODE = [
  "🚀", "👩‍💻", "🇩🇪", "Привет", "мир", "日本語", "テスト", "שלום", "مرحبا",
  "\u201C", "\u201D", "\u2018", "\u2019", "\u2014", "\u2013", "\u2026",
  "\u00a0", "\u202f", "\u200b", "é", "e\u0301",
];
const PUNCTUATION = [
  ".", "!", "?", ",", ";", ":", "...", "?!", "!!", "\"", "'", "(", ")", "[", "]", "-", "/", "—",
];
const WHITESPACE = [" ", "  ", "   ", "\t", "\n", "\n\n", " \n", "\r\n", "\u00a0"];

const pick = (rnd, values) => values[Math.floor(rnd() * values.length)];

// Prose-shaped rather than uniformly random: uniform noise almost never produces the
// token adjacencies (a full stop inside a decimal, a comma inside a URL) that the
// deterministic passes actually have to reason about.
function generate(rnd, { maxParts = 24, punctuationHeavy = false } = {}) {
  const parts = 1 + Math.floor(rnd() * maxParts);
  let text = "";
  for (let index = 0; index < parts; index += 1) {
    const roll = rnd();
    const table = punctuationHeavy
      ? [[0.34, WORDS], [0.44, REFERENCES], [0.52, NUMBERS], [0.60, UNICODE], [0.82, PUNCTUATION], [1, WHITESPACE]]
      : [[0.42, WORDS], [0.55, NUMBERS], [0.63, REFERENCES], [0.74, UNICODE], [0.88, PUNCTUATION], [1, WHITESPACE]];
    text += pick(rnd, table.find(([bound]) => roll < bound)[1]);
    if (rnd() < 0.55) text += pick(rnd, WHITESPACE);
  }
  return text;
}

// ---------------------------------------------------------------------------
// (a) Segmenter offsets.
// ---------------------------------------------------------------------------

function checkSegmentation(text, segments) {
  let previousEnd = -1;
  for (const [index, segment] of segments.entries()) {
    assert.equal(typeof segment.start, "number", `segment ${index} start`);
    assert.equal(typeof segment.end, "number", `segment ${index} end`);
    assert.ok(segment.start >= 0 && segment.end <= text.length, `segment ${index} out of bounds`);
    assert.ok(segment.start < segment.end, `segment ${index} is empty or inverted`);
    // The offsets are the contract: the UI underlines by them, so a segment whose text
    // does not match its own slice would put the mark on the wrong words.
    assert.equal(text.slice(segment.start, segment.end), segment.text, `segment ${index} slice mismatch`);
    assert.ok(segment.start >= previousEnd, `segment ${index} overlaps or precedes its predecessor`);
    previousEnd = segment.end;

    const trimmed = trimSegment(segment);
    assert.ok(trimmed.start >= segment.start && trimmed.end <= segment.end, `trimSegment ${index} escaped its segment`);
    assert.ok(trimmed.start <= trimmed.end, `trimSegment ${index} inverted`);
    assert.equal(text.slice(trimmed.start, trimmed.end), trimmed.text, `trimSegment ${index} slice mismatch`);
    assert.equal(trimmed.text, segment.text.trim(), `trimSegment ${index} is not the trimmed text`);
  }

  // Nothing with ink on it may fall between two segments: a dropped character is a
  // sentence the engine never sees.
  const covered = new Uint8Array(text.length);
  for (const segment of segments) covered.fill(1, segment.start, segment.end);
  for (let index = 0; index < text.length; index += 1) {
    if (!/\s/u.test(text[index]) && !covered[index]) {
      assert.fail(`character ${index} (${JSON.stringify(text[index])}) is in no segment`);
    }
  }
}

test("fuzz (a): segmentSentences offsets are exact and cover every non-whitespace character [seed 0xA11CE, 2000 iterations]", () => {
  const rnd = mulberry32(0xA11CE);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const text = generate(rnd);
    try {
      checkSegmentation(text, segmentSentences(text));
    } catch (error) {
      error.message += `\n  iteration ${iteration}, input ${JSON.stringify(text)}`;
      throw error;
    }
  }
});

test("fuzz (a): a segment reported complete really ends in a terminator [seed 0xA11CE, 2000 iterations]", () => {
  const rnd = mulberry32(0xA11CE);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const text = generate(rnd);
    for (const segment of segmentSentences(text)) {
      const trimmed = trimSegment(segment).text;
      if (!isCompleteSentence(trimmed)) continue;
      const withoutClosers = trimmed.replace(/["'\u2019\u201D)\]}]+$/u, "");
      assert.match(withoutClosers, /[.!?\u2026]$/u, `iteration ${iteration}, ${JSON.stringify(trimmed)}`);
    }
  }
});

test("teeth (a): checkSegmentation catches an off-by-one offset, an overlap and a dropped character", () => {
  const text = "First one. Second one.";
  const good = segmentSentences(text);
  assert.doesNotThrow(() => checkSegmentation(text, good));

  // Offsets shifted by one while the text stays put: the underline lands one char over.
  assert.throws(
    () => checkSegmentation(text, good.map((s) => ({ ...s, start: s.start + 1 }))),
    /slice mismatch/u,
  );
  // Two segments claiming the same characters.
  assert.throws(
    () => checkSegmentation(text, [{ ...good[0] }, { text: text.slice(5), start: 5, end: text.length }]),
    /overlaps|slice mismatch/u,
  );
  // A segment silently dropped, so "Second one." never reaches the engine.
  assert.throws(() => checkSegmentation(text, good.slice(0, 1)), /is in no segment/u);
});

// ---------------------------------------------------------------------------
// (b) Diff ranges.
// ---------------------------------------------------------------------------

function checkRanges(source, ranges) {
  let previousEnd = -1;
  for (const [index, range] of ranges.entries()) {
    assert.ok(range.start >= 0, `range ${index} starts before the text`);
    assert.ok(range.end <= source.length, `range ${index} ends past the text`);
    assert.ok(range.start < range.end, `range ${index} is empty or inverted`);
    assert.ok(range.start >= previousEnd, `range ${index} overlaps or precedes its predecessor`);
    previousEnd = range.end;
  }
}

// The inline hover card is built from these parts, so they have to add back up to the two
// sentences. Equal ops carry the SOURCE token — the diff keys on lowercase — which is why
// the target side reconstructs only case-insensitively. That is the reason explain.mjs
// computes capitalisation changes separately instead of reading them off the diff.
function checkInlineParts(source, target, parts) {
  const join = (tokens) => tokens.join("\u0000");
  const sourceTokens = tokenize(source).filter((token) => !token.space).map((token) => token.text);
  const targetTokens = tokenize(target).filter((token) => !token.space).map((token) => token.text);
  for (const part of parts) {
    assert.ok(["equal", "delete", "insert"].includes(part.type), `unknown part type ${part.type}`);
    assert.equal(typeof part.text, "string");
  }
  assert.equal(
    join(parts.filter((p) => p.type !== "insert").map((p) => p.text)),
    join(sourceTokens),
    "kept and deleted parts do not reconstruct the source",
  );
  assert.equal(
    join(parts.filter((p) => p.type !== "delete").map((p) => p.text)).toLowerCase(),
    join(targetTokens).toLowerCase(),
    "kept and inserted parts do not reconstruct the target",
  );
}

test("fuzz (b): changedSourceRanges stays in bounds and in order [seed 0xD1FF, 1500 iterations]", () => {
  const rnd = mulberry32(0xD1FF);
  for (let iteration = 0; iteration < 1500; iteration += 1) {
    const source = generate(rnd, { maxParts: 12 });
    const target = generate(rnd, { maxParts: 12 });
    try {
      checkRanges(source, changedSourceRanges(source, target));
      checkInlineParts(source, target, inlineDiffParts(source, target));
    } catch (error) {
      error.message += `\n  iteration ${iteration}\n  source ${JSON.stringify(source)}\n  target ${JSON.stringify(target)}`;
      throw error;
    }
  }
});

test("fuzz (b): identical inputs produce no ops and no ranges [seed 0xD1FF, 1500 iterations]", () => {
  const rnd = mulberry32(0xD1FF);
  for (let iteration = 0; iteration < 1500; iteration += 1) {
    const text = generate(rnd, { maxParts: 12 });
    const ops = diffWords(text, text);
    assert.ok(ops.every((op) => op.type === "equal"), `iteration ${iteration}: ${JSON.stringify(text)}`);
    assert.deepEqual(changedSourceRanges(text, text), [], `iteration ${iteration}: ${JSON.stringify(text)}`);
    assert.equal(explainEdit(text, text), "", `iteration ${iteration}: ${JSON.stringify(text)}`);
  }
});

// The brief suggested "diff of (s, s + suffix) marks nothing before the suffix start".
// It does not hold, and it should not: changedSourceRanges anchors a pure insertion to the
// neighbouring source token so the underline has somewhere to live, and for an append that
// neighbour is the last token of the source. Probing found 2882 violations in 3000 draws.
// What does hold is the property the anchoring was meant to preserve, so that is what is
// asserted: an append deletes nothing, and every mark it produces sits on the final token.
test("fuzz (b): appending a suffix deletes nothing and marks only the last source token [seed 0xD1FF, 1500 iterations]", () => {
  const rnd = mulberry32(0xD1FF);
  for (let iteration = 0; iteration < 1500; iteration += 1) {
    const source = generate(rnd, { maxParts: 12 });
    const appended = `${source} ${generate(rnd, { maxParts: 6 })}`;
    const ops = diffWords(source, appended);
    assert.ok(
      ops.every((op) => op.type !== "delete"),
      `iteration ${iteration}: appending deleted a token from ${JSON.stringify(source)}`,
    );
    const sourceTokens = tokenize(source).filter((token) => !token.space);
    const last = sourceTokens[sourceTokens.length - 1];
    const ranges = changedSourceRanges(source, appended);
    checkRanges(source, ranges);
    for (const range of ranges) {
      assert.ok(last, `iteration ${iteration}: marked ${JSON.stringify(range)} in a source with no tokens`);
      assert.ok(
        range.start >= last.start && range.end <= last.end,
        `iteration ${iteration}: append marked ${JSON.stringify(range)} outside the final token ${JSON.stringify(last)}`,
      );
    }
  }
});

test("teeth (b): checkRanges and checkInlineParts catch a corrupted range and a fabricated part", () => {
  const source = "The team met yesterday.";
  const target = "The team convened yesterday.";
  const ranges = changedSourceRanges(source, target);
  assert.doesNotThrow(() => checkRanges(source, ranges));

  assert.throws(() => checkRanges(source, [{ start: -1, end: 4 }]), /starts before the text/u);
  assert.throws(() => checkRanges(source, [{ start: 0, end: source.length + 5 }]), /ends past the text/u);
  assert.throws(() => checkRanges(source, [{ start: 7, end: 3 }]), /empty or inverted/u);
  assert.throws(() => checkRanges(source, [{ start: 10, end: 15 }, { start: 4, end: 8 }]), /overlaps/u);

  const parts = inlineDiffParts(source, target);
  assert.doesNotThrow(() => checkInlineParts(source, target, parts));
  // A part that claims the source said something it did not — the failure mode that would
  // put words in the writer's mouth in the hover card.
  const forged = parts.map((p) => (p.type === "equal" && p.text === "team" ? { ...p, text: "crew" } : p));
  assert.throws(() => checkInlineParts(source, target, forged), /do not reconstruct the source/u);
  assert.throws(() => checkInlineParts(source, target, parts.slice(1)), /do not reconstruct/u);
});

// ---------------------------------------------------------------------------
// (c) validateRewrite total-ness.
// ---------------------------------------------------------------------------

const EXTRA_REJECTIONS = ["information-dropped", "verifier-unavailable", "verifier-hidden", "invisible-edit"];

function checkValidation(result) {
  assert.equal(typeof result, "object", "validateRewrite returned a non-object");
  assert.notEqual(result, null, "validateRewrite returned null");
  assert.equal(typeof result.accepted, "boolean", "accepted is not a boolean");
  assert.equal(typeof result.reason, "string", "reason is not a string");
  if (result.accepted) {
    assert.equal(result.reason, "accepted");
    assert.equal(typeof result.replacement, "string", "an accepted rewrite carries no replacement string");
    assert.ok(result.replacement.length > 0, "an accepted rewrite carries an empty replacement");
    assert.equal(result.replacement, result.replacement.trim(), "an accepted replacement is not trimmed");
  } else {
    assert.ok(REJECTION_REASONS.includes(result.reason), `undocumented rejection reason ${result.reason}`);
    assert.equal(result.replacement, undefined, "a rejection carries a replacement");
  }
}

test("fuzz (c): validateRewrite never throws and always returns a well-formed verdict [seed 0x5AFE, 1000 iterations x 8 decisions]", () => {
  const rnd = mulberry32(0x5AFE);
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const source = generate(rnd, { maxParts: 12 });
    const candidate = generate(rnd, { maxParts: 12 });
    const decisions = [
      { action: "rewrite", replacement: candidate, reason: generate(rnd, { maxParts: 4 }) },
      { action: "rewrite", replacement: candidate, reason: "The sentence is already clear and direct." },
      { action: "rewrite", replacement: source, reason: "Identical." },
      { action: "keep", replacement: candidate, reason: "" },
      { action: "rewrite" },
      { action: "rewrite", replacement: 42, reason: null },
      null,
      undefined,
    ];
    for (const decision of decisions) {
      let result;
      try {
        result = validateRewrite(source, decision);
      } catch (error) {
        assert.fail(`threw on iteration ${iteration}: ${error.message}\n  source ${JSON.stringify(source)}\n  decision ${JSON.stringify(decision)}`);
      }
      try {
        checkValidation(result);
      } catch (error) {
        error.message += `\n  iteration ${iteration}\n  source ${JSON.stringify(source)}\n  decision ${JSON.stringify(decision)}`;
        throw error;
      }
    }
  }
});

test("fuzz (c): maxEditRatio 0 rejects every token change, and 1 never rejects for that reason [seed 0x5AFE, 500 iterations]", () => {
  const rnd = mulberry32(0x5AFE);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const source = generate(rnd, { maxParts: 10 });
    const candidate = generate(rnd, { maxParts: 10 });
    const decision = { action: "rewrite", replacement: candidate, reason: "Shorter." };
    const permissive = validateRewrite(source, decision, { maxEditRatio: 1 });
    checkValidation(permissive);
    assert.notEqual(permissive.reason, "excessive-edit", `iteration ${iteration}`);
    // The 0 half, previously claimed by the title but never run: with no edit budget,
    // any rewrite that changes a token is refused (whatever reason fires first, the
    // ratio guard guarantees it cannot be accepted).
    const strict = validateRewrite(source, decision, { maxEditRatio: 0 });
    checkValidation(strict);
    if (candidate.trim() !== source.trim()) {
      assert.equal(strict.accepted, false, `iteration ${iteration}: accepted with a zero edit budget`);
    }
  }
  // The deliberate exception: the ratio compares tokens case-insensitively, so a pure
  // capitalisation repair costs nothing and passes even a zero budget.
  const caseOnly = validateRewrite(
    "The workshop starts on wednesday.",
    { action: "rewrite", replacement: "The workshop starts on Wednesday.", reason: "Caps." },
    { maxEditRatio: 0 },
  );
  assert.equal(caseOnly.accepted, true, "a case-only repair has edit ratio 0 by design");
});

test("teeth (c): checkValidation catches a verdict that accepts without a usable replacement", () => {
  assert.doesNotThrow(() => checkValidation({ accepted: true, reason: "accepted", replacement: "A sentence." }));
  assert.doesNotThrow(() => checkValidation({ accepted: false, reason: "empty" }));

  assert.throws(() => checkValidation({ accepted: true, reason: "accepted" }), /no replacement string/u);
  assert.throws(() => checkValidation({ accepted: true, reason: "accepted", replacement: "" }), /empty replacement/u);
  assert.throws(() => checkValidation({ accepted: true, reason: "accepted", replacement: " x " }), /not trimmed/u);
  assert.throws(() => checkValidation({ accepted: false, reason: "vibes" }), /undocumented rejection reason/u);
  // A rejection that still hands back text is how a refused rewrite reaches the UI anyway.
  assert.throws(() => checkValidation({ accepted: false, reason: "empty", replacement: "x" }), /carries a replacement/u);
  assert.throws(() => checkValidation({ accepted: "yes", reason: "empty" }), /not a boolean/u);
  assert.throws(() => checkValidation(null), /returned null/u);
});

// ---------------------------------------------------------------------------
// (d) explainEdit quotation integrity.
// ---------------------------------------------------------------------------

// The whole point of deriving the explanation from the diff is that the writer can trust
// the quoted spans. A quote that appears in neither sentence is the model's prose leaking
// back in, which is exactly what explain.mjs exists to prevent.
function checkExplanation(source, replacement, explanation) {
  assert.equal(typeof explanation, "string", "explainEdit returned a non-string");
  for (const match of explanation.matchAll(/\u201C([^\u201D]*)\u201D/gu)) {
    assert.ok(
      source.includes(match[1]) || replacement.includes(match[1]),
      `quoted span ${JSON.stringify(match[1])} appears in neither sentence`,
    );
  }
  if (explanation) {
    assert.match(explanation, /\.$/u, "an explanation does not end in a full stop");
    assert.match(explanation, /^[\p{Lu}\p{N}\u201C]/u, "an explanation does not start with a capital");
  }
}

test("fuzz (d): every span explainEdit quotes is verbatim from one of the two sentences [seed 0xE7A1, 2000 iterations]", () => {
  const rnd = mulberry32(0xE7A1);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const source = generate(rnd, { maxParts: 12 });
    const replacement = rnd() < 0.4 ? source : generate(rnd, { maxParts: 12 });
    let explanation;
    try {
      explanation = explainEdit(source, replacement);
    } catch (error) {
      assert.fail(`threw on iteration ${iteration}: ${error.message}\n  source ${JSON.stringify(source)}\n  replacement ${JSON.stringify(replacement)}`);
    }
    try {
      checkExplanation(source, replacement, explanation);
    } catch (error) {
      error.message += `\n  iteration ${iteration}\n  source ${JSON.stringify(source)}\n  replacement ${JSON.stringify(replacement)}\n  explanation ${JSON.stringify(explanation)}`;
      throw error;
    }
  }
});

test("fuzz (d): explanations of the real must-accept repairs quote verbatim too [seed 0xE7A1]", () => {
  // Random prose exercises the parser; real repairs exercise the phrasing branches.
  for (const [source, replacement] of [
    ["We conducted a review of the draft.", "We reviewed the draft."],
    ["The router is located in close proximity to the desk.", "The router is near the desk."],
    ["The workshop starts on wednesday.", "The workshop starts on Wednesday."],
    ["Your expected to archive the copy.", "You're expected to archive the copy."],
    ["A set of revised drawings are attached.", "A set of revised drawings is attached."],
    ["The plan is absolutely totally sound.", "The plan is totally sound."],
    ["He go to work every day.", "He goes to work every day."],
    ["There are three bolts that require torque.", "Three bolts require torque."],
  ]) {
    const explanation = explainEdit(source, replacement);
    assert.ok(explanation.length > 0, `${source} produced no explanation`);
    checkExplanation(source, replacement, explanation);
  }
});

test("fuzz (d): a whitespace-only repair yields no explanation, which is why the mechanical pass supplies one", () => {
  // Fuzzing surfaced this while probing the must-accept corpus: the diff tokenises
  // "paper,ink" as three tokens either side of the repair, so a spacing fix produces no
  // ops at all. pipeline.mjs's describe() documents exactly this case as the one time the
  // mechanical pass's own wording is used. Pinned so a future change to the tokeniser
  // cannot silently leave these repairs with no explanation and no fallback.
  for (const [source, replacement] of [
    ["The package includes paper,ink, and labels.", "The package includes paper, ink, and labels."],
    ["The review was brief , but it was thorough.", "The review was brief, but it was thorough."],
    ["Section  A  is  ready.", "Section A is ready."],
  ]) {
    assert.equal(explainEdit(source, replacement), "", `${source} ⇒ ${replacement}`);
    assert.equal(repairMechanics(source)?.replacement, replacement, `${source} has no mechanical fallback`);
    assert.ok(repairMechanics(source).reason.length > 0, `${source} has an empty mechanical reason`);
  }
});

test("teeth (d): checkExplanation catches a fabricated quotation", () => {
  const source = "We conducted a review of the draft.";
  const replacement = "We reviewed the draft.";
  assert.doesNotThrow(() => checkExplanation(source, replacement, explainEdit(source, replacement)));

  // A word from neither sentence: the exact failure the derived-explanation design forbids.
  assert.throws(
    () => checkExplanation(source, replacement, "Shortens \u201Cconducted a review\u201D to \u201Caudited\u201D."),
    /appears in neither sentence/u,
  );
  // A span rejoined from tokens rather than sliced, so the spacing is wrong.
  assert.throws(
    () => checkExplanation("The big, red valve failed.", replacement, "Removes \u201Cbig , red\u201D."),
    /appears in neither sentence/u,
  );
  assert.throws(() => checkExplanation(source, replacement, "removes a word."), /does not start with a capital/u);
  assert.throws(() => checkExplanation(source, replacement, "Removes a word"), /does not end in a full stop/u);
});

// ---------------------------------------------------------------------------
// (e) Mechanical repairs.
// ---------------------------------------------------------------------------

function checkMechanicalRepair(input, repair) {
  if (repair === null) return;
  assert.equal(typeof repair.replacement, "string", "repair has no replacement string");
  assert.equal(typeof repair.reason, "string", "repair has no reason");
  assert.ok(Array.isArray(repair.ids) && repair.ids.length > 0, "repair reports no fix ids");
  assert.notEqual(repair.replacement, input, "repair reports a change it did not make");

  // Every reference in the input has to come out the other side character for character.
  // A pass that "tidies" a comma inside a URL has broken the link it was meant to leave be.
  for (const reference of REFERENCES) {
    const before = input.split(reference).length - 1;
    if (before === 0) continue;
    assert.equal(
      repair.replacement.split(reference).length - 1,
      before,
      `mechanical repair altered ${JSON.stringify(reference)}`,
    );
  }

  // A second pass must find nothing left to do, or the UI would offer the writer an
  // endless chain of one-character suggestions.
  assert.equal(
    repairMechanics(repair.replacement),
    null,
    `repair is not idempotent: ${JSON.stringify(input)} -> ${JSON.stringify(repair.replacement)}`,
  );
}

test("fuzz (e): repairMechanics is idempotent and never touches a URL, path or email [seed 0xBEEF, 2000 iterations]", () => {
  const rnd = mulberry32(0xBEEF);
  let repaired = 0;
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const input = generate(rnd, { maxParts: 16, punctuationHeavy: true });
    let repair;
    try {
      repair = repairMechanics(input);
    } catch (error) {
      assert.fail(`threw on iteration ${iteration}: ${error.message}\n  input ${JSON.stringify(input)}`);
    }
    if (repair) repaired += 1;
    try {
      checkMechanicalRepair(input, repair);
    } catch (error) {
      error.message += `\n  iteration ${iteration}\n  input ${JSON.stringify(input)}`;
      throw error;
    }
  }
  // Guards against the generator drifting into inputs that never trip the pass, which
  // would leave this test passing while checking nothing.
  assert.ok(repaired > 500, `only ${repaired} of 2000 inputs produced a repair; the corpus has gone stale`);
});

test("teeth (e): checkMechanicalRepair catches a corrupted URL and a non-idempotent repair", () => {
  const clean = "we stored the receipt on monday.";
  assert.doesNotThrow(() => checkMechanicalRepair(clean, repairMechanics(clean)));

  const withUrl = "read https://example.test/a?x=1&y=2 on monday.";
  const real = repairMechanics(withUrl);
  assert.doesNotThrow(() => checkMechanicalRepair(withUrl, real));
  // The pass "fixing" the ampersand inside the query string: the link now points elsewhere.
  assert.throws(
    () => checkMechanicalRepair(withUrl, { ...real, replacement: real.replacement.replace("?x=1&y=2", "?x=1, &y=2") }),
    /altered "https:\/\/example\.test/u,
  );
  // A repair that leaves work behind, so the writer is offered the same sentence again.
  assert.throws(
    () => checkMechanicalRepair("the review was brief , but it was thorough.", {
      replacement: "The review was brief , but it was thorough.", reason: "x", ids: ["sentence-capitalisation"],
    }),
    /not idempotent/u,
  );
  assert.throws(() => checkMechanicalRepair(clean, { ...real, replacement: clean }), /change it did not make/u);
  assert.throws(() => checkMechanicalRepair(clean, { ...real, ids: [] }), /reports no fix ids/u);
});

// ---------------------------------------------------------------------------
// (f) analyzeSentence against a fuzzed fake engine.
// ---------------------------------------------------------------------------

const PIPELINE_REJECTIONS = new Set([...REJECTION_REASONS, ...EXTRA_REJECTIONS]);

function checkPipelineResult(sentence, result) {
  assert.equal(result.source, sentence, "the result renamed the sentence it was given");
  assert.ok(result.replacement === null || typeof result.replacement === "string", "replacement is neither null nor a string");
  if (typeof result.replacement === "string") {
    assert.ok(result.replacement.length > 0, "a surfaced replacement is the empty string");
    assert.equal(typeof result.reason, "string", "a surfaced replacement carries no reason");
    // The comment on `rejection` in pipeline.mjs is the contract: null whenever something
    // surfaced. Breaking it lets one sentence be counted as both shown and refused.
    assert.equal(result.rejection, null, "a sentence surfaced a replacement and a rejection at once");
  } else {
    assert.ok(
      result.rejection !== null || result.error !== null || result.modelRejection === null,
      "the model's rewrite was refused but the sentence reports no rejection and no error",
    );
  }
  for (const field of ["rejection", "modelRejection"]) {
    const value = result[field];
    assert.ok(value === null || typeof value === "string", `${field} is neither null nor a string`);
    if (typeof value === "string") {
      assert.ok(PIPELINE_REJECTIONS.has(value), `${field} is the undocumented reason ${value}`);
    }
  }
  // A rejection that reaches the writer can only ever be the model rejection promoted.
  if (typeof result.rejection === "string") {
    assert.equal(result.rejection, result.modelRejection, "rejection and modelRejection disagree");
  }
  assert.equal(typeof result.latencyMs, "number", "latencyMs is not a number");
  assert.equal(typeof result.stages.mechanics, "boolean");
  assert.equal(typeof result.stages.model, "boolean");
  assert.ok(!(result.stages.model && result.replacement === null), "the model stage is credited with nothing to show");
  if (result.error !== null) {
    assert.equal(typeof result.error.kind, "string", "an error carries no kind");
  }
}

// Sources paired with candidates that exercise each branch: clean accept, hard refusal,
// and the single-lost-word case that is the only one handed to the verifier.
const PAIRS = [
  ["we came to the conclusion that the disk failed.", "We concluded that the disk failed."],
  ["The archive is copied on a weekly basis.", "The archive is copied weekly."],
  ["The board reached a decision on the budget.", "The board decided on the budget."],
  ["Store the backup on the array until the audit closes.", "Store the backup on the array."],
  ["Restore 18 files before noon.", "Restore 19 files before noon."],
  ["Read https://example.test/a for detail.", "Read https://example.test/b for detail."],
  ["The team met yesterday.", "Here is a better version: The team convened."],
  ["The team met yesterday.", "First sentence. Second sentence."],
  ["The workshop starts on wednesday.", "The workshop starts on Wednesday."],
  ["The package includes paper,ink, and labels.", "The package includes paper, ink, and labels."],
  ["Maya may ship the build tonight.", "Maya will ship the build tonight."],
  ["  ", "Something."],
  ["...", "Something."],
  ["\uD83D\uDE80", "Something."],
];

function makeFuzzedEngine(rnd) {
  return {
    async rewrite(text) {
      const roll = rnd();
      if (roll < 0.08) throw Object.assign(new Error("engine boom"), { kind: pick(rnd, ["failed", "timeout", "transient"]) });
      if (roll < 0.11) throw Object.assign(new Error("Request superseded"), { kind: "aborted" });
      if (roll < 0.14) throw new TypeError("a plain throw carrying no kind at all");
      if (roll < 0.26) return { action: "keep", replacement: "", reason: "already clear", latencyMs: 4 };
      if (roll < 0.31) return { action: "garbage", replacement: "x", reason: "y" };
      if (roll < 0.35) return { action: "rewrite", replacement: null, reason: "z", latencyMs: 1 };
      if (roll < 0.40) return { action: "rewrite", replacement: generate(rnd, { maxParts: 8 }), reason: "Noise.", latencyMs: 2 };
      const [, candidate] = PAIRS.find(([source]) => source === text) ?? pick(rnd, PAIRS);
      return {
        action: "rewrite",
        replacement: candidate,
        reason: pick(rnd, ["Shorter.", "The sentence is already clear and direct."]),
        latencyMs: Math.floor(rnd() * 100),
      };
    },
    // Mirrors engine.mjs, whose verify() catches everything and reports an outage as a
    // verdict rather than throwing. The unguarded case is covered by the KNOWN-GAP below.
    async verify() {
      const roll = rnd();
      if (roll < 0.30) return { verdict: "unavailable", kind: pick(rnd, ["failed", "timeout", "transient"]), reason: "verifier unavailable: x" };
      return { verdict: roll < 0.60 ? "hide" : "show", reason: "ok" };
    },
  };
}

test("fuzz (f): analyzeSentence only ever propagates aborts, and its result shape is consistent [seed 0xF00D, 1500 iterations]", async () => {
  const rnd = mulberry32(0xF00D);
  const seen = new Set();
  let aborts = 0;
  let surfaced = 0;
  for (let iteration = 0; iteration < 1500; iteration += 1) {
    const [sentence] = pick(rnd, PAIRS);
    const options = {
      engine: makeFuzzedEngine(rnd),
      deletionPolicy: pick(rnd, ["verify", "refuse"]),
      verify: rnd() < 0.85,
      mechanics: rnd() < 0.9,
    };
    let result;
    try {
      result = await analyzeSentence(sentence, options);
    } catch (error) {
      // An abort is the one escape the pipeline documents: the sentence it was asked
      // about has already moved on, so there is nothing to commit.
      assert.equal(error?.kind, "aborted", `iteration ${iteration} threw a non-abort: ${error?.stack}`);
      aborts += 1;
      continue;
    }
    try {
      checkPipelineResult(sentence, result);
    } catch (error) {
      error.message += `\n  iteration ${iteration}\n  sentence ${JSON.stringify(sentence)}\n  result ${JSON.stringify(result)}`;
      throw error;
    }
    if (result.replacement !== null) surfaced += 1;
    for (const reason of [result.rejection, result.modelRejection]) if (reason) seen.add(reason);
  }
  // The corpus has to actually reach both outcomes, or the shape check is vacuous.
  assert.ok(aborts > 20, `only ${aborts} aborts: the abort path is barely exercised`);
  assert.ok(surfaced > 50, `only ${surfaced} suggestions surfaced: the accept path is barely exercised`);
  assert.ok(seen.size >= 6, `only ${seen.size} distinct rejection reasons reached: ${[...seen].sort()}`);
});

test("fuzz (f): an aborted signal is propagated rather than answered [seed 0xF00D, 500 iterations]", async () => {
  const rnd = mulberry32(0xF00D);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const [sentence] = pick(rnd, PAIRS);
    const controller = new AbortController();
    controller.abort();
    const engine = {
      async rewrite() { throw Object.assign(new Error("Request superseded"), { kind: "aborted" }); },
      async verify() { return { verdict: "show", reason: "ok" }; },
    };
    await assert.rejects(
      () => analyzeSentence(sentence, { engine, signal: controller.signal }),
      (error) => error.kind === "aborted",
      `iteration ${iteration}`,
    );
  }
});

test("fuzz (f): with no engine the pipeline still returns a well-formed mechanical result [seed 0xF00D, 500 iterations]", async () => {
  const rnd = mulberry32(0xF00D);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const sentence = generate(rnd, { maxParts: 12, punctuationHeavy: true });
    const result = await analyzeSentence(sentence, {});
    checkPipelineResult(sentence, result);
    assert.equal(result.stages.model, false, `iteration ${iteration}`);
    assert.equal(result.modelRejection, null, `iteration ${iteration}`);
  }
});

test("teeth (f): checkPipelineResult catches a sentence reported as both surfaced and refused", () => {
  const sentence = "we conducted a review of the draft.";
  const good = {
    source: sentence, replacement: "We reviewed the draft.", reason: "Shortens it.", modelReason: null,
    stages: { mechanics: true, model: true }, rejection: null, modelRejection: null,
    rejectedText: null, latencyMs: 3, error: null,
  };
  assert.doesNotThrow(() => checkPipelineResult(sentence, good));

  // Double counting: a report built on this would show the same sentence in both columns.
  assert.throws(
    () => checkPipelineResult(sentence, { ...good, rejection: "content-dropped" }),
    /surfaced a replacement and a rejection at once/u,
  );
  // The model credited for a suggestion that does not exist.
  assert.throws(
    () => checkPipelineResult(sentence, { ...good, replacement: null, reason: null, stages: { mechanics: true, model: true } }),
    /credited with nothing to show/u,
  );
  assert.throws(
    () => checkPipelineResult(sentence, { ...good, replacement: "" }),
    /surfaced replacement is the empty string/u,
  );
  // A rejection invented outside the documented vocabulary.
  assert.throws(
    () => checkPipelineResult(sentence, { ...good, replacement: null, reason: null, stages: { mechanics: true, model: false }, rejection: "vibes", modelRejection: "vibes" }),
    /undocumented reason vibes/u,
  );
  assert.throws(() => checkPipelineResult("a different sentence", good), /renamed the sentence/u);
});

// ---------------------------------------------------------------------------
// KNOWN-GAPS found by fuzzing.
// ---------------------------------------------------------------------------

test("KNOWN-GAP [MEDIUM]: a verifier that throws escapes analyzeSentence instead of failing closed", { todo: true }, async () => {
  // repro: analyzeSentence("we came to the conclusion that the disk failed.", { engine }) where
  //        engine.verify() throws a non-abort error rejects with that error, rather than
  //        returning { modelRejection: "verifier-unavailable" }.
  //
  // pipeline.mjs wraps engine.rewrite() in a try/catch that turns any non-abort failure
  // into result.error, but the engine.verify() call two blocks later is bare. The shipped
  // engine.mjs never trips this — its verify() catches everything and reports an outage as
  // { verdict: "unavailable" } — so the gap is in the pipeline's contract with an injected
  // engine, not in today's behaviour. It matters because the two calls are otherwise
  // symmetrical, and because a thrown verifier error aborts the whole sentence loop, which
  // is precisely the outcome "fail closed, but say what actually happened" rules out.
  const engine = {
    async rewrite() {
      return { action: "rewrite", replacement: "We concluded that the disk failed.", reason: "Shorter.", latencyMs: 1 };
    },
    async verify() { throw Object.assign(new Error("verifier boom"), { kind: "failed" }); },
  };
  const result = await analyzeSentence("we came to the conclusion that the disk failed.", { engine });
  checkPipelineResult("we came to the conclusion that the disk failed.", result);
  assert.equal(result.modelRejection, "verifier-unavailable");
  assert.equal(result.error?.kind, "verifier-unavailable");
});

// The one stated expectation that did not survive contact — "the diff of (s, s + suffix)
// marks nothing before the suffix start" — turned out to be wrong about the code rather
// than the code being wrong: see the comment on the append test above, where the property
// the anchoring actually guarantees is asserted instead. Everything else held.
