// Reproducible benchmark: one corpus, one prompt, one model, raw responses preserved.
import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createEngine } from "../src/engine.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

async function modelId(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/models`);
  if (!response.ok) throw new Error(`Cannot reach local model: HTTP ${response.status}`);
  return (await response.json())?.data?.[0]?.id ?? "unknown";
}

export async function runBenchmark({
  corpus, engine, prompt, model,
  // Explicit options, never read from global argv: a library caller whose host
  // process happens to carry "--no-mechanics" must not have its benchmark semantics
  // silently changed. main() below translates the CLI flags.
  //
  // The tier defaults match what SHIPS (server.mjs and the Obsidian plugin both run
  // mechanics + rules; the plugin's default "balanced" gate expresses itself through
  // scheduling rather than through this flag, so `gate` stays off). They used not to be
  // passed at all, which meant every published quality number described a pipeline with
  // two of its tiers switched off.
  mechanics = true,
  rules = true,
  gate = false,
  deletionPolicy = "verify",
  now = () => Date.now(), onProgress = () => {},
}) {
  const rows = [];
  for (const [index, row] of corpus.rows.entries()) {
    const started = now();
    let record;
    try {
      const outcome = await analyzeSentence(row.source, {
        engine,
        mechanics,
        rules,
        gate,
        deletionPolicy,
      });
      // The pipeline reports an unreachable model inside an otherwise normal outcome.
      // Such a row is not a decision the model made, so it is recorded as a failure and
      // scored as one; `surfaced` still says what the writer would have been shown,
      // which on a failed row can only ever come from the mechanical pass.
      record = {
        ...row,
        action: outcome.error ? "failed" : outcome.replacement ? "rewrite" : "keep",
        replacement: outcome.replacement ?? "",
        reason: outcome.reason ?? "",
        // The model's own account of its edit, preserved raw as the header promises:
        // rescore's reason-contradicts-action re-check judges THIS text, and the
        // derived reason shown to the writer says nothing about what the model claimed.
        modelReason: outcome.modelReason ?? null,
        surfaced: Boolean(outcome.replacement),
        stages: outcome.stages,
        rejection: outcome.rejection,
        modelRejection: outcome.modelRejection ?? null,
        rejectedText: outcome.rejectedText ?? null,
        lostWords: outcome.lostWords ?? null,
        verifierReason: outcome.verifierReason ?? null,
        engineError: outcome.error,
        milliseconds: now() - started,
      };
    } catch (error) {
      record = {
        ...row, action: "failed", replacement: "", reason: error.message,
        surfaced: false, stages: { mechanics: false, model: false },
        rejection: null, modelRejection: null,
        engineError: { kind: error.kind ?? "failed", message: error.message },
        milliseconds: now() - started,
      };
    }
    rows.push(record);
    onProgress(index + 1, corpus.rows.length);
  }
  return {
    schemaVersion: 1,
    generatedAtUTC: new Date().toISOString(),
    corpusName: corpus.name,
    corpusSHA256: sha256(JSON.stringify(corpus)),
    promptSHA256: sha256(prompt),
    prompt,
    model,
    // The configuration that produced the rows: two reports differing only in these
    // flags were previously indistinguishable.
    options: { mechanics, rules, gate, deletionPolicy },
    rows,
  };
}

async function main() {
  const corpusPath = arg("--corpus");
  const promptPath = arg("--prompt");
  const outputPath = arg("--output");
  const baseUrl = arg("--base-url", "http://127.0.0.1:8080/v1");
  const modelPath = arg("--model-path", "");
  if (!corpusPath || !promptPath || !outputPath) {
    throw new Error(
      "usage: node bench/run.mjs --corpus <f> --prompt <f> --output <f>\n"
      + "  tiers (default = the shipped configuration): --no-mechanics --no-rules --gate\n"
      + "  policy: --refuse-deletions\n"
      + "  per-call timeout: --timeout-ms <ms> (default 20000)",
    );
  }
  const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
  const prompt = await readFile(promptPath, "utf8");
  const verifierPath = arg("--verifier");
  const verifierPrompt = verifierPath ? await readFile(verifierPath, "utf8") : null;
  const id = await modelId(baseUrl);
  // The per-call timeout was hardcoded at 20s, which is an assumption about the hardware
  // rather than about the engine: on a CPU-only box generating ~11 tokens/s, rows time out
  // and are scored as engine failures, quietly lowering recall for a reason that has
  // nothing to do with the model or the gate. Measured: two of sixty on the development
  // corpus. Overridable, default unchanged.
  const timeoutMs = Number(arg("--timeout-ms", "20000"));
  const engine = createEngine({ baseUrl, model: id, prompt, verifierPrompt, timeoutMs });
  const bytes = modelPath ? (await stat(modelPath)).size : null;
  const report = await runBenchmark({
    corpus, engine, prompt,
    model: { id, path: modelPath || "served", bytes, timeoutMs },
    mechanics: !process.argv.includes("--no-mechanics"),
    rules: !process.argv.includes("--no-rules"),
    gate: process.argv.includes("--gate"),
    deletionPolicy: process.argv.includes("--refuse-deletions") ? "refuse" : "verify",
    onProgress: (done, total) => { if (done % 10 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`); },
  });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1]?.endsWith("bench/run.mjs")) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
