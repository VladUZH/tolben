// The Grammarly-replay oracle: what would our safety layer do to Grammarly's own edits?
//
// Every quality number in REPORT.md measures the whole pipeline at once, so a missed
// suggestion cannot be attributed: the model may never have found the edit, or it found
// it and a guard threw it away. This tool separates those. It replays the accepted
// rewrites Grammarly itself produced (bench/corpus/grammarly-pairs.json, harvested from
// the live editor) through the deterministic gauntlet AS IF the model had proposed each
// one, and reports which guard refused what.
//
// It costs no model calls and runs in well under a second, which is the point: it is
// cheap enough to run on every change to src/safety.mjs.
//
// WHAT THE NUMBER IS: the share of Grammarly's EXACT WORDINGS our gate would let
// through. It is a compatibility measure against one particular engine's phrasing, and
// an upper bound on recall against that phrasing — not the shipped engine's recall, and
// not a score of how good our suggestions are. Grammarly's wording is one acceptable
// rewrite among many, and a refusal here is not automatically a defect: some are the
// project's deliberate, documented policy (docs/GRAMMARLY-BEHAVIOUR.md §3 — Grammarly
// invents agents for agentless passives and strengthens hedged claims; we refuse both on
// purpose). Read the histogram, not the headline.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { repairMechanics } from "../src/mechanics.mjs";
import {
  validateRewrite, lostContentWords, deletesTrailingPhrase, dropsConjunct, dropsRepeatedWord, deadlineNarrowed,
} from "../src/safety.mjs";
import { NEVER_VERIFY } from "../src/pipeline.mjs";

const DEFAULT_CORPUS = fileURLToPath(new URL("./corpus/grammarly-pairs.json", import.meta.url));

// Wilson score interval — the right one for a proportion on samples this size, where the
// normal approximation misbehaves near 0 and 1.
export function wilson(successes, total, z = 1.96) {
  if (total === 0) return { low: 0, high: 0 };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return { low: Math.max(0, (centre - spread) / denominator), high: Math.min(1, (centre + spread) / denominator) };
}

// One replayed pair: which bucket it lands in, and why.
//
// `mechanics` mirrors the pipeline, which validates the candidate against the
// mechanically repaired base rather than the raw source — judging against the raw source
// credits or blames the gate for repairs the mechanical pass had already made.
export function replayPair(source, candidate, { mechanics = true, deletionPolicy = "verify" } = {}) {
  const base = mechanics ? repairMechanics(source)?.replacement ?? source : source;
  const validation = validateRewrite(base, { action: "rewrite", replacement: candidate, reason: "" });
  if (!validation.accepted) return { bucket: "refused", reason: validation.reason, stage: "validator" };

  // The pipeline's own deletion policy, which refuses a second class outright and sends
  // a third to the 2B verifier. A replay cannot run the verifier (it needs the model), so
  // those land in their own bucket and bound the ceiling from above.
  const lost = lostContentWords(base, validation.replacement);
  const counted = lost.some((word) => NEVER_VERIFY.has(word.toLowerCase()));
  // Mirrors the pipeline, which refuses a dissolved coordination outright rather than
  // asking the verifier about it.
  const conjunct = dropsConjunct(base, validation.replacement, lost);
  const repeated = dropsRepeatedWord(base, validation.replacement, lost);
  const narrowed = deadlineNarrowed(base, validation.replacement, lost);
  const outright = counted || conjunct || repeated || narrowed || (deletionPolicy === "refuse"
    ? lost.length > 0
    : lost.length > 1 || (lost.length === 1 && deletesTrailingPhrase(base, validation.replacement)));
  if (outright) return { bucket: "refused", reason: "information-dropped", stage: "deletion-policy", lost };
  if (lost.length > 0) return { bucket: "verifier", reason: "verifier-decides", stage: "deletion-policy", lost };
  return { bucket: "accepted", reason: "accepted", stage: "validator" };
}

export function replay(pairs, options = {}) {
  const buckets = { accepted: 0, verifier: 0, refused: 0 };
  const reasons = {};
  const byTheme = {};
  const rows = [];
  for (const pair of pairs) {
    const verdict = replayPair(pair.original, pair.grammarly, options);
    buckets[verdict.bucket] += 1;
    if (verdict.bucket === "refused") reasons[verdict.reason] = (reasons[verdict.reason] ?? 0) + 1;
    const theme = pair.theme ?? "unthemed";
    byTheme[theme] ??= { accepted: 0, verifier: 0, refused: 0 };
    byTheme[theme][verdict.bucket] += 1;
    rows.push({ ...pair, ...verdict });
  }
  return { total: pairs.length, buckets, reasons, byTheme, rows };
}

function render(result, { corpusName }) {
  const { total, buckets, reasons, byTheme } = result;
  const ceiling = buckets.accepted + buckets.verifier;
  const line = (label, n) => {
    const { low, high } = wilson(n, total);
    const pct = (v) => `${(100 * v).toFixed(1)}%`;
    return `  ${label.padEnd(34)} ${String(n).padStart(3)}/${total}  ${pct(n / total).padStart(6)}  [${pct(low)}, ${pct(high)}]`;
  };
  const out = [
    ``,
    `Grammarly-replay oracle — ${corpusName}`,
    `  (share of Grammarly's exact wordings our gate would pass; 95% Wilson intervals)`,
    ``,
    line("hard-accept (reaches the writer)", buckets.accepted),
    line("sent to the 2B verifier", buckets.verifier),
    line("hard-refuse (never reaches writer)", buckets.refused),
    line("=> ceiling, if verifier says yes", ceiling),
    ``,
    `  refusals by guard:`,
  ];
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    out.push(`    ${String(n).padStart(3)}  ${reason}`);
  }
  out.push(``, `  by construction theme (accept / verifier / refuse):`);
  for (const [theme, b] of Object.entries(byTheme).sort((a, b) => b[1].refused - a[1].refused)) {
    out.push(`    ${String(b.accepted).padStart(3)} /${String(b.verifier).padStart(3)} /${String(b.refused).padStart(3)}   ${theme}`);
  }
  out.push(``);
  return out.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const at = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const corpusPath = at("--corpus", DEFAULT_CORPUS);
  const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
  // The harvested format keeps every sentence and marks which ones Grammarly changed;
  // only the changed ones are rewrites to replay.
  const pairs = (corpus.pairs ?? corpus.rows ?? []).filter((pair) => pair.changed !== false && pair.grammarly);
  const result = replay(pairs, {
    mechanics: !args.includes("--no-mechanics"),
    deletionPolicy: args.includes("--refuse-deletions") ? "refuse" : "verify",
  });
  process.stdout.write(render(result, { corpusName: corpusPath.split("/").pop() }));
  if (args.includes("--refusals")) {
    for (const row of result.rows.filter((r) => r.bucket === "refused")) {
      process.stdout.write(`\n[${row.reason}] ${row.theme ?? ""}\n  FROM: ${row.original}\n  TO:   ${row.grammarly}\n`);
    }
  }
}

if (process.argv[1]?.endsWith("bench/oracle.mjs")) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
