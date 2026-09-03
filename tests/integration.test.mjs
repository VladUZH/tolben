// Drives the real editor code in a DOM with a stubbed transport, covering the
// interaction matrix: completion, persistence, edits before a mark, stale replies,
// hover targeting, replace, dismiss, setting change, and transient failure.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createApp } from "../src/app-core.mjs";
import { resetIds } from "../src/identity.mjs";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function mount({ respond } = {}) {
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
    const outcome = await respond(body, options);
    if (outcome instanceof Error) throw outcome;
    if (outcome.httpError) {
      return { ok: false, status: outcome.httpError, json: async () => ({ error: "boom" }) };
    }
    return { ok: true, json: async () => outcome };
  };
  const app = createApp({ document: window.document, window, fetchImpl, debounceMs: 1 });
  return { dom, window, app, calls };
}

const rewriteOf = (source, replacement, reason = "Removes wordiness.") => ({
  source, replacement, reason, stages: { mechanics: false, model: true },
  rejection: null, latencyMs: 10, totalMs: 12,
});
const keepOf = (source) => ({
  source, replacement: null, reason: null, stages: { mechanics: false, model: false },
  rejection: null, latencyMs: 10, totalMs: 12,
});

async function type(app, window, value) {
  app.editor.value = value;
  app.editor.dispatchEvent(new window.Event("input"));
  await tick(12);
}

test("analyses a sentence only once it is finished, and only that sentence", async () => {
  const { window, app, calls } = mount({ respond: async ({ sentence }) => keepOf(sentence) });
  await type(app, window, "The end result was");
  assert.equal(calls.length, 0, "no request before terminal punctuation");
  await type(app, window, "The end result was good.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sentence, "The end result was good.");
});

test("a mark survives while a later sentence is typed, and only the new sentence is sent", async () => {
  const { window, app, calls } = mount({
    respond: async ({ sentence }) => sentence.startsWith("The end result")
      ? rewriteOf(sentence, "The result was good.")
      : keepOf(sentence),
  });
  await type(app, window, "The end result was good.");
  assert.equal(app.store.size, 1);
  await type(app, window, "The end result was good. We shipped it anyway");
  assert.equal(app.store.size, 1, "mark persists while the next sentence is unfinished");
  await type(app, window, "The end result was good. We shipped it anyway.");
  assert.equal(app.store.size, 1, "the first mark is untouched by the second sentence");
  assert.deepEqual(calls.map((call) => call.sentence),
    ["The end result was good.", "We shipped it anyway."]);
});

test("editing text before a mark keeps it and re-anchors its offsets", async () => {
  const { window, app } = mount({
    respond: async ({ sentence }) => sentence.includes("end result")
      ? rewriteOf(sentence, "The result was good.")
      : keepOf(sentence),
  });
  await type(app, window, "The end result was good.");
  const before = app.store.list()[0];
  await type(app, window, "We shipped it. The end result was good.");
  const after = app.store.list()[0];
  assert.equal(app.store.size, 1);
  assert.equal(after.id, before.id, "identity survives insertion before it");
  assert.equal(app.editor.value.slice(after.start, after.end), after.source);
});

test("a stale reply for an edited sentence never becomes a mark", async () => {
  const pending = [];
  const { window, app } = mount({
    respond: (body) => new Promise((resolve) => pending.push({ body, resolve })),
  });
  await type(app, window, "The end result was good.");
  await type(app, window, "The end result was excellent.");
  assert.equal(pending.length, 2);
  // The first, now-superseded request answers last.
  pending[1].resolve(keepOf(pending[1].body.sentence));
  pending[0].resolve(rewriteOf(pending[0].body.sentence, "The result was good."));
  await tick(20);
  assert.equal(app.store.size, 0, "a reply about text that no longer exists is dropped");
});

test("hovering a mark opens the card for that mark's sentence", async () => {
  const { window, app } = mount({
    respond: async ({ sentence }) => sentence.startsWith("The end")
      ? rewriteOf(sentence, "The result was good.")
      : rewriteOf(sentence, "We shipped it."),
  });
  await type(app, window, "The end result was good. We shipped it anyway.");
  const marks = [...app.overlay.querySelectorAll("mark")];
  assert.ok(marks.length >= 2, "each sentence contributes its own mark");
  const second = marks[marks.length - 1];
  app.openCard(second.dataset.id, second);
  assert.equal(app.card.hidden, false);
  assert.equal(app.store.get(second.dataset.id).source, "We shipped it anyway.");
});

test("the card shows the full proposed sentence with insertions and deletions", async () => {
  const { window, app } = mount({
    respond: async ({ sentence }) => rewriteOf(sentence, "We decided to wait."),
  });
  await type(app, window, "We made a decision to wait.");
  const mark = app.overlay.querySelector("mark");
  app.openCard(mark.dataset.id, mark);
  const diff = app.card.querySelector("#card-diff");
  assert.match(diff.innerHTML, /class="del">decision</u);
  assert.match(diff.innerHTML, /class="ins">decided</u);
  assert.match(diff.textContent, /wait/u);
});

test("replace rewrites only its own sentence", async () => {
  const { window, app } = mount({
    respond: async ({ sentence }) => sentence.startsWith("The end")
      ? rewriteOf(sentence, "The result was good.")
      : keepOf(sentence),
  });
  await type(app, window, "The end result was good. Nothing else changes here.");
  const mark = app.overlay.querySelector("mark");
  app.openCard(mark.dataset.id, mark);
  app.replaceActive();
  await tick(12);
  assert.equal(app.editor.value, "The result was good. Nothing else changes here.");
  assert.equal(app.card.hidden, true);
});

test("replace refuses to fire when the sentence changed underneath it", async () => {
  const { window, app } = mount({
    respond: async ({ sentence }) => rewriteOf(sentence, "The result was good."),
  });
  await type(app, window, "The end result was good.");
  const mark = app.overlay.querySelector("mark");
  const id = mark.dataset.id;
  app.openCard(id, mark);
  app.editor.value = "Something else entirely.";        // changed without a re-render
  app.replaceActive();
  assert.equal(app.editor.value, "Something else entirely.", "no write against moved text");
});

test("dismiss suppresses the suggestion until the sentence changes", async () => {
  let served = 0;
  const { window, app } = mount({
    respond: async ({ sentence }) => { served += 1; return rewriteOf(sentence, "The result was good."); },
  });
  await type(app, window, "The end result was good.");
  const mark = app.overlay.querySelector("mark");
  app.openCard(mark.dataset.id, mark);
  app.dismissActive();
  assert.equal(app.store.size, 0);
  await type(app, window, "The end result was good. ");
  assert.equal(app.store.size, 0, "dismissal holds while the sentence is unchanged");
  await type(app, window, "The end result was really good.");
  await tick(12);
  assert.equal(app.store.size, 1, "a changed sentence is analysed again");
  assert.equal(served, 2);
});

test("changing the mechanics setting re-analyses the document", async () => {
  const seen = [];
  const { window, app } = mount({
    respond: async ({ sentence, mechanics }) => { seen.push(mechanics); return keepOf(sentence); },
  });
  await type(app, window, "we stored the receipt.");
  assert.deepEqual(seen, [true]);
  const toggle = window.document.getElementById("mechanics");
  toggle.checked = false;
  toggle.dispatchEvent(new window.Event("change"));
  await tick(12);
  assert.deepEqual(seen, [true, false], "the setting change re-runs the sentence");
});

test("a transient backend failure is reported and recovers on the next edit", async () => {
  let attempt = 0;
  const { window, app } = mount({
    respond: async ({ sentence }) => {
      attempt += 1;
      return attempt === 1 ? { httpError: 503 } : rewriteOf(sentence, "The result was good.");
    },
  });
  await type(app, window, "The end result was good.");
  await tick(12);
  assert.equal(app.store.size, 0);
  assert.equal(window.document.getElementById("status").dataset.state, "error");
  await type(app, window, "The end result was very good.");
  await tick(12);
  assert.equal(app.store.size, 1, "the next sentence still gets a suggestion");
});


test("the card does not put a space before closing punctuation", async () => {
  const { window, app } = mount({
    respond: async ({ sentence }) => rewriteOf(sentence, "The team evaluated the supplier."),
  });
  await type(app, window, "The team carried out an evaluation of the supplier.");
  const mark = app.overlay.querySelector("mark");
  app.openCard(mark.dataset.id, mark);
  assert.match(app.card.querySelector("#card-diff").textContent, /supplier\.$/u);
});

test("the card keeps hyphenated words intact", async () => {
  const { window, app } = mount({
    respond: async ({ sentence }) => rewriteOf(sentence, "The batch of castings was rejected at goods-in."),
  });
  await type(app, window, "The batch of castings were rejected at goods-in.");
  const mark = app.overlay.querySelector("mark");
  app.openCard(mark.dataset.id, mark);
  assert.match(app.card.querySelector("#card-diff").textContent, /goods-in\./u);
});
