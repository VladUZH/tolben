#!/usr/bin/env node
// The shipped plugin bundle, through the managed-server lifecycle, against a real server.
//
//   node tools/plugin-lifecycle.mjs --state <dir> [--archive <llama-b10760-bin-....tar.gz>]
//
// Setup (the same provision() call runSetup() makes, minus the modal), the first sentence
// on the fresh server with every attempt timed, a warm sentence, the idle unload, a
// sentence after it, a fresh plugin instance loading the saved data.json as an Obsidian
// restart would, a sentence in that session, and recovery by running setup again. It is
// what found, on 2026-09-04, that a server Tolben started is never restarted after the
// idle unload or a restart, and that the first sentence on a fresh server fails at the
// engine's 12 s timeout instead of waiting the 41 s the prompt read costs. See REPORT.md
// under that date, and re-run this before calling either fixed.
//
// Real: obsidian-plugin/main.js as built, the provisioner, the pinned llama-server binary,
// the pinned model. Stubbed: Obsidian's UI classes (tools/obsidian-stub.cjs). The state
// directory is the one you name — never the writer's real one — with XDG_DATA_HOME
// pointed at it so plugin.stateDir() resolves inside it. The model is linked in from
// models/ (npm run models:fetch) and the provisioner verifies it against the manifest as
// it would any file already on disk. The runtime archive is fetched, pinned, through the
// plugin's own fetch — and in 1.0.0 that fetch does not follow the redirect GitHub answers
// with, so without --archive the run ends at "HTTP 302", which is the first finding; pass
// a copy of the archive to reach the others. Needs `npm install` for @codemirror, which
// the bundle leaves external.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, copyFile, symlink, rm, access, writeFile, readFile } from "node:fs/promises";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const state = opt("--state");
if (!state) { console.error("usage: node tools/plugin-lifecycle.mjs --state <dir> [--archive <tar.gz>]"); process.exit(2); }
const archive = opt("--archive");

const t0 = Date.now();
const log = (...a) => console.log(`[${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s]`, ...a);
globalThis.__tolbenRig = { log, data: { setupDone: true, baseUrl: "" } };   // as after a dismissed setup pane
process.on("unhandledRejection", (e) => log(`   (unhandled rejection) ${e?.message ?? e}`));

// ---- a directory the bundle can be required from, with the stub as `obsidian` ----------
const rig = join(resolve(state), "rig");
await rm(rig, { recursive: true, force: true });
await mkdir(join(rig, "node_modules", "obsidian"), { recursive: true });
await copyFile(join(REPO, "tools", "obsidian-stub.cjs"), join(rig, "node_modules", "obsidian", "index.js"));
for (const scope of ["@codemirror", "@lezer"]) {
  try { await access(join(REPO, "node_modules", scope)); await symlink(join(REPO, "node_modules", scope), join(rig, "node_modules", scope)); } catch {}
}
await copyFile(join(REPO, "obsidian-plugin", "main.js"), join(rig, "main.js"));

// ---- the plugin's state dir, with the pinned artefacts already in place --------------
process.env.XDG_DATA_HOME = resolve(state);
const stateDir = join(resolve(state), "tolben");
await mkdir(join(stateDir, "models"), { recursive: true });
await mkdir(join(stateDir, "runtime"), { recursive: true });
const model = join(REPO, "models", "Qwen3.5-2B-Q6_K.gguf");
const modelLink = join(stateDir, "models", "Qwen3.5-2B-Q6_K.gguf");
try { await access(modelLink); } catch { try { await access(model); await symlink(model, modelLink); } catch { log("no models/Qwen3.5-2B-Q6_K.gguf; the provisioner will download it"); } }
if (archive) {
  // Under the name the manifest gives the asset, which is what the provisioner looks for.
  const { runtimes } = JSON.parse(await readFile(join(REPO, "obsidian-plugin", "runtime", "manifest.json"), "utf8"));
  const asset = runtimes.find((r) => r.platform === process.platform && r.arch === process.arch)?.asset;
  if (!asset) throw new Error(`no runtime in the manifest for ${process.platform}/${process.arch}`);
  await copyFile(archive, join(stateDir, "runtime", asset));
}

const require = createRequire(pathToFileURL(join(rig, "main.js")));
const { provision } = await import(pathToFileURL(join(REPO, "obsidian-plugin", "runtime", "provision.mjs")));
const bundle = require(join(rig, "main.js"));
const TolbenPlugin = bundle.default ?? bundle;
const app = { workspace: { getActiveFile: () => ({ path: "Supplier review.md" }) }, vault: {} };
const manifest = { id: "tolben", version: "1.0.0" };

const health = async (root) => {
  try { const r = await fetch(`${root}/health`, { signal: AbortSignal.timeout(2000) }); return `HTTP ${r.status}`; }
  catch (e) { return `unreachable (${e.cause?.code ?? e.name})`; }
};
const analyzeOnce = async (plugin, label, sentence) => {
  const t = Date.now();
  try {
    const o = await plugin.analyze(sentence, { signal: undefined, context: { protectedTerms: [] } });
    log(`${label}: answered in ${Date.now() - t} ms -> ${JSON.stringify(o.replacement)} (${o.rejection ?? "accepted"})`);
    return o;
  } catch (e) {
    log(`${label}: THREW after ${Date.now() - t} ms: "${e.message}" kind=${e.kind ?? "(none)"}`);
    return null;
  }
};
// The controller gives a transient failure two attempts and then holds the sentence for a
// minute; here every attempt is made back to back so the cost of a cold server is visible.
const analyzeUntilAnswered = async (plugin, label, sentence, max = 8) => {
  for (let attempt = 1; attempt <= max; attempt++) {
    if (await analyzeOnce(plugin, `${label}, attempt ${attempt}`, sentence)) return;
  }
};
const setupManaged = async (plugin) => {
  // obsidian-plugin/main.mjs runSetup(), the managed branch, minus the modal.
  const result = await provision({
    stateDir: plugin.stateDir(), modelId: plugin.settings.modelId, confirmed: true, fetchImpl: plugin.fetch,
    readFile: (p, e) => plugin.readNodeFile(p, e), run: (c, a) => plugin.runCommand(c, a),
    onEvent: (e) => { if (/downloaded|spawn|ready|reaped/u.test(e.phase)) log(`   provision: ${e.phase} ${e.item?.name ?? ""} ${e.reused !== undefined ? `reused=${e.reused}` : ""} ${e.pid ?? ""} ${e.ms !== undefined ? `${e.ms} ms` : ""}`.trimEnd()); },
  });
  plugin.runtime = result; plugin.settings.baseUrl = result.apiBase; plugin.apiKey = result.apiKey;
  plugin.settings.setupDone = true; await plugin.save(); await plugin.connect();
  log(`connected: managed=${result.managed} pid=${result.pid} root=${result.baseUrl}`);
  return result;
};

log("=== SESSION 1: setup, the first sentence on a fresh server, a warm one, the idle unload ===");
const p1 = new TolbenPlugin(app, manifest);
await p1.onload();
const r1 = await setupManaged(p1);
await analyzeUntilAnswered(p1, "S1 fresh server", "The committee will carry out a review of the safety protocol next month.");
await analyzeOnce(p1, "S2 warm", "The archive is copied on a weekly basis.");
log(`server before the idle unload: ${await health(r1.baseUrl)}`);
log("unloadIdle(), which is what the ten-minute timer calls");
await p1.unloadIdle();
log(`after it: runtime=${p1.runtime} engine=${p1.engine} server ${await health(r1.baseUrl)}`);
await analyzeOnce(p1, "S3 after the idle unload", "The logistics team carried out an evaluation of the packaging supplier.");
log(`status bar: ${JSON.stringify(p1.statusEl.text)}; runtime=${p1.runtime}; server ${await health(r1.baseUrl)}`);

log("=== SESSION 2: the plugin loads again with the saved data.json, as after an Obsidian restart ===");
p1.onunload();
const p2 = new TolbenPlugin(app, manifest);
await p2.onload();
await new Promise((r) => setTimeout(r, 500));
log(`loaded: baseUrl=${p2.settings.baseUrl} setupDone=${p2.settings.setupDone} runtime=${p2.runtime} status=${JSON.stringify(p2.statusEl.text)} server ${await health(r1.baseUrl)}`);
await analyzeOnce(p2, "S4 first sentence of the new session", "The archive is copied on a weekly basis.");

log("=== RECOVERY: the writer runs 'Set up the model server' again ===");
const r2 = await setupManaged(p2);
await analyzeUntilAnswered(p2, "S5 after setup again", "The archive is copied on a weekly basis.");
await r2.stop();
p2.onunload();
log(`done; server ${await health(r2.baseUrl)}`);
await writeFile(join(resolve(state), "lifecycle-ran.txt"), new Date().toISOString());
