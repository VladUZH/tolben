import test from "node:test";
import assert from "node:assert/strict";
import { validateRewrite } from "../src/safety.mjs";
import { parseDecision } from "../src/contract.mjs";

const rewrite = (replacement) => ({ action: "rewrite", replacement, reason: "A restrained edit." });

const ACCEPTED = [
  ["The tool has the ability to recover 3 files.", "The tool can recover 3 files."],
  ["We conducted a review of the draft.", "We reviewed the draft."],
  ["The router is located in close proximity to the desk.", "The router is near the desk."],
  ["The workshop starts on wednesday.", "The workshop starts on Wednesday."],
  ["Your expected to archive the copy.", "You're expected to archive the copy."],
  ["A set of revised drawings are attached.", "A set of revised drawings is attached."],
  ["The archive is copied on a weekly basis.", "The archive is copied weekly."],
];

for (const [source, replacement] of ACCEPTED) {
  test(`accepts: ${source}`, () => {
    assert.deepEqual(validateRewrite(source, rewrite(replacement)), {
      accepted: true, reason: "accepted", replacement,
    });
  });
}

const REJECTED = [
  ["Original sentence.", { action: "keep", replacement: "", reason: "" }, "action-mismatch"],
  ["Original sentence.", rewrite(""), "empty"],
  ["Original sentence.", rewrite("Original sentence."), "unchanged"],
  ["Original sentence.", rewrite("Here is a better version: Improved sentence."), "instruction-output"],
  ["Original sentence.", rewrite("First sentence. Second sentence."), "multiple-sentences"],
  ["Restore 18 files.", rewrite("Restore 19 files."), "numbers-changed"],
  ["Read https://example.test/a for detail.", rewrite("Read https://example.test/b for detail."), "protected-token-changed"],
  ["Email ops@example.test today.", rewrite("Email help@example.test today."), "protected-token-changed"],
  ["Open /srv/reports/q4.csv today.", rewrite("Open /srv/reports/q3.csv today."), "protected-token-changed"],
  ["Deploy API_V2 to the cluster.", rewrite("Deploy API_V3 to the cluster."), "protected-token-changed"],
  ["Maya reviewed the release.", rewrite("Nadia reviewed the release."), "name-changed"],
  ["Maya may ship the build.", rewrite("Maya will ship the build."), "certainty-changed"],
  ["The service did not restart.", rewrite("The service restarted."), "negation-changed"],
  ["The review was brief, but thorough.", rewrite("The review was brief and thorough."), "content-dropped"],
  ["The service stopped yesterday.", rewrite("The service stops yesterday."), "tense-changed"],
  ["Could the backup finish before noon?", rewrite("The backup could finish before noon."), "question-changed"],
  ["The backup finished before noon.", rewrite("The backup finished before noon!"), "terminal-punctuation-changed"],
  ["The team met.", rewrite("The group of individuals assembled together."), "excessive-edit"],
];

for (const [source, decision, reason] of REJECTED) {
  test(`rejects ${reason}: ${source}`, () => {
    const result = validateRewrite(source, decision);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, reason);
  });
}

test("honours caller-supplied protected terms", () => {
  const result = validateRewrite(
    "The Falcon decoder follows the specification.",
    rewrite("The Hawk decoder follows the specification."),
    { protectedTerms: ["Falcon"] },
  );
  assert.equal(result.accepted, false);
});

test("parses only the agreed decision shape", () => {
  assert.deepEqual(parseDecision('{"action":"keep","replacement":"","reason":"Clear."}'), {
    action: "keep", replacement: "", reason: "Clear.",
  });
  assert.throws(() => parseDecision('{"action":"rewrite","replacement":"","reason":"x"}'), /replacement/u);
  assert.throws(() => parseDecision("not json"), /invalid JSON/u);
  assert.throws(() => parseDecision('{"action":"delete","replacement":"a","reason":"x"}'), /unknown action/u);
});

test("a nominalisation and its verb express the same commitment", () => {
  const result = validateRewrite(
    "The auditor made a recommendation to update the retention policy.",
    rewrite("The auditor recommended updating the retention policy."),
  );
  assert.equal(result.accepted, true);
});

test("rejects a rewrite that drops a quantifier", () => {
  const result = validateRewrite(
    "The report lists every unresolved dependency.",
    rewrite("The report lists unresolved dependencies."),
  );
  assert.deepEqual(result, { accepted: false, reason: "quantifier-changed" });
});

test("still rejects removing a hedge", () => {
  const result = validateRewrite(
    "The older battery has a tendency to lose charge overnight.",
    rewrite("The older battery loses charge overnight."),
  );
  assert.equal(result.reason, "certainty-changed");
});

test("'provided' as a verb is not a conditional clause", () => {
  const result = validateRewrite(
    "Rina provided an explanation of the new approval process.",
    rewrite("Rina explained the new approval process."),
  );
  assert.equal(result.accepted, true);
});

test("collapsing duplicated universals is allowed, dropping the only one is not", () => {
  assert.equal(validateRewrite(
    "Each and every applicant must sign the consent form.",
    rewrite("Each applicant must sign the consent form."),
  ).accepted, true);
  assert.equal(validateRewrite(
    "The report lists every unresolved dependency.",
    rewrite("The report lists unresolved dependencies."),
  ).reason, "quantifier-changed");
});

test("refuses to swap one universal quantifier for another", () => {
  assert.equal(validateRewrite(
    "The report lists every unresolved dependency.",
    rewrite("The report lists all unresolved dependencies."),
  ).reason, "quantifier-changed");
});

test("accepts the reference clarity rewrite without a rule for it", () => {
  const result = validateRewrite(
    "Due to the fact that the server was unavailable, the job failed.",
    rewrite("Because the server was unavailable, the job failed."),
  );
  assert.equal(result.accepted, true, `rejected as ${result.reason}`);
});

test("making a relation explicit is allowed; losing one is not", () => {
  assert.equal(validateRewrite("The seal held, and the test passed.",
    rewrite("Because the seal held, the test passed.")).accepted, true);
  assert.equal(validateRewrite("The review was brief, but it was thorough.",
    rewrite("The review was brief and thorough.")).reason, "content-dropped");
});

test("a name that is not a common opener is still protected at sentence start", () => {
  assert.equal(validateRewrite("Maya reviewed the release.",
    rewrite("Nadia reviewed the release.")).reason, "name-changed");
  assert.equal(validateRewrite("Rina provided an explanation of the process.",
    rewrite("The process was explained.")).reason, "name-changed");
});

test("refuses to trade one content word for an unrelated one", () => {
  assert.equal(validateRewrite("She filed the appeal because the deadline had passed.",
    rewrite("She filed the appeal because the deadline had expired.")).reason, "word-substituted");
  assert.equal(validateRewrite("The auditor wrote the report in a manner that was confusing.",
    rewrite("The auditor wrote the report in a clear manner.")).reason, "word-substituted");
  assert.equal(validateRewrite("The inspector made an inquiry into the missing shipment.",
    rewrite("The inspector queried the missing shipment.")).reason, "word-substituted");
});

test("still allows compression, inflection, and confusable repairs", () => {
  const cases = [
    ["The technician will arrive in the near future.", "The technician will arrive soon."],
    ["Our team performed a comparison of the vendors.", "Our team compared the vendors."],
    ["Both engineer reviewed the schematic.", "Both engineers reviewed the schematic."],
    ["The new policy effects every contractor.", "The new policy affects every contractor."],
    ["The team performed better then last quarter.", "The team performed better than last quarter."],
    ["Please make sure that you check the seal is seated.", "Please ensure the seal is seated."],
  ];
  for (const [source, replacement] of cases) {
    const result = validateRewrite(source, rewrite(replacement));
    assert.equal(result.accepted, true, `${source} -> ${replacement} rejected as ${result.reason}`);
  }
});

test("refuses a rewrite whose reason says the sentence was already fine", () => {
  assert.equal(validateRewrite("Neither generator started during the outage drill.",
    { action: "rewrite", replacement: "Neither generator started.", reason: "The sentence is already clear and direct." }).reason,
    "reason-contradicts-action");
  assert.equal(validateRewrite("The board took into consideration the remarks.",
    { action: "rewrite", replacement: "The board considered the remarks.", reason: "Replaces a nominalization with a direct verb." }).accepted,
    true);
});

test("refuses to obey an imperative sentence by deleting its second clause", () => {
  const result = validateRewrite(
    "Please provide only the minimum information needed and remove unnecessary customer, employee, or confidential details.",
    rewrite("Please provide only the minimum information needed."),
  );
  assert.deepEqual(result, { accepted: false, reason: "content-dropped" });
});

test("refuses wholesale clause deletion but allows ordinary compression", () => {
  assert.equal(validateRewrite(
    "The team reviewed the drawings and the site manager approved the revised layout.",
    rewrite("The team reviewed the drawings."),
  ).reason, "content-dropped");
  const kept = [
    ["It is important to note that the filter needs replacing monthly.", "The filter needs replacing monthly."],
    ["The logistics team carried out an evaluation of the packaging supplier.", "The logistics team evaluated the packaging supplier."],
    ["There are three bolts that require replacement.", "Three bolts require replacement."],
    ["The purpose of this memo is to explain the new refund rule.", "This memo explains the new refund rule."],
    ["We inspect the anchors on a quarterly basis.", "We inspect the anchors quarterly."],
  ];
  for (const [source, replacement] of kept) {
    const result = validateRewrite(source, rewrite(replacement));
    assert.equal(result.accepted, true, `${source} rejected as ${result.reason}`);
  }
});

test("a vague-amount quantifier may be traded for its plain equivalent", () => {
  assert.equal(validateRewrite(
    "There are a number of issues that need to be addressed by the team.",
    rewrite("There are several issues that need to be addressed by the team."),
  ).accepted, true);
  // Universals stay strict.
  assert.equal(validateRewrite("The report lists every unresolved dependency.",
    rewrite("The report lists all unresolved dependencies.")).reason, "quantifier-changed");
});

test("a stranded auxiliary is ellipsis, not a tense change", () => {
  assert.equal(validateRewrite(
    "The new process is more efficient than the old process was.",
    rewrite("The new process is more efficient than the old one."),
  ).accepted, true);
  // A real tense change is still refused.
  assert.equal(validateRewrite("The service stopped yesterday.",
    rewrite("The service stops yesterday.")).reason, "tense-changed");
});

test("refuses an edit whose only change is deleting a function word", () => {
  assert.equal(validateRewrite(
    "For STS 51-L, the difference in the true diameters was 0.008 inches.",
    rewrite("For STS 51-L, the difference in true diameters was 0.008 inches."),
  ).reason, "trivial-edit");
  // Inserting a missing article is a real repair, not a trivial edit.
  assert.equal(validateRewrite("She submitted application without a signature.",
    rewrite("She submitted an application without a signature.")).accepted, true);
});

test("an edit worth nothing is refused however many worthless parts it has", () => {
  // The card the writer saw on screen: it expands a contraction AND drops an article,
  // and its own explanation read "Shortens ..." while making the sentence longer. Neither
  // half is an improvement, and the one-change form of this guard let it through because
  // there were two changes rather than one.
  assert.equal(validateRewrite(
    "Note that delivering data via the unified data platform doesn't block the OCR delivery.",
    rewrite("Note that delivering data via the unified data platform does not block OCR delivery."),
  ).reason, "trivial-edit");
  // Each half alone, too.
  assert.equal(validateRewrite("The job didn't finish before the timeout.",
    rewrite("The job did not finish before the timeout.")).reason, "trivial-edit");
  assert.equal(validateRewrite("It does not block the OCR delivery.",
    rewrite("It does not block OCR delivery.")).reason, "trivial-edit");
});

test("the worthless-edit guard covers respellings beyond the n't family", () => {
  // Only negative contractions were covered at first, so the identical card in another
  // tense sailed through: "It's blocking the OCR delivery." -> "It is blocking OCR
  // delivery." is the same no-op as the one that prompted the guard.
  for (const [source, candidate] of [
    ["It's blocking the OCR delivery.", "It is blocking OCR delivery."],
    ["You're blocking the OCR delivery.", "You are blocking OCR delivery."],
    ["They're reviewing the patch.", "They are reviewing the patch."],
  ]) {
    assert.equal(validateRewrite(source, rewrite(candidate)).reason, "trivial-edit", source);
  }
  // A curly apostrophe traded for a straight one is a pure no-op, equal length and all.
  assert.equal(validateRewrite("It doesn\u2019t block delivery.",
    rewrite("It doesn't block delivery.")).reason, "trivial-edit");
});

test("the worthless-edit guard does not reach real repairs", () => {
  // Several articles removed together is an article-misuse repair, not a cosmetic tidy —
  // judging each run separately had wrongly refused these.
  assert.equal(validateRewrite("We need to improve the customer satisfaction and the employee retention.",
    rewrite("We need to improve customer satisfaction and employee retention.")).accepted, true);
  // "ain't" is nonstandard, so writing it out is a register repair, not a respelling.
  assert.equal(validateRewrite("That ain't the problem.",
    rewrite("That is not the problem.")).accepted, true);
  // Contracting shortens, and is what Grammarly suggests; only expanding is refused.
  assert.equal(validateRewrite("The relay does not trip early.",
    rewrite("The relay doesn't trip early.")).accepted, true);
  // Adding an article is the grammar tier's own best work.
  assert.equal(validateRewrite("The flow from ML process continues.",
    rewrite("The flow from the ML process continues.")).accepted, true);
  // Articles removed as part of a real compression.
  assert.equal(validateRewrite("For the purpose of testing, we created a staging environment.",
    rewrite("For testing, we created a staging environment.")).accepted, true);
  assert.equal(validateRewrite("We reviewed each and every one of the logs.",
    rewrite("We reviewed every log.")).accepted, true);
  // A doubled word is a real repair wherever it appears.
  assert.equal(validateRewrite("The data was analyzed by the the team.",
    rewrite("The data was analyzed by the team.")).accepted, true);
  // Punctuation is deliberately not normalised away: adding a comma is an improvement.
  assert.equal(validateRewrite("In the near future we intend to replace the queue.",
    rewrite("In the near future, we intend to replace the queue.")).accepted, true);
});

test("a stock phrase compressed to its conventional word loses nothing", async () => {
  const { lostContentWords } = await import("../src/safety.mjs");
  assert.deepEqual(lostContentWords(
    "Due to the fact that the sensor failed, the line stopped.",
    "Because the sensor failed, the line stopped."), []);
  assert.deepEqual(lostContentWords(
    "The technician will arrive in the near future.",
    "The technician will arrive soon."), []);
  // A phrase deleted with nothing put back is still a loss.
  assert.deepEqual(lostContentWords(
    "The report was prepared by the analyst in a very thorough manner.",
    "The report was prepared by the analyst."), ["thorough", "manner"]);
});

test("padding nouns and redundant modifiers are not lost information", async () => {
  const { lostContentWords } = await import("../src/safety.mjs");
  assert.deepEqual(lostContentWords(
    "The courier will collect the parcel at a later point in time.",
    "The courier will collect the parcel later."), []);
  assert.deepEqual(lostContentWords(
    "She repeated the instruction back again to the crew.",
    "She repeated the instruction to the crew."), []);
  // Real detail is still counted as lost.
  assert.deepEqual(lostContentWords(
    "TDRS telemetry during the launch phase was transmitted by cable.",
    "TDRS telemetry was transmitted by cable."), ["launch", "phase"]);
});

test("recognises a rewrite that lops off the end of a sentence", async () => {
  const { deletesTrailingPhrase } = await import("../src/safety.mjs");
  assert.equal(deletesTrailingPhrase("Ice closed the access track for a week.", "Ice closed the access track."), true);
  assert.equal(deletesTrailingPhrase("Export the table to CSV before importing it.", "Export the table to CSV."), true);
  // A repair inside the sentence is not a truncation.
  assert.equal(deletesTrailingPhrase("Following up again on the budget approval.", "Following up on the budget approval."), false);
  assert.equal(deletesTrailingPhrase("We received advance warning of the shutdown.", "We received a warning of the shutdown."), false);
});

test("a trailing phrase swapped for one word is still a truncation", async () => {
  const { deletesTrailingPhrase } = await import("../src/safety.mjs");
  assert.equal(deletesTrailingPhrase(
    "Only the weekend team reported the smell.", "Only the weekend team smelled."), true);
  assert.equal(deletesTrailingPhrase(
    "We calibrate the probes on a monthly basis.", "We calibrate the probes monthly."), true);
});

test("a prefixed irregular past is still past", () => {
  assert.equal(validateRewrite("The surveyor undertook a measurement of the span.",
    rewrite("The surveyor measured the span.")).accepted, true);
  assert.equal(validateRewrite("The crew undertook the repair yesterday.",
    rewrite("The crew undertakes the repair yesterday.")).reason, "tense-changed");
});

test("an opinion phrase may reduce to a belief verb", () => {
  assert.equal(validateRewrite("The chemist is of the opinion that the batch is sound.",
    rewrite("The chemist believes the batch is sound.")).accepted, true);
  // A plain synonym swap is still refused.
  assert.equal(validateRewrite("He set the gap with a feeler blade.",
    rewrite("He adjusted the gap with a feeler blade.")).reason, "word-substituted");
});

test("a percentage is a number, not a bare digit string", () => {
  // The trailing boundary made the "%" branch unmatchable, so dropping the sign passed.
  assert.equal(validateRewrite("The delay is 50% of the budget.",
    rewrite("The delay is 50 of the budget.")).accepted, false);
  assert.equal(validateRewrite("The delay is 50 ms in the worst case.",
    rewrite("The delay is 50 in the worst case.")).reason, "protected-token-changed");
  // Carrying the percentage through unchanged is still allowed.
  assert.equal(validateRewrite("It is the case that 50% of the runs failed.",
    rewrite("50% of the runs failed.")).accepted, true);
});

test("a version or quarter label is protected like any other identifier", () => {
  assert.equal(validateRewrite("Deploy v2 to the cluster.",
    rewrite("Deploy v3 to the cluster.")).reason, "protected-token-changed");
  assert.equal(validateRewrite("The Q3 review is complete.",
    rewrite("The Q4 review is complete.")).reason, "protected-token-changed");
});

test("refuses to trade one quantifier for its opposite", () => {
  const swaps = [
    ["Send at least three copies to the office.", "Send at most three copies to the office."],
    ["The upload takes exactly ten minutes to finish.", "The upload takes approximately ten minutes to finish."],
    ["Many issues remain open in the tracker.", "Few issues remain open in the tracker."],
    ["Few issues remain open in the tracker.", "Many issues remain open in the tracker."],
    ["Several issues remain open in the tracker.", "Most issues remain open in the tracker."],
  ];
  for (const [source, replacement] of swaps) {
    assert.equal(validateRewrite(source, rewrite(replacement)).reason, "quantifier-changed",
      `${source} -> ${replacement}`);
  }
  // The trade the exemption exists for is a periphrasis standing down, and it survives.
  assert.equal(validateRewrite("There are a number of issues that need to be addressed by the team.",
    rewrite("There are several issues that need to be addressed by the team.")).accepted, true);
  assert.equal(validateRewrite("A lot of the samples arrived warm.",
    rewrite("Many samples arrived warm.")).accepted, true);
});

test("one edit apart is not the same as related", () => {
  const substitutions = [
    ["The manager hired the contractor.", "The manager fired the contractor."],
    ["The change is impossible for the team.", "The change is important for the team."],
    ["The analyst confirmed the totals.", "The analyst confused the totals."],
  ];
  for (const [source, replacement] of substitutions) {
    assert.equal(validateRewrite(source, rewrite(replacement)).reason, "word-substituted",
      `${source} -> ${replacement}`);
  }
});

test("inflections and nominalisations still count as the same word", async () => {
  const { lostContentWords } = await import("../src/safety.mjs");
  const related = [
    ["engineer", "engineers"], ["comparison", "compared"], ["decision", "decided"],
    ["examination", "examined"], ["assessment", "assessed"], ["valuation", "valued"],
    ["evaluation", "evaluated"], ["explanation", "explained"],
    ["recommendation", "recommended"], ["effect", "affect"],
  ];
  for (const [before, after] of related) {
    assert.deepEqual(lostContentWords(`The ${before} was filed.`, `The ${after} was filed.`), [],
      `${before} -> ${after} read as a loss`);
  }
  assert.deepEqual(lostContentWords("The hired crew arrived.", "The fired crew arrived."), ["hired"]);
});

test("a noun that merely ends in an irregular past is not past tense", () => {
  assert.equal(validateRewrite("We will review the policy at the present time.",
    rewrite("We will review the policy now.")).accepted, true);
  assert.equal(validateRewrite("The parties will sign the consent form at a later point in time.",
    rewrite("The parties will sign the consent form later.")).accepted, true);
  // A prefixed irregular is still a past tense.
  assert.equal(validateRewrite("The crew undertook the repair yesterday.",
    rewrite("The crew undertakes the repair yesterday.")).reason, "tense-changed");
});

// --------------------------------------------------------------------------------------
// Regressions for the order, referent, and contraction rules.
// --------------------------------------------------------------------------------------

test("names, numbers and protected tokens are compared in order, not as a bag", () => {
  assert.equal(validateRewrite("Maya emailed Priya.",
    rewrite("Priya emailed Maya.")).reason, "name-changed");
  assert.equal(validateRewrite("Pay $40 to the vendor and $60 to the client.",
    rewrite("Pay $60 to the vendor and $40 to the client.")).reason, "numbers-changed");
  assert.equal(validateRewrite("Copy /srv/in/a.csv to /srv/out/b.csv.",
    rewrite("Copy /srv/out/b.csv to /srv/in/a.csv.")).reason, "protected-token-changed");
  // Repairing the case of a name still lines the two sequences up.
  assert.equal(validateRewrite("The workshop starts on wednesday.",
    rewrite("The workshop starts on Wednesday.")).accepted, true);
});

test("a candidate that only reorders the source's words is refused", () => {
  assert.equal(validateRewrite("The outage caused the alert.",
    rewrite("The alert caused the outage.")).reason, "order-changed");
  assert.equal(validateRewrite("We ship only on Fridays.",
    rewrite("We only ship on Fridays.")).reason, "order-changed");
  // Punctuation and capitalisation repairs leave the word sequence identical, so the
  // permutation rule must not see them as a reordering at all.
  assert.equal(validateRewrite("The list is short:one item.",
    rewrite("The list is short: one item.")).accepted, true);
  assert.equal(validateRewrite("the pump failed under load.",
    rewrite("The pump failed under load.")).accepted, true);
});

test("a direction word may not be traded for its opposite", () => {
  assert.equal(validateRewrite("The audit runs before the release.",
    rewrite("The audit runs after the release.")).reason, "direction-changed");
  assert.equal(validateRewrite("Bring the badge and the laptop.",
    rewrite("Bring the badge or the laptop.")).reason, "direction-changed");
  // Introducing a connective the source had no partner for is an ordinary edit.
  assert.equal(validateRewrite("The seal held, and the test passed.",
    rewrite("Because the seal held, the test passed.")).accepted, true);
});

test("an auxiliary contraction is the verb it stands for, in every signature", () => {
  // Names, certainty and tense have to read "won't" as "will not". Expanding one is
  // refused as valueless since 2026-08-30, so what is pinned here is the REASON: never a
  // misread signature. Those three checks all run BEFORE the valueless guard, so these
  // assertions can still fail — the ordering probe below keeps that true. The VOCABULARY
  // signature is not pinned by this loop (word-substituted runs after the guard, and
  // never fired on an expansion even before it); it is pinned by the "She don't" line at
  // the bottom and by the contracting direction, which runs the whole validator.
  const MISREADINGS = new Set([
    "name-changed", "certainty-changed", "tense-changed",
    "negation-changed", "quantifier-changed",
  ]);
  for (const [source, replacement] of [
    ["Don't ship the build tonight.", "Do not ship the build tonight."],
    ["The badge won't scan at the gate.", "The badge will not scan at the gate."],
    ["Didn't the vendor confirm it?", "Did not the vendor confirm it?"],
  ]) {
    const result = validateRewrite(source, rewrite(replacement));
    assert.ok(!MISREADINGS.has(result.reason), `${source} -> ${replacement} misread as ${result.reason}`);
    const back = validateRewrite(replacement, rewrite(source));
    assert.equal(back.accepted, true, `${replacement} -> ${source} rejected as ${back.reason}`);
  }
  // "don't" -> "doesn't" is an agreement repair, not a spelling-out: still accepted. This
  // is the line that pins the vocabulary signature — "doesn't" must not read as a word
  // the source never contained.
  assert.equal(validateRewrite("She don't need the badge.", rewrite("She doesn't need the badge.")).accepted, true);
  // The valueless guard must stay BEHIND the signature checks. If it were ever moved in
  // front of them, every notEqual above would pass vacuously and the misreadings could
  // come back unnoticed: an expansion that ALSO swaps a name has to report the name.
  assert.equal(validateRewrite("Maya won't sign the form.",
    rewrite("Nadia will not sign the form.")).reason, "name-changed");
  // Expanding the contraction may not quietly drop what it negated.
  assert.equal(validateRewrite("The badge won't scan at the gate.",
    rewrite("The badge will scan at the gate.")).reason, "negation-changed");
});

test("dropping 'failed to' is a negation change, not a compression", async () => {
  const { lostContentWords } = await import("../src/safety.mjs");
  assert.equal(validateRewrite("We failed to notify the vendor.",
    rewrite("We notified the vendor.")).reason, "negation-changed");
  // The pipeline needs to see the loss as large enough to refuse without a verifier.
  assert.deepEqual(lostContentWords("We failed to notify the vendor.", "We notified the vendor."),
    ["failed", "notify"]);
  // Swapping the verb outright is still reported as the unsourced substitution it is.
  assert.equal(validateRewrite("The migration succeeded overnight.",
    rewrite("The migration failed overnight.")).reason, "word-substituted");
});

test("every reason the gate can return is documented", async () => {
  const { REJECTION_REASONS } = await import("../src/safety.mjs");
  for (const reason of ["order-changed", "direction-changed", "pronoun-changed"]) {
    assert.ok(REJECTION_REASONS.includes(reason), `${reason} is undocumented`);
  }
  assert.equal(REJECTION_REASONS.length, new Set(REJECTION_REASONS).size, "duplicate reason");
});

test("'again' is redundant only beside a word that already says it is a repeat", async () => {
  const { lostContentWords } = await import("../src/safety.mjs");
  // The case the exemption exists for: "repeated" carries the meaning by itself.
  assert.deepEqual(lostContentWords(
    "She repeated the instruction back again to the crew.",
    "She repeated the instruction to the crew."), []);
  assert.deepEqual(lostContentWords(
    "We will re-run the migration again tonight.",
    "We will re-run the migration tonight."), []);
  assert.deepEqual(lostContentWords(
    "He counted the coins twice again.",
    "He counted the coins twice."), []);
  assert.deepEqual(lostContentWords(
    "The vendor returned the form back to the office.",
    "The vendor returned the form to the office."), []);
  // With no carrier left, "again" is the only word saying this has happened before, and
  // the verifier prompt teaches exactly this deletion as a loss.
  assert.deepEqual(lostContentWords(
    "Following up again on the budget approval.",
    "Following up on the budget approval."), ["again"]);
  assert.deepEqual(lostContentWords(
    "Following up again on the budget approval from last week.",
    "Following up on the budget approval from last week."), ["again"]);
  assert.deepEqual(lostContentWords(
    "The vendor sent the invoice again.",
    "The vendor sent the invoice."), ["again"]);
  assert.deepEqual(lostContentWords(
    "He read the report back to the room.",
    "He read the report to the room."), ["back"]);
});
