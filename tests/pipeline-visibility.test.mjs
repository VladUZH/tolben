// Nothing reaches the writer that they cannot see, and nothing is put to the verifier
// that it has been measured getting wrong.
//
// Three gaps met here. A model rewrite that reverted the mechanical repair used to come
// back as a "suggestion" identical to the writer's own sentence. A rewrite that only
// changed whitespace was accepted with no range to underline and no sentence to explain
// it — and so, silently, was every capitalisation repair, because the diff keys tokens
// case-insensitively and produced no ops at all for one. And a verifier that threw took
// the whole sentence down with it instead of failing closed.
//
// The tests are deterministic: every engine here is a fake with a fixed answer.

import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSentence } from "../src/pipeline.mjs";
import { changedSourceRanges } from "../src/diff.mjs";
import { explainEdit } from "../src/explain.mjs";

const NBSP = " ";
const NNBSP = " ";

// An engine that always proposes the same replacement, whatever it is asked.
const fixedEngine = (replacement, extra = {}) => ({
  rewrite: async () => ({
    action: "rewrite", replacement, reason: "Simplifies the phrasing.", latencyMs: 1,
  }),
  ...extra,
});

// An engine that edits whatever it is handed, so it can revert a mechanical repair.
const mappingEngine = (map) => ({
  rewrite: async (text) => ({
    action: "rewrite", replacement: map(text), reason: "Simplifies the phrasing.", latencyMs: 1,
  }),
});

// ------------------------------------------------- 1. a suggestion is never a no-op

test("a rewrite that lands back on the writer's own sentence is refused as unchanged", async () => {
  // The validator compares the candidate against the mechanically repaired text, so the
  // revert passes it. Only a comparison against the original catches this.
  const source = "The workshop starts on wednesday.";
  const result = await analyzeSentence(source, {
    engine: mappingEngine((text) => text.replace(/Wednesday/u, "wednesday")),
    mechanics: true,
    verify: false,
  });
  assert.equal(result.modelRejection, "unchanged");
  assert.equal(result.rejectedText, source);
  assert.equal(result.stages.model, false);
  // The mechanical repair the model tried to undo still stands on its own.
  assert.equal(result.replacement, "The workshop starts on Wednesday.");
  assert.equal(result.rejection, null, "a sentence that surfaced something is not a refusal");
});

test("the refusal holds when the mechanical pass is not what the model undid", async () => {
  // No mechanical repair to fall back on: the sentence gets nothing at all, and says why.
  const source = "The workshop starts on Wednesday.";
  const result = await analyzeSentence(source, {
    engine: fixedEngine(`  ${source}  `),
    mechanics: false,
    verify: false,
  });
  assert.equal(result.replacement, null);
  assert.equal(result.rejection, "unchanged");
  assert.equal(result.modelRejection, "unchanged");
});

// ------------------------------------------------- 2. every suggestion has a mark

test("a capitalisation repair is underlined", () => {
  // This is the case that was invisible: the diff keys tokens case-insensitively, so
  // "wednesday" and "Wednesday" paired as one `equal` op and nothing was marked at all.
  const source = "The workshop starts on wednesday.";
  const target = "The workshop starts on Wednesday.";
  const marked = changedSourceRanges(source, target).map((r) => source.slice(r.start, r.end));
  assert.deepEqual(marked, ["wednesday"]);

  const opener = changedSourceRanges("the report is ready.", "The report is ready.");
  assert.deepEqual(opener.map((r) => "the report is ready.".slice(r.start, r.end)), ["the"]);

  // Lowering a capital is a change to the writer's text too, and is marked the same way.
  const lowered = changedSourceRanges("The Report is ready.", "The report is ready.");
  assert.deepEqual(lowered.map((r) => "The Report is ready.".slice(r.start, r.end)), ["Report"]);
});

test("a mechanical capitalisation repair reaches the writer with a mark and a reason", async () => {
  const source = "the workshop starts on wednesday.";
  const result = await analyzeSentence(source, { mechanics: true });
  assert.equal(result.replacement, "The workshop starts on Wednesday.");
  assert.equal(result.stages.mechanics, true);
  assert.equal(result.stages.model, false);
  const marked = changedSourceRanges(source, result.replacement)
    .map((range) => source.slice(range.start, range.end));
  assert.deepEqual(marked, ["the", "wednesday"]);
  assert.equal(result.reason, "Capitalizes “The” and “Wednesday”.");
});

test("a rewrite with nothing to underline is refused as an invisible edit", async () => {
  const source = `The panel${NBSP}concluded that it works.`;
  const target = "The panel concluded that it works.";
  // The premise: the change is real, and neither the underline nor the explanation can
  // show it. That is what makes it unshowable rather than merely small.
  assert.deepEqual(changedSourceRanges(source, target), []);
  assert.equal(explainEdit(source, target), "");

  const result = await analyzeSentence(source, {
    engine: fixedEngine(target), mechanics: false, verify: false,
  });
  assert.equal(result.replacement, null, "an unmarkable suggestion reached the writer");
  assert.equal(result.rejection, "invisible-edit");
  assert.equal(result.modelRejection, "invisible-edit");
  assert.equal(result.rejectedText, target);
});

test("the narrow no-break space is the same case and is refused the same way", async () => {
  const source = `The panel${NNBSP}concluded that it works.`;
  const result = await analyzeSentence(source, {
    engine: fixedEngine("The panel concluded that it works."), mechanics: false, verify: false,
  });
  assert.equal(result.replacement, null);
  assert.equal(result.modelRejection, "invisible-edit");
});

test("with the mechanical pass on, the no-break space is repaired before the model sees it", async () => {
  // The repair is made deterministically, so the model is asked about text that no longer
  // contains the character. Its rewrite is then a no-op and is refused by name — and the
  // repair itself still has nothing to underline, so it is not surfaced either.
  const source = `The panel${NBSP}concluded that it works.`;
  const asked = [];
  const engine = {
    rewrite: async (text) => {
      asked.push(text);
      return { action: "rewrite", replacement: "The panel concluded that it works.", reason: "Tidier.", latencyMs: 1 };
    },
  };
  const result = await analyzeSentence(source, { engine, mechanics: true, verify: false });
  assert.deepEqual(asked, ["The panel concluded that it works."]);
  assert.equal(result.stages.mechanics, true);
  assert.equal(result.replacement, null);
  assert.equal(result.modelRejection, "unchanged");
});

test("a whitespace-only mechanical repair is not offered on its own", async () => {
  // Collapsing a doubled space is a real repair with nothing to mark. app-core already
  // rendered no underline for it; the pipeline no longer reports it as surfaced either,
  // so a run's counts and the writer's screen finally agree.
  const result = await analyzeSentence("Section  A is ready.", { mechanics: true });
  assert.equal(result.stages.mechanics, true, "the repair itself is still made");
  assert.equal(result.replacement, null);
});

test("a whitespace repair beside a visible one still reaches the writer, wording and all", async () => {
  const source = `section${NBSP}${NBSP}a is ready.`;
  const result = await analyzeSentence(source, { mechanics: true });
  assert.equal(result.replacement, "Section a is ready.");
  assert.ok(changedSourceRanges(source, result.replacement).length > 0, "nothing to underline");
  assert.equal(result.reason, "Capitalizes “Section”.");
});

test("every suggestion this pipeline surfaces has somewhere to put an underline", async () => {
  // The invariant behind all of the above, swept over the shapes that reach the gate:
  // mechanical repairs, model rewrites, and the two kinds of no-op.
  const cases = [
    ["the report is ready.", null],
    ["The workshop starts on wednesday.", null],
    ["Section  A is ready.", null],
    [`The panel${NBSP}concluded that it works.`, null],
    ["we conducted a review of the draft.", "We reviewed the draft."],
    ["The end result was good.", "The result was good."],
    ["The panel came to the conclusion that it works.", "The panel concluded that it works."],
    [`the panel${NBSP}came to the conclusion that it works.`, "The panel concluded that it works."],
  ];
  let surfaced = 0;
  for (const [source, replacement] of cases) {
    const engine = replacement === null ? undefined : fixedEngine(replacement);
    const result = await analyzeSentence(source, { engine, mechanics: true, verify: false });
    if (result.replacement === null) continue;
    surfaced += 1;
    const label = `${JSON.stringify(source)} -> ${JSON.stringify(result.replacement)}`;
    assert.ok(changedSourceRanges(source, result.replacement).length > 0, `nothing to underline: ${label}`);
    assert.notEqual(result.reason, "", `nothing to say: ${label}`);
    assert.notEqual(result.replacement, source, `offered its own sentence back: ${label}`);
  }
  assert.ok(surfaced >= 5, `the sweep must exercise the surfacing path (${surfaced})`);
});

// ------------------------------------------------- 3. the verifier's contract

const throwing = (error) => ({
  rewrite: async () => ({
    action: "rewrite", replacement: "We concluded that the disk failed.", reason: "Shorter.", latencyMs: 1,
  }),
  verify: async () => { throw error; },
});

test("a verifier that throws fails closed instead of taking the sentence with it", async () => {
  const source = "We came to the conclusion that the disk failed.";
  const result = await analyzeSentence(source, {
    engine: throwing(Object.assign(new Error("verifier boom"), { kind: "failed" })),
  });
  assert.equal(result.replacement, null, "the unverified rewrite must not surface");
  assert.equal(result.modelRejection, "verifier-unavailable");
  assert.equal(result.rejection, "verifier-unavailable");
  assert.equal(result.error?.kind, "verifier-unavailable");
  assert.equal(result.error.message, "verifier boom");
  assert.deepEqual(result.lostWords, ["came"]);
});

test("a verifier that throws with no kind at all is still a closed door", async () => {
  const result = await analyzeSentence("We came to the conclusion that the disk failed.", {
    engine: throwing(new TypeError("engine.verify is not a function")),
  });
  assert.equal(result.replacement, null);
  assert.equal(result.modelRejection, "verifier-unavailable");
  assert.equal(result.error?.kind, "verifier-unavailable");
});

test("an aborted verifier is rethrown, exactly as an aborted rewrite is", async () => {
  // An abort is not an answer: the sentence it was asked about has already moved on, and
  // the caller has to see the abort rather than a refusal invented on its behalf.
  await assert.rejects(
    () => analyzeSentence("We came to the conclusion that the disk failed.", {
      engine: throwing(Object.assign(new Error("Request superseded"), { kind: "aborted" })),
    }),
    (error) => error.kind === "aborted",
  );
});

// ------------------------------------------------- 4. counts are never put to the model

const countCase = (source, replacement) => ({
  source,
  engine: {
    rewrite: async () => ({ action: "rewrite", replacement, reason: "Shorter.", latencyMs: 1 }),
    verify: async () => ({ verdict: "show", reason: "Already implied." }),
  },
});

test("a lost count adverb is refused outright, whatever the verifier would have said", async () => {
  // Measured against the shipped 2B verifier: it approved dropping "twice" from this
  // sentence. The verifier prompt already names this class ("again" tells the reader this
  // has happened before), so the policy no longer depends on the model applying its own rule.
  const { source, engine } = countCase(
    "He counted the coins twice and then pushed them across the table.",
    "He counted the coins and then pushed them across the table.",
  );
  const result = await analyzeSentence(source, { engine });
  assert.equal(result.replacement, null, "the count was dropped on the verifier's say-so");
  assert.equal(result.rejection, "information-dropped");
  assert.equal(result.modelRejection, "information-dropped");
  assert.deepEqual(result.lostWords, ["twice"]);
});

test("the verifier is not even consulted about a lost count adverb", async () => {
  let consulted = 0;
  const engine = {
    rewrite: async () => ({
      action: "rewrite", replacement: "The alarm sounded during the night.", reason: "Shorter.", latencyMs: 1,
    }),
    verify: async () => { consulted += 1; return { verdict: "show", reason: "Already implied." }; },
  };
  const result = await analyzeSentence("The alarm sounded repeatedly during the night.", { engine });
  assert.equal(consulted, 0, "the question was asked anyway");
  assert.equal(result.modelRejection, "information-dropped");
});

test("the whole count and frequency class is refused", async () => {
  // The reason is pinned per row so the layering stays visible: "rarely" is already in the
  // safety gate's quantifier vocabulary and never reaches the deletion policy at all, which
  // is a stricter refusal arriving earlier, not a different outcome.
  const rows = [
    ["He counted the coins twice and then pushed them across the table.",
      "He counted the coins and then pushed them across the table.", "information-dropped"],
    ["She checked the log once before the meeting starts.",
      "She checked the log before the meeting starts.", "information-dropped"],
    ["The script ran thrice without failing.", "The script ran without failing.", "information-dropped"],
    ["The alarm sounded repeatedly during the night.", "The alarm sounded during the night.", "information-dropped"],
    ["The build rarely fails on the runner.", "The build fails on the runner.", "quantifier-changed"],
    ["The team meets frequently to review the plan.", "The team meets to review the plan.", "information-dropped"],
  ];
  for (const [source, replacement, reason] of rows) {
    const { engine } = countCase(source, replacement);
    const result = await analyzeSentence(source, { engine });
    assert.equal(result.replacement, null, `${source} ⇒ ${replacement}`);
    assert.equal(result.modelRejection, reason, `${source} ⇒ ${replacement}`);
  }
});

test("a single lost word outside the class is still the verifier's to judge", async () => {
  // The refusal is a small named class, not a new blanket rule: the one question the
  // verifier is asked still gets asked.
  let consulted = 0;
  const engine = {
    rewrite: async () => ({
      action: "rewrite", replacement: "We concluded that the disk failed.", reason: "Shorter.", latencyMs: 1,
    }),
    verify: async () => { consulted += 1; return { verdict: "show", reason: "Already implied." }; },
  };
  const result = await analyzeSentence("We came to the conclusion that the disk failed.", { engine });
  assert.equal(consulted, 1);
  assert.equal(result.replacement, "We concluded that the disk failed.");
  assert.equal(result.stages.model, true);
});

test("a verifier outage carries the engine's own classification as cause", async () => {
  // The rewrite loses "came", so the verifier is consulted and returns the shape the
  // engine produces for unparseable output: unavailable with kind "failed".
  const engine = {
    rewrite: async () => ({ action: "rewrite", replacement: "We concluded that the disk failed.", reason: "Shorter." }),
    verify: async () => ({ verdict: "unavailable", kind: "failed", reason: "verifier unavailable: unparseable" }),
  };
  const result = await analyzeSentence("We came to the conclusion that the disk failed.", { engine, mechanics: false });
  assert.equal(result.error?.kind, "verifier-unavailable");
  // "failed" = deterministic for this text; a retry policy must not treat it as an outage.
  assert.equal(result.error?.cause, "failed");
});
