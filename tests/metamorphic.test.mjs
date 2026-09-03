// Metamorphic tests: properties that relate one run to another rather than pinning a
// single expected output. Every engine here is fake and deterministic, so a failure
// always accuses the code under test and never the model.
//
// The relations checked are:
//   1. scope        - what the editor sends for sentence N depends only on sentence N.
//   2. renaming     - consistently renaming an entity leaves the validator's verdict alone.
//   3. concatenation - segmenting A+B equals segmenting A and B apart, at a real boundary.
//   4. convergence  - an accepted edit, once applied, cannot propose itself again.
//   5. scope again  - dismissing or replacing sentence N leaves sentence M untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createApp } from "../src/app-core.mjs";
import { resetIds } from "../src/identity.mjs";
import { validateRewrite } from "../src/safety.mjs";
import { repairMechanics } from "../src/mechanics.mjs";
import { segmentSentences, isCompleteSentence } from "../src/segmenter.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function mount({ respond }) {
  resetIds();
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/", pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    if (url === "/api/status") {
      return { ok: true, json: async () => ({ ready: true, model: "test-model" }) };
    }
    const body = JSON.parse(options.body);
    calls.push(body);
    if (options.signal?.aborted) throw Object.assign(new Error("aborted"), { kind: "aborted" });
    return { ok: true, json: async () => respond(body) };
  };
  const app = createApp({ document: window.document, window, fetchImpl, debounceMs: 1 });
  return { window, app, calls };
}

const rewriteOf = (source, replacement) => ({
  source, replacement, reason: "Removes wordiness.",
  stages: { mechanics: false, model: true }, rejection: null, latencyMs: 5, totalMs: 6,
});
const keepOf = (source) => ({
  source, replacement: null, reason: null,
  stages: { mechanics: false, model: false }, rejection: null, latencyMs: 5, totalMs: 6,
});

async function type(app, window, value) {
  app.editor.value = value;
  app.editor.dispatchEvent(new window.Event("input"));
  await tick(14);
}

// ------------------------------------------------- 1. sentence-scope independence

test("what is sent for a sentence is that sentence, whatever surrounds it", async () => {
  const { window, app, calls } = mount({ respond: ({ sentence }) => keepOf(sentence) });
  await type(app, window,
    "The end result was good. We shipped it anyway. Maya reviewed the release. It failed twice.");
  await tick(14);
  assert.deepEqual(calls.map((call) => call.sentence).sort(), [
    "It failed twice.",
    "Maya reviewed the release.",
    "The end result was good.",
    "We shipped it anyway.",
  ]);
  // Nothing carries a neighbour's text, leading space, or the whole document.
  for (const call of calls) assert.equal(call.sentence, call.sentence.trim());
});

test("the request for one sentence is byte-identical across five surroundings", async () => {
  const target = "The end result was good.";
  const contexts = [
    target,
    `Maya left. ${target}`,
    `${target} We shipped it anyway.`,
    `Maya left. ${target} We shipped it anyway.`,
    `Maya left.\n${target}\nWe shipped it anyway.`,
  ];
  const payloads = [];
  for (const document of contexts) {
    const { window, app, calls } = mount({ respond: ({ sentence }) => keepOf(sentence) });
    await type(app, window, document);
    await tick(14);
    const forTarget = calls.filter((call) => call.sentence.includes("end result"));
    assert.equal(forTarget.length, 1, `sent ${forTarget.length} times for: ${document}`);
    payloads.push(forTarget[0]);
  }
  for (const payload of payloads) {
    assert.deepEqual(payload, { sentence: target, mechanics: true });
  }
});

test("editing sentence 1 does not re-send the unchanged sentence 2", async () => {
  const { window, app, calls } = mount({ respond: ({ sentence }) => keepOf(sentence) });
  await type(app, window, "The end result was good. We shipped it anyway.");
  await tick(14);
  assert.equal(calls.length, 2);
  calls.length = 0;

  await type(app, window, "The end result was excellent. We shipped it anyway.");
  await tick(14);
  assert.deepEqual(calls.map((call) => call.sentence), ["The end result was excellent."],
    "only the edited sentence is asked about again");

  // The same holds for an insertion in front of both sentences.
  calls.length = 0;
  await type(app, window, "Maya left. The end result was excellent. We shipped it anyway.");
  await tick(14);
  assert.deepEqual(calls.map((call) => call.sentence), ["Maya left."]);
});

// ---------------------------------------------------- 2. rename consistency

const rewrite = (replacement, reason = "A restrained edit.") =>
  ({ action: "rewrite", replacement, reason });

// (source, candidate) pairs spanning accepted verdicts and five distinct refusals. Each
// carries the entities the renamings below rewrite, on both sides of the edit.
const RENAMEABLE = [
  ["Maya conducted a review of the Monday draft.", "Maya reviewed the Monday draft."],
  ["Maya has the ability to restore 3 files from v2.", "Maya can restore 3 files from v2."],
  ["Maya may ship v2 on Monday.", "Maya will ship v2 on Monday."],
  ["Maya restored 18 files from v2 on Monday.", "Maya restored 3 files from v2 on Monday."],
  ["The v2 rollout is copied on a weekly basis by Maya.", "The v2 rollout is copied weekly by Maya."],
  ["Maya did not restore the 18 files on Monday.", "Maya restored the 18 files on Monday."],
  ["Maya made a recommendation to update v2 on Monday.", "Maya recommended updating v2 on Monday."],
  ["Maya took into consideration the 18 remarks about v2.", "Maya considered the 18 remarks about v2."],
  ["It is important to note that Maya files the v2 report on Monday.", "Maya files the v2 report on Monday."],
  ["Maya reviewed the 18 drawings and Rina approved the v2 layout.", "Maya reviewed the 18 drawings."],
];

const RENAMINGS = [
  [["Maya", "Priya"]],
  [["Monday", "Friday"], ["monday", "friday"]],
  [["v2", "v9"]],
  [["Maya", "Priya"], ["Monday", "Friday"], ["v2", "v9"], ["Rina", "Dana"]],
];

const rename = (text, pairs) => pairs.reduce(
  (acc, [from, to]) => acc.replace(new RegExp(`\\b${from}\\b`, "gu"), to), text);
// Every digit shifted by one: the arithmetic changes, the shape of every number does not.
const shiftDigits = (text) => text.replace(/\d/gu, (digit) => String((Number(digit) + 1) % 10));

test("renaming an entity in both source and candidate cannot change the verdict", () => {
  let substitutions = 0;
  for (const [source, candidate] of RENAMEABLE) {
    const base = validateRewrite(source, rewrite(candidate));
    for (const pairs of RENAMINGS) {
      const renamedSource = rename(source, pairs);
      const renamedCandidate = rename(candidate, pairs);
      if (renamedSource !== source || renamedCandidate !== candidate) substitutions += 1;
      const verdict = validateRewrite(renamedSource, rewrite(renamedCandidate));
      assert.equal(verdict.accepted, base.accepted,
        `${renamedSource} -> ${renamedCandidate}: ${verdict.reason} vs ${base.reason}`);
      assert.equal(verdict.reason, base.reason);
    }
  }
  assert.ok(substitutions >= 30, `the renamings must actually bite (${substitutions})`);
});

test("shifting every digit in both source and candidate cannot change the verdict", () => {
  for (const [source, candidate] of RENAMEABLE) {
    const base = validateRewrite(source, rewrite(candidate));
    const shifted = validateRewrite(shiftDigits(source), rewrite(shiftDigits(candidate)));
    assert.equal(shifted.accepted, base.accepted, `${shiftDigits(source)} -> ${shiftDigits(candidate)}`);
    assert.equal(shifted.reason, base.reason);
  }
});

// Teeth for the two tests above: renaming ONE side is exactly the corruption a validator
// blind to names or identifiers would wave through, and it must not be waved through.
test("renaming only the candidate is refused - the invariance tests would catch a blind validator", () => {
  const oneSided = [
    ["Maya conducted a review of the Monday draft.", "Priya reviewed the Monday draft.", "name-changed"],
    ["Maya has the ability to restore 3 files from v2.", "Maya can restore 3 files from v9.", "protected-token-changed"],
    ["Maya has the ability to restore 3 files from v2.", "Maya can restore 7 files from v2.", "numbers-changed"],
    ["Maya reviewed the Monday draft.", "Maya reviewed the Friday draft.", "name-changed"],
  ];
  for (const [source, candidate, reason] of oneSided) {
    const verdict = validateRewrite(source, rewrite(candidate));
    assert.equal(verdict.accepted, false, `${source} -> ${candidate}`);
    assert.equal(verdict.reason, reason);
  }
});

// ------------------------------------------------- 3. concatenation of segmentation

const CONCAT_HEADS = [
  "Alpha runs", "Dr. Chen left", "It failed", 'He asked "why', "The file is a.csv",
  "Version v2 shipped at 14:30", "42 items arrived", "Really", "e.g. the pump stalled",
];
const CONCAT_ENDS = [".", "!", "?", "...", '."', ".)", "?!"];
const CONCAT_TAILS = ["", " ", "  ", "\n", " \n", "\t", "\n\n"];
const CONCAT_TAILDOCS = [
  "Beta walks.", " Beta walks.", "\nBeta walks.", '"Quoted." ok.', ")close it.",
  "...more.", "42 shipped. Then nine.", "Gamma waits. Delta sleeps.", "unfinished text", "\tTabbed.",
];

// The boundary A+B splits at is decided by what the segmenter is still willing to swallow
// after A's terminator: more terminators, closers, spaces/tabs, then one newline. So the
// join is safe exactly when A already ends on that boundary and B cannot extend it.
function splitsCleanly(a, b) {
  const segments = segmentSentences(a);
  if (segments.length === 0) return false;
  const last = segments[segments.length - 1];
  if (last.end !== a.length) return false;              // A's tail is not all segmented
  if (!isCompleteSentence(last.text)) return false;     // A ends mid-sentence
  if (a.endsWith("\n")) return true;                    // the newline closes the scan
  return /[ \t]$/u.test(a) && !/^[ \t\n]/u.test(b);     // B must not extend A's space run
}

const shift = (segments, offset) => segments.map((segment) => ({
  text: segment.text, start: segment.start + offset, end: segment.end + offset,
}));

test("segmenting A+B equals segmenting A and B apart at a clean boundary", () => {
  let cases = 0;
  for (const head of CONCAT_HEADS) {
    for (const end of CONCAT_ENDS) {
      for (const tail of CONCAT_TAILS) {
        const a = head + end + tail;
        for (const b of CONCAT_TAILDOCS) {
          if (!splitsCleanly(a, b)) continue;
          cases += 1;
          assert.deepEqual(
            segmentSentences(a + b),
            [...segmentSentences(a), ...shift(segmentSentences(b), a.length)],
            `${JSON.stringify(a)} + ${JSON.stringify(b)}`,
          );
        }
      }
    }
  }
  assert.ok(cases >= 2000, `the matrix must exercise the property (${cases} cases)`);
});

test("the precondition is load-bearing: these joins genuinely do not split", () => {
  // No whitespace at the boundary: "runs.Beta" reads as one token, like "report.csv".
  assert.deepEqual(segmentSentences("Alpha runs.Beta walks.").map((s) => s.text),
    ["Alpha runs.Beta walks."]);
  // A's trailing space run is extended by B's leading space, so the boundary moves.
  assert.deepEqual(segmentSentences("Alpha runs.  Beta walks.").map((s) => s.start), [0, 13]);
  assert.notDeepEqual(
    segmentSentences("Alpha runs. " + " Beta walks."),
    [...segmentSentences("Alpha runs. "), ...shift(segmentSentences(" Beta walks."), 12)],
  );
  // An unfinished A swallows B whole.
  assert.deepEqual(segmentSentences("Alpha runs Beta walks.").map((s) => s.text),
    ["Alpha runs Beta walks."]);
});

// ----------------------------------------------------------- 4. convergence

// A representative dozen of the MUST-ACCEPT edits, restated here so that this file is
// self-contained and so a change to tests/safety.test.mjs cannot silently weaken it.
const ACCEPTED = [
  ["The tool has the ability to recover 3 files.", "The tool can recover 3 files."],
  ["We conducted a review of the draft.", "We reviewed the draft."],
  ["The router is located in close proximity to the desk.", "The router is near the desk."],
  ["The workshop starts on wednesday.", "The workshop starts on Wednesday."],
  ["Your expected to archive the copy.", "You're expected to archive the copy."],
  ["A set of revised drawings are attached.", "A set of revised drawings is attached."],
  ["The archive is copied on a weekly basis.", "The archive is copied weekly."],
  ["The auditor made a recommendation to update the retention policy.", "The auditor recommended updating the retention policy."],
  ["Rina provided an explanation of the new approval process.", "Rina explained the new approval process."],
  ["Each and every applicant must sign the consent form.", "Each applicant must sign the consent form."],
  ["Due to the fact that the server was unavailable, the job failed.", "Because the server was unavailable, the job failed."],
  ["The technician will arrive in the near future.", "The technician will arrive soon."],
  ["There are three bolts that require replacement.", "Three bolts require replacement."],
  ["The purpose of this memo is to explain the new refund rule.", "This memo explains the new refund rule."],
];

test("an accepted suggestion, once applied, cannot re-propose itself", () => {
  for (const [source, replacement] of ACCEPTED) {
    assert.equal(validateRewrite(source, rewrite(replacement)).accepted, true,
      `precondition: ${source} -> ${replacement} must be accepted`);
    // The applied text arriving back with the identical rewrite is refused as a no-op,
    // so no accepted edit can be offered a second time on its own output.
    assert.deepEqual(validateRewrite(replacement, rewrite(replacement)),
      { accepted: false, reason: "unchanged" });
  }
});

test("the mechanical pass reaches its fixed point in one round", () => {
  const inputs = [
    "we shipped it on monday .",
    "the report is due on friday,and the draft is late.",
    "Section  A  is  ready.",
    "check /srv/data,backup and monday.log for the trace.",
    "email ops@example.test on tuesday ,please.",
    "v2 was released in march.",
    "we met on wednesday: the notes are in /srv/notes.md.",
    "read https://a.test/x,y before monday.",
    "  the batch failed ,twice.",
    "q3.csv was updated on sunday.",
    "the launch is on august 3 .",
    "the deadline is in may.",
    ...ACCEPTED.map(([, replacement]) => replacement),
  ];
  let repaired = 0;
  for (const input of inputs) {
    const first = repairMechanics(input);
    if (!first) continue;
    repaired += 1;
    assert.equal(repairMechanics(first.replacement), null,
      `${JSON.stringify(input)} -> ${JSON.stringify(first.replacement)} still wants repair`);
  }
  assert.ok(repaired >= 10, `the corpus must exercise the repair path (${repaired})`);
});

const fixedEngine = (replacement) => ({
  rewrite: async () => ({ action: "rewrite", replacement, reason: "Simplifies the phrasing.", latencyMs: 1 }),
});

test("re-running the pipeline on an applied suggestion offers nothing further", async () => {
  for (const [source, replacement] of ACCEPTED) {
    const first = await analyzeSentence(source, {
      engine: fixedEngine(replacement), mechanics: true, verify: false,
    });
    assert.equal(first.replacement, replacement, `first pass on ${source}`);
    const second = await analyzeSentence(replacement, {
      engine: fixedEngine(replacement), mechanics: true, verify: false,
    });
    assert.equal(second.replacement, null,
      `${JSON.stringify(replacement)} was offered ${JSON.stringify(second.replacement)} again`);
    assert.equal(second.rejection, "unchanged");
  }
});

// Was a KNOWN-GAP (severity: medium). With the mechanical pass on, a model rewrite that
// simply reverts the mechanical repair passed validation, because the validator compares
// the candidate against the REPAIRED text (`base`) and not against the writer's sentence.
// The pipeline handed back a "suggestion" whose replacement was character-for-character
// the sentence the writer already had. app-core dropped it (`outcome.replacement === text`)
// so no underline appeared, but bench/run.mjs counted it as a surfaced suggestion.
// Repro that used to hold (fully deterministic, no seed needed):
//   engine.rewrite = (t) => ({ action: "rewrite", replacement: t.replace("Wednesday", "wednesday") })
//   await analyzeSentence("The workshop starts on wednesday.", { engine, mechanics: true, verify: false })
//   -> { replacement: "The workshop starts on wednesday.", stages: { mechanics: true, model: true } }
// The pipeline now compares the final replacement against the ORIGINAL sentence and
// refuses it as "unchanged", whatever the validator made of it against `base`.
test("a pipeline suggestion is never identical to the sentence it was asked about", async () => {
  const reverting = {
    rewrite: async (text) => ({
      action: "rewrite", replacement: text.replace(/Wednesday/u, "wednesday"),
      reason: "Simplifies the phrasing.", latencyMs: 1,
    }),
  };
  const source = "The workshop starts on wednesday.";
  const result = await analyzeSentence(source, { engine: reverting, mechanics: true, verify: false });
  assert.notEqual(result.replacement, source,
    "the pipeline offered the writer their own sentence back");
  // The model's revert is refused by name, and the mechanical repair it tried to undo is
  // what the writer is offered instead — by the rule, not by the model.
  assert.equal(result.modelRejection, "unchanged");
  assert.equal(result.replacement, "The workshop starts on Wednesday.");
  assert.equal(result.stages.model, false);
  assert.equal(result.rejection, null);
});

// KNOWN-GAP (severity: low). The validator is a refusal filter, not a direction judge, so
// for grammatical repairs it accepts the edit AND its inverse: nothing deterministic stops
// an A -> B -> A cycle if the model proposes the reverse. This stays a todo because
// refusing an inverse in general is not decidable from the two sentences alone — the
// validator would have to know which direction is the improvement.
// Repro: validateRewrite("The workshop starts on Wednesday.",
//          { action: "rewrite", replacement: "The workshop starts on wednesday.", reason: "..." })
//        -> { accepted: true }
// The one case that actually looped is closed: the wednesday cycle turned on the pipeline
// surfacing the reverted sentence for the mechanical pass to repair again on the next
// pass, and a replacement equal to the writer's own sentence is now refused as "unchanged"
// (see the test above). What remains is a validator that would accept the reverse if the
// model proposed it, with nothing downstream able to loop on it.
test("the inverse of an accepted edit is refused", { todo: true }, () => {
  const reversible = [];
  for (const [source, replacement] of ACCEPTED) {
    if (validateRewrite(replacement, rewrite(source)).accepted) reversible.push([replacement, source]);
  }
  assert.deepEqual(reversible, [], "these edits are accepted in both directions");
});

// ----------------------------------------------------- 5. dismissal and replace scope

const twoSentences = "The end result was good. We shipped it anyway.";
const replacementFor = (sentence) => sentence.startsWith("The end")
  ? "The result was good." : "We shipped it regardless.";

async function mountTwoMarks() {
  const served = [];
  const harness = mount({
    respond: ({ sentence }) => {
      served.push(sentence);
      return rewriteOf(sentence, replacementFor(sentence));
    },
  });
  await type(harness.app, harness.window, twoSentences);
  await tick(14);
  assert.equal(harness.app.store.size, 2, "both sentences must be marked first");
  return { ...harness, served };
}

const suggestionFor = (app, opener) =>
  app.store.list().find((suggestion) => suggestion.source.startsWith(opener));
const markFor = (app, id) => [...app.overlay.querySelectorAll("mark")]
  .find((mark) => mark.dataset.id === id);

test("dismissing one sentence's suggestion leaves the other's alone", async () => {
  const { app, window, served } = await mountTwoMarks();
  const first = suggestionFor(app, "The end");
  const second = suggestionFor(app, "We shipped");

  app.openCard(second.id, markFor(app, second.id));
  app.dismissActive();
  await tick(14);

  assert.equal(app.store.size, 1);
  const survivor = app.store.get(first.id);
  assert.ok(survivor, "the untouched sentence keeps its suggestion");
  assert.equal(survivor.source, first.source);
  assert.equal(app.editor.value.slice(survivor.start, survivor.end), survivor.source);
  assert.ok(markFor(app, first.id), "and keeps its underline");
  assert.equal(markFor(app, second.id), undefined, "the dismissed one has no underline");

  // The dismissal is scoped to its own sentence: editing the OTHER sentence must not
  // resurrect it, and must not re-send it either.
  served.length = 0;
  await type(app, window, "The end result was excellent. We shipped it anyway.");
  await tick(14);
  assert.deepEqual(served, ["The end result was excellent."]);
  assert.equal(app.store.get(second.id) ?? null, null, "the dismissal still holds");
});

test("replacing one sentence does not clear the other's mark", async () => {
  const { app } = await mountTwoMarks();
  const first = suggestionFor(app, "The end");
  const second = suggestionFor(app, "We shipped");

  app.openCard(first.id, markFor(app, first.id));
  app.replaceActive();
  await tick(14);

  assert.equal(app.editor.value, "The result was good. We shipped it anyway.");
  const survivor = app.store.get(second.id);
  assert.ok(survivor, "the other sentence keeps its suggestion across the edit");
  assert.equal(survivor.source, "We shipped it anyway.");
  assert.equal(app.editor.value.slice(survivor.start, survivor.end), survivor.source,
    "and is re-anchored to its new offsets");
  assert.ok(markFor(app, second.id), "its underline is still rendered");
  assert.equal(app.store.size, 1, "the replaced sentence is not re-marked");
});

test("dismiss and replace commute across sentences", async () => {
  // Dismissing 2 then replacing 1 must land in the same state as replacing 1 then
  // dismissing 2: neither operation may leak into the other's sentence.
  async function run(order) {
    const { app } = await mountTwoMarks();
    const ids = {
      first: suggestionFor(app, "The end").id,
      second: suggestionFor(app, "We shipped").id,
    };
    for (const step of order) {
      const suggestion = app.store.get(ids[step === "replace" ? "first" : "second"]);
      assert.ok(suggestion, `${step}: its suggestion is still there`);
      app.openCard(suggestion.id, markFor(app, suggestion.id));
      if (step === "replace") app.replaceActive();
      else app.dismissActive();
      await tick(14);
    }
    return {
      value: app.editor.value,
      size: app.store.size,
      sources: app.store.list().map((suggestion) => suggestion.source),
    };
  }
  assert.deepEqual(await run(["dismiss", "replace"]), await run(["replace", "dismiss"]));
  assert.deepEqual(await run(["dismiss", "replace"]),
    { value: "The result was good. We shipped it anyway.", size: 0, sources: [] });
});
