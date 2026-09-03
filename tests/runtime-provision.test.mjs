// The provisioner's decisions, with every side effect injected.
//
// What is being held to account here is the ORDER and the refusals: that an orphan is
// reaped before anything else, that a server already running is used rather than 1.5 GB
// downloaded behind someone's back, and above all that nothing is fetched until a person
// has seen the plan.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plan, provision, describePlan, formatBytes, ProvisionError } from "../obsidian-plugin/runtime/provision.mjs";
import { MEASURED_MODEL, modelById } from "../obsidian-plugin/runtime/manifest.mjs";

async function withDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "tolben-prov-"));
  try { return await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// Nothing is listening; the CPU has AVX2; the environment is not sandboxed.
const BARE = {
  fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  readFile: async () => "flags\t: avx2\n",
  env: {},
};

const serving = (bodies) => async (url) => {
  for (const [match, body] of Object.entries(bodies)) {
    if (url.includes(match)) return { ok: true, json: async () => body };
  }
  throw new Error("ECONNREFUSED");
};

test("a plan names every byte, and its total, before anything moves", async () => {
  const decided = await plan({ platform: "darwin", arch: "arm64", ...BARE });
  const model = modelById(MEASURED_MODEL);
  const item = decided.items.find((row) => row.kind === "model");
  assert.equal(item.sha256, model.sha256);
  assert.equal(item.bytes, model.bytes);
  assert.match(item.url, /^https:\/\/huggingface\.co\//u);
  assert.equal(decided.totalBytes >= model.bytes, true);
  assert.equal(decided.measured, true);
});

test("the smaller quantisation is offered and labelled as not the measured artefact", async () => {
  const decided = await plan({ platform: "darwin", arch: "arm64", modelId: "qwen3.5-2b-q4_k_m", ...BARE });
  assert.equal(decided.measured, false, "the plan says so");
  assert.equal(decided.items.find((item) => item.kind === "model").measured, false, "and so does the item");
  assert.equal(decided.model.role.includes("NOT the artefact"), true, "and the manifest says why it matters");

  const measured = await plan({ platform: "darwin", arch: "arm64", ...BARE });
  assert.equal(measured.measured, true);

  // describePlan carries the label onto the one line a status bar has room for. The two
  // plans above are "blocked" in this checkout, because no llama.cpp build is pinned yet,
  // so the download wording is exercised directly.
  assert.match(describePlan({ action: "download-and-spawn", totalBytes: 1_270_808_032, measured: false }),
    /1\.27 GB \(not the measured artefact\)/u);
  assert.match(describePlan({ action: "download-and-spawn", totalBytes: 1_556_390_368, measured: true }),
    /^download 1\.56 GB$/u);
});

test("nothing is downloaded without confirmation", async () => {
  await withDir(async (dir) => {
    const fetched = [];
    await assert.rejects(provision({
      platform: "darwin", arch: "arm64", stateDir: dir, ...BARE,
      fetchImpl: async (url) => { fetched.push(url); throw new Error("ECONNREFUSED"); },
      reapImpl: async () => ({ reaped: false, reason: "no-pid-file" }),
    }), (error) => error instanceof ProvisionError && error.kind === "unconfirmed");
    assert.deepEqual(fetched.filter((url) => url.includes("huggingface") || url.includes("github.com")), [],
      "not one byte of the model or the runtime was requested");
  });
});

test("an orphan from a crashed session is reaped before anything else happens", async () => {
  await withDir(async (dir) => {
    const order = [];
    await provision({
      platform: "darwin", arch: "arm64", stateDir: dir, ...BARE,
      fetchImpl: serving({ "/v1/models": { data: [{ id: "qwen" }] } }),
      reapImpl: async () => { order.push("reap"); return { reaped: true, pid: 7 }; },
      onEvent: (event) => order.push(event.phase),
    });
    assert.equal(order[0], "reap");
    assert.ok(order.indexOf("reap") < order.indexOf("detect"));
  });
});

test("a llama-server already running is used, and nothing is downloaded or spawned", async () => {
  await withDir(async (dir) => {
    let spawned = false;
    const result = await provision({
      platform: "darwin", arch: "arm64", stateDir: dir, ...BARE,
      fetchImpl: serving({ "/v1/models": { data: [{ id: "Qwen3.5-2B-Q6_K" }] } }),
      reapImpl: async () => ({ reaped: false }),
      startImpl: async () => { spawned = true; },
    });
    assert.equal(result.kind, "existing");
    assert.equal(result.server, "llama-server");
    assert.equal(result.managed, false);
    assert.equal(result.apiBase, "http://127.0.0.1:8080/v1");
    assert.equal(spawned, false);
  });
});

test("an Ollama that already holds the pinned tag is used as it is", async () => {
  await withDir(async (dir) => {
    const tag = modelById(MEASURED_MODEL).ollama;
    const result = await provision({
      platform: "darwin", arch: "arm64", stateDir: dir, ...BARE,
      fetchImpl: serving({ "/api/tags": { models: [{ name: tag }] } }),
      reapImpl: async () => ({ reaped: false }),
    });
    assert.equal(result.server, "ollama");
    assert.equal(result.apiBase, "http://127.0.0.1:11434/v1");
    assert.equal(result.model, tag);
  });
});

test("an Ollama without the model asks for a pull rather than downloading a second copy", async () => {
  await withDir(async (dir) => {
    await assert.rejects(provision({
      platform: "darwin", arch: "arm64", stateDir: dir, ...BARE, confirmed: true,
      fetchImpl: serving({ "/api/tags": { models: [{ name: "llama3:8b" }] } }),
      reapImpl: async () => ({ reaped: false }),
    }), (error) => error.kind === "ollama-pull-required" && /ollama pull/u.test(error.advice.body));
  });
});

test("llama-server is preferred over Ollama: it is what the numbers were measured on", async () => {
  await withDir(async (dir) => {
    const tag = modelById(MEASURED_MODEL).ollama;
    const result = await provision({
      platform: "darwin", arch: "arm64", stateDir: dir, ...BARE,
      fetchImpl: serving({ "/api/tags": { models: [{ name: tag }] }, "/v1/models": { data: [{ id: "q" }] } }),
      reapImpl: async () => ({ reaped: false }),
    });
    assert.equal(result.server, "llama-server");
  });
});

// An entry the pinning tool has not reached yet — a platform llama.cpp has just started
// building for, or a release whose macOS job failed. The manifest carries none of these
// now that all six are pinned, so it is supplied here: the refusal is the promise the
// provisioner is built around and cannot be left untested because the repository is
// currently in the happy state.
const UNPINNED = [{
  id: "darwin-arm64-hypothetical", platform: "darwin", arch: "arm64", requires: [],
  assetShape: "llama-{tag}-bin-macos-arm64.tar.gz", asset: null, bytes: null, sha256: null,
  binary: "llama-server", strip: 1,
}];

test("an unpinned runtime is reported, never fetched on trust", async () => {
  await withDir(async (dir) => {
    const fetched = [];
    await assert.rejects(provision({
      platform: "darwin", arch: "arm64", stateDir: dir, ...BARE, confirmed: true,
      runtimes: UNPINNED,
      fetchImpl: async (url) => { fetched.push(url); throw new Error("ECONNREFUSED"); },
      reapImpl: async () => ({ reaped: false }),
    }), (error) => error.kind === "unpinned"
      && /will not be downloaded/u.test(error.message)
      && /Ollama/u.test(error.advice.fallback));
    assert.deepEqual(fetched.filter((url) => url.includes("github.com")), [],
      "and the refusal came before any request, not after one");
  });
});

test("a pinned runtime is what the plan now names, with its hash on the screen", async () => {
  // The manifest as committed. Everything a person is asked to authorise is here: the
  // release tag, the exact asset, its size and its full sha256.
  const decided = await plan({ platform: "darwin", arch: "arm64", ...BARE });
  const item = decided.items.find((row) => row.kind === "runtime");
  assert.equal(decided.action, "download-and-spawn");
  assert.match(item.url, /^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\/b\d+\//u);
  assert.match(item.url, /llama-b\d+-bin-macos-arm64\.tar\.gz$/u);
  assert.match(item.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(item.bytes > 1_000_000);
  // Runtime plus model, and the total a person sees is the sum of what they authorised.
  assert.equal(decided.totalBytes, decided.items.reduce((sum, row) => sum + row.bytes, 0));
});

test("a platform with no pinned build at all says so", async () => {
  const decided = await plan({ platform: "sunos", arch: "sparc", ...BARE });
  assert.equal(decided.action, "blocked");
  assert.equal(decided.runtimeUnavailable.reason, "unsupported-platform");
});

test("a sandboxed Obsidian is recognised in the plan, before a spawn fails mysteriously", async () => {
  const flatpak = await plan({ platform: "linux", arch: "x64", ...BARE, env: { FLATPAK_ID: "md.obsidian.Obsidian" } });
  assert.equal(flatpak.sandbox, "flatpak");
  const snap = await plan({ platform: "linux", arch: "x64", ...BARE, env: { SNAP: "/snap/obsidian", SNAP_NAME: "obsidian" } });
  assert.equal(snap.sandbox, "snap");
});

test("a CPU reporting no features still gets the same build", async () => {
  // llama.cpp's CPU release dispatches instruction sets at runtime, so the feature scan
  // is an optimisation with nothing left to optimise — and, importantly, a machine that
  // reports nothing must not be told that no build exists for it.
  const withAvx = await plan({ platform: "linux", arch: "x64", ...BARE });
  const without = await plan({
    platform: "linux", arch: "x64", ...BARE,
    readFile: async () => "flags\t: fpu vme de pse tsc\n",
  });
  assert.deepEqual(withAvx.features, ["avx2"]);
  assert.deepEqual(without.features, []);
  // Both resolve, to the same archive, and the feature scan changes nothing.
  assert.equal(withAvx.runtimeUnavailable, null);
  assert.equal(without.runtimeUnavailable, null);
  const build = (decided) => decided.items.find((item) => item.kind === "runtime");
  assert.equal(build(without).url, build(withAvx).url);
  assert.equal(build(without).sha256, build(withAvx).sha256);
});

test("byte sizes are rendered for humans", () => {
  assert.equal(formatBytes(0), "0 bytes");
  assert.equal(formatBytes(4096), "4 kB");
  assert.equal(formatBytes(128_436_226), "128 MB");
  assert.equal(formatBytes(1_556_390_368), "1.56 GB");
});
