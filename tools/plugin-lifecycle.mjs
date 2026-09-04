#!/usr/bin/env node
// The shipped plugin bundle, through the managed-server lifecycle, against a real server.
//
//   node tools/plugin-lifecycle.mjs --state <dir> [--archive <llama-b10760-bin-....tar.gz>] [--fresh]
//
// Setup (the same provision() call runSetup() makes, minus the modal), the connection that
// reads both prompts in, the first sentence on the fresh server, a run of sentences that
// do and do not reach the verifier, the idle unload, the sentence that brings the server
// back, a fresh plugin instance loading the saved data.json as an Obsidian restart would,
// and a sentence in that session. Every step is timed. It is what found, on 2026-09-04,
// that the plugin's fetch could not download, that the first sentence met the 12 s
// timeout twice, and that a server Tolben started was never started again (REPORT.md
// under that date); since 1.0.1 it is what shows each of those fixed, and it is run before
// a release is tagged.
//
// Real: obsidian-plugin/main.js as built, the provisioner, the pinned llama-server binary,
// the pinned model, the plugin's own fetch. Stubbed: Obsidian's UI classes
// (tools/obsidian-stub.cjs, loaded by tools/bundle-harness.mjs). The state directory is
// the one you name — never the writer's real one — with XDG_DATA_HOME pointed at it so
// plugin.stateDir() resolves inside it.
//
// Artefacts: by default the model is linked in from models/ (npm run models:fetch) and
// the provisioner verifies it against the manifest as it would any file on disk, and the
// runtime archive is fetched through the plugin's fetch unless --archive points at a
// copy. --fresh links nothing and copies nothing, so both artefacts come down through the
// plugin's fetch exactly as they do for a writer: 17 MB from GitHub, 1.5 GB from Hugging
// Face, both through a redirect. Needs `npm install` for @codemirror, which the bundle
// leaves external.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, copyFile, symlink, access, readFile, writeFile } from "node:fs/promises";
import { loadShippedBundle } from "./bundle-harness.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const state = opt("--state");
if (!state) { console.error("usage: node tools/plugin-lifecycle.mjs --state <dir> [--archive <tar.gz>] [--fresh]"); process.exit(2); }
const archive = opt("--archive");
const fresh = args.includes("--fresh");

const t0 = Date.now();
const stamp = () => `[${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s]`;
const log = (...a) => console.log(stamp(), ...a);
const findings = [];
const finding = (text) => { findings.push(text); log(`!! ${text}`); };
process.on("unhandledRejection", (e) => log(`   (unhandled rejection) ${e?.message ?? e}`));

// ---- the plugin's state dir --------------------------------------------------------------
process.env.XDG_DATA_HOME = resolve(state);
const stateDir = join(resolve(state), "tolben");
await mkdir(join(stateDir, "models"), { recursive: true });
await mkdir(join(stateDir, "runtime"), { recursive: true });
const { runtimes, models } = JSON.parse(await readFile(join(REPO, "obsidian-plugin", "runtime", "manifest.json"), "utf8"));
const runtime = runtimes.find((r) => r.platform === process.platform && r.arch === process.arch);
if (!runtime) throw new Error(`no runtime in the manifest for ${process.platform}/${process.arch}`);
if (!fresh) {
  const model = join(REPO, "models", models[0].file);
  const link = join(stateDir, "models", models[0].file);
  try { await access(link); } catch { try { await access(model); await symlink(model, link); log(`model linked from models/`); } catch { log("no models/ copy; the provisioner will download the model"); } }
  if (archive) { await copyFile(archive, join(stateDir, "runtime", runtime.asset)); log("runtime archive copied in"); }
} else {
  log("--fresh: nothing pre-placed; both artefacts come through the plugin's fetch");
}

// ---- the bundle, with Obsidian's UI stubbed ------------------------------------------------
const { TolbenPlugin } = await loadShippedBundle(join(resolve(state), "rig"));
globalThis.__tolbenRig = { log, data: { setupDone: true, managed: false, baseUrl: "" } };   // as after a dismissed setup pane
const app = { workspace: { getActiveFile: () => ({ path: "Supplier review.md" }) }, vault: {} };
const manifest = { id: "tolben", version: "1.0.1" };

const health = async (root) => {
  try { const r = await fetch(`${root}/health`, { signal: AbortSignal.timeout(2000) }); return `HTTP ${r.status}`; }
  catch (e) { return `unreachable (${e.cause?.code ?? e.name})`; }
};
const timings = [];
// The outcome does not say whether the verifier was asked (a "show" verdict leaves no
// trace), so the engine's verify() is counted from outside. Re-wrapped after every
// connect, because a reconnect builds a new engine.
let verifierCalls = 0;
function countVerifier(plugin) {
  const engine = plugin.engine;
  if (!engine || engine.__counted) return;
  const verify = engine.verify;
  engine.verify = async (...a) => { verifierCalls += 1; return verify(...a); };
  engine.__counted = true;
}
async function sentence(plugin, label, text) {
  const t = Date.now();
  countVerifier(plugin);
  const before = verifierCalls;
  try {
    const o = await plugin.analyze(text, { signal: undefined, context: { protectedTerms: [] } });
    const ms = Date.now() - t;
    const via = o.stages?.model ? "model" : o.stages?.rule ? "rule" : o.stages?.mechanics ? "mechanics" : "none";
    const verified = verifierCalls > before ? " +verifier" : "";
    log(`${label}: ${ms} ms -> ${JSON.stringify(o.replacement)} ${o.rejection ? `(refused: ${o.rejection})` : ""} [${via}${verified}]`);
    timings.push({ label, ms, replacement: o.replacement, rejection: o.rejection ?? null, stages: o.stages, verifier: verifierCalls > before });
    return o;
  } catch (e) {
    finding(`${label} threw after ${Date.now() - t} ms: "${e.message}" kind=${e.kind ?? "(none)"}`);
    timings.push({ label, ms: Date.now() - t, error: e.message });
    return null;
  }
}
// obsidian-plugin/main.mjs runSetup(), the managed branch, minus the modal.
async function setupManaged(plugin) {
  const marks = {};
  let lastMb = 0;
  const result = await plugin.provisionImpl({
    stateDir: plugin.stateDir(), modelId: plugin.settings.modelId, confirmed: true, fetchImpl: plugin.fetch,
    readFile: (p, e) => plugin.readNodeFile(p, e), run: (c, a) => plugin.runCommand(c, a),
    onEvent: (e) => {
      if (e.phase === "download") { marks[e.item.name] = Date.now(); lastMb = 0; }
      if (e.phase === "progress" && e.received - lastMb >= 200e6) { lastMb = e.received; log(`   ${e.item.name}: ${(e.received / 1e6).toFixed(0)} / ${(e.total / 1e6).toFixed(0)} MB`); }
      if (e.phase === "downloaded") {
        const s = (Date.now() - marks[e.item.name]) / 1000;
        log(`   provision: ${e.item.name} ${e.reused ? "on disk and verified" : "downloaded and verified"} in ${s.toFixed(1)} s${e.reused ? "" : ` (${(e.item.bytes / 1e6 / s).toFixed(1)} MB/s)`}`);
      }
      if (/spawn|reaped/u.test(e.phase)) log(`   provision: ${e.phase} ${e.pid ?? ""}`.trimEnd());
      if (e.phase === "ready") log(`   provision: server up, weights loaded, one token generated in ${e.ms} ms`);
    },
  });
  plugin.runtime = result; plugin.settings.baseUrl = result.apiBase; plugin.apiKey = result.apiKey;
  plugin.settings.managed = Boolean(result.managed); plugin.settings.setupDone = true; await plugin.save();
  const t = Date.now();
  await plugin.connect();
  countVerifier(plugin);
  const w = plugin.warmUp;
  log(`connected in ${Date.now() - t} ms: prompts read in — clarity ${w?.clarityMs} ms, verifier ${w?.verifierMs} ms; managed=${result.managed} pid=${result.pid} root=${result.baseUrl}`);
  timings.push({ label: "warm-up", ms: Date.now() - t, clarityMs: w?.clarityMs, verifierMs: w?.verifierMs });
  return result;
}

log("=== SESSION 1: setup, the prompts read in, the first sentence, sentences with and without the verifier ===");
const p1 = new TolbenPlugin(app, manifest);
await p1.onload();
const r1 = await setupManaged(p1);
await sentence(p1, "S1 first sentence", "The committee will carry out a review of the safety protocol next month.");
await sentence(p1, "S2 rewrite, lost words", "She undertook the negotiation of the lease with the landlord.");
await sentence(p1, "S3 clean", "The gasket held at full pressure overnight.");
await sentence(p1, "S4 rewrite, lost words", "The logistics team carried out an evaluation of the packaging supplier.");
await sentence(p1, "S5 clean", "The revised terms were sent to the vendor on Tuesday.");
await sentence(p1, "S6 rule", "In the event that the pump fails, the alarm sounds.");
await sentence(p1, "S6b one lost word", "The report was completed successfully.");
await sentence(p1, "S6c clean", "Rain delayed the pour by two days.");
await sentence(p1, "S6d one lost word", "He is currently working on the draft.");

log("=== IDLE UNLOAD: what the timer does, and the sentence after it ===");
log(`server before: ${await health(r1.baseUrl)}`);
await p1.unloadIdle();
log(`after unloadIdle: runtime=${p1.runtime} engine=${p1.engine} server ${await health(r1.baseUrl)}`);
const back = Date.now();
const s7 = await sentence(p1, "S7 after the idle unload", "The crew reached the summit before noon.");
if (s7) log(`back in ${Date.now() - back} ms: managed=${p1.runtime?.managed} pid=${p1.runtime?.pid} root=${p1.runtime?.baseUrl} — prompts ${p1.warmUp?.clarityMs} + ${p1.warmUp?.verifierMs} ms of that`);
timings.push({ label: "return after idle unload", ms: Date.now() - back });

log("=== SESSION 2: the plugin loads again with the saved data.json, as after an Obsidian restart ===");
const root1 = p1.runtime?.baseUrl;
p1.onunload();
await new Promise((r) => setTimeout(r, 1500));
log(`the first session's server after onunload: ${root1 ? await health(root1) : "(none)"}`);
const p2 = new TolbenPlugin(app, manifest);
const load = Date.now();
await p2.onload();
log(`onload returned in ${Date.now() - load} ms; starting=${Boolean(p2.starting)} (the server starts without waiting for a sentence)`);
try { await p2.starting; log(`ready ${Date.now() - load} ms after load: pid=${p2.runtime?.pid} prompts ${p2.warmUp?.clarityMs} + ${p2.warmUp?.verifierMs} ms`); }
catch (e) { finding(`the connection at load failed: ${e.message}`); }
timings.push({ label: "ready after restart", ms: Date.now() - load });
await sentence(p2, "S8 first sentence of the new session", "Nobody on the night shift noticed the leak.");
await sentence(p2, "S9 rewrite, lost words", "The auditors made a decision to postpone the review.");
const root2 = p2.runtime?.baseUrl;
p2.onunload();
await new Promise((r) => setTimeout(r, 1500));
log(`done; the second session's server after onunload: ${root2 ? await health(root2) : "(none)"}`);

log("=== SUMMARY ===");
for (const t of timings) log(`  ${t.label.padEnd(36)} ${String(t.ms).padStart(6)} ms${t.error ? `  ERROR ${t.error}` : ""}`);
if (findings.length) { log(`${findings.length} finding(s):`); for (const f of findings) log(`  - ${f}`); process.exitCode = 1; }
else log("no findings: the plugin downloaded or reused, started, read the prompts in, answered, came back after the unload and after the restart");
await writeFile(join(resolve(state), "lifecycle.json"), JSON.stringify({ ranAt: new Date().toISOString(), fresh, timings, findings }, null, 2));
