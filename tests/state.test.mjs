import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSentences, resetIds } from "../src/identity.mjs";
import { createStore } from "../src/store.mjs";
import { createCoordinator } from "../src/coordinator.mjs";

test("a sentence keeps its identity while the next one is typed", () => {
  resetIds();
  const first = reconcileSentences([], "The launch begins tomorrow.");
  const second = reconcileSentences(first, "The launch begins tomorrow. We are still");
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, false);
  assert.equal(second[1].complete, false);
});

test("a sentence keeps its identity when text is inserted before it", () => {
  resetIds();
  const first = reconcileSentences([], "The job failed.");
  const second = reconcileSentences(first, "We shipped it. The job failed.");
  const kept = second.find((sentence) => sentence.text === "The job failed.");
  assert.equal(kept.id, first[0].id);
  assert.notEqual(second[0].id, first[0].id);
});

test("editing a sentence in place is an edit, not a delete and insert", () => {
  resetIds();
  const first = reconcileSentences([], "The job failed. It ran late.");
  const second = reconcileSentences(first, "The job failed badly. It ran late.");
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].changed, true);
  assert.equal(second[1].id, first[1].id);
  assert.equal(second[1].changed, false);
});

test("duplicate sentences receive distinct identities", () => {
  resetIds();
  const sentences = reconcileSentences([], "Stop now. Stop now.");
  assert.notEqual(sentences[0].id, sentences[1].id);
});

test("marks survive reconciliation on untouched sentences and die on edited ones", () => {
  resetIds();
  const store = createStore();
  const first = reconcileSentences([], "The end result was good. ");
  store.set({ id: first[0].id, source: first[0].text, start: first[0].start, end: first[0].end, replacement: "The result was good." });
  const second = reconcileSentences(first, "The end result was good. We shipped anyway.");
  store.reconcile(second);
  assert.equal(store.size, 1, "untouched sentence keeps its mark");

  const third = reconcileSentences(second, "The end result was fine. We shipped anyway.");
  store.reconcile(third);
  assert.equal(store.size, 0, "edited sentence loses its stale mark");
});

test("a dismissal lasts until the sentence changes", () => {
  const store = createStore();
  store.set({ id: "s1", source: "A.", start: 0, end: 2 });
  store.dismiss("s1", "A.");
  assert.equal(store.isDismissed("s1", "A."), true);
  assert.equal(store.size, 0);
  store.reconcile([{ id: "s1", text: "A changed.", start: 0, end: 10 }]);
  assert.equal(store.isDismissed("s1", "A."), false);
});

test("a stale reply never becomes a mark", async () => {
  const resolvers = [];
  const coordinator = createCoordinator({
    analyze: () => new Promise((resolve) => resolvers.push(resolve)),
  });
  const first = coordinator.submit({ id: "s1", revision: 1, text: "old" });
  const second = coordinator.submit({ id: "s1", revision: 2, text: "new" });
  resolvers[0]({ replacement: "stale" });
  resolvers[1]({ replacement: "fresh" });
  assert.equal(await first, null, "superseded reply is dropped");
  assert.equal((await second).outcome.replacement, "fresh");
});

test("an out-of-order reply for a superseded revision is dropped", async () => {
  const resolvers = [];
  const coordinator = createCoordinator({ analyze: () => new Promise((r) => resolvers.push(r)) });
  const first = coordinator.submit({ id: "s1", revision: 1, text: "a" });
  const second = coordinator.submit({ id: "s1", revision: 2, text: "b" });
  resolvers[1]({ replacement: "fresh" });
  resolvers[0]({ replacement: "stale" });
  assert.equal((await second).outcome.replacement, "fresh");
  assert.equal(await first, null);
});

test("invalidate aborts the request in flight", async () => {
  let seen;
  const coordinator = createCoordinator({
    analyze: (text, { signal }) => new Promise((resolve, reject) => {
      seen = signal;
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { kind: "aborted" })));
    }),
  });
  const pending = coordinator.submit({ id: "s1", revision: 1, text: "a" });
  coordinator.invalidate("s1");
  assert.equal(await pending, null);
  assert.equal(seen.aborted, true);
});

// withdraw(): cancel a batch of requests and restart the queue once, at the end.
//
// Cancelling one at a time is not equivalent. Freeing a slot restarts the queue
// immediately, so a caller withdrawing several ids sees the queue start the next one on
// its list before it gets there — and then cancels that too, having already paid for it.
test("withdraw cancels a batch without starting work from inside it", async () => {
  const started = [];
  const release = [];
  const coordinator = createCoordinator({
    maxConcurrent: 2,
    analyze: (text) => new Promise((resolve) => {
      started.push(text);
      release.push(() => resolve({ text }));
    }),
  });

  for (const [index, text] of ["a", "b", "c", "d"].entries()) {
    coordinator.submit({ id: `s${index}`, revision: 1, text });
  }
  await Promise.resolve();
  assert.deepEqual(started, ["a", "b"], "two run, two queue");

  // Everything currently known is withdrawn: nothing on the list may start.
  coordinator.withdraw(["s0", "s1", "s2", "s3"]);
  await Promise.resolve();
  assert.deepEqual(started, ["a", "b"], "withdraw started work it was cancelling");
  assert.equal(coordinator.pending, 0);
  assert.equal(coordinator.running, 0, "the slots were not handed back");
  coordinator.dispose();
});

test("withdraw frees the slots for work submitted after it", async () => {
  const started = [];
  const coordinator = createCoordinator({
    maxConcurrent: 2,
    analyze: (text) => new Promise(() => { started.push(text); }),
  });
  coordinator.submit({ id: "a", revision: 1, text: "a" });
  coordinator.submit({ id: "b", revision: 1, text: "b" });
  await Promise.resolve();
  assert.deepEqual(started, ["a", "b"]);

  coordinator.withdraw(["a", "b"]);
  coordinator.submit({ id: "c", revision: 1, text: "c" });
  await Promise.resolve();
  assert.deepEqual(started, ["a", "b", "c"]);
  coordinator.dispose();
});

test("withdraw ignores ids it does not know", () => {
  const coordinator = createCoordinator({ analyze: async () => ({}) });
  assert.doesNotThrow(() => coordinator.withdraw(["nothing", "here"]));
  coordinator.dispose();
});
