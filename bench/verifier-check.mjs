// Scores the 2B verifier against bench/corpus/verifier-labels.json.
//
// The verifier is the second half of the deletion policy: a rewrite that loses exactly
// one content word is not refused, it is put to the model. That makes the policy only as
// strong as the verifier, and until a model actually ran here nobody had measured how
// strong that is. The first measurement was not encouraging — 20 of 22 shown — so this
// script exists to make the next prompt change accountable rather than hopeful.
//
// Two numbers matter and they pull against each other:
//   - recall on HIDE: of the rewrites that genuinely lose information, how many are
//     caught. A verifier that catches none is a rubber stamp.
//   - false hides: of the rewrites that lose nothing, how many are refused anyway. A
//     verifier that hides everything is not a verifier, it is `--refuse-deletions` with
//     extra latency and less honesty about what it is doing.
//
// Rows marked `inRemit: false` are scored apart. Those rewrites do change meaning, but
// for a reason the verifier's question cannot reach; counting them as misses would credit
// a prompt for answering the wrong question correctly.
//
//   node bench/verifier-check.mjs                      # needs a server on 127.0.0.1:8080
//   node bench/verifier-check.mjs --prompt <file>      # score a candidate prompt
//   node bench/verifier-check.mjs --verbose            # list every disagreement

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createEngine } from "../src/engine.mjs";

const LABELS = fileURLToPath(new URL("./corpus/verifier-labels.json", import.meta.url));
const DEFAULT_PROMPT = fileURLToPath(new URL("../src/verifier-prompt.txt", import.meta.url));

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

export function summarise(rows) {
  const inRemit = rows.filter((row) => row.inRemit);
  const hides = inRemit.filter((row) => row.expected === "hide");
  const shows = inRemit.filter((row) => row.expected === "show");
  return {
    caught: hides.filter((row) => row.got === "hide").length,
    hides: hides.length,
    falseHides: shows.filter((row) => row.got === "hide").length,
    shows: shows.length,
    unavailable: rows.filter((row) => row.got !== "show" && row.got !== "hide").length,
    outsideRemit: rows.filter((row) => !row.inRemit).map((row) => row.got),
  };
}

async function main() {
  const baseUrl = arg("--base-url", "http://127.0.0.1:8080/v1");
  let modelId;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/models`, { signal: AbortSignal.timeout(3000) });
    modelId = (await response.json())?.data?.[0]?.id;
  } catch { modelId = null; }
  if (!modelId) {
    process.stdout.write(`no local model on ${baseUrl}; nothing to score\n`);
    return;
  }

  const promptPath = arg("--prompt", DEFAULT_PROMPT);
  const engine = createEngine({
    baseUrl,
    model: modelId,
    // The rewrite half is not exercised here, but createEngine requires a prompt.
    prompt: "unused: bench/verifier-check.mjs only calls verify()",
    verifierPrompt: await readFile(promptPath, "utf8"),
    timeoutMs: Number(arg("--timeout-ms", "180000")),
  });

  const labels = JSON.parse(await readFile(LABELS, "utf8")).labels;
  const rows = [];
  for (const label of labels) {
    const verdict = await engine.verify(label.source, label.replacement, { lost: label.lost });
    rows.push({ ...label, got: verdict?.verdict ?? "unavailable", why: verdict?.reason ?? "" });
  }

  const s = summarise(rows);
  process.stdout.write(`\nverifier — ${promptPath.split("/").pop()} on ${rows.length} labelled rewrites\n`);
  process.stdout.write(`  caught, of those that lose information:  ${s.caught}/${s.hides}\n`);
  process.stdout.write(`  refused, of those that lose nothing:     ${s.falseHides}/${s.shows}\n`);
  process.stdout.write(`  unavailable:                             ${s.unavailable}\n`);
  process.stdout.write(`  outside the question's remit:            ${s.outsideRemit.join(", ")}\n\n`);

  for (const row of rows) {
    if (!row.inRemit || row.got === row.expected) continue;
    process.stdout.write(`${row.expected} -> ${row.got}  lost=${JSON.stringify(row.lost)}\n  O: ${row.source}\n  P: ${row.replacement}\n  why: ${row.why}\n`);
  }
  if (process.argv.includes("--verbose")) {
    for (const row of rows) {
      if (!row.inRemit || row.got !== row.expected) continue;
      process.stdout.write(`ok ${row.got.padEnd(4)} lost=${JSON.stringify(row.lost)}  ${row.source.slice(0, 70)}\n`);
    }
  }
}

if (process.argv[1]?.endsWith("bench/verifier-check.mjs")) {
  process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); });
  main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
