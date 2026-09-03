// The Grammarly-replay oracle, and the operating point it measures.
//
// bench/oracle.mjs replays Grammarly's own accepted rewrites through the deterministic
// gauntlet as if the model had proposed each one, which localises recall loss to an
// individual guard — the thing whole-pipeline numbers cannot do. The corpus assertions
// below pin the measured operating point with a margin, exactly as tests/gate.test.mjs
// pins the gate's: a guard change that quietly starts refusing (or accepting) a chunk of
// Grammarly's edit distribution fails here first, in under a second and with no model.
//
// The margins are deliberately loose in the SAFE direction. Refusing less than the floor
// is not automatically wrong — the point of the tool is to move that number up — so the
// bounds are wide enough that an intentional guard relaxation passes while an accidental
// collapse of the safety layer does not.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { replay, replayPair, wilson } from "../bench/oracle.mjs";

const CORPUS = fileURLToPath(new URL("../bench/corpus/grammarly-pairs.json", import.meta.url));
const corpus = JSON.parse(await readFile(CORPUS, "utf8"));
const pairs = corpus.pairs.filter((pair) => pair.changed);

test("the corpus is the one the operating point was measured on", () => {
  assert.equal(corpus.pairs.length, 200);
  assert.equal(pairs.length, 118, "118 of the 200 harvested sentences were rewritten by Grammarly");
});

test("operating point: what our gate does to Grammarly's own rewrites", () => {
  const { buckets, total } = replay(pairs);
  assert.equal(total, 118);
  assert.equal(buckets.accepted + buckets.verifier + buckets.refused, 118, "every pair lands in exactly one bucket");

  // Measured 2026-09-01: 42 hard-accept, 22 to the verifier, 54 hard-refuse.
  assert.ok(buckets.accepted >= 35, `hard-accept collapsed to ${buckets.accepted}/118 (was 42)`);
  assert.ok(buckets.refused <= 62, `hard-refuse ballooned to ${buckets.refused}/118 (was 54)`);
  // The ceiling is the number the project is trying to raise; guard it from below only.
  const ceiling = buckets.accepted + buckets.verifier;
  assert.ok(ceiling >= 56, `recall ceiling fell to ${ceiling}/118 (was 64)`);
});

test("the safety-probe rows stay refused — they are planted meaning changes", () => {
  // "numbers, units, versions and entities (safety probes)" is the theme harvested to
  // check that an engine refuses to touch quantities and identities. All of it must
  // refuse; an accept here is a hole, not recall.
  const probes = pairs.filter((pair) => /safety probes/u.test(pair.theme ?? ""));
  assert.ok(probes.length > 0, "the corpus carries safety probes");
  for (const probe of probes) {
    const verdict = replayPair(probe.original, probe.grammarly);
    assert.equal(verdict.bucket, "refused", `a safety probe was let through: ${probe.original}`);
  }
});

test("a refusal names the guard that produced it", () => {
  const { rows } = replay(pairs);
  for (const row of rows.filter((r) => r.bucket === "refused")) {
    assert.equal(typeof row.reason, "string");
    assert.ok(row.reason.length > 0, `unnamed refusal for: ${row.original}`);
    assert.ok(["validator", "deletion-policy"].includes(row.stage));
  }
});

test("the deletion policy setting moves the buckets in the expected direction", () => {
  const lenient = replay(pairs, { deletionPolicy: "verify" });
  const strict = replay(pairs, { deletionPolicy: "refuse" });
  assert.ok(strict.buckets.refused >= lenient.buckets.refused, "refuse-deletions cannot refuse less");
  assert.equal(strict.buckets.verifier, 0, "under refuse-deletions nothing is left for the verifier");
});

test("replayPair judges against the mechanically repaired base, as the pipeline does", () => {
  // A candidate that merely echoes the mechanical repair is "unchanged" to the pipeline,
  // which validates against the repaired base — but judged against the RAW source it
  // looks like a real edit and would be scored as one, crediting the model with the
  // mechanical pass's work. This pair is the discriminator: opposite verdicts.
  const source = "on monday we shipped it .";
  const echo = "On Monday we shipped it.";
  assert.deepEqual(
    replayPair(source, echo, { mechanics: true }),
    { bucket: "refused", reason: "unchanged", stage: "validator" },
  );
  assert.equal(replayPair(source, echo, { mechanics: false }).bucket, "accepted");
});

test("wilson intervals bracket the point estimate and stay in range", () => {
  for (const [k, n] of [[42, 118], [0, 118], [118, 118], [1, 3]]) {
    const { low, high } = wilson(k, n);
    assert.ok(low >= 0 && high <= 1, `interval out of range for ${k}/${n}`);
    assert.ok(low <= k / n && k / n <= high, `interval does not bracket ${k}/${n}`);
  }
  assert.deepEqual(wilson(0, 0), { low: 0, high: 0 });
  // The n=118 interval is about ±9 points, which is why single-digit changes in the
  // buckets are not evidence on their own.
  const { low, high } = wilson(42, 118);
  assert.ok(high - low > 0.15 && high - low < 0.20, `unexpected interval width ${high - low}`);
});

// --------------------------------------------------------------------- labels
//
// bench/corpus/oracle-labels.json records, for every refusal the oracle produces on
// Grammarly's own rewrites, whether the project refuses it ON PURPOSE. It was committed
// before any guard was touched, precisely so that later guard work cannot quietly
// redefine a deliberate policy difference as a bug in order to move the number.

const LABELS = fileURLToPath(new URL("../bench/corpus/oracle-labels.json", import.meta.url));
const labelFile = JSON.parse(await readFile(LABELS, "utf8"));

test("every labelled row is a real pair in the corpus", () => {
  const byOriginal = new Map(pairs.map((pair) => [pair.original, pair]));
  for (const row of labelFile.labels) {
    const pair = byOriginal.get(row.original);
    assert.ok(pair, `labelled row is not in the corpus: ${row.original}`);
    assert.equal(pair.grammarly, row.grammarly, "the labelled rewrite has drifted from the corpus");
  }
});

test("ALIGNED refusals stay refused — these are the deliberate policy differences", () => {
  const aligned = labelFile.labels.filter((row) => row.label === "ALIGNED");
  assert.ok(aligned.length >= 17, `the aligned set shrank to ${aligned.length}; re-label deliberately, never silently`);
  for (const row of aligned) {
    const verdict = replayPair(row.original, row.grammarly);
    assert.equal(verdict.bucket, "refused",
      `an ALIGNED refusal (${row.ground}) was unlocked: ${row.original}`);
  }
});

test("every ALIGNED row names the ground it is aligned on", () => {
  const grounds = new Set(["agent-invention", "certainty-raised", "vocabulary", "quantity/entity", "dialect"]);
  for (const row of labelFile.labels.filter((r) => r.label === "ALIGNED")) {
    assert.ok(grounds.has(row.ground), `unknown ground "${row.ground}" for: ${row.original}`);
    assert.ok(row.note.length > 0, `ALIGNED row carries no rationale: ${row.original}`);
  }
});

// ---------------------------------------------------------- false-unlock control
//
// The counterweight to the oracle. Raising the oracle's number is trivial if you are
// willing to loosen guards, and that is precisely how a meaning-inversion hole gets
// built — so every guard change is judged on BOTH sides: refusals reached, against
// refusals wrongly unlocked. bench/results/*.json records `rejectedText` for every
// model rewrite the gate has ever refused, which is real 2B output on real prose,
// including the inversions that motivated the guards in the first place.

import { collectRefusals, verdictsFor } from "../bench/unlock-check.mjs";

const BASELINE = fileURLToPath(new URL("../bench/corpus/refusal-baseline.json", import.meta.url));
const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
const recordedRefusals = await collectRefusals();

test("no recorded refusal has been silently unlocked", async () => {
  const current = verdictsFor(recordedRefusals);
  const unlocked = [];
  for (const item of recordedRefusals) {
    const was = baseline.verdicts[item.id];
    if (was === undefined || was.startsWith("accepted")) continue;
    if (current[item.id].startsWith("accepted")) unlocked.push(`${item.source}\n    -> ${item.candidate}`);
  }
  assert.deepEqual(unlocked, [],
    "a guard change unlocked a rewrite the gate previously refused; hand-check each, then "
    + "regenerate with `node bench/unlock-check.mjs --write` if they are genuinely safe");
});

test("the baseline still covers every recorded refusal", () => {
  const missing = recordedRefusals.filter((item) => baseline.verdicts[item.id] === undefined);
  assert.deepEqual(missing.map((m) => m.source), [],
    "new benchmark results landed without refreshing the refusal baseline");
});

// ---------------------------------------------------------- precision control
//
// The half of the measurement that was missing. Everything above asks about REFUSALS:
// which ones the gate reaches, and whether a change wrongly opened one. Nothing asked
// whether a suggestion the gate ACCEPTED was correct — a surfaced rewrite on a
// rewrite-expected row is scored as a win by bench/score.mjs and never looked at again.
//
// That is not a theoretical gap. "The service writes nothing to the primary." -> "The
// service writes to the primary." was accepted outright and would have counted as a
// recall success everywhere. The false-unlock control could not see it either: that
// control is differential, and notices only what STOPS being refused, so a hole present
// since the first commit is invisible to it.
//
// bench/corpus/accepted-labels.json holds a hand reading of all 274 rewrites the project
// has recorded as accepted. These tests hold the gate to it.

import { collectAccepted, verdictsFor as acceptedVerdicts, readLabels, classify } from "../bench/precision-check.mjs";

const PRECISION_BASELINE = fileURLToPath(new URL("../bench/corpus/precision-baseline.json", import.meta.url));
const precisionBaseline = JSON.parse(await readFile(PRECISION_BASELINE, "utf8"));
const recordedAccepted = await collectAccepted();
const acceptedLabels = await readLabels();

test("no meaning-changing rewrite is NEWLY accepted", async () => {
  const report = classify(recordedAccepted, acceptedVerdicts(recordedAccepted), acceptedLabels, precisionBaseline);
  assert.deepEqual(
    report.newDefects.map((row) => `[${row.ground}] ${row.source}\n    -> ${row.replacement}`), [],
    "a change made the gate accept a rewrite hand-labelled as meaning-changing",
  );
});

test("a closed defect never reopens", async () => {
  // Once a CHANGED row stops being accepted and the baseline records it, returning to
  // accepted is caught by the test above — this pins the direction of travel explicitly
  // so the count cannot drift upward unnoticed.
  const report = classify(recordedAccepted, acceptedVerdicts(recordedAccepted), acceptedLabels, precisionBaseline);
  const standing = report.defects.length;
  const recorded = [...acceptedLabels.values()]
    .filter((row) => row.label === "CHANGED" && row.bucket === "accepted").length;
  assert.ok(standing <= recorded,
    `standing defects rose from ${recorded} to ${standing}; each new one must be hand-read`);
});

test("every labelled accepted rewrite names its ground when it is CHANGED", () => {
  const missing = [...acceptedLabels.values()]
    .filter((row) => row.label === "CHANGED" && !row.ground);
  assert.deepEqual(missing.map((row) => row.source), []);
});

test("the precision baseline still covers every recorded accepted rewrite", () => {
  const missing = recordedAccepted.filter((item) => precisionBaseline.verdicts[item.id] === undefined);
  assert.deepEqual(missing.map((m) => m.source), [],
    "new benchmark results landed without refreshing the precision baseline");
});
