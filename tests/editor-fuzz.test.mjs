// Seeded randomized editor sessions. Each session drives the real createApp in jsdom
// against a fake model that answers slowly, erratically, and sometimes not at all, then
// asserts the same set of structural invariants after every single operation.
//
// Randomness is seeded (mulberry32) and the seed is in the test name, so a failure is
// replayable exactly: re-run with the same seed and the same operations occur in the same
// order with the same delays. Math.random is never used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createApp } from "../src/app-core.mjs";
import { reconcileSentences, resetIds } from "../src/identity.mjs";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// (6) A promise rejection nobody handles is a bug wherever it comes from. Collected for
// the whole file and asserted per session, so the first session to leak one fails.
const unhandled = [];
process.on("unhandledRejection", (reason) => { unhandled.push(reason); });

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng, bound) => Math.floor(rng() * bound);
const pick = (rng, values) => values[int(rng, values.length)];

const FRAGMENTS = [
  "The end result was good",
  "we shipped it anyway",
  "Maya reviewed the v2 release on monday",
  "The router is located in close proximity to the desk",
  "Check /srv/reports/q4.csv before 14:30",
  "It failed",
  "Dr. Chen left at 9:15",
  "there are three bolts that require replacement",
  "The archive is copied on a weekly basis",
  "Due to the fact that the server was unavailable, the job failed",
  "e.g. the pump stalled twice",
  'He asked "why"',
];
const ENDERS = [".", "!", "?", "...", ". ", "? ", ".\n", "! ", " ", ""];
const MAX_DOCUMENT = 900;

// A deterministic, restrained edit of the sentence: a fake model, not a good one.
function propose(sentence, roll) {
  const word = sentence.match(/\b\p{L}{4,}\b/u);
  if (!word) return null;
  if (roll < 0.45) {
    return sentence.slice(0, word.index) + word[0].slice(0, -1) +
      sentence.slice(word.index + word[0].length);
  }
  return sentence.replace(/\b\p{L}{4,}\b/u, (match) => `${match} clearly`);
}

const rewriteOutcome = (source, replacement) => ({
  source, replacement, reason: "Removes wordiness.",
  stages: { mechanics: false, model: true }, rejection: null, latencyMs: 4, totalMs: 6,
});
const keepOutcome = (source) => ({
  source, replacement: null, reason: null,
  stages: { mechanics: false, model: false }, rejection: null, latencyMs: 4, totalMs: 6,
});

// roll bands: hang | HTTP failure | 200-with-error | rewrite | keep
function response(sentence, roll) {
  if (roll < 0.17) {
    return { ok: false, status: 503, json: async () => ({ error: { message: "model busy" } }) };
  }
  if (roll < 0.24) {
    return { ok: true, json: async () => ({ error: { kind: "transient", message: "decode failed" } }) };
  }
  if (roll < 0.66) {
    const replacement = propose(sentence, roll);
    return {
      ok: true,
      json: async () => (replacement && replacement !== sentence
        ? rewriteOutcome(sentence, replacement)
        : keepOutcome(sentence)),
    };
  }
  return { ok: true, json: async () => keepOutcome(sentence) };
}

function mountSession(seed, { fast = false } = {}) {
  resetIds();
  // Two streams from the one seed: the operations the writer performs, and how the fake
  // model answers. Keeping them apart means the sequence of operations for a seed does
  // not shift when a reply happens to land a millisecond earlier.
  const rng = mulberry32(seed);
  const replyRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/", pretendToBeVisual: true });
  const { window } = dom;
  const pending = new Set();     // fake replies that have not answered yet
  let draining = false;
  const sent = [];

  const fetchImpl = async (url, options = {}) => {
    if (url === "/api/status") {
      return { ok: true, json: async () => ({ ready: true, model: "fuzz-model" }) };
    }
    const { sentence } = JSON.parse(options.body);
    sent.push(sentence);
    const roll = replyRng();
    const delay = int(replyRng, 31);
    return new Promise((resolve, reject) => {
      const entry = {};
      const finish = () => { clearTimeout(entry.timer); pending.delete(entry); };
      entry.release = () => { finish(); resolve(response(sentence, roll)); };
      entry.abort = () => {
        finish();
        reject(Object.assign(new Error("aborted"), { kind: "aborted" }));
      };
      pending.add(entry);
      if (options.signal) {
        if (options.signal.aborted) return entry.abort();
        options.signal.addEventListener("abort", entry.abort, { once: true });
      }
      // The unluckiest requests hang for far longer than the editor's own settling
      // window, so several later operations run while one is still outstanding. A fast
      // session skips both: every reply lands at once, which puts far more replies
      // through the commit path per operation.
      const held = roll < 0.07 ? 120 + int(replyRng, 120) : delay;
      entry.timer = setTimeout(entry.release, draining || fast ? 0 : held);
    });
  };

  const app = createApp({ document: window.document, window, fetchImpl, debounceMs: 1 });
  return {
    seed, rng, window, app, sent, pending,
    shadow: [],
    drain() {
      draining = true;
      for (const entry of [...pending]) entry.release();
    },
  };
}

// ------------------------------------------------------------------ invariants

// Everything that must be true of the editor at rest, and of most of it in flight.
// `quiet` says whether the session has settled; the status assertions only make sense
// once nothing is outstanding.
function checkInvariants(session, label, { quiet = false } = {}) {
  const { app, window } = session;
  const value = app.editor.value;
  const suggestions = app.store.list();

  // (1) every stored suggestion still describes the text it was made about.
  for (const suggestion of suggestions) {
    assert.equal(value.slice(suggestion.start, suggestion.end), suggestion.source,
      `${label}: suggestion ${suggestion.id} is anchored to text it does not match`);
  }

  // (4) no two live suggestions share an id or overlap: one sentence, one identity.
  const ids = new Set();
  let previousEnd = -1;
  for (const suggestion of suggestions) {
    assert.equal(ids.has(suggestion.id), false, `${label}: duplicate suggestion id ${suggestion.id}`);
    ids.add(suggestion.id);
    assert.ok(suggestion.start >= previousEnd,
      `${label}: suggestion ${suggestion.id} overlaps the previous one`);
    previousEnd = suggestion.end;
  }

  // (2) every underline in the overlay belongs to a suggestion that still exists.
  for (const mark of app.overlay.querySelectorAll("mark")) {
    assert.ok(ids.has(mark.dataset.id),
      `${label}: overlay mark ${mark.dataset.id} has no suggestion behind it`);
  }

  // (3) the overlay mirrors the editor exactly, but for the trailing-newline sentinel.
  const mirrored = value.endsWith("\n") ? `${value}\u200b` : value;
  assert.equal(app.overlay.textContent, mirrored,
    `${label}: the overlay text has drifted from the editor`);

  // (4, continued) the sentence model itself: unique ids, in order, offsets that read back.
  session.shadow = reconcileSentences(session.shadow, value);
  const sentenceIds = new Set();
  let sentenceEnd = -1;
  for (const sentence of session.shadow) {
    assert.equal(sentenceIds.has(sentence.id), false,
      `${label}: two live sentences share id ${sentence.id}`);
    sentenceIds.add(sentence.id);
    assert.equal(value.slice(sentence.start, sentence.end), sentence.text,
      `${label}: sentence ${sentence.id} offsets do not read back its text`);
    assert.ok(sentence.start >= sentenceEnd, `${label}: sentences ${sentence.id} out of order`);
    sentenceEnd = sentence.end;
  }

  const status = window.document.getElementById("status");
  if (status.dataset.state === "checking") {
    assert.equal(status.textContent, "Reviewing sentence…");
  }
  if (!quiet) return;

  // (5) at rest the status is never "reviewing", and reports exactly what is on screen.
  assert.notEqual(status.dataset.state, "checking",
    `${label}: still reviewing with nothing in flight`);
  if (status.dataset.state === "error") {
    assert.match(status.textContent, /unavailable/u, `${label}: unexplained error status`);
  } else {
    assert.equal(status.dataset.state, suggestions.length > 0 ? "active" : "idle",
      `${label}: status does not match ${suggestions.length} suggestions`);
  }
  assert.equal(window.document.getElementById("count").textContent, String(suggestions.length));
}

// Runs the timers until nothing is outstanding. Returns whether it got there: a hung
// fake reply keeps the session busy on purpose, and then the status is legitimately
// "Reviewing sentence…".
async function settle(session, { rounds = 9, step = 4 } = {}) {
  for (let round = 0; round < rounds; round += 1) {
    await tick(step);
    if (session.app.coordinator.pending === 0 && session.pending.size === 0) {
      await tick(step);
      if (session.app.coordinator.pending === 0 && session.pending.size === 0) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ operations

async function setValue(session, next, label) {
  const { app, window } = session;
  const capped = next.length > MAX_DOCUMENT ? next.slice(next.length - MAX_DOCUMENT) : next;
  app.editor.value = capped;
  app.editor.dispatchEvent(new window.Event("input"));
  return label;
}

const marksOf = (app) => [...app.overlay.querySelectorAll("mark")];

async function operate(session) {
  const { app, window, rng } = session;
  const value = app.editor.value;
  const roll = rng();

  if (roll < 0.24) {
    const at = int(rng, value.length + 1);
    const chunk = pick(rng, FRAGMENTS) + pick(rng, ENDERS);
    return setValue(session, value.slice(0, at) + chunk + value.slice(at), "type");
  }
  if (roll < 0.40) {
    if (value.length === 0) return setValue(session, `${pick(rng, FRAGMENTS)}.`, "type-into-empty");
    const from = int(rng, value.length);
    const to = Math.min(value.length, from + 1 + int(rng, 45));
    return setValue(session, value.slice(0, from) + value.slice(to), "delete");
  }
  if (roll < 0.52) {
    const block = `${[0, 1, 2].map(() => pick(rng, FRAGMENTS) + pick(rng, [".", "!", "?"])).join(" ")} `;
    const at = int(rng, value.length + 1);
    return setValue(session, value.slice(0, at) + block + value.slice(at), "paste");
  }
  if (roll < 0.62) {
    // Finish the sentence being written. The trailing whitespace matters: a document
    // that ends in a newline is the case the overlay needs its sentinel for.
    const finished = `${value.replace(/\s*$/u, "")}${pick(rng, [".", "!", "?", "…"])}`;
    return setValue(session, finished + pick(rng, [" ", "", "\n", "\n\n"]), "complete");
  }
  if (roll < 0.76) {
    const marks = marksOf(app);
    if (marks.length === 0) return setValue(session, `${value}${pick(rng, FRAGMENTS)}. `, "type-no-marks");
    const mark = pick(rng, marks);
    app.openCard(mark.dataset.id, mark);
    app.replaceActive();
    return "replace";
  }
  if (roll < 0.87) {
    const marks = marksOf(app);
    if (marks.length === 0) return setValue(session, `${value}${pick(rng, FRAGMENTS)}? `, "type-no-marks");
    const mark = pick(rng, marks);
    app.openCard(mark.dataset.id, mark);
    app.dismissActive();
    return "dismiss";
  }
  if (roll < 0.95) {
    const toggle = window.document.getElementById("mechanics");
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new window.Event("change"));
    return "mechanics-toggle";
  }
  return setValue(session, "", "clear-all");
}

async function runSession(seed, operations, { fast = false } = {}) {
  const before = unhandled.length;
  const label = `seed 0x${seed.toString(16)}`;
  const session = mountSession(seed, { fast });
  const tally = { marked: 0, errored: 0, held: 0, replace: 0, dismiss: 0, "mechanics-toggle": 0 };
  await session.app.ready;
  checkInvariants(session, `${label} op 0 (mount)`, { quiet: false });

  for (let index = 1; index <= operations; index += 1) {
    const name = await operate(session);
    // In flight: the structural invariants hold even mid-request.
    await tick(0);
    checkInvariants(session, `${label} op ${index} (${name}, in flight)`);
    const quiet = await settle(session);
    checkInvariants(session, `${label} op ${index} (${name})`, { quiet });

    tally[name] = (tally[name] ?? 0) + 1;
    if (session.app.store.size > 0) tally.marked += 1;
    if (session.window.document.getElementById("status").dataset.state === "error") tally.errored += 1;
    if (!quiet) tally.held += 1;
  }

  // (7) Full quiescence: release every hung reply, run the timers out, and nothing may
  // still be queued or running inside the coordinator.
  session.drain();
  const quiet = await settle(session, { rounds: 40, step: 5 });
  assert.equal(quiet, true, `${label}: the session never went quiet`);
  checkInvariants(session, `${label} (quiescent)`, { quiet: true });
  assert.equal(session.app.coordinator.pending, 0, `${label}: coordinator entries left in flight`);
  await tick(5);
  assert.deepEqual(unhandled.slice(before), [], `${label}: unhandled rejection`);

  // A fuzz session that never reached the interesting states proves nothing, so the
  // states themselves are asserted: marks on screen, replacements applied, dismissals,
  // failures reported, and enough settled moments to check the status invariant at all.
  if (process.env.FUZZ_STATS) console.log(seed.toString(16), JSON.stringify(tally), "sent", session.sent.length);
  const reached = (what, count, minimum) => assert.ok(count >= minimum,
    `${label}: only ${count} ${what} in ${operations} operations, expected ${minimum}+`);
  reached("requests", session.sent.length, operations);
  reached("operations with a mark on screen", tally.marked, Math.round(operations * 0.25));
  // Whether a card action finds a mark depends on what has come back by then, so these
  // two are counted together and given room.
  reached("replace/dismiss actions", tally.replace + tally.dismiss, Math.round(operations * 0.04));
  reached("reported failures", tally.errored, 1);
  reached("mechanics toggles", tally["mechanics-toggle"], 3);
  reached("settled moments to check the status against",
    operations - tally.held, Math.round(operations * 0.2));
  return session;
}

for (const seed of [0x5eed01, 0x5eed02, 0x5eed03]) {
  test(`fuzzed editor session holds every invariant (seed 0x${seed.toString(16)})`, async () => {
    await runSession(seed, 110);
  });
}

// A shorter, denser session with the same invariants, on a fourth seed: the operation
// mix is the same, but the model answers instantly, so far more replies reach the commit
// path per operation and the editor is asked to settle far more often.
test("fuzzed session with a fast model holds every invariant (seed 0x5eed04)", async () => {
  await runSession(0x5eed04, 80, { fast: true });
});

// ------------------------------------------------------------------ teeth

// The invariants above are only worth their runtime if a corrupted state fails them.
// Each case below builds a real, healthy session and then injects exactly the kind of
// corruption the invariant exists to catch.
//
// The same was checked against deliberately broken copies of src/ (mutants run outside
// this repo, never committed). Every one of these was caught by all four sessions:
//   - store.reconcile stops re-anchoring survivors  -> invariant 1, seed 0x5eed01 op 20
//   - render drops the trailing-newline sentinel    -> invariant 3, seed 0x5eed02 op 2
//   - coordinator.invalidate leaks its in-flight    -> invariant 7, "never went quiet"
// One mutant survives: deleting app-core's own `sentence.text !== text` check in
// onResult. The coordinator's request-identity check already refuses the same reply, so
// that line is defence in depth and no session can reach past it.
test("teeth: a stale suggestion that bypasses the coordinator fails invariant 1", async () => {
  const session = mountSession(0x7ee701);
  await session.app.ready;
  await setValue(session, "The end result was good. We shipped it anyway.", "type");
  session.drain();
  await settle(session, { rounds: 40, step: 5 });
  checkInvariants(session, "teeth-1 baseline", { quiet: true });

  // A reply for a sentence that has since been edited, committed straight into the store
  // as though the coordinator's staleness check had not run.
  const { app } = session;
  app.store.set({
    id: "stale", source: "The end result was terrible.", replacement: "The result was bad.",
    reason: "", stages: { model: true }, start: 0, end: 28,
  });
  app.render();
  assert.throws(() => checkInvariants(session, "teeth-1"),
    /anchored to text it does not match/u);
});

test("teeth: an overlay left rendering a removed suggestion fails invariant 2", async () => {
  const session = mountSession(0x7ee702);
  await session.app.ready;
  await setValue(session, "The end result was good. We shipped it anyway.", "type");
  session.drain();
  await settle(session, { rounds: 40, step: 5 });

  const { app } = session;
  // Force a marked state, then drop the suggestion without re-rendering: exactly what a
  // dismissal that forgot to repaint would leave behind.
  const sentence = "We shipped it anyway.";
  const start = app.editor.value.indexOf(sentence);
  app.store.set({
    id: "ghost", source: sentence, replacement: "We shipped it regardless.",
    reason: "", stages: { model: true }, start, end: start + sentence.length,
  });
  app.render();
  assert.ok(marksOf(app).some((mark) => mark.dataset.id === "ghost"), "the mark must exist first");
  app.store.remove("ghost");
  assert.throws(() => checkInvariants(session, "teeth-2"), /has no suggestion behind it/u);
});

test("teeth: an overlay that stops mirroring the editor fails invariant 3", async () => {
  const session = mountSession(0x7ee703);
  await session.app.ready;
  await setValue(session, "The end result was good.", "type");
  session.drain();
  await settle(session, { rounds: 40, step: 5 });
  checkInvariants(session, "teeth-3 baseline", { quiet: true });

  // Text written to the editor without an input event: the mirror is now a line behind,
  // which is how a dropped re-render shows up on screen.
  session.app.editor.value = "The end result was good. And then it was not.";
  assert.throws(() => checkInvariants(session, "teeth-3"),
    /overlay text has drifted from the editor/u);
});

test("teeth: a reply held open forever fails the quiescence invariant", async () => {
  const session = mountSession(0x7ee704);
  await session.app.ready;
  await setValue(session, "The end result was good.", "type");
  await settle(session);
  // Never drained: the fake is still holding the request, so the coordinator cannot be
  // empty and the final assertion of every session above would fail here.
  if (session.pending.size > 0) {
    assert.ok(session.app.coordinator.pending > 0, "a held reply keeps its coordinator entry");
    assert.equal(await settle(session), false, "a held reply never goes quiet");
  }
  session.drain();
  assert.equal(await settle(session, { rounds: 40, step: 5 }), true);
  assert.equal(session.app.coordinator.pending, 0);
});
