// Verify, against a REAL Ollama, the three things the adapter assumes.
//
//   node tools/ollama-check.mjs                 # probe only
//   node tools/ollama-check.mjs --pull          # pull the pinned tag first
//   node tools/ollama-check.mjs --smoke 10      # then run N sentences end to end
//
// This exists because the adapter's fallback is chosen from a probe, and the probe itself
// is the thing that could be wrong. Unit tests prove the adapter reacts correctly to a
// server that drops keep_alive; only a real Ollama proves whether it does.
//
// Exit status is 1 if the probe found nothing at all, or if a smoke sentence failed.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { connectOllama, pullModel, probeDialect, OLLAMA_DEFAULT } from "../obsidian-plugin/runtime/ollama.mjs";
import { detectOllama, hasPinnedModel } from "../obsidian-plugin/runtime/detect.mjs";
import { modelById, MEASURED_MODEL } from "../obsidian-plugin/runtime/manifest.mjs";
import { createEngine } from "../src/engine.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";
import { formatBytes } from "../obsidian-plugin/runtime/provision.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const argument = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
};

// Ten sentences that between them touch every tier the pipeline has: a nominalization,
// a wordy connective, a safety probe that must be refused, and clean prose that must be
// left alone.
const SMOKE = [
  ["The department will conduct an investigation into the missing inventory.", "rewrite"],
  ["In order to ship the release, we ran the full suite.", "rewrite"],
  ["The router is located in close proximity to the desk.", "rewrite"],
  ["We conducted a review of the draft on Tuesday.", "rewrite"],
  ["There are three bolts that require replacement.", "rewrite"],
  ["The archive is copied on a weekly basis.", "rewrite"],
  ["The service must never restart during a deploy.", "keep"],
  ["Approximately 20 percent of the rows were affected.", "keep"],
  ["The build finished at 03:15 UTC on 31 December 2026.", "keep"],
  ["The cat sat on the mat.", "keep"],
];

async function main() {
  const baseUrl = argument("--base-url", OLLAMA_DEFAULT);
  const model = modelById(argument("--model", MEASURED_MODEL));
  const tag = model.ollama;

  const running = await detectOllama({ baseUrl });
  if (!running) {
    process.stderr.write(`No Ollama answering on ${baseUrl}. Start it with \`ollama serve\`.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`ollama      ${baseUrl}, ${running.models.length} model(s)\n`);
  process.stdout.write(`want        ${tag}  (${formatBytes(model.bytes)}, sha256 ${model.sha256.slice(0, 12)}…)\n`);

  if (!hasPinnedModel(running.models, tag)) {
    if (!process.argv.includes("--pull")) {
      process.stderr.write(`\nOllama does not have ${tag}. Re-run with --pull, or:\n    ollama pull ${tag}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`\npulling ${tag} — ${formatBytes(model.bytes)}\n`);
    let line = "";
    await pullModel({
      tag, baseUrl,
      onProgress: ({ status, received, total }) => {
        const next = total ? `  ${status}  ${formatBytes(received)} / ${formatBytes(total)}` : `  ${status}`;
        if (next !== line) { process.stdout.write(`\r${next.padEnd(70)}`); line = next; }
      },
    });
    process.stdout.write("\n");
  }

  const findings = await probeDialect({ tag, baseUrl });
  process.stdout.write("\nprobe of /v1:\n");
  process.stdout.write(`  keep_alive honoured        ${findings.keepAlive ? "yes" : "NO"}`
    + `${findings.keepAliveMinutes === undefined ? "" : ` (expires in ${findings.keepAliveMinutes} min)`}\n`);
  process.stdout.write(`  reasoning suppressed       ${findings.thinking === false ? "yes" : "NO — <think> reached the content"}\n`);
  process.stdout.write(`  response_format honoured   ${findings.schema ? "yes" : "NO"}\n`);
  process.stdout.write(`  field order                ${findings.fieldOrder ?? "unknown"}`
    + `${findings.stopSafe ? "  (schema order: the reason-stop is safe)" : "  — REORDERED, so the reason-stop is off"}\n`);
  for (const error of findings.errors) process.stdout.write(`  note: ${error}\n`);
  process.stdout.write(`  => using ${findings.endpoint === "v1" ? "/v1/chat/completions" : "/api/chat (native)"}\n`);

  const smokeCount = Number(argument("--smoke", "0"));
  if (!smokeCount) return;

  const connection = await connectOllama({ tag, baseUrl });
  const engine = createEngine({
    baseUrl: connection.apiBase,
    model: tag,
    dialect: connection.dialect,
    useReasonStop: connection.useReasonStop,
    fetchImpl: connection.fetchImpl,
    prompt: await readFile(`${ROOT}src/clarity-prompt.txt`, "utf8"),
    verifierPrompt: await readFile(`${ROOT}src/verifier-prompt.txt`, "utf8"),
    timeoutMs: 60000,
  });

  process.stdout.write(`\nsmoke, ${Math.min(smokeCount, SMOKE.length)} sentences through the full pipeline:\n`);
  let failures = 0;
  const latencies = [];
  for (const [sentence, expected] of SMOKE.slice(0, smokeCount)) {
    const started = Date.now();
    let outcome;
    try {
      outcome = await analyzeSentence(sentence, { engine, mechanics: true, rules: true });
    } catch (error) {
      failures += 1;
      process.stdout.write(`  FAILED  ${error.message}\n          ${sentence}\n`);
      continue;
    }
    const ms = Date.now() - started;
    latencies.push(ms);
    if (outcome.error) {
      failures += 1;
      process.stdout.write(`  FAILED  ${outcome.error.kind}: ${outcome.error.message}\n          ${sentence}\n`);
      continue;
    }
    const surfaced = Boolean(outcome.replacement);
    // `expected` is what the corpus says the model SHOULD do; a disagreement is recorded
    // rather than failed, because this is a smoke test of the transport, not a recall
    // measurement — bench/run.mjs is where quality is judged.
    const agrees = expected === "rewrite" ? surfaced : !surfaced;
    process.stdout.write(`  ${agrees ? "ok    " : "differs"}  ${String(ms).padStart(6)} ms  ${surfaced ? "→ " + outcome.replacement : "kept" + (outcome.rejection ? ` (${outcome.rejection})` : "")}\n`);
  }
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    process.stdout.write(`\n  p50 ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms\n`);
  }
  if (failures > 0) {
    process.stdout.write(`\n${failures} sentence(s) could not be analysed at all\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => { process.stderr.write(`\n${error.stack ?? error}\n`); process.exitCode = 1; });
