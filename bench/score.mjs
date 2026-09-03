// Scores a benchmark report as the UI would see it: surfaced = passed safety validation.
import { readFile } from "node:fs/promises";
import { validateRewrite, lostContentWords, deletesTrailingPhrase } from "../src/safety.mjs";
import { NEVER_VERIFY } from "../src/pipeline.mjs";
import { repairMechanics } from "../src/mechanics.mjs";
import { changedSourceRanges } from "../src/diff.mjs";

// The raw model output lives in `replacement` when the validator of the day accepted it
// and in `rejectedText` when it refused, so a re-score has to look in both places. A row
// whose only suggestion came from the mechanical pass has no model output to re-judge.
function modelOutputOf(row) {
  if (row.rejectedText) return row.rejectedText;
  if (row.stages?.model && row.replacement) return row.replacement;
  return null;
}

// Re-applies the CURRENT safety pipeline to stored raw model output, so reports
// captured under an older validator stay comparable. Three properties keep it honest:
//   - the candidate is judged against the mechanically repaired BASE, recomputed with
//     the current mechanics pass, exactly as the live pipeline judged it — judging
//     against row.source re-attributed a model echo of the repair to the model;
//   - the pipeline's deterministic deletion policy runs too (NEVER_VERIFY, multi-word
//     losses, trailing phrases): validateRewrite alone inflated recall and FP-rate on
//     an UNCHANGED validator. The one thing an offline re-score cannot re-run is the
//     model verifier, so a single verifiable lost word falls back to the verdict the
//     original run recorded for this exact output, and is otherwise accepted;
//   - a refusal surfaces the recomputed mechanical repair when it is showable, as the
//     live fallback() does, instead of scoring the row as silence.
export function rescore(rows, { mechanics = true, deletionPolicy = "verify" } = {}) {
  return rows.map((row) => {
    if (row.action === "failed") return row;   // the model never answered; nothing to judge
    const output = modelOutputOf(row);
    if (!output) return row;
    const base = mechanics ? repairMechanics(row.source)?.replacement ?? row.source : row.source;
    const showable = (candidate) =>
      candidate.trim() !== row.source.trim() && changedSourceRanges(row.source, candidate).length > 0;

    const refuse = (reason) => {
      // The deterministic floor the live pipeline would fall back to. A rule answer
      // outranks the bare mechanical repair and is already recorded on the row, so it is
      // kept rather than recomputed; only the mechanical repair needs rebuilding.
      const repair = mechanics ? repairMechanics(row.source)?.replacement ?? "" : "";
      const floor = row.stages?.rule && row.replacement
        ? row.replacement
        : (repair && showable(repair) ? repair : "");
      return {
        ...row,
        action: floor ? "rewrite" : "keep",
        replacement: floor,
        surfaced: Boolean(floor),
        rejectedText: output,
        rejection: floor ? null : reason,
        modelRejection: reason,
        stages: { ...row.stages, model: false },
      };
    };

    const validation = validateRewrite(base, {
      action: "rewrite", replacement: output, reason: row.modelReason ?? "",
    });
    if (!validation.accepted) return refuse(validation.reason);
    if (!showable(validation.replacement)) return refuse("unchanged");

    const lost = lostContentWords(base, validation.replacement);
    const refuseOutright = lost.some((word) => NEVER_VERIFY.has(word.toLowerCase()))
      || (deletionPolicy === "refuse"
        ? lost.length > 0
        : lost.length > 1 || (lost.length === 1 && deletesTrailingPhrase(base, validation.replacement)));
    if (refuseOutright) return refuse("information-dropped");
    // The pipeline promotes the verdict to `rejection` only when nothing surfaced;
    // with a mechanical fallback on screen it lives in modelRejection.
    if (lost.length === 1 && row.rejectedText === output
      && (row.rejection === "verifier-hidden" || row.modelRejection === "verifier-hidden")) {
      return refuse("verifier-hidden");
    }

    return {
      ...row,
      action: "rewrite",
      replacement: validation.replacement,
      surfaced: true,
      rejection: null,
      modelRejection: null,
      rejectedText: null,
      stages: { ...row.stages, model: true },
    };
  });
}

export function summarize(rows) {
  // A row whose engine call failed is not a decision the model made. It is counted as a
  // failure and excluded from both denominators, so a dead model scores as nothing
  // measured rather than as a flawless clean run.
  const failed = rows.filter((row) => row.action === "failed");
  const scored = rows.filter((row) => row.action !== "failed");
  const positives = scored.filter((row) => row.expectedAction === "rewrite");
  const cleans = scored.filter((row) => row.expectedAction === "keep");
  const latencies = rows.map((row) => row.milliseconds).sort((a, b) => a - b);
  // Nearest rank: the q-th percentile is the ceil(q*n)-th smallest value, so p95 is only
  // the maximum when the sample is small enough that it genuinely has to be.
  const at = (q) => (latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.max(0, Math.ceil(q * latencies.length) - 1))]
    : 0);
  const rejections = {};
  const modelRejections = {};
  for (const row of scored) {
    if (row.rejection) rejections[row.rejection] = (rejections[row.rejection] ?? 0) + 1;
    if (row.modelRejection) modelRejections[row.modelRejection] = (modelRejections[row.modelRejection] ?? 0) + 1;
  }
  const failureKinds = {};
  for (const row of failed) {
    const kind = row.engineError?.kind ?? "failed";
    failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
  }
  const byClass = {};
  for (const row of positives) {
    byClass[row.issueClass] ??= { surfaced: 0, total: 0 };
    byClass[row.issueClass].total += 1;
    if (row.surfaced) byClass[row.issueClass].surfaced += 1;
  }
  return {
    scoredRows: scored.length,
    positives: positives.length,
    surfacedOnPositives: positives.filter((row) => row.surfaced).length,
    recall: positives.length ? positives.filter((row) => row.surfaced).length / positives.length : 0,
    cleans: cleans.length,
    falsePositives: cleans.filter((row) => row.surfaced).length,
    falsePositiveRate: cleans.length ? cleans.filter((row) => row.surfaced).length / cleans.length : 0,
    failures: failed.length,
    failureKinds,
    // Both break down surfacedOnPositives, never the false-positive line.
    surfacedByModel: positives.filter((row) => row.surfaced && row.stages?.model).length,
    surfacedByMechanicsOnly: positives.filter((row) => row.surfaced && row.stages?.mechanics && !row.stages?.model).length,
    rejections,
    modelRejections,
    byClass,
    latencyP50: at(0.5),
    latencyP95: at(0.95),
    latencyMax: latencies[latencies.length - 1] ?? 0,
  };
}

async function main() {
  for (const path of process.argv.slice(2)) {
    if (path === "--rescore") continue;
    const report = JSON.parse(await readFile(path, "utf8"));
    const s = summarize(process.argv.includes("--rescore")
      ? rescore(report.rows, {
        mechanics: report.options?.mechanics ?? true,
        deletionPolicy: report.options?.deletionPolicy ?? "verify",
      })
      : report.rows);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    process.stdout.write(
      `\n${path.split("/").pop()}  prompt=${report.promptSHA256.slice(0, 8)}\n` +
      `  scored rows:                  ${s.scoredRows}/${report.rows.length}\n` +
      `  surfaced on rewrite-expected: ${s.surfacedOnPositives}/${s.positives} (${pct(s.recall)})\n` +
      `    of which model-produced:    ${s.surfacedByModel}\n` +
      `    of which mechanics-only:    ${s.surfacedByMechanicsOnly}\n` +
      `  false positives on clean:     ${s.falsePositives}/${s.cleans} (${pct(s.falsePositiveRate)})\n` +
      `  engine failures:              ${s.failures} ${JSON.stringify(s.failureKinds)}\n` +
      `  latency p50/p95/max:          ${s.latencyP50}/${s.latencyP95}/${s.latencyMax} ms\n` +
      `  safety rejections:            ${JSON.stringify(s.rejections)}\n` +
      `  model rewrites refused:       ${JSON.stringify(s.modelRejections)}\n` +
      `  by class: ${Object.entries(s.byClass).map(([k, v]) => `${k} ${v.surfaced}/${v.total}`).join(", ")}\n`,
    );
  }
}
if (process.argv[1]?.endsWith("bench/score.mjs")) main();
