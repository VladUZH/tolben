// Adversarial matrix for the deterministic safety gate.
//
// A clarity rewriter is only as trustworthy as its refusals. The recent review found
// meaning-inversion holes by hand — hired/fired, at least/at most, 50%/50, v2/v3 were all
// accepted once — so this file codifies the whole space instead of sampling it: every row
// pins the exact outcome, so a regression that starts accepting an inversion (or starts
// refusing an ordinary repair) fails here rather than reaching a writer's screen.
//
// Two tables of comparable size, because both failure directions are real. Accepting a
// meaning change corrupts what the writer said; refusing a legitimate repair makes the
// product useless. Neither table asserts "does not crash" — every row names the outcome.
//
// Where probing found a genuine hole, it is recorded as a `todo` test asserting the
// behaviour the gate SHOULD have, with the one-line repro in a comment. Those are marked
// KNOWN-GAP, do not fail the suite, and start passing the day the gap is closed. No
// production source was changed to make anything here green.

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRewrite,
  lostContentWords,
  deletesTrailingPhrase,
  REJECTION_REASONS,
} from "../src/safety.mjs";
import { NEVER_VERIFY } from "../src/pipeline.mjs";

const rewrite = (replacement, reason = "A restrained edit.") =>
  ({ action: "rewrite", replacement, reason });

const ACCEPTED = "ACCEPTED";

// Runs a table and compares the whole outcome map at once: a failure names every row that
// moved, not just the first, which is what makes a regression in a shared rule legible.
function outcomes(rows) {
  const actual = {};
  const expected = {};
  for (const [source, candidate, reason] of rows) {
    const key = `${source}  ⇒  ${candidate}`;
    const result = validateRewrite(source, rewrite(candidate));
    actual[key] = result.accepted ? ACCEPTED : result.reason;
    expected[key] = reason;
  }
  return { actual, expected };
}

const rejects = (name, rows) =>
  test(`MUST-REJECT ${name} (${rows.length} cases)`, () => {
    const { actual, expected } = outcomes(rows);
    assert.deepEqual(actual, expected);
  });

const accepts = (name, rows) =>
  test(`MUST-ACCEPT ${name} (${rows.length} cases)`, () => {
    const { actual, expected } = outcomes(rows.map(([s, c]) => [s, c, ACCEPTED]));
    assert.deepEqual(actual, expected);
    // An acceptance has to hand back the candidate verbatim, trimmed — a gate that
    // accepted while returning something else would pass the map check above.
    for (const [source, candidate] of rows) {
      assert.deepEqual(
        validateRewrite(source, rewrite(candidate)),
        { accepted: true, reason: "accepted", replacement: candidate.trim() },
        `${source} ⇒ ${candidate}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// MUST-REJECT: the candidate changes what the sentence claims.
// ---------------------------------------------------------------------------

const NEGATION_FLIPS = [
  ["The service did not restart after the upgrade.", "The service restarted after the upgrade.", "negation-changed"],
  ["The service restarted after the upgrade.", "The service did not restart after the upgrade.", "negation-changed"],
  ["The account cannot be closed today.", "The account can be closed today.", "negation-changed"],
  ["The change is not required before launch.", "The change is required before launch.", "negation-changed"],
  ["The build finished without warnings.", "The build finished with warnings.", "negation-changed"],
  ["He isn't attending the review.", "He is attending the review.", "negation-changed"],
  ["Do not restart the service.", "Restart the service.", "negation-changed"],
  ["The device is not compatible with the dock.", "The device is incompatible with the dock.", "negation-changed"],
  ["The device is incompatible with the dock.", "The device is not compatible with the dock.", "negation-changed"],
  ["The valve never leaks under pressure.", "The valve leaks under pressure.", "quantifier-changed"],
  ["The valve leaks under pressure.", "The valve never leaks under pressure.", "quantifier-changed"],
  ["We found no defects in the batch.", "We found defects in the batch.", "quantifier-changed"],
  ["Neither driver reported an error.", "Either driver reported an error.", "quantifier-changed"],
  ["No one approved the change.", "Someone approved the change.", "quantifier-changed"],
  // un-/in- prefix swaps: caught as an unsourced substitution rather than as a negation.
  ["The door is locked during the audit.", "The door is unlocked during the audit.", "word-substituted"],
  ["The door is unlocked during the audit.", "The door is locked during the audit.", "word-substituted"],
  ["The report is complete and signed.", "The report is incomplete and signed.", "word-substituted"],
  ["The claim was verified by the team.", "The claim was unverified by the team.", "word-substituted"],
  ["The file is unreadable on the share.", "The file is readable on the share.", "word-substituted"],
  ["The user disliked the layout.", "The user liked the layout.", "word-substituted"],
  ["The flag is disabled in production.", "The flag is enabled in production.", "word-substituted"],
  ["The result is inconsistent across runs.", "The result is consistent across runs.", "word-substituted"],
  // Was "word-substituted": the negation tally did not recognise "nothing" as negative,
  // so the inversion was caught only by the vocabulary guard, incidentally.
  ["Nothing was lost in the transfer.", "Something was lost in the transfer.", "negation-changed"],
];

const MODALITY_FLIPS = [
  ["Maya may ship the build tonight.", "Maya will ship the build tonight.", "certainty-changed"],
  ["Maya will ship the build tonight.", "Maya may ship the build tonight.", "certainty-changed"],
  ["The operator must sign the form.", "The operator should sign the form.", "certainty-changed"],
  ["The operator should sign the form.", "The operator must sign the form.", "certainty-changed"],
  ["The team can restore the archive.", "The team must restore the archive.", "certainty-changed"],
  ["The vendor might delay the shipment.", "The vendor will delay the shipment.", "certainty-changed"],
  ["Engineers are required to log the change.", "Engineers may log the change.", "certainty-changed"],
  ["The system should retry the request.", "The system will retry the request.", "certainty-changed"],
  ["The device could overheat under load.", "The device would overheat under load.", "certainty-changed"],
  ["We recommend a second review.", "We require a second review.", "certainty-changed"],
  ["Users must reset the token.", "Users may reset the token.", "certainty-changed"],
  ["The change is mandatory for all users.", "The change is optional for all users.", "certainty-changed"],
  ["The system guarantees delivery.", "The system attempts delivery.", "certainty-changed"],
  // Hedges are commitments too: dropping or adding one moves the claim.
  ["It is possible that the job stalls.", "The job stalls.", "certainty-changed"],
  ["The job stalls.", "It is possible that the job stalls.", "certainty-changed"],
  ["It seems the disk is failing.", "The disk is failing.", "certainty-changed"],
  ["The disk is failing.", "It seems the disk is failing.", "certainty-changed"],
  ["The results roughly match the model.", "The results match the model.", "certainty-changed"],
  ["The results appear to match the model.", "The results match the model.", "certainty-changed"],
  ["The results match the model.", "The results roughly match the model.", "certainty-changed"],
  ["The vendor is unable to ship today.", "The vendor is able to ship today.", "word-substituted"],
  ["The team is likely to finish today.", "The team is unlikely to finish today.", "word-substituted"],
];

const QUANTIFIER_FLIPS = [
  ["All drivers reported the fault.", "Some drivers reported the fault.", "quantifier-changed"],
  ["Some drivers reported the fault.", "All drivers reported the fault.", "quantifier-changed"],
  ["Every sensor needs recalibration.", "Any sensor needs recalibration.", "quantifier-changed"],
  ["Both engineers signed the report.", "Either engineer signed the report.", "quantifier-changed"],
  ["None of the checks failed.", "Some of the checks failed.", "quantifier-changed"],
  ["The script deletes all temporary files.", "The script deletes temporary files.", "quantifier-changed"],
  // least/most: the pair the review found accepted once.
  ["The backup takes at least ten minutes.", "The backup takes at most ten minutes.", "quantifier-changed"],
  ["Many customers renewed the contract.", "Few customers renewed the contract.", "quantifier-changed"],
  ["Few customers renewed the contract.", "Many customers renewed the contract.", "quantifier-changed"],
  ["Most drivers reported the fault.", "Several drivers reported the fault.", "quantifier-changed"],
  ["We reviewed several drafts.", "We reviewed a few drafts.", "quantifier-changed"],
  ["The sensor always reports the fault.", "The sensor never reports the fault.", "quantifier-changed"],
  ["The sensor never reports the fault.", "The sensor always reports the fault.", "quantifier-changed"],
  ["The sensor often reports the fault.", "The sensor rarely reports the fault.", "quantifier-changed"],
  ["The alert fires sometimes.", "The alert fires often.", "quantifier-changed"],
  ["The alert fires usually.", "The alert fires always.", "quantifier-changed"],
  ["Only the lead approves the merge.", "The lead approves the merge.", "quantifier-changed"],
  ["The lead approves the merge.", "Only the lead approves the merge.", "quantifier-changed"],
  ["The job takes about ten minutes.", "The job takes ten minutes.", "quantifier-changed"],
  ["Approximately ten units shipped.", "Exactly ten units shipped.", "name-changed"],
];

const WORD_SUBSTITUTIONS = [
  // The canonical hole: one edit apart, opposite meanings.
  ["The vendor hired the contractor last week.", "The vendor fired the contractor last week.", "word-substituted"],
  ["The vendor fired the contractor last week.", "The vendor hired the contractor last week.", "word-substituted"],
  ["Revenue increased during the quarter.", "Revenue decreased during the quarter.", "word-substituted"],
  ["The team accepted the proposal.", "The team rejected the proposal.", "word-substituted"],
  ["The password expired on Tuesday.", "The password passed on Tuesday.", "word-substituted"],
  ["The instructions were confusing to readers.", "The instructions were clear to readers.", "word-substituted"],
  ["We enabled the feature for testers.", "We disabled the feature for testers.", "word-substituted"],
  ["The valve opens under pressure.", "The valve closes under pressure.", "word-substituted"],
  ["The migration succeeded overnight.", "The migration failed overnight.", "word-substituted"],
  ["The build is stable on the branch.", "The build is unstable on the branch.", "word-substituted"],
  ["The fee includes shipping.", "The fee excludes shipping.", "word-substituted"],
  ["The technician replaced the gasket.", "The technician replaced the bearing.", "word-substituted"],
  ["The technician replaced the gasket.", "The technician inspected the gasket.", "word-substituted"],
  ["Ten of the twelve nodes recovered.", "Ten of the twenty nodes recovered.", "word-substituted"],
  // A rewrite may not add a claim the source never made.
  ["The build failed.", "The build failed twice.", "word-substituted"],
];

const ENTITY_SWAPS = [
  ["Maya reviewed the release notes.", "Nadia reviewed the release notes.", "name-changed"],
  ["Contact Priya about the invoice.", "Contact Sanjay about the invoice.", "name-changed"],
  ["Ask Dr. Chen about the sample.", "Ask Dr. Patel about the sample.", "name-changed"],
  ["London hosted the summit.", "Berlin hosted the summit.", "name-changed"],
  ["The Falcon decoder handles the stream.", "The Hawk decoder handles the stream.", "name-changed"],
  ["The build ran on Ubuntu overnight.", "The build ran on Debian overnight.", "name-changed"],
  ["The service runs on PostgreSQL.", "The service runs on MySQL.", "name-changed"],
  ["The workshop starts on Wednesday.", "The workshop starts on Thursday.", "name-changed"],
  ["The meeting is on Monday morning.", "The meeting is on Tuesday morning.", "name-changed"],
  ["The contract renews in March.", "The contract renews in April.", "name-changed"],
  ["The audit begins in January.", "The audit begins in February.", "name-changed"],
  // Product identifiers, mixed case and snake case, land on the protected-token rule.
  ["Deploy API_V2 to the cluster.", "Deploy API_V3 to the cluster.", "protected-token-changed"],
  ["The iPhone14 shipped without a charger.", "The iPhone15 shipped without a charger.", "protected-token-changed"],
  ["Order the Pixel7 handset today.", "Order the Pixel8 handset today.", "protected-token-changed"],
  ["Ship the Model3 units today.", "Ship the Model5 units today.", "protected-token-changed"],
  ["The release is tagged v2 in the repository.", "The release is tagged v3 in the repository.", "protected-token-changed"],
  ["Use the ACME_TOKEN variable.", "Use the ACME_SECRET variable.", "protected-token-changed"],
  ["The GDPR clause applies here.", "The CCPA clause applies here.", "protected-token-changed"],
  ["The API returned a 500 error.", "The interface returned a 500 error.", "protected-token-changed"],
  ["Set the retry_limit value to 5.", "Set the retryLimit value to 5.", "protected-token-changed"],
  // Splitting an identifier is a rename, even though every character survives.
  ["Deploy iPhone14 firmware tonight.", "Deploy iPhone 14 firmware tonight.", "numbers-changed"],
];

const NUMBER_AND_UNIT_CHANGES = [
  ["Restore 18 files before noon.", "Restore 19 files before noon.", "numbers-changed"],
  ["The task takes 3.5 hours to finish.", "The task takes 3.6 hours to finish.", "numbers-changed"],
  ["The quota is 100 requests per minute.", "The quota is 1000 requests per minute.", "numbers-changed"],
  ["The bar reached 12.5 kg today.", "The bar reached 12.6 kg today.", "numbers-changed"],
  // The percent sign is part of the quantity: dropping it is not a formatting tidy-up.
  ["Adoption grew by 50% this quarter.", "Adoption grew by 50 this quarter.", "numbers-changed"],
  ["Adoption grew by 50% this quarter.", "Adoption grew by 60% this quarter.", "numbers-changed"],
  ["The invoice totals $1,200 for the month.", "The invoice totals $1,300 for the month.", "numbers-changed"],
  ["The fee is €40 per seat.", "The fee is €50 per seat.", "numbers-changed"],
  ["The meeting begins at 14:30 sharp.", "The meeting begins at 15:30 sharp.", "numbers-changed"],
  ["The report covers 2023 results.", "The report covers 2024 results.", "numbers-changed"],
  ["Version 1.2 is deprecated now.", "Version 1.3 is deprecated now.", "numbers-changed"],
  ["The audit covers the 3rd quarter.", "The audit covers the 4th quarter.", "numbers-changed"],
  ["The signal held at 50 Hz.", "The signal held at 60 Hz.", "numbers-changed"],
  ["The sample froze at 4 °C overnight.", "The sample froze at 5 °C overnight.", "numbers-changed"],
  ["See the finding in [12] for detail.", "See the finding in [13] for detail.", "numbers-changed"],
  ["The finding is documented in [12].", "The finding is documented.", "numbers-changed"],
  ["What is the current queue depth?", "The queue depth is 12.", "numbers-changed"],
  // Same number, different unit: the quantity changed by three orders of magnitude.
  ["The cable measures 3 m in length.", "The cable measures 3 cm in length.", "protected-token-changed"],
  ["The timeout is set to 500 ms today.", "The timeout is set to 500 s today.", "protected-token-changed"],
  ["The drive holds 2 TB of data.", "The drive holds 2 GB of data.", "protected-token-changed"],
  ["It ran for 2 min and stopped.", "It ran for 2 h and stopped.", "protected-token-changed"],
  ["The job runs at 09:00 UTC.", "The job runs at 09:00 PST.", "protected-token-changed"],
];

const REFERENCE_EDITS = [
  ["Read https://example.test/a for detail.", "Read https://example.test/b for detail.", "protected-token-changed"],
  ["Read https://example.test/a for detail.", "Read https://example.test/a/ for detail.", "protected-token-changed"],
  ["Read https://example.test/a for detail.", "Read the page for detail.", "protected-token-changed"],
  ["Email ops@example.test before Friday.", "Email help@example.test before Friday.", "protected-token-changed"],
  ["Email ops@example.test before Friday.", "Email the team before Friday.", "protected-token-changed"],
  ["Open /srv/reports/q4.csv today.", "Open /srv/reports/q3.csv today.", "protected-token-changed"],
  ["Open /srv/reports/q4.csv today.", "Open the report today.", "protected-token-changed"],
  ["Open the file report.csv before noon.", "Open the file report.json before noon.", "protected-token-changed"],
  ["Copy C:\\data\\input.txt to the share.", "Copy C:\\data\\output.txt to the share.", "protected-token-changed"],
];

const TENSE_FLIPS = [
  ["The service stopped yesterday afternoon.", "The service stops yesterday afternoon.", "tense-changed"],
  ["The team ships the build tonight.", "The team shipped the build tonight.", "tense-changed"],
  ["We have reviewed the draft already.", "We review the draft already.", "tense-changed"],
  ["The vendor delivered the parts.", "The vendor delivers the parts.", "tense-changed"],
  ["The report will land on Friday.", "The report lands on Friday.", "certainty-changed"],
  ["Delete the temporary files now.", "Deleted the temporary files now.", "name-changed"],
];

const SENTENCE_TYPE_CHANGES = [
  ["Could the backup finish before noon?", "The backup could finish before noon.", "question-changed"],
  ["The backup could finish before noon.", "Could the backup finish before noon?", "question-changed"],
  ["Is the archive ready for review?", "The archive is ready for review.", "question-changed"],
  ["The backup finished before noon.", "The backup finished before noon!", "terminal-punctuation-changed"],
  ["The team met yesterday!", "The team met yesterday.", "terminal-punctuation-changed"],
  ["The build failed.", "The build failed…", "terminal-punctuation-changed"],
  ["The team met yesterday.", "The team met yesterday", "terminal-punctuation-changed"],
];

const CLAUSE_DELETIONS = [
  ["The archive is stored offsite, and the index is stored locally.", "The archive is stored offsite.", "content-dropped"],
  ["We paused the rollout because the metrics regressed.", "We paused the rollout.", "content-dropped"],
  ["The sensor logs temperature and the valve logs pressure.", "The sensor logs temperature.", "content-dropped"],
  ["The alarm sounds when the pressure exceeds the limit.", "The alarm sounds.", "content-dropped"],
  ["The review was brief, but thorough.", "The review was brief and thorough.", "content-dropped"],
  ["If the build fails, the deploy is cancelled.", "The deploy is cancelled.", "content-dropped"],
  ["Restart the service if the queue stalls.", "Restart the service.", "content-dropped"],
  // An imperative that gets obeyed instead of rewritten.
  ["Delete every temporary file in the cache.", "Deleted.", "name-changed"],
  ["Send the file to the vendor.", "Send it.", "excessive-edit"],
  ["The team met.", "The group of individuals assembled together.", "excessive-edit"],
];

// Meaning changes that leave the bag of words alone. Every check in the gate used to be a
// count or a set, so a candidate that only moved words — or that swapped two words drawn
// from the same closed class — passed all of them. The rows below name the rule that now
// catches each shape, so a regression that reopens one is legible.
const ORDER_AND_ROLE_SWAPS = [
  ["Priya emailed Maya about the invoice.", "Maya emailed Priya about the invoice.", "name-changed"],
  ["The client billed the vendor.", "The vendor billed the client.", "order-changed"],
  ["The alert followed the outage.", "The outage followed the alert.", "order-changed"],
  ["Move the pump from the rack to the bench.", "Move the pump from the bench to the rack.", "order-changed"],
  // Moving a scope-taking quantifier is a claim change, not a tidy-up.
  ["The team ships only on Fridays.", "The team only ships on Fridays.", "order-changed"],
  ["Pay $40 to the vendor and $60 to the client.", "Pay $60 to the vendor and $40 to the client.", "numbers-changed"],
  ["The release lands before the audit.", "The release lands after the audit.", "direction-changed"],
  ["Hold the badge until the audit closes.", "Hold the badge since the audit closes.", "direction-changed"],
  ["Bring the laptop and the badge.", "Bring the laptop or the badge.", "direction-changed"],
  ["He approved the invoice yesterday.", "She approved the invoice yesterday.", "pronoun-changed"],
  ["We signed the waiver on arrival.", "They signed the waiver on arrival.", "pronoun-changed"],
  ["The fourth attempt succeeded.", "The third attempt succeeded.", "quantifier-changed"],
  ["The fee is $40 per seat.", "The fee is £40 per seat.", "protected-token-changed"],
  ["Nearly all nodes recovered.", "All nodes recovered.", "certainty-changed"],
  ["We failed to file the report.", "We filed the report.", "negation-changed"],
  ["The drive rebooted overnight.", "The drives rebooted overnight.", "word-substituted"],
];

const REPLY_ARTEFACTS = [
  ["The team met yesterday.", "Here is a better version: The team convened.", "instruction-output"],
  ["The team met yesterday.", "Certainly! Rewritten sentence: The team convened.", "instruction-output"],
  ["The team met yesterday.", "Sure, here's the revision: The team convened.", "instruction-output"],
  ["The team met yesterday.", "Improved: The team convened.", "instruction-output"],
  ["The team met yesterday.", "Output: The team convened.", "instruction-output"],
  ["The team met yesterday.", "Revised sentence: The team convened.", "instruction-output"],
  ["The team met yesterday.", "Okay, here is the result: The team convened.", "instruction-output"],
  ["The team met yesterday.", "First sentence. Second sentence.", "multiple-sentences"],
  ["Original sentence.", "", "empty"],
  ["Original sentence.", "   ", "empty"],
  ["Original sentence.", "Original sentence.", "unchanged"],
];

rejects("negation flips", NEGATION_FLIPS);
rejects("modality flips", MODALITY_FLIPS);
rejects("quantifier flips", QUANTIFIER_FLIPS);
rejects("antonym and unrelated-word substitutions", WORD_SUBSTITUTIONS);
rejects("entity and identifier swaps", ENTITY_SWAPS);
rejects("number, unit, date, percent, currency and time changes", NUMBER_AND_UNIT_CHANGES);
rejects("URL, path, email and citation edits", REFERENCE_EDITS);
rejects("tense flips", TENSE_FLIPS);
rejects("statement/question and terminal punctuation changes", SENTENCE_TYPE_CHANGES);
rejects("clause deletion and obeyed imperatives", CLAUSE_DELETIONS);
rejects("word order, direction words, pronouns and money", ORDER_AND_ROLE_SWAPS);
rejects("instruction-style and malformed output", REPLY_ARTEFACTS);

const MUST_REJECT_TABLES = [
  NEGATION_FLIPS, MODALITY_FLIPS, QUANTIFIER_FLIPS, WORD_SUBSTITUTIONS, ENTITY_SWAPS,
  NUMBER_AND_UNIT_CHANGES, REFERENCE_EDITS, TENSE_FLIPS, SENTENCE_TYPE_CHANGES,
  CLAUSE_DELETIONS, ORDER_AND_ROLE_SWAPS, REPLY_ARTEFACTS,
];

// A rewrite whose stated reason says nothing was wrong has contradicted itself, whatever
// the candidate looks like. Checked separately because the reason, not the text, decides.
test("MUST-REJECT reason contradicts action (5 cases)", () => {
  const source = "The team met yesterday.";
  const candidate = "The team convened yesterday.";
  for (const reason of [
    "The sentence is already clear and direct.",
    "No changes are needed here.",
    "It is already concise.",
    "This sentence is already correct.",
    "The original is already clear and direct, but here is a variant.",
  ]) {
    const result = validateRewrite(source, { action: "rewrite", replacement: candidate, reason });
    assert.deepEqual(result, { accepted: false, reason: "reason-contradicts-action" }, reason);
  }
});

test("MUST-REJECT anything that is not a rewrite decision (6 cases)", () => {
  for (const decision of [
    { action: "keep", replacement: "Something else.", reason: "" },
    { action: "explain", replacement: "Something else.", reason: "" },
    {},
    null,
    undefined,
    "rewrite",
  ]) {
    const result = validateRewrite("Original sentence.", decision);
    assert.deepEqual(result, { accepted: false, reason: "action-mismatch" }, JSON.stringify(decision));
  }
});

test("MUST-REJECT a non-string replacement", () => {
  for (const replacement of [42, null, undefined, {}, ["a"], true]) {
    const result = validateRewrite("Original sentence.", { action: "rewrite", replacement, reason: "x" });
    assert.deepEqual(result, { accepted: false, reason: "empty" }, JSON.stringify(replacement));
  }
});

test("caller-supplied protected terms are enforced on top of the built-in patterns", () => {
  const source = "The Falcon decoder follows the specification.";
  assert.deepEqual(
    validateRewrite(source, rewrite("The Hawk decoder follows the specification."), { protectedTerms: ["Falcon"] }),
    { accepted: false, reason: "protected-token-changed" },
  );
  // A term the source never contained cannot make an otherwise clean edit fail.
  const clean = validateRewrite(
    "We conducted a review of the draft.",
    rewrite("We reviewed the draft."),
    { protectedTerms: ["Falcon"] },
  );
  assert.equal(clean.accepted, true);
});

test("every rejection uses a documented reason and returns no replacement", () => {
  const seen = new Set();
  for (const table of MUST_REJECT_TABLES) {
    for (const [source, candidate] of table) {
      const result = validateRewrite(source, rewrite(candidate));
      assert.equal(result.accepted, false, `${source} ⇒ ${candidate}`);
      assert.ok(
        REJECTION_REASONS.includes(result.reason),
        `undocumented reason ${result.reason} for ${source} ⇒ ${candidate}`,
      );
      assert.equal(result.replacement, undefined, `${source} ⇒ ${candidate}`);
      seen.add(result.reason);
    }
  }
  // The matrix has to exercise the vocabulary, not just a corner of it.
  assert.ok(seen.size >= 14, `matrix only reached ${seen.size} distinct reasons: ${[...seen].sort()}`);
});

test("the must-reject matrix has no duplicate rows", () => {
  const keys = MUST_REJECT_TABLES.flat().map(([s, c]) => `${s}\u0000${c}`);
  assert.deepEqual(keys.length, new Set(keys).size);
});

// ---------------------------------------------------------------------------
// MUST-ACCEPT: the candidate is a repair, and refusing it makes the tool useless.
// ---------------------------------------------------------------------------

const NOMINALISATION_REDUCTIONS = [
  ["We conducted a review of the draft.", "We reviewed the draft."],
  ["They performed an analysis of the logs.", "They analysed the logs."],
  ["The board reached a decision on the budget.", "The board decided on the budget."],
  ["We carried out an inspection of the valve.", "We inspected the valve."],
  ["He gave an explanation of the delay.", "He explained the delay."],
  ["The vendor provided confirmation of the order.", "The vendor confirmed the order."],
  ["We made a comparison of the two drafts.", "We compared the two drafts."],
  ["The auditor made an assessment of the risk.", "The auditor assessed the risk."],
  ["We undertook an evaluation of the design.", "We evaluated the design."],
  ["The auditor gave approval to the change.", "The auditor approved the change."],
  ["The lab performed a calibration of the sensor.", "The lab calibrated the sensor."],
  ["The engineer carried out a repair of the valve.", "The engineer repaired the valve."],
  ["Management gave consideration to the proposal.", "Management considered the proposal."],
  ["The board made an investment in the plant.", "The board invested in the plant."],
  ["The office issued a reminder to the staff.", "The office reminded the staff."],
  ["The vendor offered an apology for the delay.", "The vendor apologised for the delay."],
  ["The auditor performed a verification of the totals.", "The auditor verified the totals."],
  ["The crew conducted an installation of the pump.", "The crew installed the pump."],
  ["The panel made a selection of three finalists.", "The panel selected three finalists."],
  ["We provided an update to the client.", "We updated the client."],
  ["He gave a description of the fault.", "He described the fault."],
  ["We came to the conclusion that the disk failed.", "We concluded that the disk failed."],
  ["The vendor sent a notification to the team.", "The vendor notified the team."],
  ["The team took a look at the logs.", "The team looked at the logs."],
  ["Please make a decision by Friday.", "Please decide by Friday."],
  ["The alarm is in operation during the audit.", "The alarm operates during the audit."],
  ["The system is in violation of the policy.", "The system violates the policy."],
  ["The clerk made a correction to the ledger.", "The clerk corrected the ledger."],
  ["The lab gave a demonstration of the rig.", "The lab demonstrated the rig."],
  ["We conducted an investigation of the outage.", "We investigated the outage."],
  ["The vendor made a submission of the form.", "The vendor submitted the form."],
  ["The crew performed a replacement of the seal.", "The crew replaced the seal."],
  ["The team made an adjustment to the schedule.", "The team adjusted the schedule."],
  ["He gave an authorisation for the transfer.", "He authorised the transfer."],
  ["The office made a distribution of the badges.", "The office distributed the badges."],
];

const STOCK_PHRASE_COMPRESSIONS = [
  ["The tool has the ability to recover 3 files.", "The tool can recover 3 files."],
  ["The tool has the capability to restore 5 files.", "The tool can restore 5 files."],
  ["The system is capable of handling the load.", "The system can handle the load."],
  ["The router is located in close proximity to the desk.", "The router is near the desk."],
  ["The pump sits in close proximity to the tank.", "The pump sits near the tank."],
  ["The valve is located near to the pump.", "The valve is near the pump."],
  ["The archive is copied on a weekly basis.", "The archive is copied weekly."],
  ["The backup runs on a nightly basis.", "The backup runs nightly."],
  ["The invoice is sent on a monthly basis.", "The invoice is sent monthly."],
  ["The audit happens on a quarterly basis.", "The audit happens quarterly."],
  ["The licence renews on a yearly basis.", "The licence renews yearly."],
  ["The log rotates on a daily basis.", "The log rotates daily."],
  ["We will ship it at a later point in time.", "We will ship it later."],
  ["We will decide at a later point in time.", "We will decide later."],
  ["Due to the fact that the disk failed, we stopped.", "Because the disk failed, we stopped."],
  ["Due to the fact that the queue stalled, we paused.", "Because the queue stalled, we paused."],
  ["The patch lands in the near future.", "The patch lands soon."],
  ["The fix ships in the near future.", "The fix ships soon."],
  ["In order to finish, we need the key.", "To finish, we need the key."],
  ["In order to proceed, we need the badge.", "To proceed, we need the badge."],
  ["We met for the purpose of planning the release.", "We met to plan the release."],
  ["We met for the purpose of reviewing the budget.", "We met to review the budget."],
  ["At the present time the queue is empty.", "Now the queue is empty."],
  ["At the present time the array is idle.", "Now the array is idle."],
  ["In the event that the disk fails, page the operator.", "If the disk fails, page the operator."],
  ["In spite of the fact that it rained, we shipped.", "Although it rained, we shipped."],
  ["With regard to the invoice, the totals match.", "The totals match."],
  ["In terms of cost, the plan is sound.", "The plan is sound."],
  ["The report is of a technical nature.", "The report is technical."],
  ["It is the case that the queue is empty.", "The queue is empty."],
  ["It is the case that the relay tripped.", "The relay tripped."],
  ["There are three bolts that require torque.", "Three bolts require torque."],
  ["There are two valves that need service.", "Two valves need service."],
  ["There is a fault that blocks the deploy.", "A fault blocks the deploy."],
  ["The change was made in a rapid manner.", "The change was made rapidly."],
  ["The audit runs on an annual basis.", "The audit runs annually."],
  ["The array sits in close proximity to the rack.", "The array sits near the rack."],
  ["We will file it at a later point in time.", "We will file it later."],
  ["Due to the fact that the relay tripped, we stopped.", "Because the relay tripped, we stopped."],
  ["The build lands in the near future.", "The build lands soon."],
  ["In order to sign, we need the badge.", "To sign, we need the badge."],
  ["It is the case that the pump failed.", "The pump failed."],
  ["There is a valve that needs a seal.", "A valve needs a seal."],
  ["The note is of an urgent nature.", "The note is urgent."],
  ["In the event that the pump stalls, call the operator.", "If the pump stalls, call the operator."],
];

const AGREEMENT_REPAIRS = [
  ["A set of revised drawings are attached.", "A set of revised drawings is attached."],
  ["A list of the parts are attached.", "A list of the parts is attached."],
  ["The set of drawings were revised.", "The set of drawings was revised."],
  ["The engineer accept the proposal.", "The engineer accepts the proposal."],
  ["The engineer sign the form daily.", "The engineer signs the form daily."],
  ["The queue are empty now.", "The queue is empty now."],
  ["The team are meeting at noon.", "The team is meeting at noon."],
  ["He have finished the task.", "He has finished the task."],
  ["She do not need the badge.", "She does not need the badge."],
  ["The valves needs a new seal.", "The valves need a new seal."],
  ["The reports was filed on time.", "The reports were filed on time."],
  ["Each of the nodes were restarted.", "Each of the nodes was restarted."],
  ["The effects of the change was small.", "The effects of the change were small."],
  ["The nodes was restarted overnight.", "The nodes were restarted overnight."],
  ["The operator sign the log daily.", "The operator signs the log daily."],
  ["The archives is stored offsite.", "The archives are stored offsite."],
  ["She have filed the report.", "She has filed the report."],
  ["The seals needs replacement.", "The seals need replacement."],
];

const ARTICLE_REPAIRS = [
  ["We need a extra seat.", "We need an extra seat."],
  ["This is a improvement over the draft.", "This is an improvement over the draft."],
  ["He is an director of the plant.", "He is a director of the plant."],
  ["She filed report before noon.", "She filed the report before noon."],
  ["We booked a hour for the review.", "We booked an hour for the review."],
  ["The intern wrote a analysis of the logs.", "The intern wrote an analysis of the logs."],
  ["Send a email to the vendor.", "Send an email to the vendor."],
  ["Open a report before noon.", "Open the report before noon."],
];

const CONFUSED_WORD_REPAIRS = [
  ["The change effects the whole fleet.", "The change affects the whole fleet."],
  ["Their is a fault in the relay.", "There is a fault in the relay."],
  ["Its ready for the review.", "It's ready for the review."],
  ["Your expected to archive the copy.", "You're expected to archive the copy."],
  ["The report is more clear then the draft.", "The report is more clear than the draft."],
  ["We need to loose the extra weight.", "We need to lose the extra weight."],
  ["The principle reason is cost.", "The principal reason is cost."],
  ["The gift was a nice complement to the note.", "The gift was a nice compliment to the note."],
  ["Everyone accept the intern signed the form.", "Everyone except the intern signed the form."],
  ["We must insure the totals match.", "We must ensure the totals match."],
  ["The office is farther along the corridor.", "The office is further along the corridor."],
  ["The team went to the site to.", "The team went to the site too."],
];

const CAPITALISATION_REPAIRS = [
  ["The workshop starts on wednesday.", "The workshop starts on Wednesday."],
  ["The audit begins on monday morning.", "The audit begins on Monday morning."],
  ["The audit begins on tuesday.", "The audit begins on Tuesday."],
  ["The invoice is due on friday.", "The invoice is due on Friday."],
  ["The window closes on saturday.", "The window closes on Saturday."],
  ["The contract renews in march.", "The contract renews in March."],
  ["The release ships in september.", "The release ships in September."],
  ["The freeze starts in december.", "The freeze starts in December."],
  ["the valve failed under load.", "The valve failed under load."],
  ["there is a fault in the relay.", "There is a fault in the relay."],
  ["we stored the receipt in the safe.", "We stored the receipt in the safe."],
  ["The freeze lifts on sunday.", "The freeze lifts on Sunday."],
  ["The audit closes in november.", "The audit closes in November."],
  ["the pump failed under load.", "The pump failed under load."],
];

const ESL_REPAIRS = [
  ["He go to work every day.", "He goes to work every day."],
  ["She is knowing the answer.", "She knows the answer."],
  ["He is depend on the vendor.", "He depends on the vendor."],
  ["She make a report every week.", "She makes a report every week."],
  ["He make the report every week.", "He makes the report every week."],
  ["They was ready for the audit.", "They were ready for the audit."],
  ["The informations are stored offsite.", "The information is stored offsite."],
  ["The datas are stored offsite.", "The data is stored offsite."],
  ["He is interested on the role.", "He is interested in the role."],
  ["We arrived to the site at noon.", "We arrived at the site at noon."],
  ["She is agree with the plan.", "She agrees with the plan."],
  ["He is responsible of the array.", "He is responsible for the array."],
  ["The team depend of the vendor.", "The team depends on the vendor."],
  ["We are wait for the badge.", "We are waiting for the badge."],
  ["She is listen to the operator.", "She is listening to the operator."],
  ["The valve is consist of two seals.", "The valve consists of two seals."],
  ["He is belong to the night crew.", "He belongs to the night crew."],
  ["The report is contain three tables.", "The report contains three tables."],
  ["We are discuss the budget now.", "We are discussing the budget now."],
  ["She is prefer the second draft.", "She prefers the second draft."],
  ["The pump is need a new seal.", "The pump needs a new seal."],
  ["The crew is arrive at noon.", "The crew arrives at noon."],
  ["We are review the draft now.", "We are reviewing the draft now."],
  ["He is know the operator.", "He knows the operator."],
  ["The relay is trip under load.", "The relay trips under load."],
  ["She is write the report today.", "She is writing the report today."],
  ["The pump is require a new seal.", "The pump requires a new seal."],
  ["We was ready at noon.", "We were ready at noon."],
  ["The evidences are stored offsite.", "The evidence is stored offsite."],
];

const CONTRACTION_EXPANSIONS = [
  ["We can't reach the server.", "We cannot reach the server."],
  ["The array isn't mounted yet.", "The array is not mounted yet."],
  ["The vendor hasn't confirmed it.", "The vendor has not confirmed it."],
  ["We haven't filed the report.", "We have not filed the report."],
  ["The relay doesn't trip early.", "The relay does not trip early."],
];

const PUNCTUATION_AND_SPACING_REPAIRS = [
  ["The package includes paper,ink, and labels.", "The package includes paper, ink, and labels."],
  ["The review was brief , but it was thorough.", "The review was brief, but it was thorough."],
  ["The crew left , and the site closed.", "The crew left, and the site closed."],
  ["The valve failed ; the pump held.", "The valve failed; the pump held."],
  ["The relay tripped ; we reset it.", "The relay tripped; we reset it."],
  ["The list is short:one item.", "The list is short: one item."],
  ["Section  A  is  ready.", "Section A is ready."],
  ["One  two  three  four.", "One two three four."],
  ["The log lists paper,ink, and tape.", "The log lists paper, ink, and tape."],
  ["The pump held ; the valve failed.", "The pump held; the valve failed."],
  ["Row  B  is  clear.", "Row B is clear."],
  ["The note is brief:one line.", "The note is brief: one line."],
];

const REDUNDANCY_REMOVALS = [
  ["The plan is absolutely totally sound.", "The plan is totally sound."],
  ["The result is really quite clear.", "The result is quite clear."],
  ["The test is entirely fully automated.", "The test is fully automated."],
  ["We are planning ahead for the freeze.", "We are planning for the freeze."],
  ["The parts are brand new today.", "The parts are new today."],
  ["The crew joined together at the gate.", "The crew joined at the gate."],
  ["We collaborated together on the draft.", "We collaborated on the draft."],
  ["The gift is a free gift for members.", "The gift is a gift for members."],
  ["The end result is a smaller file.", "The result is a smaller file."],
  ["The final outcome is a smaller file.", "The outcome is a smaller file."],
  ["The total sum is 42 units.", "The sum is 42 units."],
];

// The other half of each rule added for ORDER_AND_ROLE_SWAPS. A guard that refuses a
// reversal is only worth having if the repair it sits next to still gets through: the
// preposition "about", an auxiliary contraction, an irregular participle, a stray
// auxiliary, and a doubled word all live one step away from a rule above.
const GUARDED_REPAIRS = [
  ["We held a discussion about the layout.", "We discussed the layout."],
  ["The crew made a start on the repair.", "The crew started the repair."],
  ["The auditor made a recommendation about the layout.", "The auditor recommended the layout."],
  ["Do not restart the service tonight.", "Don't restart the service tonight."],
  ["The relay will not trip early.", "The relay won't trip early."],
  ["He don't need the badge.", "He doesn't need the badge."],
  ["The team lead the audit last year.", "The team led the audit last year."],
  ["Please advice the vendor on the schedule.", "Please advise the vendor on the schedule."],
  ["We have took the badge already.", "We have taken the badge already."],
  ["The board held a meeting on Monday.", "The board met on Monday."],
  ["The crew is in agreement with the plan.", "The crew agrees with the plan."],
  ["We are work here since 2019.", "We work here since 2019."],
  ["The pump is very completely sealed.", "The pump is completely sealed."],
  ["We talked about about the budget.", "We talked about the budget."],
  // The source already names a past moment, so moving the verb to match it is the repair.
  ["Yesterday the crew arrive at noon.", "Yesterday the crew arrived at noon."],
  ["Last week the vendor ship the parts.", "Last week the vendor shipped the parts."],
];

accepts("nominalisation reductions", NOMINALISATION_REDUCTIONS);
accepts("stock-phrase compressions", STOCK_PHRASE_COMPRESSIONS);
accepts("subject-verb agreement repairs", AGREEMENT_REPAIRS);
accepts("article repairs", ARTICLE_REPAIRS);
accepts("confused-word repairs", CONFUSED_WORD_REPAIRS);
accepts("capitalisation repairs", CAPITALISATION_REPAIRS);
accepts("ESL-style repairs", ESL_REPAIRS);
// Reversed 2026-08-30. These were MUST-ACCEPT while the concern was the validator
// misreading them — "Don't" as the name "Don", "won't" as a dropped commitment. Those
// bugs are still fixed, and the assertions below still pin them. What changed is the
// verdict: a writer shown "doesn't" -> "does not" is offered a longer sentence and no
// clearer one, and the card that prompted this said "Shortens ..." while expanding.
// Grammarly moves the other way, so contracting is still accepted (see below).
test(`MUST-REFUSE-AS-VALUELESS contraction expansions (${CONTRACTION_EXPANSIONS.length} cases)`, () => {
  for (const [source, candidate] of CONTRACTION_EXPANSIONS) {
    const verdict = validateRewrite(source, rewrite(candidate));
    assert.equal(verdict.accepted, false, `${source} ⇒ ${candidate}`);
    assert.equal(verdict.reason, "trivial-edit", `${source} ⇒ ${candidate}`);
  }
});

test("contracting is still accepted — only the expanding direction is worthless", () => {
  for (const [expanded, contracted] of CONTRACTION_EXPANSIONS) {
    acceptsRepair(contracted, expanded);
  }
});
accepts("punctuation and spacing repairs", PUNCTUATION_AND_SPACING_REPAIRS);
accepts("redundancy removals", REDUNDANCY_REMOVALS);
accepts("repairs the order and referent guards must not block", GUARDED_REPAIRS);

const MUST_ACCEPT_TABLES = [
  NOMINALISATION_REDUCTIONS, STOCK_PHRASE_COMPRESSIONS, AGREEMENT_REPAIRS, ARTICLE_REPAIRS,
  CONFUSED_WORD_REPAIRS, CAPITALISATION_REPAIRS, ESL_REPAIRS, CONTRACTION_EXPANSIONS,
  PUNCTUATION_AND_SPACING_REPAIRS, REDUNDANCY_REMOVALS, GUARDED_REPAIRS,
];

test("the must-accept table is at least as large as the must-reject table", () => {
  const rejectCount = MUST_REJECT_TABLES.reduce((n, table) => n + table.length, 0);
  const acceptCount = MUST_ACCEPT_TABLES.reduce((n, table) => n + table.length, 0);
  assert.ok(
    acceptCount >= rejectCount,
    `must-accept ${acceptCount} < must-reject ${rejectCount}: the matrix is biased toward refusing`,
  );
});

test("the must-accept matrix has no duplicate rows", () => {
  const keys = MUST_ACCEPT_TABLES.flat().map(([s, c]) => `${s}\u0000${c}`);
  assert.deepEqual(keys.length, new Set(keys).size);
});

test("no pair appears in both matrices", () => {
  const rejected = new Set(MUST_REJECT_TABLES.flat().map(([s, c]) => `${s}\u0000${c}`));
  for (const [source, candidate] of MUST_ACCEPT_TABLES.flat()) {
    assert.equal(rejected.has(`${source}\u0000${candidate}`), false, `${source} ⇒ ${candidate}`);
  }
});

// ---------------------------------------------------------------------------
// The deletion policy the pipeline layers on top of validateRewrite.
//
// validateRewrite deliberately lets some deletions through — a rewrite that eats the
// tail of a sentence still reads perfectly well, which is why it needs a second gate.
// These rows pin both halves of that gate and the decision the pipeline derives from
// them, so a change to either function shows up as a policy change, not a silent one.
// ---------------------------------------------------------------------------

// Mirrors pipeline.mjs: `refuseOutright` under each deletionPolicy setting. The count and
// frequency adverbs are refused before either setting is consulted — the 2B verifier was
// measured approving exactly that deletion ("counted the coins twice" ⇒ "counted the
// coins"), so it is never asked. The set is IMPORTED, not copied: the hand copy this
// replaced had already drifted (it was missing "again").
const countAdverbLost = (lost) => lost.some((word) => NEVER_VERIFY.has(word.toLowerCase()));
const verifyPolicyRefuses = (lost, trailing) =>
  countAdverbLost(lost) || lost.length > 1 || (lost.length === 1 && trailing);
const refusePolicyRefuses = (lost) => countAdverbLost(lost) || lost.length > 0;

const DELETION_POLICY = [
  // source, candidate, lost content words, deletes a trailing phrase
  ["Rinse the filter thoroughly before importing it.", "Rinse the filter thoroughly.", ["importing"], true],
  ["Store the backup on the array until the audit closes.", "Store the backup on the array.", ["audit", "closes"], true],
  ["The archive is stored offsite for seven years.", "The archive is stored offsite.", ["seven", "years"], true],
  ["We ran the migration script on the replica.", "We ran the migration script.", ["replica"], true],
  ["Please file the report before the deadline.", "Please file the report.", ["deadline"], true],
  ["Stop the deploy immediately.", "Stop the deploy.", ["immediately"], true],
  ["The archive is stored offsite and indexed nightly.", "The archive is stored offsite and indexed.", ["nightly"], true],
  ["All nodes recovered except the replica.", "All nodes recovered.", ["except", "replica"], true],
  ["The report was signed by the auditor.", "The report was signed.", ["auditor"], true],
  ["According to the vendor, the part shipped.", "The part shipped.", ["According", "vendor"], false],
  ["The customer reported the smell.", "The customer smelled.", ["reported"], true],
  // A count adverb lost mid-sentence: one word, no tail deletion, so the old mirror sent
  // it to the verifier. NEVER_VERIFY is the only thing refusing these two rows outright.
  ["The auditor counted the coins twice before lunch.", "The auditor counted the coins before lunch.", ["twice"], false],
  // "again" with no repetition-carrying word left in the candidate is lost information;
  // beside "repeated" it is not, which is the row below it in safety.test.mjs.
  ["Following up again on the budget approval.", "Following up on the budget approval.", ["again"], false],
  // Compressions that lose nothing: the policy must not fire on these.
  ["The router is located in close proximity to the desk.", "The router is near the desk.", [], false],
  // deletesTrailingPhrase is deliberately blunt — it asks only whether the sentence ends
  // in a run of deleted content words, and "basis" qualifies. It is safe to be blunt
  // because the policy only consults it once lostContentWords has already found a loss,
  // and STOCK_PHRASE_NOUNS keeps "basis" out of that list. Pinned here so that anyone
  // reading either function in isolation sees the two are only meaningful together.
  ["The archive is copied on a weekly basis.", "The archive is copied weekly.", [], true],
  ["The tool has the ability to recover 3 files.", "The tool can recover 3 files.", [], false],
  ["A set of revised drawings are attached.", "A set of revised drawings is attached.", [], false],
  ["He go to work every day.", "He goes to work every day.", [], false],
  ["Due to the fact that the disk failed, we stopped.", "Because the disk failed, we stopped.", [], false],
  ["In order to finish, we need the key.", "To finish, we need the key.", [], false],
  // Nominalizations unpacked into their verb. The light verb carries no meaning of its
  // own, so these lose nothing: "conducted", "performed" and "reached" were billed to the
  // writer only because the policy counted every deleted verb.
  ["We conducted a review of the draft.", "We reviewed the draft.", [], false],
  ["They performed an analysis of the logs.", "They analysed the logs.", [], false],
  ["The board reached a decision on the budget.", "The board decided on the budget.", [], false],
  // "come to" is not on that list — it is a motion verb before it is a light one — so
  // this stays the single lost word with no tail deletion, the one case the model
  // verifier is asked about.
  ["We came to the conclusion that the disk failed.", "We concluded that the disk failed.", ["came"], false],
];

test(`deletion policy: lostContentWords and deletesTrailingPhrase (${DELETION_POLICY.length} cases)`, () => {
  const actual = {};
  const expected = {};
  for (const [source, candidate, lost, trailing] of DELETION_POLICY) {
    const key = `${source}  ⇒  ${candidate}`;
    actual[key] = { lost: lostContentWords(source, candidate), trailing: deletesTrailingPhrase(source, candidate) };
    expected[key] = { lost, trailing };
  }
  assert.deepEqual(actual, expected);
});

test("deletion policy: every tail truncation is refused outright under both settings", () => {
  const truncations = DELETION_POLICY.filter(([, , lost]) => lost.length > 0);
  assert.ok(truncations.length >= 10, "not enough deletion cases to be meaningful");
  for (const [source, candidate, lost, trailing] of truncations) {
    assert.equal(
      verifyPolicyRefuses(lostContentWords(source, candidate), deletesTrailingPhrase(source, candidate)),
      verifyPolicyRefuses(lost, trailing),
      `${source} ⇒ ${candidate}`,
    );
    assert.equal(refusePolicyRefuses(lostContentWords(source, candidate)), true, `${source} ⇒ ${candidate}`);
  }
});

test("deletion policy: a lossless compression is never refused by either setting", () => {
  const lossless = DELETION_POLICY.filter(([, , lost]) => lost.length === 0);
  assert.ok(lossless.length >= 5, "not enough lossless cases to be meaningful");
  for (const [source, candidate] of lossless) {
    const lost = lostContentWords(source, candidate);
    assert.deepEqual(lost, [], `${source} ⇒ ${candidate}`);
    assert.equal(verifyPolicyRefuses(lost, deletesTrailingPhrase(source, candidate)), false, `${source} ⇒ ${candidate}`);
    assert.equal(refusePolicyRefuses(lost), false, `${source} ⇒ ${candidate}`);
  }
});

test("deletion policy: deletesTrailingPhrase alone never refuses anything", () => {
  // The blunt end-of-sentence test fires on compressions that lose nothing at all, so a
  // future refactor must not promote it to a gate in its own right.
  const trailingButLossless = DELETION_POLICY
    .filter(([source, candidate]) => deletesTrailingPhrase(source, candidate) &&
      lostContentWords(source, candidate).length === 0);
  assert.ok(trailingButLossless.length > 0, "the interaction this guards is no longer exercised");
  for (const [source, candidate] of trailingButLossless) {
    assert.equal(verifyPolicyRefuses(lostContentWords(source, candidate), true), false, `${source} ⇒ ${candidate}`);
  }
});

test("deletion policy: 'refuse' is strictly stricter than 'verify'", () => {
  for (const [source, candidate] of DELETION_POLICY) {
    const lost = lostContentWords(source, candidate);
    const trailing = deletesTrailingPhrase(source, candidate);
    if (verifyPolicyRefuses(lost, trailing)) {
      assert.equal(refusePolicyRefuses(lost), true, `${source} ⇒ ${candidate}`);
    }
  }
});


// ---------------------------------------------------------------------------
// CLOSED GAPS.
//
// Each of these was found by probing this matrix and was, until the rules below it
// existed, a real hole: the assertion states the behaviour the gate should have, and the
// repro that used to hold is kept in the comment so the shape of the hole stays legible.
// They ran as `todo` while they were open; they are ordinary tests now, and each pins the
// exact rejection reason so that closing one hole by widening another shows up here.
// ---------------------------------------------------------------------------

const rejectsAs = (source, candidate, reason) =>
  assert.deepEqual(
    validateRewrite(source, rewrite(candidate)),
    { accepted: false, reason },
    `${source} ⇒ ${candidate}`,
  );

const acceptsRepair = (source, candidate) =>
  assert.deepEqual(
    validateRewrite(source, rewrite(candidate)),
    { accepted: true, reason: "accepted", replacement: candidate },
    `${source} ⇒ ${candidate}`,
  );

// The name, number, and protected-token checks all compared multisets, so any candidate
// that permuted the source's words passed every one of them. This was the highest-severity
// family found: the sentence keeps all its parts and reverses what it says about them.
// Closed by comparing those three classes as sequences and by refusing a candidate whose
// word multiset is exactly the source's.
const ARGUMENT_ORDER_SWAPS = [
  // repro: validateRewrite("Maya emailed Priya.", rewrite("Priya emailed Maya.")).accepted === true
  ["Maya emailed Priya.", "Priya emailed Maya.", "name-changed"],
  // repro: validateRewrite("The vendor billed the client.", rewrite("The client billed the vendor.")).accepted === true
  ["The vendor billed the client.", "The client billed the vendor.", "order-changed"],
  // repro: validateRewrite("The outage caused the alert.", rewrite("The alert caused the outage.")).accepted === true
  ["The outage caused the alert.", "The alert caused the outage.", "order-changed"],
  // repro: validateRewrite("The new build is faster than the old one.", rewrite("The old build is faster than the new one.")).accepted === true
  ["The new build is faster than the old one.", "The old build is faster than the new one.", "order-changed"],
  // repro: validateRewrite("Copy the file from the array to the share.", rewrite("Copy the file from the share to the array.")).accepted === true
  ["Copy the file from the array to the share.", "Copy the file from the share to the array.", "order-changed"],
];

test("[was CRITICAL]: reordering the arguments of a sentence is refused", () => {
  for (const [source, candidate, reason] of ARGUMENT_ORDER_SWAPS) rejectsAs(source, candidate, reason);
  // The rule is exact: a rewrite that moves words while also changing one is an ordinary
  // edit, and the permutation check must not reach it. This is where the rule's cost sits
  // — a rewrite that ONLY moves an adjunct ("On Friday the crew filed the report." ⇒ "The
  // crew filed the report on Friday.") is refused too, because from the words alone it is
  // indistinguishable from swapping the two arguments of a verb.
  acceptsRepair("The report was signed by the auditor.", "The auditor signed the report.");
  acceptsRepair("The gasket was replaced by the technician.", "The technician replaced the gasket.");
});

test("[was HIGH]: before/after and and/or cannot be reversed even though both sides are function words", () => {
  for (const [source, candidate] of [
    // repro: validateRewrite("The audit runs before the release.", rewrite("The audit runs after the release.")).accepted === true
    ["The audit runs before the release.", "The audit runs after the release."],
    ["The backup starts after midnight.", "The backup starts before midnight."],
    // repro: validateRewrite("Bring the badge and the laptop.", rewrite("Bring the badge or the laptop.")).accepted === true
    ["Bring the badge and the laptop.", "Bring the badge or the laptop."],
    ["Bring the badge or the laptop.", "Bring the badge and the laptop."],
  ]) {
    rejectsAs(source, candidate, "direction-changed");
  }
  // Only a member whose partner was there to reverse is refused: a rewrite that makes a
  // relation explicit, or that drops a conjunction it also compresses, still passes.
  acceptsRepair("The seal held, and the test passed.", "Because the seal held, the test passed.");
});

test("[was HIGH]: dropping 'failed to' is refused, and the pipeline refuses it outright too", () => {
  // repro: validateRewrite("We failed to notify the vendor.", rewrite("We notified the vendor.")).accepted === true
  //        lostContentWords(...) === ["failed"], deletesTrailingPhrase(...) === false, so the
  //        pipeline handed this to the 2B verifier instead of refusing it deterministically.
  const source = "We failed to notify the vendor.";
  const candidate = "We notified the vendor.";
  rejectsAs(source, candidate, "negation-changed");
  assert.equal(
    verifyPolicyRefuses(lostContentWords(source, candidate), deletesTrailingPhrase(source, candidate)),
    true,
    "an inversion this complete must not depend on a 2B verifier",
  );
  // The other direction — inventing the failure — was already refused, and still is.
  rejectsAs("We notified the vendor.", "We failed to notify the vendor.", "word-substituted");
});

test("[was HIGH]: dropping a hedge that guards a universal claim is refused", () => {
  // repro: validateRewrite("Nearly every test passed.", rewrite("Every test passed.")).accepted === true
  //        "nearly" was in no CERTAINTY_GROUP or QUANTIFIER_GROUP, so the universal was
  //        strengthened for free; lost === ["Nearly"] with no tail deletion, so the
  //        pipeline deferred to the verifier rather than refusing.
  for (const [source, candidate] of [
    ["Nearly every test passed.", "Every test passed."],
    ["Almost all nodes recovered.", "All nodes recovered."],
    ["Virtually every node recovered.", "Every node recovered."],
    ["Practically all drives failed.", "All drives failed."],
  ]) {
    rejectsAs(source, candidate, "certainty-changed");
  }
});

test("[was HIGH]: swapping a personal pronoun changes the referent and is refused", () => {
  // repro: validateRewrite("He signed the waiver on arrival.", rewrite("She signed the waiver on arrival.")).accepted === true
  //        Pronouns are FUNCTION_WORDS, so vocabularyHasAntecedent never inspected them.
  for (const [source, candidate] of [
    ["He signed the waiver on arrival.", "She signed the waiver on arrival."],
    ["He signed the waiver on arrival.", "They signed the waiver on arrival."],
    ["She approved the invoice yesterday.", "He approved the invoice yesterday."],
    ["I filed the report on Friday.", "You filed the report on Friday."],
  ]) {
    rejectsAs(source, candidate, "pronoun-changed");
  }
  // Only a referent the source never mentioned is refused, so an expletive may still be
  // compressed away and a contraction repaired.
  acceptsRepair("It is the case that the pump failed.", "The pump failed.");
  acceptsRepair("Its ready for the review.", "It's ready for the review.");
});

test("[was HIGH]: an ordinal written as a word cannot be changed", () => {
  // repro: validateRewrite("The second attempt succeeded.", rewrite("The first attempt succeeded.")).accepted === true
  //        REDUCTION_LEXICON contained "first", so vocabularyHasAntecedent waved it through
  //        and lostContentWords treated the whole run as a licensed compression (lost === []).
  for (const [source, candidate] of [
    ["The second attempt succeeded.", "The first attempt succeeded."],
    ["The third review found the fault.", "The first review found the fault."],
    ["The first attempt succeeded.", "The second attempt succeeded."],
  ]) {
    rejectsAs(source, candidate, "quantifier-changed");
  }
});

test("[was HIGH]: a currency symbol is a protected token, so the unit of money cannot be swapped", () => {
  // repro: validateRewrite("The fee is $40 per seat.", rewrite("The fee is €40 per seat.")).accepted === true
  //        PROTECTED_PATTERNS covered "40 kg" and "40%" but nothing anchored a leading
  //        currency sign, and "$" tokenises as punctuation, which carries no letters and
  //        is therefore never a content word.
  for (const [source, candidate] of [
    ["The fee is $40 per seat.", "The fee is €40 per seat."],
    ["The invoice totals £1,200 for the month.", "The invoice totals $1,200 for the month."],
    ["The fee is 40 $ per seat.", "The fee is 40 € per seat."],
  ]) {
    rejectsAs(source, candidate, "protected-token-changed");
  }
});

test("[was MEDIUM]: pluralising an entity with nothing in the sentence asking for it is refused", () => {
  // repro: validateRewrite("The server rebooted overnight.", rewrite("The servers rebooted overnight.")).accepted === true
  //        related() returns true when one word starts with the other ("engineer"/"engineers"),
  //        which also licensed changing how many things the sentence is about.
  for (const [source, candidate] of [
    ["The server rebooted overnight.", "The servers rebooted overnight."],
    ["The drive failed during the audit.", "The drives failed during the audit."],
    ["The drives failed during the audit.", "The drive failed during the audit."],
  ]) {
    rejectsAs(source, candidate, "word-substituted");
  }
  // A determiner that demands the number the rewrite supplies makes it an agreement
  // repair, and verb agreement never had anything to do with this rule.
  acceptsRepair("Both engineer reviewed the schematic.", "Both engineers reviewed the schematic.");
  acceptsRepair("Each engineers signed the form.", "Each engineer signed the form.");
  acceptsRepair("The valves needs a new seal.", "The valves need a new seal.");
});

test("[was MEDIUM]: moving 'only' changes what it scopes over and is refused", () => {
  // repro: validateRewrite("We ship only on Fridays.", rewrite("We only ship on Fridays.")).accepted === true
  //        quantifiersPreserved compares sets, so a quantifier that moved was unchanged.
  rejectsAs("We ship only on Fridays.", "We only ship on Fridays.", "order-changed");
});

test("[was MEDIUM]: 'about' as a preposition no longer trips the quantifier gate", () => {
  // repro: validateRewrite("We discussed about the budget.", rewrite("We discussed the budget.")).reason === "quantifier-changed"
  //        "about" sat in the approximation group alongside "roughly" and "exactly", so
  //        removing it as a preposition read as dropping a hedge. That blocked a whole
  //        family of ordinary edits, including "made a recommendation about X" ⇒ "recommended X".
  for (const [source, candidate] of [
    ["We discussed about the budget.", "We discussed the budget."],
    ["The team made a recommendation about the layout.", "The team recommended the layout."],
    ["The vendor made an announcement about the delay.", "The vendor announced the delay."],
  ]) {
    acceptsRepair(source, candidate);
  }
  // Beside a quantity it approximates again, and dropping it is still a claim change.
  rejectsAs("The job takes about ten minutes.", "The job takes ten minutes.", "quantifier-changed");
  rejectsAs("The job takes about 10 minutes.", "The job takes 10 minutes.", "quantifier-changed");
});

test("[was MEDIUM]: a sentence-initial contraction is no longer read as a person's name", () => {
  // repro: validateRewrite("Don't ship the build tonight.", rewrite("Do not ship the build tonight.")).reason === "name-changed"
  //        properNouns() stripped "'t" from "Don't", leaving "Don", which is absent from
  //        SENTENCE_STARTERS and was therefore treated as an identity to preserve.
  for (const [source, candidate] of [
    ["Don't ship the build tonight.", "Do not ship the build tonight."],
    ["Doesn't the relay trip early?", "Does not the relay trip early?"],
    ["Didn't the vendor confirm it?", "Did not the vendor confirm it?"],
    ["Isn't the archive ready now?", "Is not the archive ready now?"],
  ]) {
    // The expansion is refused as valueless now, but the point of this test is the
    // REASON: "Don" must never again be read as a name to preserve.
    const verdict = validateRewrite(source, rewrite(candidate));
    assert.notEqual(verdict.reason, "name-changed", `${source} ⇒ ${candidate}`);
    // The same repair in the contracting direction is still offered outright.
    acceptsRepair(candidate, source);
  }
  // A capital that opens the sentence behind a bracket is not a name either.
  acceptsRepair("(The panel came to the conclusion that it works.)", "(The panel concluded that it works.)");
});

test("[was MEDIUM]: both unreachable CONFUSABLES pairs are reachable", () => {
  // repro: validateRewrite("The team lead the migration last year.", rewrite("The team led the migration last year.")).reason === "tense-changed"
  //        "led" is in PAST_IRREGULAR, so repairing lead⇒led always read as a tense change.
  // repro: validateRewrite("Please advice us on the schedule.", rewrite("Please advise us on the schedule.")).reason === "certainty-changed"
  //        "advice" is in a CERTAINTY_GROUP but "advise" is not, so the repair looked like a
  //        dropped commitment. Both pairs are listed in CONFUSABLES as repairs the gate
  //        intends to permit.
  for (const [source, candidate] of [
    ["The team lead the migration last year.", "The team led the migration last year."],
    ["Please advice us on the schedule.", "Please advise us on the schedule."],
  ]) {
    acceptsRepair(source, candidate);
  }
  // The early exit is one swap wide, and quantities are settled before it runs.
  rejectsAs("Restore 18 files then close the ticket.", "Restore 19 files than close the ticket.", "numbers-changed");
});

test("[was MEDIUM]: expanding \"won't\" is no longer a dropped commitment", () => {
  // repro: validateRewrite("The badge won't scan at the gate.", rewrite("The badge will not scan at the gate.")).reason === "certainty-changed"
  //        countWords looks for \bwill\b, which "won't" does not contain, so expanding the
  //        contraction added a "will" the source appeared to lack.
  // Refused as valueless now; what matters here is that it is not "certainty-changed".
  assert.notEqual(
    validateRewrite("The badge won't scan at the gate.", rewrite("The badge will not scan at the gate.")).reason,
    "certainty-changed",
  );
  acceptsRepair("The badge will not scan at the gate.", "The badge won't scan at the gate.");
  // The negation still has to balance: expanding it away is a different sentence.
  rejectsAs("The badge won't scan at the gate.", "The badge will scan at the gate.", "negation-changed");
});

test("[was MEDIUM]: repairing \"She don't\" to \"She doesn't\" is not an invented word", () => {
  // repro: validateRewrite("She don't need the badge.", rewrite("She doesn't need the badge.")).reason === "word-substituted"
  //        "don't"/"doesn't" are not a CONFUSABLES pair and do not share a stem, so the
  //        commonest agreement error in the language could not be repaired in contracted form.
  acceptsRepair("She don't need the badge.", "She doesn't need the badge.");
  acceptsRepair("They doesn't need the badge.", "They don't need the badge.");
});

test("[was MEDIUM]: removing one function word is allowed when that is the whole repair", () => {
  // repro: validateRewrite("I am work here since 2019.", rewrite("I work here since 2019.")).reason === "trivial-edit"
  //        isTrivialEdit refused any edit whose sole op deletes a function word. That is
  //        right for "the", and wrong for a stray auxiliary or a doubled intensifier —
  //        note explain.mjs carries a dedicated "repeats the word beside it" phrasing for
  //        the intensifier case, which the old rule made unreachable.
  for (const [source, candidate] of [
    ["I am work here since 2019.", "I work here since 2019."],
    ["The valve is very completely sealed.", "The valve is completely sealed."],
    ["She filed the the report.", "She filed the report."],
  ]) {
    acceptsRepair(source, candidate);
  }
  // Deleting a lone article still buys the writer nothing.
  rejectsAs(
    "For STS 51-L, the difference in the true diameters was 0.008 inches.",
    "For STS 51-L, the difference in true diameters was 0.008 inches.",
    "trivial-edit",
  );
});

test("[was LOW]: irregular stems no longer make an ordinary nominalisation reduction look invented", () => {
  // repro: validateRewrite("The team held a meeting on Friday.", rewrite("The team met on Friday.")).reason === "word-substituted"
  //        stem("meeting") is "meet" and stem("met") is "met": a two-character common
  //        prefix, below the four sharedStem() requires.
  // repro: validateRewrite("We reached an agreement with the supplier.", rewrite("We agreed with the supplier.")).reason === "word-substituted"
  //        Two rounds of suffix stripping take "agreement" to "agre" and "agreed" to "agr".
  for (const [source, candidate] of [
    ["The team held a meeting on Friday.", "The team met on Friday."],
    ["We reached an agreement with the supplier.", "We agreed with the supplier."],
    ["The engineer is in agreement with the plan.", "The engineer agrees with the plan."],
  ]) {
    acceptsRepair(source, candidate);
  }
  // The table maps forms of one verb, not any two words that happen to be irregular.
  rejectsAs("The vendor sent the parts.", "The vendor took the parts.", "word-substituted");
});

test("[was LOW]: repairing an irregular participle is not a tense change", () => {
  // repro: validateRewrite("I have went to the office already.", rewrite("I have gone to the office already.")).reason === "tense-changed"
  //        "went" is in PAST_IRREGULAR and "gone" matched neither PAST_IRREGULAR nor the
  //        perfect pattern, which required an -ed/-en ending.
  for (const [source, candidate] of [
    ["I have went to the office already.", "I have gone to the office already."],
    ["We have took the badge already.", "We have taken the badge already."],
  ]) {
    acceptsRepair(source, candidate);
  }
  // A participle outside the perfect is still a present state, not a past tense.
  rejectsAs("The work is done today.", "The work was done today.", "tense-changed");
});

// The one tense move the gate now permits, and only on the evidence the writer supplied.
test("a past-time adverbial in the source licenses moving the verb into the past", () => {
  for (const [source, candidate] of [
    ["Yesterday I go to work.", "Yesterday I went to work."],
    ["Last week the crew arrive at noon.", "Last week the crew arrived at noon."],
    ["The vendor deliver the parts two days ago.", "The vendor delivered the parts two days ago."],
  ]) {
    acceptsRepair(source, candidate);
  }
  // The licence runs one way, and only with the evidence: losing a past tense, or gaining
  // one the sentence never asked for, is still refused.
  rejectsAs("Yesterday I went to work.", "Yesterday I go to work.", "tense-changed");
  rejectsAs("The service stopped yesterday afternoon.", "The service stops yesterday afternoon.", "tense-changed");
  rejectsAs("The team ships the build tonight.", "The team shipped the build tonight.", "tense-changed");
});
