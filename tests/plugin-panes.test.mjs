// The three panes, the status line, the refusal ledger and the network counter.
//
// The pane renderers take a DOM node and nothing else, so jsdom is enough to hold them to
// account — and what is checked is not that they render, but that they render the things
// the product's claims rest on: every hash before the download button, the non-loopback
// count in the first line, and an empty ledger that reads as an answer rather than an
// apology.

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderSetup, renderProgress, renderLedger, renderNetwork, statusLine } from "../obsidian-plugin/panes.mjs";
import { createLedger } from "../obsidian-plugin/ledger.mjs";
import { createNetworkLog, isLoopback } from "../obsidian-plugin/network-log.mjs";
import { modelById, MEASURED_MODEL } from "../obsidian-plugin/runtime/manifest.mjs";

function root() {
  const dom = new JSDOM("<div id='root'></div>");
  return dom.window.document.getElementById("root");
}

const MODEL = modelById(MEASURED_MODEL);
const SMALL = modelById("qwen3.5-2b-q4_k_m");

const downloadPlan = (overrides = {}) => ({
  action: "download-and-spawn",
  running: { ollama: null, llamaServer: null },
  sandbox: null,
  measured: true,
  model: MODEL,
  totalBytes: MODEL.bytes,
  items: [{ kind: "model", id: MODEL.id, name: MODEL.file, url: MODEL.sources[0], bytes: MODEL.bytes, sha256: MODEL.sha256, measured: true }],
  runtimeUnavailable: null,
  ...overrides,
});

// --------------------------------------------------------------------------- setup

test("the setup pane shows every URL, size and hash above the button", () => {
  const node = root();
  renderSetup(node, downloadPlan(), {});
  const text = node.textContent;
  assert.match(text, /1\.56 GB/u, "the size is stated");
  assert.ok(text.includes(MODEL.sha256), "the full hash is shown, not a prefix");
  assert.ok(text.includes(MODEL.sources[0]), "and the exact URL");

  // Above the button, not behind a disclosure triangle: the hash must appear in the
  // document before the element that starts the download.
  const html = node.innerHTML;
  assert.ok(html.indexOf(MODEL.sha256) < html.indexOf("Download"), "the hash comes before the button");
});

test("the button says what it will do, in bytes", () => {
  const node = root();
  renderSetup(node, downloadPlan(), {});
  const primary = node.querySelector("button.tolben-primary");
  assert.match(primary.textContent, /^Download 1\.56 GB and start$/u);
});

test("confirming is what starts a download, and nothing else does", () => {
  const node = root();
  let confirmed = 0;
  let cancelled = 0;
  renderSetup(node, downloadPlan(), { onConfirm: () => { confirmed += 1; }, onCancel: () => { cancelled += 1; } });
  node.querySelector("button.tolben-primary").click();
  assert.equal(confirmed, 1);
  [...node.querySelectorAll("button")].find((b) => b.textContent === "Not now").click();
  assert.equal(cancelled, 1);
});

test("an unmeasured quantisation is labelled where the reader will see it", () => {
  const node = root();
  renderSetup(node, downloadPlan({
    measured: false, model: SMALL, totalBytes: SMALL.bytes,
    items: [{ kind: "model", name: SMALL.file, url: SMALL.sources[0], bytes: SMALL.bytes, sha256: SMALL.sha256, measured: false }],
  }), {});
  assert.match(node.querySelector(".tolben-warn").textContent, /not the model the published numbers were measured on/u);
});

test("a server already running needs no download and says so", () => {
  const node = root();
  renderSetup(node, downloadPlan({
    action: "use-llama-server",
    running: { llamaServer: { baseUrl: "http://127.0.0.1:8080", apiBase: "http://127.0.0.1:8080/v1" }, ollama: null },
  }), {});
  assert.match(node.textContent, /already running on http:\/\/127\.0\.0\.1:8080/u);
  assert.match(node.textContent, /Nothing needs downloading/u);
  assert.equal(node.querySelector("button.tolben-primary").textContent, "Use it");
});

test("a blocked platform offers the way out rather than a dead end", () => {
  const node = root();
  renderSetup(node, downloadPlan({
    action: "blocked",
    runtimeUnavailable: { reason: "unpinned", detail: "The llama.cpp build for macos-arm64 has no recorded sha256." },
  }), {});
  assert.match(node.querySelector(".tolben-warn").textContent, /no recorded sha256/u);
  assert.match(node.textContent, /Install Ollama/u);
});

test("a sandboxed Obsidian is warned about before it fails", () => {
  const node = root();
  renderSetup(node, downloadPlan({ sandbox: "flatpak" }), {});
  assert.match(node.querySelector(".tolben-warn").textContent, /inside flatpak/u);
});

test("progress reports bytes against a total", () => {
  const node = root();
  renderProgress(node, { label: "Qwen3.5-2B-Q6_K.gguf", received: 778_195_184, total: MODEL.bytes });
  assert.match(node.textContent, /778 MB of 1\.56 GB/u);
  // jsdom normalises "50.0%" to "50%", so the bar is checked by value, not by spelling.
  assert.equal(Number.parseFloat(node.querySelector(".tolben-progress-fill").style.width), 50);
});

// -------------------------------------------------------------------------- ledger

test("an empty ledger reads as an answer, not an apology", () => {
  const node = root();
  renderLedger(node, { path: "note.md", rows: [] }, {});
  assert.match(node.textContent, /Nothing was refused in this note/u);
  assert.equal(node.querySelector("button"), null, "nothing to copy or clear");
});

test("the ledger shows the sentence, the proposal and the rule that stopped it", () => {
  const node = root();
  renderLedger(node, {
    path: "note.md",
    rows: [{
      source: "The auditor reviewed the vendor's controls.",
      replacement: "The vendor reviewed the auditor's controls.",
      reason: "order-changed",
    }],
  }, {});
  assert.match(node.querySelector(".tolben-ledger-reason").textContent, /^order-changed$/u);
  assert.match(node.querySelector(".tolben-ledger-source").textContent, /The auditor reviewed/u);
  assert.match(node.querySelector(".tolben-ledger-proposed").textContent, /The vendor reviewed/u);
});

test("a refusal with no proposal still reads sensibly", () => {
  const node = root();
  renderLedger(node, { path: "n.md", rows: [{ source: "S.", replacement: null, reason: "empty" }] }, {});
  assert.match(node.querySelector(".tolben-ledger-proposed").textContent, /\(nothing\)/u);
});

// ------------------------------------------------------------------------- network

const networkReport = (overrides = {}) => ({
  network: { requests: 12, offMachine: 0, failures: 0, hosts: [{ host: "127.0.0.1:51234", requests: 12, loopback: true }] },
  endpoint: "http://127.0.0.1:51234/v1",
  managed: true,
  pid: 4242,
  model: "Qwen3.5-2B-Q6_K.gguf",
  modelSha256: MODEL.sha256,
  measured: true,
  cacheEntries: 40,
  ledger: { notes: 2, entries: 5 },
  ...overrides,
});

test("the network pane's first line is the claim, and it is computed", () => {
  const node = root();
  renderNetwork(node, networkReport());
  assert.match(node.querySelector(".tolben-good").textContent, /12 requests since this plugin loaded, all to this machine/u);
});

test("a request that left the machine turns the claim into its contradiction", () => {
  // If this ever renders on a real install, the product's central promise is false and
  // the pane has to say so rather than round it down.
  const node = root();
  renderNetwork(node, networkReport({
    network: {
      requests: 12, offMachine: 1, failures: 0,
      hosts: [{ host: "telemetry.example.com", requests: 1, loopback: false }, { host: "127.0.0.1:51234", requests: 11, loopback: true }],
    },
  }));
  assert.equal(node.querySelector(".tolben-good"), null);
  assert.match(node.querySelector(".tolben-warn").textContent, /1 of 12 requests went somewhere other than this machine/u);
  assert.match(node.querySelector(".tolben-host-remote").textContent, /NOT this machine/u);
});

test("the pane names the model hash and whether it is the measured artefact", () => {
  const node = root();
  renderNetwork(node, networkReport());
  assert.ok(node.textContent.includes(MODEL.sha256));
  assert.match(node.textContent, /this is what REPORT\.md's numbers describe/u);
  assert.match(node.textContent, /pid 4242/u);
});

test("a server the writer started is not claimed as Tolben's", () => {
  const node = root();
  renderNetwork(node, networkReport({ managed: false, pid: null, modelSha256: null, measured: undefined }));
  assert.match(node.textContent, /started by you; Tolben did not spawn it/u);
  assert.match(node.textContent, /not a pinned artefact/u);
});

test("the pane says what is in memory and what reached the vault", () => {
  const node = root();
  renderNetwork(node, networkReport({ vaultWrites: "settings only (data.json)" }));
  assert.match(node.textContent, /40 cached answers, 5 refusals across 2 note\(s\)/u);
  assert.match(node.textContent, /settings only \(data\.json\)/u);
});

// --------------------------------------------------------------------- status line

test("the status line carries what was refused, not only what was suggested", () => {
  assert.equal(statusLine({ state: "ready", count: 3, refused: 2, managed: true }),
    "Tolben: ready · local · 3 suggestions · 2 refused");
  assert.equal(statusLine({ state: "ready", count: 1, refused: 0 }), "Tolben: ready · local · 1 suggestion");
  assert.equal(statusLine({ state: "ready" }), "Tolben: ready · local");
});

test("held sentences are never rounded down to 'clear'", () => {
  // Reporting nothing here told the writer their prose was checked when it never was.
  assert.match(statusLine({ state: "ready", count: 0, held: 4 }), /4 unchecked/u);
});

test("the states before ready say which one they are in", () => {
  assert.equal(statusLine({ state: "setup" }), "Tolben: needs setup");
  assert.equal(statusLine({ state: "starting" }), "Tolben: starting the model");
  assert.equal(statusLine({ state: "checking" }), "Tolben: checking…");
  assert.equal(statusLine({ state: "ready", error: "model server HTTP 500" }), "Tolben: model server HTTP 500");
});

// ------------------------------------------------------------------- ledger object

test("a refusal is recorded once however often the note is re-analysed", () => {
  const ledger = createLedger();
  for (let round = 0; round < 5; round += 1) {
    ledger.record("a.md", { source: "S.", replacement: "R.", reason: "order-changed" });
  }
  assert.equal(ledger.countForNote("a.md"), 1);
});

test("the ledger is per note and forgets on demand", () => {
  const ledger = createLedger();
  ledger.record("a.md", { source: "S1.", replacement: "R1.", reason: "x" });
  ledger.record("b.md", { source: "S2.", replacement: "R2.", reason: "y" });
  assert.deepEqual(ledger.stats(), { notes: 2, entries: 2 });
  ledger.clear("a.md");
  assert.equal(ledger.countForNote("a.md"), 0);
  assert.equal(ledger.countForNote("b.md"), 1);
  ledger.clear();
  assert.deepEqual(ledger.stats(), { notes: 0, entries: 0 });
});

test("a long session on one note does not grow without bound", () => {
  const ledger = createLedger({ maxPerNote: 3 });
  for (let index = 0; index < 10; index += 1) {
    ledger.record("a.md", { source: `S${index}.`, replacement: "R.", reason: "x" });
  }
  assert.equal(ledger.countForNote("a.md"), 3);
  // The recent ones are what survive: they are the refusals someone just watched happen.
  assert.deepEqual(ledger.forNote("a.md").map((row) => row.source), ["S9.", "S8.", "S7."]);
});

test("an incomplete refusal is not recorded at all", () => {
  const ledger = createLedger();
  ledger.record(null, { source: "S.", reason: "x" });
  ledger.record("a.md", { source: "", reason: "x" });
  ledger.record("a.md", { source: "S.", reason: null });
  assert.deepEqual(ledger.stats(), { notes: 0, entries: 0 });
});

test("the ledger renders as plain text a person can paste into an issue", () => {
  const ledger = createLedger();
  ledger.record("a.md", { source: "S.", replacement: "R.", reason: "order-changed" });
  const text = ledger.asText("a.md");
  assert.match(text, /1 refusal in a\.md/u);
  assert.match(text, /refused: order-changed/u);
  assert.match(text, /from: S\./u);
  assert.equal(ledger.asText("nothing.md"), "Nothing was refused in this note.");
});

// ------------------------------------------------------------------- network log

test("loopback is decided by address, and an invalid one is not loopback", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", "127.1", "127.0.0.1"]) {
    assert.equal(isLoopback(host), true, host);
  }
  for (const host of ["huggingface.co", "192.168.1.5", "0.0.0.0", "", null, "127.0.0.1.evil.com"]) {
    assert.equal(isLoopback(host), false, String(host));
  }
  // Not an address at all, so it would be resolved as a NAME and could point anywhere.
  // Counting it as loopback would make the whole counter a lie.
  assert.equal(isLoopback("127.0.0.256"), false);
  assert.equal(isLoopback("127.999"), false);
});

test("every request through the wrapper is counted, by host", async () => {
  const log = createNetworkLog();
  const fetchImpl = log.wrap(async () => ({ ok: true }));
  await fetchImpl("http://127.0.0.1:8080/v1/models");
  await fetchImpl("http://127.0.0.1:8080/v1/chat/completions");
  const report = log.report();
  assert.equal(report.requests, 2);
  assert.equal(report.offMachine, 0);
  assert.deepEqual(report.hosts.map((host) => host.host), ["127.0.0.1:8080"]);
  assert.equal(report.hosts[0].requests, 2);
});

test("a request that leaves the machine is counted separately and cannot be hidden", async () => {
  const log = createNetworkLog();
  const fetchImpl = log.wrap(async () => ({ ok: true }));
  await fetchImpl("https://huggingface.co/lmstudio-community/x.gguf");
  const report = log.report();
  assert.equal(report.offMachine, 1);
  assert.equal(report.hosts.find((host) => host.host === "huggingface.co").loopback, false);
});

test("a failed request is still counted: it was still made", async () => {
  const log = createNetworkLog();
  const fetchImpl = log.wrap(async () => { throw new Error("ECONNREFUSED"); });
  await assert.rejects(fetchImpl("http://127.0.0.1:8080/v1/models"));
  const report = log.report();
  assert.equal(report.requests, 1);
  assert.equal(report.failures, 1);
});

test("an unparseable URL counts against the claim rather than for it", async () => {
  const log = createNetworkLog();
  const fetchImpl = log.wrap(async () => ({ ok: true }));
  await fetchImpl("not a url");
  assert.equal(log.report().offMachine, 1);
});
