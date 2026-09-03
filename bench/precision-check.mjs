// The precision control: the other half of the measurement, and the half that was missing.
//
// Everything else this project measures asks about REFUSALS. bench/oracle.mjs asks how
// much of Grammarly's phrasing our gate refuses; bench/unlock-check.mjs asks whether a
// change newly accepted something we used to refuse; bench/score.mjs counts a surfaced
// suggestion on a rewrite-expected row as a win and never looks at it again. None of them
// asks whether a suggestion we DID surface was correct.
//
// That gap is not hypothetical. Two meaning inversions — "The service writes nothing to
// the primary." -> "The service writes to the primary." among them — were being accepted
// outright, and would have scored as recall successes in every instrument above.
// unlock-check could not see them either: it is differential, and only notices what STOPS
// being refused. Something wrong since the first commit is invisible to it.
//
// So this script replays every rewrite the project has ever RECORDED AS ACCEPTED
// (`replacement` across bench/results/*.json — the mirror of the `rejectedText` corpus
// unlock-check mines) and holds it against bench/corpus/accepted-labels.json, where each
// one has been read by hand and marked PRESERVING or CHANGED.
//
//   node bench/precision-check.mjs --write --note "why"   # snapshot the current verdicts
//   node bench/precision-check.mjs                        # compare the tree against it
//
// Exit status is 1 when a CHANGED rewrite is accepted that the baseline does not already
// record as a known defect, so it can gate a commit.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { replayPair } from "./oracle.mjs";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const LABELS = fileURLToPath(new URL("./corpus/accepted-labels.json", import.meta.url));
const BASELINE = fileURLToPath(new URL("./corpus/precision-baseline.json", import.meta.url));

// FNV-1a over source + replacement, the same keying unlock-check uses, so the baseline
// stays small while the text is re-read from the labels on demand.
export function key(source, replacement) {
  let hash = 0x811c9dc5;
  const material = `${source} ${replacement}`;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Every distinct (source, accepted-replacement) pair the project has recorded.
export async function collectAccepted() {
  const files = (await readdir(RESULTS)).filter((name) => name.endsWith(".json"));
  const pairs = new Map();
  for (const file of files) {
    let report;
    try { report = JSON.parse(await readFile(`${RESULTS}${file}`, "utf8")); } catch { continue; }
    for (const row of report.rows ?? []) {
      if (typeof row.source !== "string" || !row.replacement) continue;
      const id = key(row.source, row.replacement);
      if (pairs.has(id)) continue;
      pairs.set(id, { id, source: row.source, replacement: row.replacement, from: file });
    }
  }
  return [...pairs.values()];
}

export function verdictsFor(accepted) {
  const verdicts = {};
  for (const item of accepted) {
    const verdict = replayPair(item.source, item.replacement);
    verdicts[item.id] = `${verdict.bucket}:${verdict.reason}`;
  }
  return verdicts;
}

export async function readLabels() {
  const file = JSON.parse(await readFile(LABELS, "utf8"));
  return new Map(file.labels.map((row) => [key(row.source, row.replacement), row]));
}

// What the tree does now, sorted into the four things worth knowing.
export function classify(accepted, current, labels, baseline) {
  const report = { defects: [], newDefects: [], fixed: [], deferred: [], recallCost: [], recallRegained: [], unlabelled: 0 };
  for (const item of accepted) {
    const label = labels.get(item.id);
    if (!label) { report.unlabelled += 1; continue; }
    const now = current[item.id];
    const was = baseline?.verdicts?.[item.id];
    const acceptedNow = now.startsWith("accepted");
    if (label.label === "CHANGED") {
      if (acceptedNow) {
        // A defect the baseline already knows about is a standing one; anything else is
        // a rewrite that has BECOME acceptable to the gate, which is a new hole.
        (was?.startsWith("accepted") ? report.defects : report.newDefects).push({ ...item, ...label, was, now });
      } else if (was?.startsWith("accepted") || (was?.startsWith("verifier") && now.startsWith("refused"))) {
        // Closed: it used to reach the writer, outright or through a verifier that was
        // measured not to stop it, and now the deterministic gate refuses it.
        report.fixed.push({ ...item, ...label, was, now });
      }
      // A CHANGED rewrite the deterministic gate hands to the 2B verifier is only stopped
      // if the verifier stops it, and measured it mostly does not. Of the six put to it,
      // three change meaning for a reason its question cannot reach (a substitution, a
      // reanalysis, a word the loss list names wrongly); of the three it is genuinely
      // asked, it catches one. Either way the verifier is not a safety net, so these are
      // counted beside the standing defects rather than filed as handled.
      // bench/verifier-check.mjs is where that is scored.
      if (now.startsWith("verifier")) report.deferred.push({ ...item, ...label, was, now });
      continue;
    }
    // A PRESERVING rewrite that stops being accepted is recall the gate has given up.
    // Not automatically wrong — tightening for precision costs recall — but it must be
    // visible rather than absorbed.
    if (!acceptedNow && was?.startsWith("accepted")) report.recallCost.push({ ...item, ...label, was, now });
    // And the other direction: a preserving rewrite the gate used to refuse and now
    // accepts. Not a defect either way, but a line that says only what was GIVEN UP
    // reads like tightening is always the cost and never the gain.
    if (acceptedNow && was && !was.startsWith("accepted")) report.recallRegained.push({ ...item, ...label, was, now });
  }
  return report;
}

async function main() {
  const accepted = await collectAccepted();
  const current = verdictsFor(accepted);
  const labels = await readLabels();

  if (process.argv.includes("--write")) {
    let previous = null;
    try { previous = JSON.parse(await readFile(BASELINE, "utf8")); } catch { /* first run */ }
    const noteAt = process.argv.indexOf("--note");
    const note = noteAt >= 0 ? process.argv[noteAt + 1] : "";
    const report = classify(accepted, current, labels, previous);
    const entry = note || report.fixed.length || report.recallCost.length || report.recallRegained.length
      ? [{
        date: new Date().toISOString().slice(0, 10),
        note,
        fixed: report.fixed.map((row) => ({ from: row.source, to: row.replacement, ground: row.ground, now: row.now })),
        recallCost: report.recallCost.map((row) => ({ from: row.source, to: row.replacement, now: row.now })),
        recallRegained: report.recallRegained.map((row) => ({ from: row.source, to: row.replacement, was: row.was })),
      }]
      : [];
    await writeFile(BASELINE, `${JSON.stringify({
      description: "Verdict of the safety gate on every rewrite this project has recorded as ACCEPTED, keyed by FNV-1a of source+replacement. Meaning lives in accepted-labels.json and never changes; this file is the moving record of what the gate does. `history` records every CHANGED rewrite a re-baseline has closed and every PRESERVING one it has given up, so neither can happen quietly. Regenerate with `node bench/precision-check.mjs --write --note \"why\"`.",
      snapshot: new Date().toISOString().slice(0, 10),
      count: accepted.length,
      history: [...(previous?.history ?? []), ...entry],
      verdicts: current,
    }, null, 1)}\n`);
    process.stdout.write(`baseline written: ${accepted.length} accepted rewrites`
      + `${report.fixed.length ? `, ${report.fixed.length} defect(s) closed` : ""}`
      + `${report.recallCost.length ? `, ${report.recallCost.length} preserving rewrite(s) given up` : ""}\n`);
    return;
  }

  const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
  const report = classify(accepted, current, labels, baseline);

  process.stdout.write(`\nprecision control — ${accepted.length} recorded accepted rewrites`
    + `${report.unlabelled ? ` (${report.unlabelled} unlabelled; extend accepted-labels.json)` : ""}\n`);
  process.stdout.write(`  meaning-changing and still accepted (known):    ${report.defects.length}\n`);
  process.stdout.write(`  meaning-changing and NEWLY accepted (must be 0): ${report.newDefects.length}\n`);
  process.stdout.write(`  known defects closed since the baseline:        ${report.fixed.length}\n`);
  // The parenthetical is a measurement from bench/verifier-check.mjs, not a live number,
  // and it only describes the rows that are actually put to the verifier.
  process.stdout.write(`  meaning-changing, left to the 2B verifier:      ${report.deferred.length}`
    + `${report.deferred.length ? " (it catches 1 of the 3 it is genuinely asked)" : ""}\n`);
  process.stdout.write(`  preserving rewrites newly refused (recall cost): ${report.recallCost.length}\n`);
  process.stdout.write(`  preserving rewrites newly accepted (recall gain): ${report.recallRegained.length}\n\n`);

  for (const row of report.newDefects) {
    process.stdout.write(`NEW DEFECT  [${row.ground}] ${row.was} -> ${row.now}\n  FROM: ${row.source}\n  TO:   ${row.replacement}\n  ${row.note}\n`);
  }
  for (const row of report.fixed) {
    process.stdout.write(`CLOSED      [${row.ground}] ${row.now}\n  FROM: ${row.source}\n  TO:   ${row.replacement}\n`);
  }
  for (const row of report.recallRegained) {
    process.stdout.write(`REGAINED    ${row.was} -> ${row.now}\n  FROM: ${row.source}\n  TO:   ${row.replacement}\n`);
  }
  if (process.argv.includes("--verbose")) {
    for (const row of report.defects) {
      process.stdout.write(`standing    [${row.ground}] ${row.confidence}\n  FROM: ${row.source}\n  TO:   ${row.replacement}\n  ${row.note}\n`);
    }
    for (const row of report.recallCost) {
      process.stdout.write(`recall      ${row.was} -> ${row.now}\n  FROM: ${row.source}\n  TO:   ${row.replacement}\n`);
    }
  }
  if (report.newDefects.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("bench/precision-check.mjs")) {
  // This report is long and meant to be piped into `head`, which closes the pipe under
  // us. That is the reader having read enough, not a failure.
  process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); });
  main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
