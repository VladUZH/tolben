// The Obsidian plugin's controller: which sentences are allowed to reach the model.
//
// In Live Preview the writer sees rendered output, so a suggestion on text inside a code
// fence is worse than useless — the underline lands on something that is not prose and
// Replace would edit code. The editor decides what is excluded (it has the syntax tree);
// the controller only has to honour it, which is what these cover.

import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "../obsidian-plugin/controller.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

function spy(replacement = null) {
  const seen = [];
  const analyze = async (sentence) => {
    seen.push(sentence);
    return {
      source: sentence,
      replacement: replacement ? replacement(sentence) : null,
      reason: "Shorter.",
      stages: { mechanics: false, model: true },
      rejection: null,
    };
  };
  return { analyze, seen };
}

test("an excluded sentence is never sent to the model", async () => {
  const { analyze, seen } = spy();
  const doc = "The archive is copied on a weekly basis.\n\n```\nrm -rf the old files.\n```\n";
  const fenceStart = doc.indexOf("```");
  const controller = createController({
    analyze,
    debounceMs: 1,
    isExcluded: (sentence) => sentence.start >= fenceStart,
  });
  controller.sync(doc);
  await settle();
  assert.deepEqual(seen, ["The archive is copied on a weekly basis."]);
  controller.dispose();
});

test("a sentence that becomes excluded loses the suggestion it already had", async () => {
  const { analyze } = spy((sentence) => sentence.replace("on a weekly basis", "weekly"));
  let excluded = false;
  const doc = "The archive is copied on a weekly basis.\n";
  const controller = createController({
    analyze,
    debounceMs: 1,
    isExcluded: () => excluded,
  });
  controller.sync(doc);
  await settle();
  assert.equal(controller.marks().length > 0, true, "the suggestion should have arrived");

  // The writer wraps the paragraph in a code fence: the text is unchanged, so nothing
  // else in the pipeline notices, and without this the underline would simply stay.
  excluded = true;
  controller.sync(doc);
  assert.deepEqual(controller.marks(), []);
  controller.dispose();
});

test("exclusion is re-asked on every sync, so un-excluding restores analysis", async () => {
  const { analyze, seen } = spy();
  let excluded = true;
  const doc = "The archive is copied on a weekly basis.\n";
  const controller = createController({ analyze, debounceMs: 1, isExcluded: () => excluded });
  controller.sync(doc);
  await settle();
  assert.deepEqual(seen, []);

  excluded = false;
  controller.sync(doc);
  await settle();
  assert.deepEqual(seen, ["The archive is copied on a weekly basis."]);
  controller.dispose();
});

test("with no exclusion configured every complete sentence is analysed", async () => {
  const { analyze, seen } = spy();
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("One sentence here. Another sentence here.\n");
  await settle();
  assert.deepEqual(seen, ["One sentence here.", "Another sentence here."]);
  controller.dispose();
});

// Block markers are the line's structure, not part of its sentence. Sending them to the
// model means every bullet in a note comes back refused by the markup check — correctly,
// since the model does drop them — so they are removed before it ever sees the text, and
// the offsets move with them so the underline still lands on the right characters.
const MARKER_CASES = [
  ["- The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["* The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["+ The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["1. The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["  - The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["- [ ] The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["- [x] The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["> The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["> - The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
  ["## The tool has the ability to recover files.\n", "The tool has the ability to recover files."],
];

for (const [doc, expected] of MARKER_CASES) {
  test(`the model is shown prose, not the block marker: ${JSON.stringify(doc.trimEnd())}`, async () => {
    const { analyze, seen } = spy();
    const controller = createController({ analyze, debounceMs: 1 });
    controller.sync(doc);
    await settle();
    assert.deepEqual(seen, [expected]);
    controller.dispose();
  });
}

test("stripping a marker moves the offsets, so the underline lands on the prose", async () => {
  const doc = "- The tool has the ability to recover files.\n";
  const { analyze } = spy((sentence) => sentence.replace("has the ability to", "can"));
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(doc);
  await settle();
  const marks = controller.marks();
  assert.equal(marks.length, 1);
  assert.equal(doc.slice(marks[0].start, marks[0].end), "has the ability to");
  controller.dispose();
});

test("a hyphen that is not a list marker is left alone", async () => {
  const { analyze, seen } = spy();
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("Well-known tools recover files.\n-5 degrees is the low.\n");
  await settle();
  assert.deepEqual(seen, ["Well-known tools recover files.", "-5 degrees is the low."]);
  controller.dispose();
});

// Inline markup: the model is shown prose, and the answer lands on the right characters.

test("a sentence wrapped in markup is analysed as the prose a reader sees", async () => {
  const { analyze, seen } = spy();
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("**The archive** is *copied on a weekly* basis.\n");
  await settle();
  assert.deepEqual(seen, ["The archive is copied on a weekly basis."]);
  controller.dispose();
});

test("inline code contents are protected on the way to the model", async () => {
  const contexts = [];
  const analyze = async (sentence, { context }) => {
    contexts.push(context);
    return { source: sentence, replacement: null, reason: "", stages: {}, rejection: null };
  };
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("The tool has the ability to run `npm test` first.\n");
  await settle();
  assert.deepEqual(contexts, [{ protectedTerms: ["npm test"] }]);
  controller.dispose();
});

test("underlines land on the rendered words, not on the markup around them", async () => {
  const doc = "**The archive** is *copied on a weekly* basis.\n";
  const { analyze } = spy(() => "The archive is copied weekly.");
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(doc);
  await settle();
  // The same two marks the web demo puts on this sentence, here landing on rendered
  // words inside emphasis rather than on raw markdown.
  assert.deepEqual(controller.marks().map((mark) => doc.slice(mark.start, mark.end)), ["on a", "basis"]);
  controller.dispose();
});

test("an underlined range that spans a delimiter splits around it", async () => {
  const doc = "The tool *has the ability* to recover files.\n";
  const { analyze } = spy(() => "The tool can recover files.");
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(doc);
  await settle();
  // "has the ability to" is one changed range in prose, but the closing "*" sits inside
  // it. Two runs, and the delimiter itself is underlined by neither.
  assert.deepEqual(
    controller.marks().map((mark) => doc.slice(mark.start, mark.end)),
    // The space between them lives after the "*" in the source, so it rides with the
    // second run. In Live Preview the delimiter renders as nothing and the two read as
    // one continuous underline.
    ["has the ability", " to"],
  );
  controller.dispose();
});

test("accepting rewrites the prose and leaves the markup standing", async () => {
  const doc = "**The archive** is *copied on a weekly* basis.\n";
  const { analyze } = spy(() => "The archive is copied weekly.");
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(doc);
  await settle();
  const applied = controller.accept(controller.marks()[0].id);
  assert.equal(doc.slice(applied.from, applied.to), "**The archive** is *copied on a weekly* basis.");

  let result = "";
  let cursor = 0;
  for (const edit of applied.edits) {
    result += doc.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  result += doc.slice(cursor);
  assert.equal(result, "**The archive** is *copied weekly*.\n");
  controller.dispose();
});

test("accepting a suggestion whose sentence has moved on yields nothing", async () => {
  const { analyze } = spy(() => "The archive is copied weekly.");
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("The archive is copied on a weekly basis.\n");
  await settle();
  const id = controller.marks()[0].id;
  controller.sync("The archive is copied on a weekly basis, roughly.\n");
  assert.equal(controller.accept(id), null);
  controller.dispose();
});

test("a sentence carrying a code fence is never analysed, syntax tree or not", async () => {
  // Exclusion normally comes from CodeMirror's syntax tree, which parses lazily: a fence
  // far down a long note may not be known to be one yet. A fence marker in the raw text
  // is proof on its own, and without this the flattener treats the backticks as inline
  // code and an accepted edit eats them.
  const { analyze, seen } = spy();
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("```\nThe code has the ability to run.\n```\n");
  await settle();
  assert.deepEqual(seen, []);
  controller.dispose();
});

// Viewport-scoped analysis. CodeMirror does not render decorations outside the viewport,
// so analysing the whole document buys suggestions that cannot be displayed — and on a
// single-slot model server it buys them one at a time, ahead of the ones that can.

const LONG_DOC = [
  "The archive is copied on a weekly basis.",
  "The tool has the ability to recover files.",
  "We conducted a review of the draft.",
  "The router is located in close proximity to the desk.",
].join("\n\n") + "\n";

// Sentences are analysed only while they intersect this window.
function windowed(from, to) {
  return (sentence) => sentence.start < to.value && sentence.end > from.value;
}

test("only sentences in the visible window are sent to the model", async () => {
  const { analyze, seen } = spy();
  const from = { value: 0 };
  const to = { value: LONG_DOC.indexOf("We conducted") };
  const controller = createController({ analyze, debounceMs: 1, isVisible: windowed(from, to) });
  controller.sync(LONG_DOC);
  await settle();
  assert.deepEqual(seen, [
    "The archive is copied on a weekly basis.",
    "The tool has the ability to recover files.",
  ]);
  controller.dispose();
});

test("scrolling analyses what comes into view, without re-reading the document", async () => {
  const { analyze, seen } = spy();
  const from = { value: 0 };
  const to = { value: LONG_DOC.indexOf("We conducted") };
  const controller = createController({ analyze, debounceMs: 1, isVisible: windowed(from, to) });
  controller.sync(LONG_DOC);
  await settle();
  assert.equal(seen.length, 2);

  from.value = LONG_DOC.indexOf("We conducted");
  to.value = LONG_DOC.length;
  controller.refresh();
  await settle();
  assert.deepEqual(seen.slice(2), [
    "We conducted a review of the draft.",
    "The router is located in close proximity to the desk.",
  ]);
  controller.dispose();
});

test("scrolling back asks nothing again", async () => {
  const { analyze, seen } = spy();
  const from = { value: 0 };
  const to = { value: LONG_DOC.indexOf("We conducted") };
  const controller = createController({ analyze, debounceMs: 1, isVisible: windowed(from, to) });
  controller.sync(LONG_DOC);
  await settle();

  from.value = LONG_DOC.indexOf("We conducted");
  to.value = LONG_DOC.length;
  controller.refresh();
  await settle();
  const asked = seen.length;

  from.value = 0;
  to.value = LONG_DOC.indexOf("We conducted");
  controller.refresh();
  await settle();
  assert.equal(seen.length, asked, "a decided sentence was asked about twice");
  controller.dispose();
});

test("a suggestion is kept when its sentence scrolls out of view", async () => {
  const { analyze } = spy((sentence) => sentence.replace("on a weekly basis", "weekly"));
  const from = { value: 0 };
  const to = { value: LONG_DOC.length };
  const controller = createController({ analyze, debounceMs: 1, isVisible: windowed(from, to) });
  controller.sync(LONG_DOC);
  await settle();
  const before = controller.marks().length;
  assert.ok(before > 0);

  // Scrolled past. The marks are off screen and CodeMirror will not draw them, but
  // throwing them away would mean paying for the same answer again on the way back.
  from.value = LONG_DOC.indexOf("We conducted");
  controller.refresh();
  assert.equal(controller.marks().length, before);
  controller.dispose();
});

test("a sentence that leaves the window before its debounce fires is never sent", async () => {
  const { analyze, seen } = spy();
  const from = { value: 0 };
  const to = { value: LONG_DOC.length };
  const controller = createController({ analyze, debounceMs: 40, isVisible: windowed(from, to) });
  controller.sync(LONG_DOC);
  // Scrolled away inside the debounce window, before anything was submitted.
  to.value = LONG_DOC.indexOf("The tool");
  controller.refresh();
  await settle();
  assert.deepEqual(seen, ["The archive is copied on a weekly basis."]);
  controller.dispose();
});

test("with no visibility configured the whole document is analysed", async () => {
  const { analyze, seen } = spy();
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(LONG_DOC);
  await settle();
  assert.equal(seen.length, 4);
  controller.dispose();
});

// Leaving the viewport has to reach requests that were already submitted, not just
// debounces that have not fired. Every debounce in a window fires within milliseconds of
// each other, so by the time a writer has scrolled anywhere the queue already holds the
// work — and a queue that is never re-examined drains top to bottom regardless of where
// they are looking, which is the whole behaviour this was meant to fix.

function blocking() {
  const calls = [];
  const analyze = (sentence, { signal }) => {
    const call = { sentence, signal, done: false };
    calls.push(call);
    return new Promise((resolve, reject) => {
      call.finish = () => {
        call.done = true;
        resolve({ source: sentence, replacement: null, reason: "", stages: {}, rejection: null });
      };
      signal?.addEventListener("abort", () => {
        call.aborted = true;
        reject(Object.assign(new Error("aborted"), { kind: "aborted" }));
      }, { once: true });
    });
  };
  return { analyze, calls };
}

test("a queued request is dropped when its sentence scrolls out of view", async () => {
  const { analyze, calls } = blocking();
  const from = { value: 0 };
  const to = { value: LONG_DOC.length };
  const controller = createController({ analyze, debounceMs: 1, isVisible: windowed(from, to) });
  controller.sync(LONG_DOC);
  await settle();
  // The model has one slot, so the coordinator runs one at a time; the rest queue.
  assert.equal(calls.length, 1, "expected one running and the rest queued");

  // Scrolled to the top. The queued sentences are no longer anywhere near the viewport.
  to.value = LONG_DOC.indexOf("The tool");
  controller.refresh();

  // Let the running pair finish, freeing both slots.
  for (const call of calls) call.finish();
  await settle();

  const asked = calls.map((call) => call.sentence);
  assert.ok(!asked.includes("We conducted a review of the draft."), "a queued sentence ran anyway");
  assert.ok(!asked.includes("The router is located in close proximity to the desk."));
  controller.dispose();
});

test("a running request is aborted when its sentence scrolls out of view", async () => {
  const { analyze, calls } = blocking();
  const from = { value: 0 };
  const to = { value: LONG_DOC.length };
  const controller = createController({ analyze, debounceMs: 1, isVisible: windowed(from, to) });
  controller.sync(LONG_DOC);
  await settle();
  assert.equal(calls.length, 1);

  // Scrolled past everything that is running. The model has one slot: holding it for text
  // nobody is looking at is precisely the cost this is supposed to avoid, and aborting
  // hands it straight back.
  from.value = LONG_DOC.indexOf("We conducted");
  to.value = LONG_DOC.length;
  controller.refresh();
  await settle();

  assert.equal(calls[0].aborted, true, "the running request was not aborted");
  controller.dispose();
});

// mapOffsets: the cheap bridge between a CodeMirror dispatch and the deferred resync.
// The editor maps sentence offsets through the transaction's ChangeSet immediately, so
// anything read in the gap — marks, accept guards — addresses the characters where they
// now are; the full resync follows a tick later.

test("mapOffsets shifts marks with the text they belong to", async () => {
  const doc = "The archive is copied on a weekly basis.\n";
  const { analyze } = spy(() => "The archive is copied weekly.");
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(doc);
  await settle();
  const before = controller.marks();
  assert.ok(before.length > 0);

  // "Intro.\n" (7 chars) inserted above the sentence, as update.changes.mapPos reports it.
  controller.mapOffsets((pos) => pos + 7);
  const after = controller.marks();
  assert.deepEqual(after.map((m) => m.start), before.map((m) => m.start + 7));
  assert.deepEqual(after.map((m) => m.end), before.map((m) => m.end + 7));

  // The deferred resync then lands on the real text and agrees: the sentence's own text
  // is unchanged, so the suggestion survives at the mapped offsets.
  controller.sync(`Intro.
${doc}`);
  assert.deepEqual(controller.marks(), after);
  controller.dispose();
});

test("accept computes edits from mapped offsets in the gap before resync", async () => {
  const doc = "Intro line one.\nThe archive is copied on a weekly basis.\n";
  const { analyze } = spy((s) => s === "The archive is copied on a weekly basis."
    ? "The archive is copied weekly." : null);
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(doc);
  await settle();
  const id = controller.marks()[0].id;

  // Text inserted above the sentence; offsets mapped, resync not yet run.
  const shifted = `abc ${doc}`;
  controller.mapOffsets((pos) => pos + 4);
  const applied = controller.accept(id);
  assert.ok(applied, "accept refused after mapping");
  assert.equal(shifted.slice(applied.from, applied.to), "The archive is copied on a weekly basis.");
  controller.dispose();
});

// Scheduling: the single model slot goes where the reader is looking.

test("rank decides who gets the slot next, not document order", async () => {
  const { analyze, calls } = blocking();
  // Reverse document order: the LAST sentence ranks best.
  const controller = createController({
    analyze,
    debounceMs: 1,
    rank: (sentence) => -sentence.start,
  });
  controller.sync(LONG_DOC);
  await settle();
  // One slot: the first submit grabbed it before rank could matter.
  assert.equal(calls.length, 1);
  calls[0].finish();
  await settle();
  // The freed slot goes to the best-ranked waiter — the last sentence, not the second.
  assert.equal(calls[1].sentence, "The router is located in close proximity to the desk.");
  controller.dispose();
});

test("typing in one sentence does not reset the others' debounce", async () => {
  const { analyze, seen } = spy();
  const base = "The archive is copied weekly. The tool recovers files. ";
  const controller = createController({ analyze, debounceMs: 40 });
  controller.sync(base);
  // Continuous typing: syncs every 15ms, never a 40ms pause. The trailing fragment has no
  // terminator, so it is never itself scheduled. Before the fix every sync re-armed every
  // timer, so nothing was submitted until the writer stopped — measured as zero model
  // calls during 600ms of continuous typing, then a burst.
  let extra = "";
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    extra += "x";
    controller.sync(`${base}And still typing ${extra}`);
  }
  assert.equal(seen.length, 2, "the settled sentences should have been analysed mid-typing");
  controller.dispose();
});

// Instant mechanical repairs and bounded failure retries.

test("a mechanical repair surfaces immediately while the model is still thinking", async () => {
  const { analyze, calls } = blocking();
  const controller = createController({
    analyze,
    debounceMs: 1,
    analyzeLocal: async (sentence) => sentence.includes("Teh")
      ? { replacement: sentence.replace("Teh", "The"), reason: "Fixes “Teh”.", stages: { mechanics: true, model: false } }
      : { replacement: null },
  });
  controller.sync("Teh archive is copied weekly.\n");
  await settle();
  // The model call is parked unresolved; the deterministic repair is already on screen.
  assert.equal(calls.length, 1);
  const marks = controller.marks();
  assert.ok(marks.length > 0, "no provisional mark");
  assert.equal(controller.store.get(marks[0].id).stages.mechanics, true);
  controller.dispose();
});

test("the model's decision replaces the provisional repair when it lands", async () => {
  let resolveModel;
  const analyze = () => new Promise((resolve) => { resolveModel = resolve; });
  const controller = createController({
    analyze,
    debounceMs: 1,
    analyzeLocal: async (sentence) => ({
      replacement: sentence.replace("Teh", "The"),
      reason: "Fixes “Teh”.",
      stages: { mechanics: true, model: false },
    }),
  });
  const source = "Teh archive is copied on a weekly basis.";
  controller.sync(`${source}\n`);
  await settle();
  resolveModel({
    source,
    replacement: "The archive is copied weekly.",
    reason: "Shortens it.",
    stages: { mechanics: true, model: true },
    rejection: null,
  });
  await settle();
  const suggestion = controller.store.get(controller.marks()[0].id);
  assert.equal(suggestion.replacement, "The archive is copied weekly.");
  assert.equal(suggestion.stages.model, true);
  controller.dispose();
});

test("a transient failure is retried a bounded number of times, not forever", async () => {
  let attempts = 0;
  const analyze = async () => {
    attempts += 1;
    throw Object.assign(new Error("model down"), { kind: "transient" });
  };
  const doc = "The archive is copied weekly.\n";
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync(doc);
  await settle();
  // Every subsequent sync — typing pauses, scrolls — used to buy another wasted call.
  for (let round = 0; round < 5; round += 1) {
    controller.refresh();
    await settle();
  }
  assert.equal(attempts, 2, "expected exactly the bounded retries");
  controller.dispose();
});

test("a permanent failure is never re-asked for the same text", async () => {
  let attempts = 0;
  const analyze = async () => {
    attempts += 1;
    throw Object.assign(new Error("unparseable"), { kind: "failed" });
  };
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("The archive is copied weekly.\n");
  await settle();
  controller.refresh();
  await settle();
  assert.equal(attempts, 1);
  controller.dispose();
});

test("a success elsewhere does NOT lift a hold — recovery is the cooldown, not luck", async () => {
  // The old rule (any success clears the whole ledger) meant one pathological sentence —
  // an always-timing-out run-on, say — was re-bought after every success anywhere,
  // permanently degrading the single slot. Held sentences now wait out a backoff.
  const seen = [];
  const analyze = async (sentence) => {
    seen.push(sentence);
    if (sentence.startsWith("Broken")) throw Object.assign(new Error("busy"), { kind: "transient" });
    return { source: sentence, replacement: null, reason: "", stages: {}, rejection: null };
  };
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("Broken sentence stays broken.\n");
  await settle();
  controller.refresh();
  await settle();
  const heldAt = seen.filter((s) => s.startsWith("Broken")).length;
  assert.equal(heldAt, 2, "both attempts spent");

  controller.sync("Broken sentence stays broken.\n\nA healthy sentence succeeds.\n");
  await settle();
  assert.ok(seen.includes("A healthy sentence succeeds."));
  controller.refresh();
  await settle();
  assert.equal(seen.filter((s) => s.startsWith("Broken")).length, heldAt, "the success re-bought the doomed sentence");
  controller.dispose();
});

test("the cooldown grants a held sentence one retry after it expires", async () => {
  let now = 1_000_000;
  let attempts = 0;
  const analyze = async () => {
    attempts += 1;
    throw Object.assign(new Error("busy"), { kind: "transient" });
  };
  const controller = createController({ analyze, debounceMs: 1, clock: () => now });
  const doc = "The archive is copied weekly.\n";
  controller.sync(doc);
  await settle();
  controller.refresh();
  await settle();
  assert.equal(attempts, 2, "budget spent");
  controller.refresh();
  await settle();
  assert.equal(attempts, 2, "held");

  // The server comes back some time later; the next look retries once.
  now += 10 * 60_000;
  controller.refresh();
  await settle();
  assert.equal(attempts, 3, "the cooldown should grant one retry");
  // And a hold after a failed retry backs off again rather than spinning.
  controller.refresh();
  await settle();
  assert.equal(attempts, 3);
  controller.dispose();
});

test("one real failure shared by joined awaiters counts once, not per awaiter", async () => {
  // A refresh while a call is in flight arms a fresh debounce, which joins the same
  // coordinator entry. The one rejection then reaches both awaiters — and used to burn
  // both retry attempts, so the retry the ledger promises never happened.
  let attempts = 0;
  let rejectCall;
  const analyze = () => new Promise((resolve, reject) => {
    attempts += 1;
    rejectCall = () => reject(Object.assign(new Error("busy"), { kind: "transient" }));
  });
  const controller = createController({ analyze, debounceMs: 1 });
  controller.sync("The archive is copied weekly.\n");
  await settle();
  assert.equal(attempts, 1);
  controller.refresh();          // arms a second debounce that joins the in-flight call
  await settle();
  assert.equal(attempts, 1, "the refresh must join, not restart");
  rejectCall();
  await settle();
  controller.refresh();
  await settle();
  assert.equal(attempts, 2, "one failure must leave one retry in the budget");
  controller.dispose();
});

test("accepting a mechanics-only card leaves the sentence open for the model", async () => {
  // Accepting the fast provisional card mid-flight aborts the model call; recording the
  // result as decided would mean the accepted sentence — possibly still wordy — was
  // never reviewed at all. A model-stage accept stays decided (that guard is what stops
  // the model reviewing its own output).
  const asked = [];
  const analyze = (sentence) => { asked.push(sentence); return new Promise(() => {}); };
  const controller = createController({
    analyze,
    debounceMs: 1,
    analyzeLocal: async (sentence) => sentence.includes("Yuor")
      ? { replacement: sentence.replace("Yuor", "Your"), reason: "Fixes it.", stages: { mechanics: true, model: false } }
      : { replacement: null },
  });
  controller.sync("Yuor archive is copied weekly.\n");
  await settle();
  const id = controller.marks()[0].id;
  const applied = controller.accept(id);
  assert.ok(applied);
  // The edit lands; the resync sees the repaired sentence — which the model never saw.
  controller.sync("Your archive is copied weekly.\n");
  await settle();
  assert.ok(asked.includes("Your archive is copied weekly."), "the repaired sentence was never offered to the model");
  controller.dispose();
});
