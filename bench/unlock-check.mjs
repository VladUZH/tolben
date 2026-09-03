// The false-unlock control: the other half of every guard relaxation.
//
// bench/oracle.mjs measures how much of Grammarly's edit distribution the safety layer
// refuses, and the temptation it creates is obvious — loosen a guard, watch the number
// improve, ship. That is exactly how a meaning-inversion hole gets built. This script is
// the counterweight: it replays every model rewrite this project has ever REFUSED, and
// reports any that a change would newly let through.
//
// The corpus is free and already on disk: bench/results/*.json store `rejectedText` for
// every row the gate refused across every benchmark run ever recorded — real 2B output on
// real prose, including the meaning inversions that motivated half the guards. A guard
// change is admissible only when this reports zero new accepts, or when every new accept
// has been read by a human and found genuinely safe.
//
//   node bench/unlock-check.mjs --write     # snapshot the current verdicts as the baseline
//   node bench/unlock-check.mjs             # compare the working tree against that baseline
//
// Exit status is 1 when anything unlocked, so it can gate a commit.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { replayPair } from "./oracle.mjs";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const BASELINE = fileURLToPath(new URL("./corpus/refusal-baseline.json", import.meta.url));

// FNV-1a over source + candidate: the baseline stores verdicts by key rather than by
// text, so it stays small while the text is re-read from the result files on demand.
function key(source, candidate) {
  let hash = 0x811c9dc5;
  const material = `${source}\u0000${candidate}`;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Every distinct (source, refused-candidate) pair the project has ever recorded.
export async function collectRefusals() {
  const files = (await readdir(RESULTS)).filter((name) => name.endsWith(".json"));
  const pairs = new Map();
  for (const file of files) {
    let report;
    try { report = JSON.parse(await readFile(`${RESULTS}${file}`, "utf8")); } catch { continue; }
    for (const row of report.rows ?? []) {
      if (!row.rejectedText || typeof row.source !== "string") continue;
      const id = key(row.source, row.rejectedText);
      if (!pairs.has(id)) {
        pairs.set(id, { id, source: row.source, candidate: row.rejectedText, from: file, reason: row.modelRejection ?? row.rejection ?? null });
      }
    }
  }
  return [...pairs.values()];
}

export function verdictsFor(refusals) {
  const verdicts = {};
  for (const item of refusals) {
    const verdict = replayPair(item.source, item.candidate);
    verdicts[item.id] = `${verdict.bucket}:${verdict.reason}`;
  }
  return verdicts;
}

async function main() {
  const refusals = await collectRefusals();
  const current = verdictsFor(refusals);

  if (process.argv.includes("--write")) {
    // Re-baselining is the moment a refusal stops being one, so the rows it waves through
    // are written down beside the verdicts rather than disappearing into them. A reader
    // who wants to know why a hole is not a hole can read the list and judge for
    // themselves; without it, "the baseline says so" is unfalsifiable.
    let previous = null;
    try { previous = JSON.parse(await readFile(BASELINE, "utf8")); } catch { /* first run */ }
    const noteAt = process.argv.indexOf("--note");
    const note = noteAt >= 0 ? process.argv[noteAt + 1] : "";
    const newlyAccepted = previous ? refusals.filter((item) =>
      previous.verdicts[item.id] !== undefined
      && !previous.verdicts[item.id].startsWith("accepted")
      && current[item.id].startsWith("accepted")) : [];
    const entry = newlyAccepted.length || note
      ? [{
        date: new Date().toISOString().slice(0, 10),
        note,
        accepted: newlyAccepted.map((item) => ({ from: item.source, to: item.candidate, was: previous.verdicts[item.id] })),
      }]
      : [];
    await writeFile(BASELINE, `${JSON.stringify({
      description: "Verdict of the safety gate on every model rewrite this project has recorded as refused (bench/results/*.json `rejectedText`). Regenerate with `node bench/unlock-check.mjs --write --note \"why\"` ONLY when the new verdicts have been reviewed: this file is what stops a guard relaxation from silently reopening a meaning-inversion hole. `reviewed` records every rewrite a re-baseline has ever promoted to accepted, and who said it was safe.",
      snapshot: new Date().toISOString().slice(0, 10),
      count: refusals.length,
      reviewed: [...(previous?.reviewed ?? []), ...entry],
      verdicts: current,
    }, null, 1)}\n`);
    process.stdout.write(`baseline written: ${refusals.length} refused rewrites`
      + `${newlyAccepted.length ? `, ${newlyAccepted.length} promoted to accepted and recorded` : ""}\n`);
    return;
  }

  const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
  const unlocked = [];
  // A refusal that becomes a VERIFIER row is a real relaxation too — the deterministic
  // gate has stopped refusing it and the 2B model now decides. Reported on its own line
  // rather than buried among reason changes, because the accept/refuse binary hid it.
  const softened = [];
  const changed = [];
  let missing = 0;
  for (const item of refusals) {
    const was = baseline.verdicts[item.id];
    if (was === undefined) { missing += 1; continue; }
    const now = current[item.id];
    if (was === now) continue;
    const bucket = now.startsWith("accepted") ? unlocked
      : now.startsWith("verifier") && !was.startsWith("verifier") ? softened
      : changed;
    bucket.push({ ...item, was, now });
  }

  process.stdout.write(`\nfalse-unlock control — ${refusals.length} recorded refusals`
    + `${missing ? ` (${missing} not in the baseline; regenerate it)` : ""}\n`);
  process.stdout.write(`  newly ACCEPTED (must be zero, or hand-checked): ${unlocked.length}\n`);
  process.stdout.write(`  refused -> verifier (hand-check each):          ${softened.length}\n`);
  process.stdout.write(`  still refused, different reason:                ${changed.length}\n\n`);
  for (const row of unlocked) {
    process.stdout.write(`UNLOCKED  ${row.was} -> ${row.now}   [${row.from}]\n  FROM: ${row.source}\n  TO:   ${row.candidate}\n`);
  }
  for (const row of softened) {
    process.stdout.write(`SOFTENED  ${row.was} -> ${row.now}   [${row.from}]\n  FROM: ${row.source}\n  TO:   ${row.candidate}\n`);
  }
  if (process.argv.includes("--verbose")) {
    for (const row of changed) {
      process.stdout.write(`reason    ${row.was} -> ${row.now}\n  FROM: ${row.source}\n  TO:   ${row.candidate}\n`);
    }
  }
  if (unlocked.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("bench/unlock-check.mjs")) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
