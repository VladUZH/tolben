// The provisioner: from "a writer just enabled the plugin" to "a model server is
// answering on loopback", with every byte named before it moves.
//
// The order is deliberate and is the whole design:
//
//   1. Reap an orphan from a crashed session, so a force-quit does not leave 2 GB
//      resident and a second server fighting for the port.
//   2. Ask what is already running. Someone with Ollama has done the hard part, and
//      downloading 1.5 GB behind their back would be rude and slow.
//   3. Build a PLAN — every URL, size and sha256 — and stop. `provision()` will not
//      fetch anything unless it is called with `confirmed: true`, which the setup pane
//      only passes after a person has read the plan. This is the difference between a
//      tool that downloads a model and a tool that asks.
//   4. Download, verify, extract, spawn, warm up.
//
// Each step reports progress through one `onEvent` channel so the setup pane, the
// headless CLI and the tests all watch the same thing.

import { join } from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { downloadVerified, hashOf } from "./download.mjs";
import { extract } from "./unpack.mjs";
import { cpuFeatures } from "./cpu.mjs";
import { detectRunning, hasPinnedModel } from "./detect.mjs";
import { downloadPlan, modelById, MEASURED_MODEL, manifest, runtimeUrl } from "./manifest.mjs";
import { explainSpawnFailure, detectSandbox } from "./messages.mjs";
import {
  startServer, warmUp, reapOrphan, freePort, newApiKey, ServerError,
} from "./server.mjs";

export class ProvisionError extends Error {
  constructor(message, { kind = "failed", advice = null, cause } = {}) {
    super(message, { cause });
    this.name = "ProvisionError";
    this.kind = kind;
    this.advice = advice; // { title, body, fallback } from messages.mjs, when there is one
  }
}

export const RUNTIME_DIR = "runtime";
export const MODEL_DIR = "models";

/**
 * What provisioning WOULD do, without doing any of it.
 *
 * This is what the setup pane renders before the first byte: the servers already running,
 * the artefacts that would be fetched with their sizes and hashes, and — when the managed
 * runtime is not available on this platform — why not.
 */
export async function plan({
  platform = process.platform,
  arch = process.arch,
  modelId = MEASURED_MODEL,
  stateDir,
  fetchImpl = globalThis.fetch,
  readFile,
  run,
  env = process.env,
  // The manifest's own table unless a caller replaces it; tests use this to reach the
  // refusals a fully pinned manifest can no longer produce.
  runtimes,
} = {}) {
  const features = await cpuFeatures({ platform, arch, readFile, run });
  const running = await detectRunning({ fetchImpl });
  const model = modelById(modelId);
  const download = downloadPlan({ platform, arch, features, modelId, runtimes });

  // An Ollama that already holds the pinned tag needs no download at all; one that does
  // not needs a pull, which is its own confirmation and its own progress bar.
  const ollamaReady = running.ollama && hasPinnedModel(running.ollama.models, model?.ollama);

  return {
    platform, arch, features,
    sandbox: detectSandbox(env),
    running,
    model,
    measured: model?.measured ?? false,
    ollamaNeedsPull: Boolean(running.ollama) && !ollamaReady,
    ollamaTag: model?.ollama ?? null,
    items: download.items,
    totalBytes: download.totalBytes,
    runtimeUnavailable: download.runtimeUnavailable,
    // What will actually happen, in one word, so a caller does not have to re-derive it.
    action: running.llamaServer ? "use-llama-server"
      : ollamaReady ? "use-ollama"
      : running.ollama ? "pull-ollama"
      : download.runtimeUnavailable ? "blocked"
      : "download-and-spawn",
    stateDir,
  };
}

/**
 * Do it.
 *
 * `confirmed` must be true before anything is fetched: a plan whose `action` is
 * "download-and-spawn" and that has not been confirmed throws rather than downloading.
 * An existing server is used without confirmation, because using something already
 * running costs the writer nothing.
 */
export async function provision({
  platform = process.platform,
  arch = process.arch,
  modelId = MEASURED_MODEL,
  stateDir,
  confirmed = false,
  fetchImpl = globalThis.fetch,
  spawnImpl,
  onEvent = () => {},
  signal,
  readFile,
  run,
  env = process.env,
  startImpl = startServer,
  warmUpImpl = warmUp,
  reapImpl = reapOrphan,
  portImpl = freePort,
  runtimes,
} = {}) {
  if (!stateDir) throw new ProvisionError("provision() needs a stateDir to keep its runtime in");

  onEvent({ phase: "reap" });
  const reaped = await reapImpl(stateDir);
  if (reaped.reaped) onEvent({ phase: "reaped", pid: reaped.pid });

  onEvent({ phase: "detect" });
  const decided = await plan({ platform, arch, modelId, stateDir, fetchImpl, readFile, run, env, runtimes });
  onEvent({ phase: "planned", plan: decided });

  if (decided.action === "use-llama-server") {
    const found = decided.running.llamaServer;
    return {
      kind: "existing", server: "llama-server",
      apiBase: found.apiBase, baseUrl: found.baseUrl, apiKey: null,
      model: found.models[0] ?? "local", managed: false, stop: async () => {},
    };
  }
  if (decided.action === "use-ollama") {
    const found = decided.running.ollama;
    return {
      kind: "existing", server: "ollama",
      apiBase: found.apiBase, baseUrl: found.baseUrl, apiKey: null,
      model: decided.ollamaTag, managed: false, stop: async () => {},
    };
  }
  if (decided.action === "pull-ollama") {
    // The pull itself belongs to the Ollama adapter, which owns that protocol; what the
    // provisioner does is say the tag is missing and hand the decision back.
    throw new ProvisionError(
      `Ollama is running but does not have ${decided.ollamaTag}.`,
      { kind: "ollama-pull-required", advice: { title: "Ollama needs the model", body: `Pull it with:\n    ollama pull ${decided.ollamaTag}`, fallback: null } },
    );
  }
  if (decided.action === "blocked") {
    const { reason, detail } = decided.runtimeUnavailable;
    throw new ProvisionError(detail, {
      kind: reason,
      advice: {
        title: "Tolben cannot manage a model server on this machine",
        body: detail,
        fallback: "Install Ollama and run `ollama serve`, or start llama-server yourself on 127.0.0.1:8080.",
      },
    });
  }

  const runtimeDir = join(stateDir, RUNTIME_DIR);
  const modelDir = join(stateDir, MODEL_DIR);
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });

  // What is already on disk and matches its pin needs neither confirmation nor a fetch.
  // The plugin comes back this way after an idle unload and at every launch, and it must
  // never download on its own: the setup pane, where a person has seen every URL, byte
  // count and hash, is the only place a download is agreed to. So the check runs before
  // the refusal, and a file that is present and right is simply used.
  const placed = [];
  for (const item of decided.items) {
    const destination = item.kind === "runtime" ? join(runtimeDir, item.name) : join(modelDir, item.name);
    placed.push({ item, destination, pinned: await isPinnedOnDisk(destination, item.sha256) });
  }
  const missing = placed.filter(({ pinned }) => !pinned);
  if (!confirmed && missing.length) {
    const bytes = missing.reduce((sum, { item }) => sum + (item.bytes ?? 0), 0);
    throw new ProvisionError(
      `Provisioning would download ${missing.length} file(s), ${formatBytes(bytes)}. `
      + "Nothing was fetched: call provision({ confirmed: true }) once a person has seen the plan.",
      { kind: "unconfirmed" },
    );
  }

  let binary = null;
  let modelPath = null;
  for (const { item, destination, pinned } of placed) {
    onEvent({ phase: "download", item, destination });
    const result = pinned
      ? { path: destination, bytes: item.bytes, reused: true }
      : await downloadVerified({
        url: item.url,
        destination,
        sha256: item.sha256,
        bytes: item.bytes,
        fetchImpl,
        signal,
        onProgress: (progress) => onEvent({ phase: "progress", item, ...progress }),
      });
    onEvent({ phase: "downloaded", item, reused: result.reused });
    if (item.kind === "model") { modelPath = destination; continue; }

    onEvent({ phase: "extract", item });
    const runtime = runtimeForItem(item);
    const unpacked = join(runtimeDir, item.id);
    await rm(unpacked, { recursive: true, force: true });
    // Whichever reader the asset's name calls for: llama.cpp ships macOS and Linux as
    // tar.gz and only Windows as zip. `strip` drops the `llama-<tag>/` directory the tar
    // archives put everything under; the zip has its entries at the root, so it strips
    // nothing.
    //
    // Only what is needed to serve is taken: a release carries benchmarks and example
    // programs this plugin will never run, and every one of them is a file an antivirus
    // can object to.
    await extract(destination, unpacked, {
      strip: runtime.strip ?? 0,
      filter: (entry) => /llama-server(\.exe)?$/u.test(entry.name)
        || /\.(so|dylib|dll)(\.\d+)*$/u.test(entry.name),
    });
    binary = join(unpacked, runtime.binary);
    onEvent({ phase: "extracted", item, binary });
  }

  const port = await portImpl();
  const apiKey = newApiKey();
  const slotDir = join(stateDir, "slots");
  await mkdir(slotDir, { recursive: true });

  onEvent({ phase: "spawn", binary, port });
  let handle;
  try {
    handle = await startImpl({
      binary, modelPath, stateDir, port, apiKey, slotDir, spawnImpl, fetchImpl,
    });
  } catch (error) {
    const advice = explainSpawnFailure({ platform, binary, error, env });
    throw new ProvisionError(error.message, {
      kind: error instanceof ServerError ? error.kind : "spawn",
      advice,
      cause: error,
    });
  }

  onEvent({ phase: "warmup" });
  const warm = await warmUpImpl({ apiBase: handle.apiBase, apiKey: handle.apiKey, fetchImpl });
  onEvent({ phase: "ready", ms: warm.ms, ok: warm.ok });

  return {
    kind: "managed", server: "llama-server",
    apiBase: handle.apiBase, baseUrl: handle.baseUrl, apiKey: handle.apiKey,
    model: decided.model.id, measured: decided.model.measured,
    managed: true, pid: handle.pid, warmUpMs: warm.ms,
    binary, modelPath, slotDir,
    stop: (options) => handle.stop(options),
    handle,
  };
}

// Present, non-empty, and hashing to the pin. Anything else is "not there", including a
// file of the right name with the wrong bytes.
async function isPinnedOnDisk(path, sha256) {
  try {
    if ((await stat(path)).size <= 0) return false;
  } catch {
    return false;
  }
  return (await hashOf(path)) === sha256;
}

function runtimeForItem(item) {
  return manifest.runtimes.find((runtime) => runtime.id === item.id);
}

export function formatBytes(bytes) {
  if (!bytes) return "0 bytes";
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} kB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

/**
 * A one-line summary of a plan, for a status bar or a CLI. Deliberately says whether the
 * model is the measured one: a writer comparing their experience against REPORT.md needs
 * to know they are not running the artefact those numbers came from.
 */
export function describePlan(decided) {
  switch (decided.action) {
    case "use-llama-server": return `llama-server already running on ${decided.running.llamaServer.baseUrl}`;
    case "use-ollama": return `Ollama already running with ${decided.ollamaTag}`;
    case "pull-ollama": return `Ollama is running but needs ${decided.ollamaTag}`;
    case "blocked": return `no managed runtime: ${decided.runtimeUnavailable.reason}`;
    default: return `download ${formatBytes(decided.totalBytes)}`
      + (decided.measured ? "" : " (not the measured artefact)");
  }
}

export { runtimeUrl };
