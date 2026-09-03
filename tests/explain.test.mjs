// The explanation must describe the edit that was actually made. Every word it quotes
// has to come from the diff, and no change may go unmentioned.
import test from "node:test";
import assert from "node:assert/strict";
import { explainEdit } from "../src/explain.mjs";
import { diffWords } from "../src/diff.mjs";

const PAIRS = [
  ["The logistics team carried out an evaluation of the packaging supplier.", "The logistics team evaluated the packaging supplier."],
  ["Guidance, navigation and control subsystems data were reviewed, and it appears that the subsystems performed properly.", "Guidance, navigation, and control subsystems data were reviewed, and it appears the subsystems performed properly."],
  ["The batch of castings were rejected at goods-in.", "The batch of castings was rejected at goods-in."],
  ["The outage will effect the overnight run.", "The outage will affect the overnight run."],
  ["The results of the test were completely and totally inconclusive.", "The results of the test were inconclusive."],
  ["In the event that the power fails, the backup will start automatically.", "If the power fails, the backup will start automatically."],
  ["on tuesday the electrician tested the bonding.", "On Tuesday the electrician tested the bonding."],
  ["We reconcile the ledger on a quarterly basis.", "We reconcile the ledger quarterly."],
  ["The chemist is of the opinion that the batch is sound.", "The chemist believes the batch is sound."],
  ["He submitted claim without the receipts.", "He submitted the claim without receipts."],
  ["Due to the late release, we cannot show a demo.", "Because of the late release, we cannot show a demo."],
  ["Each of the valves require an annual inspection.", "Each valve requires an annual inspection."],
];

test("every quoted phrase comes from the text, not from the model", () => {
  for (const [source, replacement] of PAIRS) {
    const text = explainEdit(source, replacement);
    assert.ok(text, `no explanation for: ${source}`);
    const quoted = [...text.matchAll(/“([^”]+)”/gu)].map((match) => match[1]);
    assert.ok(quoted.length > 0, `nothing quoted in: ${text}`);
    for (const phrase of quoted) {
      assert.ok(
        source.includes(phrase) || replacement.includes(phrase),
        `explanation quotes ${JSON.stringify(phrase)} which appears in neither version: ${text}`,
      );
    }
  }
});

test("an unchanged sentence is never described as changed", () => {
  assert.equal(explainEdit("The launch begins tomorrow.", "The launch begins tomorrow."), "");
});

test("names the actual kind of each edit", () => {
  assert.match(explainEdit("The outage will effect the run.", "The outage will affect the run."), /corrects “effect” to “affect”/iu);
  assert.match(explainEdit("The batch were rejected.", "The batch was rejected."), /“were” to “was” to match the subject/u);
  assert.match(explainEdit("on tuesday we met.", "On Tuesday we met."), /capitalizes “On” and “Tuesday”/iu);
  assert.match(explainEdit("We audit it on a monthly basis.", "We audit it monthly."), /shortens “on a monthly basis” to “monthly”/iu);
  assert.match(explainEdit("Guidance, navigation and control data.", "Guidance, navigation, and control data."), /adds a comma/iu);
});

test("a change the diff shows is never left unmentioned", () => {
  for (const [source, replacement] of PAIRS) {
    const changed = diffWords(source, replacement).filter((op) => op.type !== "equal").length;
    const text = explainEdit(source, replacement);
    if (changed > 0) assert.ok(text.length > 0, `silent about ${changed} changes: ${source}`);
  }
});

test("a decision truncated at the reason field still parses", async () => {
  const { completeTruncatedJSON, REASON_STOP } = await import("../src/engine.mjs");
  const { parseDecision } = await import("../src/contract.mjs");
  assert.equal(REASON_STOP, ',"reason"');
  const keep = completeTruncatedJSON('{"action":"keep","replacement":""');
  assert.deepEqual(parseDecision(keep), { action: "keep", replacement: "", reason: "" });
  const rewrite = completeTruncatedJSON('{"action":"rewrite","replacement":"A shorter sentence."');
  assert.deepEqual(parseDecision(rewrite),
    { action: "rewrite", replacement: "A shorter sentence.", reason: "" });
  // A complete object is left alone.
  const whole = '{"action":"keep","replacement":"","reason":"Clear."}';
  assert.equal(completeTruncatedJSON(whole), whole);
});

test("a quoted phrase is the text as written, not tokens rejoined with spaces", () => {
  const cases = [
    ["The big, red truck arrived at the depot.", "The truck arrived at the depot."],
    ["The report, which was long, was filed.", "The report was filed."],
    ["We reviewed the draft; then we signed it.", "We reviewed the draft and signed it."],
    ...PAIRS,
  ];
  for (const [source, replacement] of cases) {
    const text = explainEdit(source, replacement);
    for (const phrase of [...text.matchAll(/“([^”]+)”/gu)].map((match) => match[1])) {
      assert.ok(
        source.includes(phrase) || replacement.includes(phrase),
        `explanation quotes ${JSON.stringify(phrase)} which appears in neither version: ${text}`,
      );
    }
  }
  assert.match(explainEdit("The big, red truck arrived at the depot.", "The truck arrived at the depot."),
    /[Rr]emoves “big, red”/u);
});

test("a lowering is not described as a capitalisation", () => {
  assert.match(explainEdit("The dog is here.", "the dog is here."), /[Ll]owercases “the”/u);
  assert.match(explainEdit("the dog is here.", "The dog is here."), /[Cc]apitalizes “The”/u);
  assert.match(explainEdit("On Monday The Team met.", "On Monday the team met."),
    /[Ll]owercases “the” and “team”/u);
});
