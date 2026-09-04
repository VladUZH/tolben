// The managed-server lifecycle, through the shipped bundle, against a fake OpenAI server
// on loopback and an injected provisioner.
//
// What is real: obsidian-plugin/main.js as built, the plugin's own fetch over real HTTP,
// the engine, the pipeline. What is fake: the model server (it answers "keep" to every
// sentence and one token to a warm-up) and provision(), which here starts such a server
// instead of a llama-server. The claims under test are about the plugin's control flow:
// that a managed server is started again at load and after the idle unload, that the
// prompts are read in before any sentence is sent, that nothing is downloaded on the way
// back, and that sentences wait rather than fail while that happens. On 2026-09-04 every
// one of those was false in 1.0.0 and no test could tell (REPORT.md under that date). The
// real-server version of this is tools/plugin-lifecycle.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadShippedBundle, REPO } from "../tools/bundle-harness.mjs";

const CLARITY_PROMPT = await readFile(join(REPO, "src", "clarity-prompt.txt"), "utf8");
const VERIFIER_PROMPT = await readFile(join(REPO, "src", "verifier-prompt.txt"), "utf8");

// A model server that answers like llama-server does at the reason stop, and records
// every request it saw.
function fakeServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ url: req.url, body });
      const json = (status, payload) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (req.url === "/health") return json(200, { status: "ok" });
      if (req.url === "/v1/models") return json(200, { data: [{ id: "fake-model" }] });
      if (req.url.startsWith("/slots/")) return json(200, {});
      if (req.url === "/v1/chat/completions") {
        const content = body.max_tokens === 1 ? "{"
          : body.response_format?.json_schema?.name === "edit_verdict" ? '{"verdict":"show","reason":""}'
          : `{"action":"keep","replacement":${JSON.stringify(body.messages.at(-1).content)}`;
        return json(200, { choices: [{ message: { content } }] });
      }
      return json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    const base = `http://127.0.0.1:${server.address().port}`;
    // close() alone waits for keep-alive sockets the plugin's fetch holds open; drop them.
    const close = () => new Promise((r) => { server.close(r); server.closeAllConnections(); });
    resolve({ base, requests, close, get listening() { return server.listening; } });
  }));
}

let harness, dir;
test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "tolben-lifecycle-"));
  harness = await loadShippedBundle(join(dir, "rig"));
});
test.after(async () => { await rm(dir, { recursive: true, force: true }); });

function rig({ data }) {
  const statuses = [];
  globalThis.__tolbenRig = { log: () => {}, data, onStatus: (text) => statuses.push(text) };
  return { statuses, saved: () => globalThis.__tolbenRig.data };
}
const app = { workspace: { getActiveFile: () => ({ path: "note.md" }) }, vault: {} };
const manifest = { id: "tolben", version: "1.0.1" };
const analyze = (plugin, sentence, signal) => plugin.analyze(sentence, { signal, context: { protectedTerms: [] } });
// Registered with t.after in every test: a plugin left loaded holds a timer and a fake
// server left listening holds a socket, and either would keep a failed test from ending.
async function cleanup(plugin, provision = null) {
  try { plugin.onunload(); } catch { /* already unloaded */ }
  for (const server of provision?.servers ?? []) await server.close();
}

// provision() as the plugin calls it, except that what it starts is a fake server.
function provisioner() {
  const calls = [];
  const servers = [];
  const impl = async (options) => {
    calls.push(options);
    const server = await fakeServer();
    servers.push(server);
    return {
      kind: "managed", server: "llama-server", managed: true, pid: 4242,
      apiBase: `${server.base}/v1`, baseUrl: server.base, apiKey: "test-key",
      stop: async () => server.close(),
    };
  };
  return { impl, calls, servers, latest: () => servers.at(-1) };
}

test("a managed server is started at load, warmed with both prompts, and only then asked about a sentence", async (t) => {
  const { statuses, saved } = rig({ data: { setupDone: true, managed: true, baseUrl: "http://127.0.0.1:1/v1" } });
  const provision = provisioner();
  const plugin = new harness.TolbenPlugin(app, manifest);
  plugin.provisionImpl = provision.impl;
  t.after(() => cleanup(plugin, provision));
  await plugin.onload();
  assert.ok(plugin.starting, "the connection starts at load, not at the first sentence");
  await plugin.starting;

  assert.equal(provision.calls.length, 1);
  assert.equal(provision.calls[0].confirmed, false, "coming back never confirms a download");
  assert.ok(statuses.includes("Tolben: starting the model"), `saw: ${statuses.join(" | ")}`);
  assert.equal(statuses.at(-1), "Tolben: ready · local");
  assert.equal(saved().baseUrl, `${provision.latest().base}/v1`, "the new port is saved");
  assert.equal(saved().managed, true);

  const chats = provision.latest().requests.filter((r) => r.url === "/v1/chat/completions");
  assert.equal(chats.length, 2, "two warm-up calls and nothing else before a sentence");
  assert.deepEqual(chats.map((r) => r.body.max_tokens), [1, 1]);
  assert.equal(chats[0].body.messages[0].content, CLARITY_PROMPT);
  assert.equal(chats[1].body.messages[0].content, VERIFIER_PROMPT);
  assert.ok(chats[0].body.response_format, "the warm-up carries the same schema as a real request");
  assert.equal(plugin.warmUp.ok, true);

  const outcome = await analyze(plugin, "The revised terms were sent to the vendor on Tuesday.");
  assert.equal(outcome.replacement, null);
  assert.equal(provision.latest().requests.filter((r) => r.url === "/v1/chat/completions").length, 3);
});

test("after the idle unload the next sentence brings the server back, and sentences wait for it", async (t) => {
  rig({ data: { setupDone: true, managed: true, baseUrl: "" } });
  const provision = provisioner();
  const plugin = new harness.TolbenPlugin(app, manifest);
  plugin.provisionImpl = provision.impl;
  t.after(() => cleanup(plugin, provision));
  await plugin.onload();
  await plugin.starting;
  const first = provision.latest();
  // A third sentence, because the outcome cache answers a repeated one without the model.
  await analyze(plugin, "The crew reached the summit before noon.");

  await plugin.unloadIdle();
  assert.equal(first.listening, false, "stop() was called on the server Tolben started");
  assert.equal(plugin.runtime, null);
  assert.equal(plugin.engine, null);

  // Two sentences at once: one provision, one warm-up, two answers.
  const [a, b] = await Promise.all([
    analyze(plugin, "The revised terms were sent to the vendor on Tuesday."),
    analyze(plugin, "The gasket held at full pressure overnight."),
  ]);
  assert.equal(provision.calls.length, 2);
  assert.equal(a.replacement, null);
  assert.equal(b.replacement, null);
  const second = provision.latest();
  const chats = second.requests.filter((r) => r.url === "/v1/chat/completions");
  assert.deepEqual(chats.slice(0, 2).map((r) => r.body.max_tokens), [1, 1], "warmed again before either sentence");
  assert.equal(chats.length, 4);
});

test("a restart with the saved data.json starts the managed server again without a sentence", async (t) => {
  const { saved } = rig({ data: { setupDone: true, managed: true, baseUrl: "http://127.0.0.1:1/v1" } });
  const provision = provisioner();
  const p1 = new harness.TolbenPlugin(app, manifest);
  p1.provisionImpl = provision.impl;
  t.after(() => cleanup(p1, provision));
  await p1.onload();
  await p1.starting;
  p1.onunload();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(provision.latest().listening, false, "onunload stopped it");

  const p2 = new harness.TolbenPlugin(app, manifest);
  p2.provisionImpl = provision.impl;
  await p2.onload();
  await p2.starting;
  assert.equal(provision.calls.length, 2);
  assert.equal(saved().baseUrl, `${provision.latest().base}/v1`);
  t.after(() => cleanup(p2, provision));
  const outcome = await analyze(p2, "The revised terms were sent to the vendor on Tuesday.");
  assert.equal(outcome.replacement, null);
});

test("when the files are gone, the sentence fails with the setup command named, and nothing is downloaded", async (t) => {
  const { statuses } = rig({ data: { setupDone: true, managed: true, baseUrl: "" } });
  let calls = 0;
  const plugin = new harness.TolbenPlugin(app, manifest);
  t.after(() => cleanup(plugin));
  plugin.provisionImpl = async ({ confirmed }) => {
    calls += 1;
    assert.equal(confirmed, false);
    throw Object.assign(new Error("Provisioning would download 2 file(s)"), { kind: "unconfirmed" });
  };
  await plugin.onload();
  await assert.rejects(plugin.starting, /Set up the model server/u);
  await assert.rejects(analyze(plugin, "The revised terms were sent to the vendor on Tuesday."),
    (error) => /Set up the model server/u.test(error.message) && error.kind === "failed");
  assert.equal(calls, 2, "once at load, once for the sentence; never a download");
  assert.ok(statuses.includes("Tolben: starting the model"));
});

test("a server the writer runs is never provisioned, and a dead one is reported rather than replaced", async (t) => {
  rig({ data: { setupDone: true, managed: false, baseUrl: "http://127.0.0.1:1/v1" } });
  const provision = provisioner();
  const plugin = new harness.TolbenPlugin(app, manifest);
  plugin.provisionImpl = provision.impl;
  t.after(() => cleanup(plugin, provision));
  await plugin.onload();
  await assert.rejects(plugin.starting, /ECONNREFUSED|timeout|fetch/iu);
  await assert.rejects(analyze(plugin, "The revised terms were sent to the vendor on Tuesday."), /ECONNREFUSED|timeout|fetch/iu);
  assert.equal(provision.calls.length, 0);
});

test("a sentence the writer moves past does not wait for the server to start", async (t) => {
  rig({ data: { setupDone: true, managed: true, baseUrl: "" } });
  let release;
  const gate = new Promise((r) => { release = r; });
  const provision = provisioner();
  const plugin = new harness.TolbenPlugin(app, manifest);
  plugin.provisionImpl = async (options) => { await gate; return provision.impl(options); };
  t.after(() => cleanup(plugin, provision));
  await plugin.onload();
  const controller = new AbortController();
  const pending = analyze(plugin, "The revised terms were sent to the vendor on Tuesday.", controller.signal);
  setTimeout(() => controller.abort(new Error("moved on")), 20);
  await assert.rejects(pending, (error) => error.kind === "aborted");
  release();
  await plugin.starting;
});
