// Regressions for the two layers that face something hostile: the HTTP server, which
// must survive any bytes a client sends, and the editor, whose state has to stay
// truthful across synchronous re-entry, deletions and a model that is not answering.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createApp } from "../src/app-core.mjs";
import { resetIds } from "../src/identity.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- server harness

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// A stand-in for llama.cpp: answers /models so the demo server connects, then behaves
// as the test asks for the completion call.
async function startFakeModel({ status = 200, delayMs = 0 } = {}) {
  const port = await freePort();
  const state = { requests: 0, aborted: 0, completed: 0 };
  const server = createServer((request, response) => {
    if (request.url.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
    }
    state.requests += 1;
    const timer = setTimeout(() => {
      if (response.writableEnded || response.destroyed) return;
      state.completed += 1;
      if (status !== 200) {
        response.writeHead(status, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: "upstream failure" }));
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: '{"action":"keep","replacement":"","reason":""}' } }],
      }));
    }, delayMs);
    response.on("close", () => {
      clearTimeout(timer);
      if (!response.writableEnded) state.aborted += 1;
    });
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    state,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    async stop() { server.close(); server.closeAllConnections?.(); },
  };
}

async function startDemoServer({ modelBaseUrl = "http://127.0.0.1:1/v1" } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MODEL_BASE_URL: modelBaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never listened: ${stderr}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("tolben demo on")) { clearTimeout(timer); resolve(); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
  });
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    alive: () => child.exitCode === null && child.signalCode === null,
    get stderr() { return stderr; },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;  // already gone
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => {});
    },
  };
}

// Polls until a condition holds, so a regression is a failed assertion rather than a
// suite that never finishes.
async function waitFor(condition, { timeoutMs = 3000, what = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await tick(20);
  }
  return true;
}

// A request written straight onto the socket, so headers no fetch client would send
// still reach the server.
function rawRequest(port, lines) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    let received = "";
    socket.setTimeout(4000, () => socket.destroy());
    socket.on("data", (chunk) => { received += chunk; });
    socket.on("close", () => resolve(received));
    socket.on("error", () => resolve(received));
  });
}

// ---------------------------------------------------------------- server tests

test("a malformed rewrite body is a 400 and never takes the server down", async (t) => {
  const server = await startDemoServer();
  t.after(() => server.stop());

  const bodies = ["null", "5", "[]", '{"sentence":', "", '{"sentence": 7}', '"text"'];
  for (const body of bodies) {
    const response = await fetch(`${server.origin}/api/rewrite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(response.status, 400, `body ${JSON.stringify(body)} should be rejected, not fatal`);
    assert.ok((await response.json()).error, "the rejection says what was wrong");
    assert.ok(server.alive(), `the server died on body ${JSON.stringify(body)}: ${server.stderr}`);
  }

  const status = await fetch(`${server.origin}/api/status`);
  assert.equal(status.status, 200, "the server still answers after every malformed body");
});

test("a request with no usable Host header is answered, not fatal", async (t) => {
  const server = await startDemoServer();
  t.after(() => server.stop());

  const empty = await rawRequest(server.port, ["GET / HTTP/1.1", "Host: ", "Connection: close"]);
  assert.match(empty, /^HTTP\/1\.1 \d{3}/u, "an empty Host still gets a response");
  assert.ok(server.alive(), `the server died on an empty Host header: ${server.stderr}`);

  const broken = await rawRequest(server.port, ["GET / HTTP/1.1", "Host: ]not a host[", "Connection: close"]);
  assert.match(broken, /^HTTP\/1\.1 [34]\d\d/u, "an unparseable Host is a client error");
  assert.ok(server.alive(), `the server died on a broken Host header: ${server.stderr}`);

  const after = await fetch(`${server.origin}/api/status`);
  assert.equal(after.status, 200, "the server still answers afterwards");
});

test("a failed analysis is reported as 503, not as a clean result", async (t) => {
  const model = await startFakeModel({ status: 500 });
  t.after(() => model.stop());
  const server = await startDemoServer({ modelBaseUrl: model.baseUrl });
  t.after(() => server.stop());

  const response = await fetch(`${server.origin}/api/rewrite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentence: "The end result was good.", mechanics: false }),
  });
  assert.equal(response.status, 503, "a wedged model must not look like 'looks clear'");
  const payload = await response.json();
  assert.ok(payload.error, "the failure travels with the response");
  assert.ok(server.alive());
});

test("a client that goes away stops the generation it was waiting for", async (t) => {
  const model = await startFakeModel({ delayMs: 4000 });
  t.after(() => model.stop());
  const server = await startDemoServer({ modelBaseUrl: model.baseUrl });
  t.after(() => server.stop());

  const controller = new AbortController();
  const pending = fetch(`${server.origin}/api/rewrite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentence: "The end result was good.", mechanics: false }),
    signal: controller.signal,
  }).catch((error) => error);

  assert.ok(await waitFor(() => model.state.requests > 0), "the model call is under way");
  controller.abort();
  await pending;

  await waitFor(() => model.state.aborted > 0);
  assert.equal(model.state.aborted, 1, "the upstream request is cancelled with the client's");
  assert.equal(model.state.completed, 0, "no tokens are generated for a sentence nobody wants");
  assert.ok(server.alive());
});

// ---------------------------------------------------------------- editor harness

function mount({ respond, debounceMs = 1, browserInsertText = false } = {}) {
  resetIds();
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/", pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    if (url === "/api/status") {
      return { ok: true, json: async () => ({ ready: true, model: "test-model" }) };
    }
    const body = JSON.parse(options.body);
    calls.push({ ...body, signal: options.signal });
    if (options.signal?.aborted) throw Object.assign(new Error("aborted"), { kind: "aborted" });
    const outcome = await respond(body, options);
    if (outcome instanceof Error) throw outcome;
    if (outcome.httpError) {
      return { ok: false, status: outcome.httpError, json: async () => ({ error: "boom" }) };
    }
    return { ok: true, json: async () => outcome };
  };
  if (browserInsertText) {
    // What Chrome and Safari do: apply the edit to the focused control and fire `input`
    // synchronously, before execCommand returns. jsdom has no execCommand at all.
    window.document.execCommand = (name, _ui, value) => {
      if (name !== "insertText") return false;
      const element = window.document.activeElement;
      if (!element || element.tagName !== "TEXTAREA") return false;
      const { selectionStart, selectionEnd } = element;
      element.value = element.value.slice(0, selectionStart) + value + element.value.slice(selectionEnd);
      element.setSelectionRange(selectionStart + value.length, selectionStart + value.length);
      element.dispatchEvent(new window.Event("input", { bubbles: true }));
      return true;
    };
  }
  const app = createApp({ document: window.document, window, fetchImpl, debounceMs });
  return { dom, window, app, calls, status: window.document.getElementById("status") };
}

const rewriteOf = (source, replacement, reason = "Removes wordiness.") => ({
  source, replacement, reason, stages: { mechanics: false, model: true },
  rejection: null, latencyMs: 10, totalMs: 12,
});
const keepOf = (source) => ({
  source, replacement: null, reason: null, stages: { mechanics: false, model: false },
  rejection: null, latencyMs: 10, totalMs: 12,
});
// Exactly what the pipeline returns when llama.cpp will not answer.
const engineFailureOf = (source) => ({
  source, replacement: null, reason: null, modelReason: null,
  stages: { mechanics: false, model: false }, rejection: null, rejectedText: null, latencyMs: 0,
  error: { kind: "transient", message: "Local model server returned HTTP 500" }, totalMs: 5,
});

function type(app, window, value) {
  app.editor.value = value;
  app.editor.dispatchEvent(new window.Event("input"));
}

async function typeAndSettle(app, window, value, ms = 12) {
  type(app, window, value);
  await tick(ms);
}

// ---------------------------------------------------------------- editor tests

test("a model failure inside a 200 is reported, and the sentence is checked again later", async () => {
  let failing = true;
  const { window, app, calls, status } = mount({
    respond: async ({ sentence }) => (failing ? engineFailureOf(sentence) : rewriteOf(sentence, "The result was good.")),
  });
  await typeAndSettle(app, window, "The end result was good.");
  assert.equal(status.dataset.state, "error", "a wedged model must not read as 'Looks clear'");
  assert.match(status.textContent, /Local model unavailable/u);
  assert.equal(app.store.size, 0);

  failing = false;                                   // llama.cpp comes back
  await typeAndSettle(app, window, "The end result was good. ");
  assert.equal(calls.length, 2, "the sentence was never marked decided, so it is re-checked");
  assert.equal(calls[1].sentence, "The end result was good.");
  assert.equal(app.store.size, 1, "the suggestion arrives once the model answers");
  assert.equal(status.dataset.state, "active");
});

test("accepting a replacement never sends the model its own output back", async () => {
  for (const browserInsertText of [false, true]) {
    const { window, app, calls } = mount({
      browserInsertText,
      respond: async ({ sentence }) => (sentence.startsWith("The end")
        ? rewriteOf(sentence, "The result was good.")
        : keepOf(sentence)),
    });
    await typeAndSettle(app, window, "The end result was good.");
    const mark = app.overlay.querySelector("mark");
    app.openCard(mark.dataset.id, mark);
    app.replaceActive();
    await tick(30);
    assert.equal(app.editor.value, "The result was good.");
    assert.deepEqual(calls.map((call) => call.sentence), ["The end result was good."],
      `the accepted text was re-analysed (synchronous input event: ${browserInsertText})`);
  }
});

// jsdom does no layout, so the line boxes this is really about cannot be measured here.
// What can be asserted is the cause: a pre-wrap element drops the empty line after a
// trailing newline unless something follows it, so the mirror ends one line short of the
// textarea, its scrollHeight clamps early and every mark drifts up a line.
test("the overlay keeps the trailing empty line that a textarea renders", async () => {
  const { window, app } = mount({ respond: async ({ sentence }) => keepOf(sentence) });
  for (const value of ["one.", "one.\n", "one.\n\n", "one.\ntwo.\n", "one.\n\n\n", ""]) {
    await typeAndSettle(app, window, value);
    const expected = value.endsWith("\n") ? `${value}\u200b` : value;
    assert.equal(app.overlay.textContent, expected,
      `the mirror renders one line short of the textarea for ${JSON.stringify(value)}`);
  }
});

test("the overlay still escapes markup when the sentinel is appended", async () => {
  const { window, app } = mount({ respond: async ({ sentence }) => keepOf(sentence) });
  await typeAndSettle(app, window, "a < b & c > d.\n");
  assert.match(app.overlay.innerHTML, /a &lt; b &amp; c &gt; d\./u);
  assert.equal(app.overlay.textContent, "a < b & c > d.\n\u200b");
});

test("a sentence deleted before its debounce fires is never sent", async () => {
  const { window, app, calls, status } = mount({
    respond: async ({ sentence }) => keepOf(sentence),
    debounceMs: 60,
  });
  type(app, window, "The end result was good.");
  await tick(10);
  type(app, window, "");                              // select all, delete
  assert.equal(status.textContent, "Looks clear");
  await tick(120);
  assert.deepEqual(calls, [], "deleted text is not reviewed");
  assert.equal(status.textContent, "Looks clear", "no phantom review over an empty document");
});

test("deleting a sentence aborts the request already in flight for it", async () => {
  const { window, app, calls } = mount({ respond: () => new Promise(() => {}) });
  await typeAndSettle(app, window, "The end result was good.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false);
  type(app, window, "");
  assert.equal(calls[0].signal.aborted, true, "the in-flight request for deleted text is cancelled");
  assert.equal(app.coordinator.pending, 0);
});

test("a failure banner clears once there is nothing left to review", async () => {
  const { window, app, status } = mount({ respond: async () => ({ httpError: 503 }) });
  await typeAndSettle(app, window, "The end result was good.");
  assert.equal(status.dataset.state, "error");

  // Still failing, and the sentence is still there: the banner has to stay.
  type(app, window, "The end result was good. ");
  assert.equal(status.dataset.state, "error", "the banner survives while a retry is queued");
  await tick(20);
  assert.equal(status.dataset.state, "error");

  await typeAndSettle(app, window, "", 20);
  assert.equal(status.dataset.state, "idle", "an empty document has no failing request to report");
  assert.equal(status.textContent, "Looks clear");
});

test("a debounce armed while a reply is in flight does not re-ask about the same text", async () => {
  const pending = [];
  const { window, app, calls } = mount({
    respond: (body) => new Promise((resolve) => pending.push({ body, resolve })),
    debounceMs: 60,
  });
  const asked = (sentence) => calls.filter((call) => call.sentence === sentence).length;

  await typeAndSettle(app, window, "The end result was good.", 90);
  assert.equal(pending.length, 1, "the first request is out");

  // Typing on into the next sentence re-arms the first sentence's debounce, because its
  // reply has not landed yet.
  type(app, window, "The end result was good. W");
  pending[0].resolve(rewriteOf("The end result was good.", "The result was good."));
  await tick(10);                       // the reply lands, well before the re-armed timer
  assert.equal(app.store.size, 1, "the reply became a suggestion");

  await tick(120);                      // the re-armed timer fires
  assert.equal(asked("The end result was good."), 1,
    "the timer fired after the answer arrived and asked the same question again");

  // The guard must not swallow a sentence that genuinely changed.
  await typeAndSettle(app, window, "The end result was excellent.", 90);
  assert.equal(asked("The end result was excellent."), 1, "changed text is still analysed");
});
