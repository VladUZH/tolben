// Regressions for the state, pipeline and benchmark-accounting fixes.
import test from "node:test";
import assert from "node:assert/strict";
import { createCoordinator } from "../src/coordinator.mjs";
import { reconcileSentences, resetIds } from "../src/identity.mjs";
import { createStore } from "../src/store.mjs";
import { createEngine, completeTruncatedJSON } from "../src/engine.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";
import { runBenchmark } from "../bench/run.mjs";
import { summarize, rescore } from "../bench/score.mjs";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------- coordinator

test("re-submitting an unchanged sentence joins the request already in flight", async () => {
  let calls = 0;
  const signals = [];
  const resolvers = [];
  const coordinator = createCoordinator({
    analyze: (text, { signal }) => {
      calls += 1;
      signals.push(signal);
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  const first = coordinator.submit({ id: "s1", revision: 1, text: "The end result was good." });
  const second = coordinator.submit({ id: "s1", revision: 2, text: "The end result was good." });
  assert.equal(calls, 1, "the same question is not asked twice");
  assert.equal(signals[0].aborted, false, "the request in flight is not aborted");
  resolvers[0]({ replacement: "The result was good." });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, "both callers get the one answer");
  assert.equal(a.outcome.replacement, "The result was good.");
  assert.equal(coordinator.pending, 0);
});

test("a changed sentence still aborts and restarts its request", async () => {
  const signals = [];
  const resolvers = [];
  const coordinator = createCoordinator({
    analyze: (text, { signal }) => {
      signals.push(signal);
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  const first = coordinator.submit({ id: "s1", revision: 1, text: "old" });
  const second = coordinator.submit({ id: "s1", revision: 2, text: "new" });
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true, "the superseded request is aborted");
  assert.equal(await first, null);
  resolvers[1]({ replacement: "fresh" });
  assert.equal((await second).outcome.replacement, "fresh");
});

test("at most two analyze calls run at once", async () => {
  const started = [];
  const coordinator = createCoordinator({
    analyze: (text) => { started.push(text); return new Promise(() => {}); },
  });
  for (let i = 1; i <= 6; i += 1) coordinator.submit({ id: `s${i}`, revision: i, text: `Sentence ${i}.` });
  await tick();
  assert.deepEqual(started, ["Sentence 1.", "Sentence 2."], "the rest wait for a slot");
  assert.equal(coordinator.running, 2);
  assert.equal(coordinator.pending, 6, "queued requests are still outstanding");
});

test("a queued request that is invalidated never reaches the model", async () => {
  const started = [];
  const coordinator = createCoordinator({
    analyze: (text) => { started.push(text); return new Promise(() => {}); },
  });
  coordinator.submit({ id: "a", revision: 1, text: "A." });
  coordinator.submit({ id: "b", revision: 2, text: "B." });
  const queued = coordinator.submit({ id: "c", revision: 3, text: "C." });
  coordinator.invalidate("c");
  assert.equal(await queued, null, "the queued request resolves to nothing");
  assert.equal(coordinator.pending, 2);
  coordinator.invalidate("a");
  await tick();
  assert.deepEqual(started, ["A.", "B."], "a request that left the queue is never sent");
});

test("aborting a running request frees its slot without waiting for it to settle", async () => {
  const started = [];
  // A call that never settles once aborted: the slot must not depend on it.
  const coordinator = createCoordinator({
    analyze: (text) => { started.push(text); return new Promise(() => {}); },
  });
  coordinator.submit({ id: "a", revision: 1, text: "A." });
  coordinator.submit({ id: "b", revision: 2, text: "B." });
  coordinator.submit({ id: "c", revision: 3, text: "C." });
  assert.deepEqual(started, ["A.", "B."]);
  coordinator.invalidate("a");
  assert.deepEqual(started, ["A.", "B.", "C."], "the queued sentence starts as soon as the slot is free");
  assert.equal(coordinator.running, 2);
});

test("a stale reply is refused even when the caller reuses a revision number", async () => {
  const committed = [];
  const resolvers = [];
  const coordinator = createCoordinator({
    analyze: () => new Promise((resolve) => resolvers.push(resolve)),  // deaf to abort
    onResult: (result) => committed.push(result.outcome.replacement),
  });
  coordinator.submit({ id: "s1", revision: 7, text: "old" });
  coordinator.submit({ id: "s1", revision: 7, text: "new" });
  resolvers[0]({ replacement: "STALE" });
  resolvers[1]({ replacement: "FRESH" });
  await tick();
  assert.deepEqual(committed, ["FRESH"]);
});

// ------------------------------------------------------------------ identity

test("deleting one of two identical sentences does not hand its dismissal to the survivor", () => {
  resetIds();
  const store = createStore();
  let sentences = reconcileSentences([], "Stop now. Stop now.");
  const [first, second] = sentences;
  store.dismiss(first.id, first.text);
  store.set({ id: second.id, source: second.text, replacement: "Stop.", start: second.start, end: second.end });

  sentences = reconcileSentences(sentences, "Stop now.");
  store.reconcile(sentences);
  assert.notEqual(sentences[0].id, first.id, "the survivor does not inherit the deleted sentence's identity");
  assert.equal(store.isDismissed(sentences[0].id, sentences[0].text), false, "no dismissal the writer never made");
});

test("editing one of two identical sentences leaves the other one's identity alone", () => {
  resetIds();
  const first = reconcileSentences([], "Stop now. Stop now.");
  const second = reconcileSentences(first, "Stop now. Stop right now.");
  assert.equal(second[0].id, first[0].id, "the untouched duplicate keeps its id");
  assert.equal(second[0].changed, false);
  assert.equal(second[1].id, first[1].id, "the edited one is an edit, not an insert");
});

test("among identical sentences the nearest one by offset keeps the identity", () => {
  resetIds();
  const first = reconcileSentences([], "Stop now. Stop now.");
  const second = reconcileSentences(first, "Go away. Stop now.");
  assert.equal(second[1].id, first[1].id, "the surviving duplicate keeps its own id, not the first one's");
  assert.equal(second[0].id, first[0].id, "the rewritten sentence inherits the id at its position");
});

// -------------------------------------------------------------------- engine

test("an unparseable response body fails without a retry", async () => {
  let calls = 0;
  const engine = createEngine({
    prompt: "p",
    timeoutMs: 500,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => { throw new SyntaxError("Unexpected token 'o', \"oops\" is not valid JSON"); } };
    },
  });
  await assert.rejects(engine.rewrite("A sentence."), (error) => error.kind === "failed");
  assert.equal(calls, 1, "a malformed decision is never retried");
});

test("an empty completion is reported as no content", async () => {
  assert.equal(completeTruncatedJSON(""), "");
  assert.equal(completeTruncatedJSON("  \n "), "");
  const engine = createEngine({
    prompt: "p",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "" } }] }) }),
  });
  await assert.rejects(engine.rewrite("A sentence."), (error) => /no content/iu.test(error.message));
});

test("a verifier that cannot be reached reports unavailable, not a verdict", async () => {
  const engine = createEngine({
    prompt: "p",
    verifierPrompt: "v",
    fetchImpl: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:8080"); },
  });
  const verdict = await engine.verify("A sentence about it.", "A sentence.", { lost: ["about"] });
  assert.equal(verdict.verdict, "unavailable");
  // A socket-level outage is a passing fault, exactly as decide() classifies the same
  // error: "failed" is reserved for output that is deterministic for this pair, and
  // reporting an outage as deterministic burned the sentence's whole retry budget.
  assert.equal(verdict.kind, "transient");
  assert.match(verdict.reason, /verifier unavailable/u);
});

// ------------------------------------------------------------------ pipeline

test("an aborted model call propagates instead of returning a suggestion", async () => {
  const engine = { rewrite: async () => { throw Object.assign(new Error("Request superseded"), { kind: "aborted" }); } };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    analyzeSentence("on monday we shipped it .", { engine, signal: controller.signal }),
    (error) => error.kind === "aborted",
  );
});

test("a verifier outage is an engine failure, not a safety rejection", async () => {
  const engine = {
    rewrite: async () => ({ action: "rewrite", replacement: "We concluded that the disk failed.", reason: "Direct verb.", latencyMs: 5 }),
    verify: async () => ({ verdict: "unavailable", kind: "transient", reason: "verifier unavailable: ECONNREFUSED" }),
  };
  const result = await analyzeSentence("We came to the conclusion that the disk failed.", { engine });
  assert.equal(result.replacement, null, "still fails closed");
  assert.equal(result.rejection, "verifier-unavailable");
  assert.equal(result.error?.kind, "verifier-unavailable", "an outage is reported as an error");

  const corpus = { name: "t", rows: [{ id: "v1", issueClass: "clarity", source: "We came to the conclusion that the disk failed.", expectedAction: "rewrite" }] };
  const report = await runBenchmark({ corpus, engine, prompt: "p", model: { id: "x" } });
  assert.equal(report.rows[0].action, "failed");
  const summary = summarize(report.rows);
  assert.equal(summary.failures, 1);
  assert.deepEqual(summary.failureKinds, { "verifier-unavailable": 1 });
  assert.deepEqual(summary.rejections, {}, "an outage is not counted as a refusal");
});

test("a deliberate verifier refusal is still a safety rejection", async () => {
  const engine = {
    rewrite: async () => ({ action: "rewrite", replacement: "We concluded that the disk failed.", reason: "Direct verb.", latencyMs: 5 }),
    verify: async () => ({ verdict: "hide", reason: "the removed word carries meaning" }),
  };
  const result = await analyzeSentence("We came to the conclusion that the disk failed.", { engine });
  assert.equal(result.replacement, null);
  assert.equal(result.rejection, "verifier-hidden");
  assert.equal(result.error, null);
});

test("a refused rewrite beside a mechanical repair is not counted as both", async () => {
  const engine = { rewrite: async () => ({ action: "rewrite", replacement: "Bob approved it.", reason: "", latencyMs: 1 }) };
  const result = await analyzeSentence("on monday alice approved it .", { engine });
  assert.equal(result.modelRejection, "name-changed", "the model's refusal is still recorded");
  assert.equal(result.rejection, null, "but it is not this sentence's outcome: something surfaced");
  assert.equal(result.replacement, "On Monday alice approved it.");

  const corpus = { name: "t", rows: [{ id: "m1", issueClass: "mechanics", source: "on monday alice approved it .", expectedAction: "rewrite" }] };
  const summary = summarize((await runBenchmark({ corpus, engine, prompt: "p", model: { id: "x" } })).rows);
  assert.equal(summary.surfacedOnPositives, 1);
  assert.deepEqual(summary.rejections, {});
  assert.deepEqual(summary.modelRejections, { "name-changed": 1 });
});

// --------------------------------------------------------------------- bench

test("a dead model scores as failures, not as a flawless clean run", async () => {
  const corpus = {
    name: "dead",
    rows: [
      { id: "p1", issueClass: "clarity", source: "The panel gave approval to the layout.", expectedAction: "rewrite" },
      { id: "c1", issueClass: "clarity", source: "The rig cannot run without coolant.", expectedAction: "keep" },
    ],
  };
  const engine = { rewrite: async () => { throw Object.assign(new Error("Local model exceeded 8000 ms"), { kind: "timeout" }); } };
  const report = await runBenchmark({ corpus, engine, prompt: "p", model: { id: "dead" } });
  assert.deepEqual(report.rows.map((row) => row.action), ["failed", "failed"]);
  const summary = summarize(report.rows);
  assert.equal(summary.failures, 2);
  assert.deepEqual(summary.failureKinds, { timeout: 2 });
  assert.equal(summary.positives, 0, "a row the model never answered is not a positive");
  assert.equal(summary.cleans, 0, "nor a clean one");
  assert.equal(summary.falsePositiveRate, 0);
  assert.equal(summary.scoredRows, 0);
});

test("a thrown engine error is recorded with its kind and excluded from the denominators", async () => {
  const corpus = {
    name: "throw",
    rows: [
      { id: "p1", issueClass: "clarity", source: "The panel gave approval to the layout.", expectedAction: "rewrite" },
      { id: "p2", issueClass: "clarity", source: "Legal performed a check of the clause.", expectedAction: "rewrite" },
    ],
  };
  let first = true;
  const engine = {
    rewrite: async () => {
      if (first) { first = false; throw Object.assign(new Error("boom"), { kind: "transient" }); }
      return { action: "keep", replacement: "", reason: "", latencyMs: 1 };
    },
  };
  const summary = summarize((await runBenchmark({ corpus, engine, prompt: "p", model: { id: "x" } })).rows);
  assert.equal(summary.failures, 1);
  assert.deepEqual(summary.failureKinds, { transient: 1 });
  assert.equal(summary.positives, 1, "only the row the model answered is scored");
  assert.equal(summary.recall, 0);
});

test("percentiles use nearest rank", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({
    expectedAction: "keep", surfaced: false, action: "keep", milliseconds: (i + 1) * 100,
  }));
  const twenty = summarize(rows(20));
  assert.equal(twenty.latencyP50, 1000);
  assert.equal(twenty.latencyP95, 1900);
  assert.equal(twenty.latencyMax, 2000);
  assert.notEqual(twenty.latencyP95, twenty.latencyMax, "p95 is not simply the maximum");
  const ten = summarize(rows(10));
  assert.equal(ten.latencyP50, 500);
  assert.equal(summarize([]).latencyP50, 0);
});

test("rescore re-validates the raw output of rows the old validator refused", () => {
  const rows = [{
    id: "r1", issueClass: "clarity", expectedAction: "rewrite",
    source: "The panel gave approval to the revised layout.",
    action: "keep", replacement: "",
    rejectedText: "The panel approved the revised layout.",
    reason: "", surfaced: false, stages: { mechanics: false, model: false },
    rejection: "name-changed", milliseconds: 900,
  }];
  const [rescored] = rescore(rows);
  assert.equal(rescored.surfaced, true);
  assert.equal(rescored.action, "rewrite");
  assert.equal(rescored.replacement, "The panel approved the revised layout.");
  assert.equal(rescored.rejection, null);
  assert.equal(rescored.stages.model, true);
  assert.equal(summarize(rescore(rows)).recall, 1);
});

test("rescore leaves a failed row and a mechanics-only row alone", () => {
  const failed = {
    id: "f1", expectedAction: "rewrite", source: "A sentence.", action: "failed",
    replacement: "", rejectedText: null, surfaced: false, stages: { mechanics: false, model: false },
    engineError: { kind: "timeout", message: "gone" }, milliseconds: 20000,
  };
  const mechanicsOnly = {
    id: "m1", expectedAction: "rewrite", source: "on monday we shipped .", action: "rewrite",
    replacement: "On Monday we shipped.", rejectedText: null, surfaced: true,
    stages: { mechanics: true, model: false }, rejection: null, milliseconds: 5,
  };
  assert.deepEqual(rescore([failed, mechanicsOnly]), [failed, mechanicsOnly]);
});

test("a handler that throws rejects the caller rather than escaping", async () => {
  const coordinator = createCoordinator({
    analyze: async () => ({ replacement: "x" }),
    onResult: () => { throw new Error("render failed"); },
  });
  await assert.rejects(coordinator.submit({ id: "s1", revision: 1, text: "a" }), /render failed/u);
  assert.equal(coordinator.pending, 0);
});

// Priority: the queue serves the writer's eyes, not submission order.
//
// Submission order is document order, so a FIFO queue drains a long note top to bottom
// no matter where the reader is — measured as 30-60s before the first visible underline
// after a mid-note jump. Priority is decided by the caller; the coordinator only promises
// lowest-first, FIFO among equals, and promotion when a duplicate submit joins a queued
// entry with a better priority.

test("the lowest priority queued entry runs first regardless of submission order", async () => {
  const started = [];
  const coordinator = createCoordinator({
    maxConcurrent: 1,
    analyze: (text) => new Promise(() => { started.push(text); }),
  });
  coordinator.submit({ id: "hold", revision: 1, text: "hold", priority: 0 });
  await Promise.resolve();
  coordinator.submit({ id: "margin", revision: 1, text: "margin", priority: 900 });
  coordinator.submit({ id: "below", revision: 1, text: "below", priority: 500 });
  coordinator.submit({ id: "visible", revision: 1, text: "visible", priority: 10 });
  coordinator.invalidate("hold");   // frees the slot
  await Promise.resolve();
  assert.deepEqual(started, ["hold", "visible"]);
  coordinator.dispose();
});

test("equal priorities drain in submission order", async () => {
  const started = [];
  const coordinator = createCoordinator({
    maxConcurrent: 1,
    analyze: (text) => new Promise(() => { started.push(text); }),
  });
  coordinator.submit({ id: "hold", revision: 1, text: "hold" });
  await Promise.resolve();
  for (const text of ["a", "b", "c"]) coordinator.submit({ id: text, revision: 1, text, priority: 5 });
  coordinator.invalidate("hold");
  await Promise.resolve();
  coordinator.invalidate("a");
  await Promise.resolve();
  assert.deepEqual(started, ["hold", "a", "b"]);
  coordinator.dispose();
});

test("a duplicate submit re-ranks a queued entry in both directions: the latest rank is the current truth", async () => {
  const started = [];
  const coordinator = createCoordinator({
    maxConcurrent: 1,
    analyze: (text) => new Promise(() => { started.push(text); }),
  });
  coordinator.submit({ id: "hold", revision: 1, text: "hold" });
  await Promise.resolve();
  // s2 enters the queue first AND with the better priority, so plain FIFO and an
  // unpromoted queue would both run it first — only re-ranking flips the order.
  coordinator.submit({ id: "s2", revision: 1, text: "two", priority: 50 });
  coordinator.submit({ id: "s1", revision: 1, text: "one", priority: 800 });
  // The reader scrolled s1 on screen: same text, better rank — it jumps the queue.
  coordinator.submit({ id: "s1", revision: 2, text: "one", priority: 1 });
  coordinator.invalidate("hold");
  await Promise.resolve();
  assert.deepEqual(started, ["hold", "one"]);

  // And the other direction: rank reflects the viewport NOW, so a worse rank on a later
  // submit demotes. s2's stale rank (50) beats s3's — holding it was measured serving a
  // whole stale screen before the text the reader had scrolled to.
  coordinator.submit({ id: "s3", revision: 1, text: "three", priority: 100 });
  coordinator.submit({ id: "s2", revision: 2, text: "two", priority: 700 });   // scrolled away
  coordinator.invalidate("s1");
  await Promise.resolve();
  assert.deepEqual(started, ["hold", "one", "three"]);
  coordinator.dispose();
});
