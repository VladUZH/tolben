// Regression pins for the 2026-08-31 codebase-wide bug hunt.
//
// Every test here reproduces a defect that was observed live against the previous
// code — each failed before its fix and passes after. Grouped by module; the numbers
// reference the hunt's finding ids so a future reader can trace the full analysis.

import test from "node:test";
import assert from "node:assert/strict";
import { segmentSentences, isCompleteSentence } from "../src/segmenter.mjs";
import { repairMechanics } from "../src/mechanics.mjs";
import { applyClarityRules } from "../src/clarity-rules.mjs";
import {
  validateRewrite, lostContentWords, protectedTokenList, markupTokens,
  dropsConjunct, dropsRepeatedWord, deadlineNarrowed,
} from "../src/safety.mjs";
import { inlineDiffParts } from "../src/diff.mjs";
import { explainEdit } from "../src/explain.mjs";
import { createEngine } from "../src/engine.mjs";
import { checkGate } from "../src/gate.mjs";
import { createCoordinator } from "../src/coordinator.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";
import { flattenMarkdown, sourceEdits, sourceRuns } from "../obsidian-plugin/markdown.mjs";
import { createController } from "../obsidian-plugin/controller.mjs";
import { rescore } from "../bench/score.mjs";
import { runBenchmark } from "../bench/run.mjs";

const rewrite = (replacement) => ({ action: "rewrite", replacement, reason: "x" });

// --------------------------------------------------------------------- segmenter

test("#3: a fully emphasised sentence is complete, and .** cannot smuggle two sentences", () => {
  assert.equal(isCompleteSentence("**Done!**"), true);
  assert.equal(isCompleteSentence("*Ready?*"), true);
  // Two sentences dressed in bold no longer pass the multiple-sentences guard.
  const two = validateRewrite("A plain single sentence stands here.",
    rewrite("**The tool ran.** It failed twice."));
  assert.equal(two.accepted, false);
});

test("#34: a closing quote or bracket after trailing emphasis stays with its sentence", () => {
  const quoted = segmentSentences("He said “**Done!**” Next one.").map((s) => s.text);
  assert.equal(quoted[0].includes("”"), true, "the closing quote belongs to the first sentence");
  assert.equal(quoted[1], "Next one.");
  const bracketed = segmentSentences("She wrote (*really!*) and left.").map((s) => s.text);
  assert.equal(bracketed[0].includes(")"), true, "the closing bracket belongs to the first sentence");
});

test("#35: underscore emphasis opening the next sentence splits like asterisk emphasis", () => {
  const texts = segmentSentences("The build passed._Note:_ deploy tomorrow.\n").map((s) => s.text);
  assert.deepEqual(texts, ["The build passed.", "_Note:_ deploy tomorrow.\n"]);
});

test("#36: a lazy continuation line does not split the blockquote's sentence", () => {
  const texts = segmentSentences("> The vendor review was started\nlazily on this line\n> and finished here.\n");
  assert.equal(texts.length, 1, "one quote run is one block");
});

test("#37: a deep-indented ordered-list marker is never cut loose as its own segment", () => {
  const texts = segmentSentences("                        1. Do the thing.\n").map((s) => s.text);
  assert.equal(texts.length, 1);
  assert.match(texts[0], /Do the thing/u);
});

test("#66: an astral word character after an emphasis run keeps the run with the opener", () => {
  const texts = segmentSentences("It passed.**\u{1D40D}ote:** tomorrow").map((s) => s.text);
  assert.equal(texts[0], "It passed.");
  assert.equal(texts[1].startsWith("**"), true, "the opener belongs to the next sentence");
});

// --------------------------------------------------------------------- mechanics

test("#6: a dot that opens the next token is not a stray sentence mark", () => {
  assert.equal(repairMechanics("Run ./build.sh now."), null);
  assert.equal(repairMechanics("Check .gitignore now."), null);
  assert.equal(repairMechanics("The value is .5 percent."), null);
  // The glued-comma fault this fix exists for is still repaired.
  assert.equal(repairMechanics("The test was brief , but complete.").replacement,
    "The test was brief, but complete.");
});

test("#7: 'this may' is a modal, not the month of May", () => {
  assert.equal(repairMechanics("This may be wrong."), null);
  assert.equal(repairMechanics("We fixed this march of errors."), null);
  // A preposition still licenses the month reading.
  assert.equal(repairMechanics("The meeting is on may 5.").replacement, "The meeting is on May 5.");
});

test("#8: mechanical repairs stay out of math spans and wikilinks", () => {
  assert.equal(repairMechanics("The equation $f(a,b)$ holds."), null);
  assert.equal(repairMechanics("See [[wednesday log]] for details."), null);
});

test("#33: a posix path after punctuation is untouchable", () => {
  assert.equal(repairMechanics("Backups live in (/srv/data,backup) today."), null);
});

test("#40/#41/#42: capitalisation skips camelCase and ligatures, but fixes one-word sentences", () => {
  assert.equal(repairMechanics("eBay listed the item."), null);
  assert.equal(repairMechanics("iPhone sales grew."), null);
  assert.equal(repairMechanics("ﬁnal report is late."), null);          // "ﬁnal" -> "FInal" was worse
  assert.equal(repairMechanics("done.").replacement, "Done.");
  assert.equal(repairMechanics("no?").replacement, "No?");
});

// ------------------------------------------------------------------ clarity rules

test("#9: the put-frame guard sees past 48 characters", () => {
  assert.equal(applyClarityRules(
    "Put your extremely complicated and disorganized financial affairs in order to spare your family the paperwork.",
  ), null);
});

test("#10: non-be copulas take the predicate reading of 'in order'", () => {
  assert.equal(applyClarityRules("Everything seems in order to me."), null);
  assert.equal(applyClarityRules("The paperwork looks in order to the auditors."), null);
  assert.equal(applyClarityRules("Everything appears in order for the launch."), null);
});

test("#43: 'revert back' stays out of hyphenated compounds", () => {
  assert.equal(applyClarityRules("Please revert back-end changes to the old schema."), null);
  assert.equal(applyClarityRules("We should revert back to the old schema.").replacement,
    "We should revert to the old schema.");
});

test("#44: a clause-scoped guard window manufactures no mid-word boundaries", () => {
  const ruled = applyClarityRules("The output was checked very carefully by two engineers in order to improve the model.");
  assert.equal(ruled.replacement, "The output was checked very carefully by two engineers to improve the model.");
});

test("#45/#46: literal noun readings of 'near future' and 'the exception of' are left alone", () => {
  assert.equal(applyClarityRules("He is interested in the near future of artificial intelligence."), null);
  assert.equal(applyClarityRules("The handler dealt with the exception of type ValueError."), null);
  assert.equal(applyClarityRules("We will meet in the near future.").replacement, "We will meet soon.");
  assert.equal(applyClarityRules("Everyone attended with the exception of Maya.").replacement,
    "Everyone attended except for Maya.");
});

// ------------------------------------------------------------------------ safety

test("#1: a voice change that keeps the participants' order has flipped their roles", () => {
  assert.equal(validateRewrite("The outage was caused by the alert.",
    rewrite("The outage caused the alert.")).reason, "order-changed");
  assert.equal(validateRewrite("Maya emailed Priya about the invoice.",
    rewrite("Maya was emailed by Priya about the invoice.")).reason, "order-changed");
  // A genuine conversion reorders the participants and stays accepted.
  assert.equal(validateRewrite("The report was reviewed by the team.",
    rewrite("The team reviewed the report.")).accepted, true);
});

test("#1b: a reversal plus a dropped article is still a permutation", () => {
  assert.equal(validateRewrite("The outage caused the alert.",
    rewrite("The alert caused outage.")).reason, "order-changed");
});

test("#2: one inserted reduction word no longer launders unrelated clause deletion", () => {
  assert.deepEqual(
    lostContentWords("We shipped the parts to the customer in bulk.", "We shipped the parts soon."),
    ["customer", "bulk"],
  );
  // The canonical compressions stay lossless.
  assert.deepEqual(lostContentWords("We will meet in the near future.", "We will meet soon."), []);
  assert.deepEqual(lostContentWords("The tool has the ability to recover files.", "The tool can recover files."), []);
});

test("#13: only inflectional extensions relate two words, and only content survivors carry meaning", () => {
  assert.equal(validateRewrite("The car was sold to a dealer on Tuesday.",
    rewrite("The carpet was sold to a dealer on Tuesday.")).reason, "word-substituted");
  // A surviving "to" no longer vouches for a deleted "tomorrow".
  assert.deepEqual(lostContentWords("Send the draft to Priya tomorrow.", "Send the draft to Priya."), ["tomorrow"]);
  assert.equal(validateRewrite("Two engineers signed off.", rewrite("Two engineer signed off.")).accepted, true,
    "plain inflection still relates");
});

test("#14: 'used' is a past tense the gate can see", () => {
  assert.equal(validateRewrite("We used the spare pump yesterday.",
    rewrite("We use the spare pump yesterday.")).reason, "tense-changed");
});

test("#15: the sign of a quantity is part of the quantity", () => {
  assert.equal(validateRewrite("The sample froze at -5 °C overnight.",
    rewrite("The sample froze at 5 °C overnight.")).reason, "numbers-changed");
});

test("#16: protected terms with non-word edges actually protect", () => {
  assert.equal(validateRewrite("Use the --force flag to bypass checks.",
    rewrite("Use the force flag to bypass checks."), { protectedTerms: ["--force"] }).reason,
  "protected-token-changed");
});

test("#17: 'about $10' is a hedged quantity", () => {
  assert.equal(validateRewrite("The cost is about $10 per seat.",
    rewrite("The cost is $10 per seat.")).reason, "quantifier-changed");
});

test("#18: y/ies pluralisation behind a neutral determiner is refused like +s", () => {
  assert.equal(validateRewrite("The policy expired on Tuesday.",
    rewrite("The policies expired on Tuesday.")).reason, "word-substituted");
});

test("#19: on/off, up/down, above/below, over/under, more/less are direction pairs", () => {
  assert.equal(validateRewrite("Turn the system on.", rewrite("Turn the system off.")).reason, "direction-changed");
  assert.equal(validateRewrite("Move the slider up.", rewrite("Move the slider down.")).reason, "direction-changed");
  assert.equal(validateRewrite("The value is above the limit.",
    rewrite("The value is below the limit.")).reason, "direction-changed");
  assert.equal(validateRewrite("We need more time for this.",
    rewrite("We need less time for this.")).reason, "direction-changed");
});

test("#20: case-only edits to protected tokens and markup are edits", () => {
  assert.equal(validateRewrite("Read https://example.test/A for detail.",
    rewrite("Read https://example.test/a for detail.")).reason, "protected-token-changed");
  assert.equal(validateRewrite("Deploy from /srv/Reports today.",
    rewrite("Deploy from /srv/reports today.")).reason, "protected-token-changed");
  assert.equal(validateRewrite("Run `Make` before lunch.",
    rewrite("Run `make` before lunch.")).reason, "markup-changed");
});

test("#49: two currency amounts are not a math span", () => {
  assert.equal(validateRewrite("Pay $40 to vendor and $50 to client.",
    rewrite("Pay $40 to the vendor and $50 to the client.")).accepted, true);
  // Genuine inline math is still markup.
  assert.deepEqual(markupTokens("The equation $x+1$ holds."), ["$x+1$"]);
});

test("#50: the email pattern scans long dotted garbage in linear time", () => {
  const evil = `a@${"a.".repeat(15000)}!`;
  const started = Date.now();
  protectedTokenList(evil);
  assert.ok(Date.now() - started < 500, "email scan must not backtrack quadratically");
});

test("#62: deleting a table cell separator is a markup change", () => {
  assert.equal(validateRewrite("One | Copied weekly.", rewrite("One copied weekly.")).reason, "markup-changed");
});

// ------------------------------------------------------------------ diff, explain

test("card: a capitalisation-only suggestion shows a visible change", () => {
  const parts = inlineDiffParts("wednesday is fine.", "Wednesday is fine.");
  assert.deepEqual(parts.slice(0, 2), [
    { type: "delete", text: "wednesday" },
    { type: "insert", text: "Wednesday" },
  ]);
});

test("#11: a capitalisation repair is named even when other words change too", () => {
  const reason = explainEdit(
    "the panel came to the conclusion that the request should be denied.",
    "The panel concluded that the request should be denied.",
  );
  assert.match(reason, /capitalizes “The”/u);
});

test("#12: removing a lone intensifier does not claim it repeats a neighbour", () => {
  assert.equal(explainEdit("The fix is really working.", "The fix is working."), "Removes “really”.");
  assert.match(explainEdit("The seal was very completely sealed.", "The seal was completely sealed."),
    /repeats the word beside it/u);
});

test("#48: a lengthening is never described as shortening", () => {
  const reason = explainEdit("She don't need badge.", "She doesn't need the badge.");
  assert.doesNotMatch(reason, /^Shortens/u);
});

// ------------------------------------------------------------------------ engine

test("#52: a decision missing its reason field is malformed, not transient", async () => {
  let calls = 0;
  const engine = createEngine({
    prompt: "p",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "{\"action\":\"keep\",\"replacement\":\"\"}" } }] }) };
    },
  });
  await assert.rejects(engine.rewrite("s"), (error) => error.kind === "failed");
  assert.equal(calls, 1, "malformed output is never retried");
});

test("#53: a verifier socket failure is transient, like the same failure in decide()", async () => {
  const engine = createEngine({
    prompt: "p", verifierPrompt: "v",
    fetchImpl: async () => { throw new TypeError("fetch failed"); },
  });
  const verdict = await engine.verify("a", "b");
  assert.equal(verdict.verdict, "unavailable");
  assert.equal(verdict.kind, "transient");
});

// -------------------------------------------------------------------------- gate

test("#54: checkGate stays fast on a pathological unpunctuated run", () => {
  const evil = ", running ".repeat(5000) + "and to go";
  const started = Date.now();
  checkGate(evil);
  assert.ok(Date.now() - started < 500, "gate patterns must not backtrack quadratically");
});

// -------------------------------------------------------------------- coordinator

test("#38: a superseding submit competes for the freed slot", async () => {
  const started = [];
  const coordinator = createCoordinator({
    maxConcurrent: 1,
    analyze: (text) => new Promise(() => { started.push(text); }),
  });
  coordinator.submit({ id: "onscreen", revision: 1, text: "v1", priority: 1 });
  coordinator.submit({ id: "margin", revision: 1, text: "margin", priority: 900 });
  coordinator.submit({ id: "onscreen", revision: 2, text: "v2", priority: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(started, ["v1", "v2"], "the on-screen replacement outranks the queued margin");
  coordinator.dispose();
});

test("#5: identical text with different context is not the same question", () => {
  const coordinator = createCoordinator({ analyze: () => new Promise(() => {}) });
  const first = coordinator.submit({ id: "x", revision: 1, text: "same", context: { protectedTerms: [] } });
  const second = coordinator.submit({ id: "x", revision: 2, text: "same", context: { protectedTerms: ["restart"] } });
  assert.notEqual(first, second, "a changed context supersedes instead of joining");
  coordinator.dispose();
});

// ----------------------------------------------------------------------- pipeline

test("#21: the rule tier's protected-term guard is boundary-aware", async () => {
  const outcome = await analyzeSentence("The team makes use of the tool.", {
    engine: null, rules: true, protectedTerms: ["use"],
  });
  assert.equal(outcome.stages.rule, false, "the substring 'use' inside 'uses' does not count as survival");
});

// -------------------------------------------------------------- markdown projection

test("#27: interior quote markers never leak into the projected prose", () => {
  const projection = flattenMarkdown("> The archive is copied on a\n> weekly basis, always.\n");
  assert.doesNotMatch(projection.text, />/u);
});

test("#28: an edit bracketing an untouched atom leaves the atom alone", () => {
  const apply = (source, replacement) => {
    const projection = flattenMarkdown(source);
    let out = source;
    for (const edit of sourceEdits(projection, replacement).sort((a, b) => b.from - a.from)) {
      out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
    }
    return out;
  };
  assert.equal(apply("We make use of [[Sync Tool]] in order to copy files.", "We use Sync Tool to copy files."),
    "We use [[Sync Tool]] to copy files.");
  assert.equal(apply("We make use of `rsync` in order to copy files.", "We use rsync to copy files."),
    "We use `rsync` to copy files.");
});

test("#59: a multi-backtick code span holding a backtick projects whole", () => {
  const projection = flattenMarkdown("Run ``a`b`` now.");
  assert.equal(projection.text, "Run a`b now.");
  assert.deepEqual(projection.protectedTerms, ["a`b"]);
});

test("#60: an unpaired delimiter glued to text is prose", () => {
  assert.equal(flattenMarkdown("The value is 3*4 today.").text, "The value is 3*4 today.");
  assert.equal(flattenMarkdown("Check that x==4 holds.").text, "Check that x==4 holds.");
  assert.equal(flattenMarkdown("**The archive** is *copied weekly*.").text, "The archive is copied weekly.");
});

test("#61: deleting an escaped character takes its backslash with it", () => {
  const source = "The \\*starred\\* words go.";
  const projection = flattenMarkdown(source);
  let out = source;
  for (const edit of sourceEdits(projection, "The words go.").sort((a, b) => b.from - a.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
  }
  assert.equal(out, "The words go.");
});

// ---------------------------------------------------------------- probe controller

test("#26: invalidateAll withdraws the in-flight request instead of rejoining it", async () => {
  let calls = 0;
  const controller = createController({
    analyze: () => { calls += 1; return new Promise(() => {}); },   // hangs: still in flight
    debounceMs: 1,
  });
  controller.sync("The end result was good.\n");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  controller.invalidateAll();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 2, "the re-submit is a fresh request under the new settings");
  controller.dispose();
});

test("#56: an answer discarded as stale does not mark its text decided", async () => {
  let resolveFirst;
  const answers = [];
  const controller = createController({
    analyze: (text) => {
      answers.push(text);
      // Only the FIRST request settles; the request for the interim text hangs, so
      // nothing can overwrite a stale decided-record and hide the bug — on the
      // pre-fix controller the stale answer marks "was good." decided and the undo
      // below never re-asks.
      if (answers.length === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return new Promise(() => {});
    },
    debounceMs: 1,
  });
  controller.sync("The end result was good.\n");
  await new Promise((resolve) => setTimeout(resolve, 30));
  // The text moves on while the answer is in flight, then the writer undoes.
  controller.sync("The end result was fine.\n");
  resolveFirst({ source: answers[0], replacement: "The result was good.", reason: "", stages: { model: true }, rejection: null });
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.sync("The end result was good.\n");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(answers.filter((text) => text === "The end result was good.").length >= 2,
    "undoing back to the requested text re-asks instead of losing the suggestion");
  controller.dispose();
});

// -------------------------------------------------------------------------- bench

test("#65: runBenchmark takes its options as options, and records them", async () => {
  const corpus = { name: "t", rows: [{ id: "r1", source: "on monday we shipped it .", expectedAction: "keep" }] };
  const report = await runBenchmark({ corpus, engine: null, prompt: "p", model: { id: "m" }, mechanics: false });
  assert.equal(report.options.mechanics, false);
  assert.equal(report.rows[0].replacement, "", "mechanics stayed off without any argv flag");
  const repaired = await runBenchmark({ corpus, engine: null, prompt: "p", model: { id: "m" }, mechanics: true });
  assert.notEqual(repaired.rows[0].replacement, "");
});

test("#29/#30: rescore applies the deletion policy and judges against the repaired base", () => {
  // A model echo of the mechanical repair: live, this is refused "unchanged" and the
  // mechanical repair surfaces as mechanics-only. Rescore must agree, not credit the model.
  const echo = {
    id: "e1", source: "on monday we shipped it .", expectedAction: "rewrite",
    action: "rewrite", replacement: "On Monday we shipped it.", reason: "",
    modelReason: "", surfaced: true,
    stages: { mechanics: true, model: false }, rejection: null,
    modelRejection: "unchanged", rejectedText: "On Monday we shipped it.", milliseconds: 5,
  };
  const [rescored] = rescore([echo]);
  assert.equal(rescored.stages.model, false, "an echo of the repair is not the model's work");
  assert.equal(rescored.surfaced, true, "the mechanical repair still surfaces");
  // A rewrite the live pipeline refuses outright for dropping a counted adverb.
  const counted = {
    id: "c1", source: "He counted the coins twice before lunch.", expectedAction: "keep",
    action: "rewrite", replacement: "He counted the coins before lunch.", reason: "",
    modelReason: "Shorter.", surfaced: true,
    stages: { mechanics: false, model: true }, rejection: null,
    modelRejection: null, rejectedText: null, milliseconds: 5,
  };
  const [refused] = rescore([counted]);
  assert.equal(refused.surfaced, false, "the NEVER_VERIFY policy runs on rescore too");
});

// ---------------------------------------------------------------------------
// Second round: pins for the adversarial review of the first round's fixes.
// Numbers reference the review findings (R0..R26).
// ---------------------------------------------------------------------------

test("R0/R6: digit-leading inline math is markup; postfix currency is not", () => {
  assert.deepEqual(markupTokens("The equation $3x+2$ holds."), ["$3x+2$"]);
  assert.equal(validateRewrite("The equation $3x+2$ holds for every input.",
    rewrite("The equation $3x-2$ holds for every input.")).reason, "markup-changed");
  // Postfix currency must not fuse the prose between two amounts into one span.
  assert.equal(validateRewrite("The fee is 40$, the deposit is is 60$ today.",
    rewrite("The fee is 40$, the deposit is 60$ today.")).accepted, true);
});

test("R1: every REDUCTION_LEXICON word carries its canonical compression", () => {
  assert.deepEqual(lostContentWords("Please make sure that the backups run nightly.",
    "Please ensure that the backups run nightly."), []);
  assert.deepEqual(lostContentWords("Prior to the meeting, send the agenda.",
    "Before the meeting, send the agenda."), []);
  assert.deepEqual(lostContentWords("Subsequent to the audit, we filed the report.",
    "After the audit, we filed the report."), []);
});

test("R2: 'by noon' is a deadline, not an agent", () => {
  assert.equal(validateRewrite("The store is closed by noon.",
    rewrite("The store closes by noon.")).accepted, true);
  assert.equal(validateRewrite("The doors are locked by 6 pm.",
    rewrite("The doors lock by 6 pm.")).accepted, true);
  // A real agent still trips the flip check.
  assert.equal(validateRewrite("The outage was caused by the alert.",
    rewrite("The outage caused the alert.")).reason, "order-changed");
});

test("R3/R4: negative currency keeps its sign; the minus glyph is normalised", () => {
  assert.equal(validateRewrite("The balance changed by -$5 overnight.",
    rewrite("The balance changed by $5 overnight.")).reason, "numbers-changed");
  assert.equal(validateRewrite("The delta was −4 points.",
    rewrite("The delta was -4 points.")).accepted, true);
  // The currency-unit swap still reports as the protected-token change it is.
  assert.equal(validateRewrite("The fee is $40 per seat.",
    rewrite("The fee is €40 per seat.")).reason, "protected-token-changed");
});

test("R5: 'based off' -> 'based on' is a usage repair, not a direction flip", () => {
  assert.equal(validateRewrite("The estimate is based off last year data.",
    rewrite("The estimate is based on last year data.")).accepted, true);
  assert.equal(validateRewrite("Turn the system on.",
    rewrite("Turn the system off.")).reason, "direction-changed");
});

test("R7: doubled-consonant and short-noun inflections relate; car/card does not", () => {
  assert.deepEqual(lostContentWords("Keep running the tests hourly.", "Keep the run of tests hourly."), []);
  assert.equal(validateRewrite("The car was parked outside.",
    rewrite("The card was parked outside.")).reason, "word-substituted");
});

test("R8: unwinding a fronted copula with the missing article added is a repair", () => {
  assert.equal(validateRewrite("Attached is signed contract.",
    rewrite("The signed contract is attached.")).accepted, true);
  // Dropping an article alongside a reversal is still a permutation.
  assert.equal(validateRewrite("The outage caused the alert.",
    rewrite("The alert caused outage.")).reason, "order-changed");
});

test("R9: identifier dots before an unpaired underscore stay inside the token", () => {
  assert.equal(segmentSentences("Set this._private to null now.\n").length, 1);
  const texts = segmentSentences("The build passed._Note:_ deploy tomorrow.\n").map((s) => s.text);
  assert.equal(texts.length, 2, "a closing underscore still marks emphasis");
});

test("R10: a fenced block ends a quote run", () => {
  const text = "> A quote line\n```\ncode\n```\nA plain paragraph line\n> A new quote.\n";
  const texts = segmentSentences(text).map((s) => s.text);
  assert.ok(texts.some((s) => s.startsWith("> A new quote")),
    "the new quote opens its own block instead of gluing to the paragraph");
});

test("R11: mechanics repairs run between two dollar amounts", () => {
  assert.equal(repairMechanics("He paid $5  and  $10 yesterday.").replacement,
    "He paid $5 and $10 yesterday.");
});

test("R12: unicode hyphens guard compounds like the ASCII hyphen", () => {
  assert.equal(applyClarityRules("Please revert back‑end changes now."), null);
  assert.equal(applyClarityRules("Please revert back‐end changes now."), null);
});

test("R13-R16: sourceEdits reproduces the replacement's own separators exactly", () => {
  const apply = (source, replacement) => {
    const projection = flattenMarkdown(source);
    let out = source;
    for (const edit of sourceEdits(projection, replacement).sort((a, b) => b.from - a.from)) {
      out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
    }
    return out;
  };
  assert.equal(apply("she left then quickly.", "she left, then quickly."), "she left, then quickly.");
  assert.equal(apply("The well-known fix works.", "The well known fix works."), "The well known fix works.");
  assert.equal(apply("The test was brief , but complete.", "The test was brief, but complete."),
    "The test was brief, but complete.");
  assert.equal(apply("Teh  cat sat.", "The cat sat."), "The cat sat.");
});

test("R17: a deletion spanning a quote's line break swallows the interior marker", () => {
  const source = "> We did it to win\n> quickly and cleanly.";
  const projection = flattenMarkdown(source);
  let out = source;
  for (const edit of sourceEdits(projection, "We did it to win cleanly.").sort((a, b) => b.from - a.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
  }
  assert.equal(flattenMarkdown(out).text.includes(">"), false, "no marker glued into the prose");
});

test("R20: checkGate stays fast on one long unbroken token", () => {
  const evil = "a".repeat(50000);
  const started = Date.now();
  checkGate(evil);
  assert.ok(Date.now() - started < 500, "a pasted blob must not reopen the quadratic scan");
});

test("R19/R22: rescore honours modelRejection verdicts and the recorded deletionPolicy", () => {
  // Verifier hid the deletion, but a mechanical repair surfaced, so the verdict lives
  // in modelRejection with rejection null.
  const hidden = {
    id: "h1", source: "the mockups won't be ready until end of day tomorrow .", expectedAction: "keep",
    action: "rewrite", replacement: "The mockups won't be ready until end of day tomorrow.", reason: "",
    modelReason: "Shorter.", surfaced: true,
    stages: { mechanics: true, model: false }, rejection: null,
    modelRejection: "verifier-hidden",
    rejectedText: "The mockups won't be ready until tomorrow.", milliseconds: 5,
  };
  const [rescored] = rescore([hidden]);
  assert.equal(rescored.stages.model, false, "the hidden rewrite stays hidden");
  // Under the refuse policy any lost content word is refused outright.
  const single = {
    id: "s1", source: "Rinse the filter before importing it.", expectedAction: "keep",
    action: "rewrite", replacement: "Rinse the filter.", reason: "",
    modelReason: "Shorter.", surfaced: true,
    stages: { mechanics: false, model: true }, rejection: null,
    modelRejection: null, rejectedText: null, milliseconds: 5,
  };
  const [refused] = rescore([single], { deletionPolicy: "refuse" });
  assert.equal(refused.surfaced, false, "the refuse policy is honoured on rescore");
});

// ---------------------------------------------------------------------------
// Third round: the rule tier pre-empting the model (found by the gap research).
// ---------------------------------------------------------------------------

test("R-preempt: a fired clarity rule no longer ships the rest of the sentence's faults", async () => {
  // Before the fix each of these surfaced with the grammar error intact, because the
  // rule returned outright and the model was never asked.
  const seen = [];
  const engine = {
    rewrite: async (shown) => {
      seen.push(shown);
      return { action: "rewrite", latencyMs: 1, reason: "Agreement.",
        replacement: shown.replace(" was ", " were ").replace("recovers", "recover")
          .replace("user was", "users were").replace("sees", "see") };
    },
  };
  const cases = [
    "In order to ship, the tests was run.",
    "The tool has the ability to recovers files.",
    "We are able to sees the logs.",
  ];
  for (const source of cases) {
    const result = await analyzeSentence(source, { engine, rules: true });
    assert.equal(seen.at(-1), source, "the model is shown the writer's own sentence, not the rule's output");
    assert.equal(result.stages.model, true, `the model never ran for: ${source}`);
  }
});

test("R-preempt: the rule is still the floor when the model keeps", async () => {
  const engine = { rewrite: async () => ({ action: "keep", replacement: "", reason: "clear", latencyMs: 1 }) };
  const result = await analyzeSentence("The tool has the ability to recover files.", { engine, rules: true });
  assert.equal(result.replacement, "The tool can recover files.");
  assert.equal(result.stages.rule, true);
});

// ---------------------------------------------------------------------------
// Span-scoped guards, round 1: formulaic attention frames.
// ---------------------------------------------------------------------------

test("SPAN-1: attention frames behave identically, whatever words they contain", () => {
  // The guards count words across the whole sentence, so the frame's own "should" was
  // read as the writer's commitment: these two structurally identical edits used to get
  // opposite verdicts.
  for (const source of [
    "It is worth noting that the cache expires after an hour.",
    "It should be noted that the cache expires after an hour.",
    "It is important to note that the cache expires after an hour.",
    "Please note that the cache expires after an hour.",
  ]) {
    const verdict = validateRewrite(source, rewrite("The cache expires after an hour."));
    assert.equal(verdict.accepted, true, `frame not exempted: ${source}`);
  }
});

test("SPAN-1: the deletion policy scopes to the same span as the validator", () => {
  // Otherwise the validator accepts the edit and the deletion policy bills the writer
  // for "noted" anyway, sending to the verifier an edit that cost them nothing.
  assert.deepEqual(
    lostContentWords("It should be noted that the endpoint requires a token.", "The endpoint requires a token."),
    [],
  );
});

test("SPAN-1: EPISTEMIC frames are not exempt — they carry the claim's strength", () => {
  // Dropping the frame must not, by itself, license the edit: these carry how strongly
  // the writer meant the claim, which is the documented policy difference in
  // docs/GRAMMARLY-BEHAVIOUR.md §3, not a counting artefact. Here the frame is the only
  // modal, so removing it leaves a bare assertion and the edit is refused.
  assert.equal(validateRewrite("It could be argued that the design is somewhat fragile.",
    rewrite("The design is somewhat fragile.")).accepted, false);
  assert.equal(validateRewrite("There is a chance that the report will be late.",
    rewrite("The report will be late.")).accepted, false);
  // The frame is still not in ATTENTION_FRAME — nothing about it is exempt.
  assert.equal(validateRewrite("It could be argued that we shipped 40 units.",
    rewrite("We shipped 40 units.")).accepted, false);
});

test("SPAN-5: a stack of hedges may be reduced to one, if the modality survives", () => {
  // "There is a chance that the job could possibly time out" carries the same modality
  // three times over; dropping two of the three markers changes nothing the reader
  // relies on, because "could" still stands. Labelled UNINTENDED in oracle-labels.json.
  assert.equal(validateRewrite("There is a chance that the job could possibly time out.",
    rewrite("The job could time out.")).accepted, true);
  // But emptying the group is still a change: nothing hedges the claim afterwards.
  assert.equal(validateRewrite("We are fairly confident that the fix will most likely hold.",
    rewrite("We are confident the fix will hold.")).reason, "certainty-changed");
  // And a hedge may never be introduced where the writer committed.
  assert.equal(validateRewrite("The migration completes on Friday.",
    rewrite("The migration could complete on Friday.")).reason, "certainty-changed");
});

test("SPAN-1: an edit under the frame still faces the full gauntlet", () => {
  // The exemption re-scopes the comparison; it does not wave anything through.
  assert.equal(validateRewrite("It should be noted that we shipped 40 units.",
    rewrite("We shipped 50 units.")).reason, "numbers-changed");
  assert.equal(validateRewrite("It should be noted that the outage was caused by the alert.",
    rewrite("The outage caused the alert.")).reason, "order-changed");
  // A genuine passive-to-active under the frame, agent present in the source, still passes.
  assert.equal(validateRewrite("It should be noted that the server was decommissioned by the team.",
    rewrite("The team decommissioned the server.")).accepted, true);
});

test("SPAN-1: a frame mid-sentence is ordinary prose, not a frame", () => {
  const verdict = validateRewrite("We agreed it should be noted that the cache expires.",
    rewrite("The cache expires."));
  assert.equal(verdict.accepted, false, "only a frame the writer opened with is exempt");
});

// ---------------------------------------------------------------------------
// Span-scoped guards, round 2: repetition in coordinate structures.
// ---------------------------------------------------------------------------

test("SPAN-2: a repeated modal or subordinator may be tidied away", () => {
  // gate.mjs's own "repeated subordinator" family exists to FIND this redundancy, so
  // refusing the repair was the engine contradicting itself.
  assert.equal(validateRewrite(
    "We could either rewrite the service from scratch, or we could refactor it incrementally.",
    rewrite("We could either rewrite the service from scratch or refactor it incrementally."),
  ).accepted, true);
  assert.equal(validateRewrite(
    "Because the vendor missed the deadline and because the budget was committed, we descoped.",
    rewrite("Because the vendor missed the deadline and the budget was committed, we descoped."),
  ).accepted, true);
});

test("SPAN-2: words inside a group stay interchangeable", () => {
  // The distinct-member count is what licenses the flagship reduction: one member of
  // the ability group swapped for another. A presence-per-word rule broke this.
  assert.equal(validateRewrite("The tool has the ability to recover files.",
    rewrite("The tool can recover files.")).accepted, true);
});

test("SPAN-2: the last member of a group vanishing is still a change", () => {
  assert.equal(validateRewrite("The valve must be replaced.",
    rewrite("The valve should be replaced.")).reason, "certainty-changed");
  assert.equal(validateRewrite("The job may fail under load.",
    rewrite("The job will fail under load.")).reason, "certainty-changed");
  assert.equal(validateRewrite("We are fairly confident that the fix will most likely hold.",
    rewrite("We are confident the fix will hold.")).reason, "certainty-changed");
});

// KNOWN GAP, deliberately visible rather than hidden. Ignoring repetition means a
// modal can be dropped from ONE of two coordinated clauses while the other keeps its
// own — the second clause loses its hedge and no count notices. The alternative,
// exact occurrence counts, refuses the legitimate coordination tidy above, which is
// the commoner case by far and one Grammarly performs. Closing this properly needs a
// notion of which clause a modal governs, i.e. a parse; nothing in the 183 recorded
// refusals or the redteam tables exhibits it.
test("SPAN-2: a hedge dropped from one of two coordinated clauses", { todo: "needs clause scope, not word counts" }, () => {
  assert.equal(validateRewrite("The tests may fail and the deploy may fail.",
    rewrite("The tests may fail and the deploy fails.")).accepted, false);
});

// ---------------------------------------------------------------------------
// Span-scoped guards, round 3: in a passive, the auxiliary carries the tense.
// ---------------------------------------------------------------------------

test("SPAN-3: a present passive is present, however its participle is spelled", () => {
  // The -ed branch already knew this ("are presented" is not past); the irregular
  // branches did not, so "is read" scored as past while its own active voice "reads"
  // did not, and every present-tense passive-to-active conversion read as a tense flip.
  assert.notEqual(validateRewrite("The configuration file is read by the loader at startup.",
    rewrite("The loader reads the configuration file at startup.")).reason, "tense-changed");
  assert.notEqual(validateRewrite("The tickets are reviewed by the on-call engineer every morning.",
    rewrite("The on-call engineer reviews the tickets every morning.")).reason, "tense-changed");
  // A PAST passive is still past: only the present auxiliaries license the exemption.
  assert.equal(validateRewrite("The service was decommissioned last quarter.",
    rewrite("The team decommissions the service.")).reason, "tense-changed");
});

test("SPAN-3: the governing auxiliary is found past any run of adverbs", () => {
  // Skipping a fixed number made the test asymmetric — one adverb counted as present
  // tense and two did not — so merely dropping an adverb read as a tense flip.
  assert.equal(validateRewrite("The valve is very completely sealed.",
    rewrite("The valve is completely sealed.")).accepted, true);
  assert.equal(validateRewrite("The valve is completely sealed.",
    rewrite("The valve is sealed.")).accepted, true);
});

// ---------------------------------------------------------------------------
// Span-scoped guards, round 4: an inflection of a source word is not an invention.
// ---------------------------------------------------------------------------

test("SPAN-4: a voice conversion's verb traces back to the source", () => {
  // vocabularyHasAntecedent scopes its search to the diff RUN a word was inserted in,
  // so in a voice conversion the inserted "reads" and the removed "read" land in
  // different runs and never meet. The whole-source fallback was a literal match, which
  // does not cross the inflection.
  assert.equal(validateRewrite("The configuration file is read by the loader at startup.",
    rewrite("The loader reads the configuration file at startup.")).accepted, true);
  assert.equal(validateRewrite("The tickets are reviewed by the on-call engineer every morning.",
    rewrite("The on-call engineer reviews the tickets every morning.")).accepted, true);
});

test("SPAN-4: a protected token is an atom, not prose the writer used", () => {
  // Found by the false-unlock control on a recorded refusal: without stripping them,
  // the "bulletins" inside the URL licensed the model to introduce "the bulletin at"
  // as though the word were already in the sentence.
  assert.equal(validateRewrite("Consult https://example.test/bulletins for updates.",
    rewrite("Consult the bulletin at https://example.test/bulletins for updates.")).reason,
  "word-substituted");
});

test("SPAN-4: an unrelated substitution is still an invention", () => {
  assert.equal(validateRewrite("The deadline passed on Tuesday.",
    rewrite("The deadline expired on Tuesday.")).reason, "word-substituted");
  assert.equal(validateRewrite("The instructions were confusing.",
    rewrite("The instructions were clear.")).accepted, false);
});

// ---------------------------------------------------------------------------
// Span-scoped guards, round 5: certainty. English spells politeness, futurity and
// commitment with the same handful of words, and counting them across a whole sentence
// cannot tell the three apart. Each test below pins one side of that split, and every
// one has a companion asserting the guard still refuses the case it exists for.
// ---------------------------------------------------------------------------

test("SPAN-5: a politeness 'would' is not a commitment", () => {
  // The softener is the only thing that leaves, and the request is as tentative after
  // the edit as before it. Labelled UNINTENDED in oracle-labels.json.
  assert.equal(validateRewrite("Would it be possible for you to provide us with an updated estimate?",
    rewrite("Could you provide an updated estimate?")).accepted, true);
  assert.equal(validateRewrite("I would like to propose a shorter retry window.",
    rewrite("I propose a shorter retry window.")).accepted, true);
});

test("SPAN-5: a conditional or reported 'would' still refuses", () => {
  // Only the listed collocations are softeners. A "would" that carries the sentence's
  // modality is untouched by the normalisation and empties its group as before.
  assert.equal(validateRewrite("We would ship on Friday if the tests passed.",
    rewrite("We ship on Friday if the tests pass.")).reason, "certainty-changed");
  assert.equal(validateRewrite("It was decided that the feature flag would remain on for now.",
    rewrite("We decided to keep the feature flag on for now.")).reason, "certainty-changed");
});

test("SPAN-5: a raising hedge over an evidential verb is one hedge, not two", () => {
  // "would seem to suggest" hedges the same claim twice — and is on Grammarly's own
  // periphrasis list. What survives is "suggest", which asserts nothing either.
  assert.equal(validateRewrite("The data would seem to suggest that there is a correlation between the two variables.",
    rewrite("The data suggest a correlation between the two variables.")).accepted, true);
  assert.equal(validateRewrite("The report seems to indicate that latency rose.",
    rewrite("The report indicates that latency rose.")).accepted, true);
});

test("SPAN-5: a modal standing over content, not over a hedge, still refuses", () => {
  // The discriminator is position. In "could suggest" the modal governs the evidential
  // verb and dropping it asserts what the writer only entertained; in "suggest that we
  // perhaps delay" the dropped hedge sits INSIDE the suggestion and takes nothing away.
  assert.equal(validateRewrite("The data could suggest a correlation.",
    rewrite("The data suggest a correlation.")).reason, "certainty-changed");
  assert.equal(validateRewrite("The tool could recommend an action.",
    rewrite("The tool recommends an action.")).reason, "certainty-changed");
  assert.equal(validateRewrite("I suggest that we perhaps delay the announcement.",
    rewrite("I suggest we delay the announcement.")).accepted, true);
});

test("SPAN-6: a softening 'just' is not an exclusive", () => {
  // "Just to give a quick update" restricts nothing. Labelled UNINTENDED.
  assert.equal(validateRewrite("Just to give a quick update on where we are with the integration work.",
    rewrite("To give a quick update on where we are with the integration work.")).accepted, true);
  // The exclusive keeps its guard in all three of its shapes: before a number, before a
  // determiner, and mid-sentence before a verb.
  assert.equal(validateRewrite("Just three tenants have enabled the beta feature.",
    rewrite("Three tenants have enabled the beta feature.")).reason, "quantifier-changed");
  assert.equal(validateRewrite("We shipped just the config change.",
    rewrite("We shipped the config change.")).reason, "quantifier-changed");
  assert.equal(validateRewrite("The service just writes to the replica.",
    rewrite("The service writes to the replica.")).reason, "quantifier-changed");
});

test("SPAN-6: 'most' is a bound only in 'at most'", () => {
  // A word can sit in two quantifier groups and mean a different thing in each. The
  // bound sense used to fire on every ordinary "most cases", so the periphrasis trade
  // "in the majority of cases" -> "in most cases" read as a bound arriving from nowhere.
  assert.equal(validateRewrite("In the majority of cases, the retry logic recovers the request.",
    rewrite("In most cases, the retry logic recovers the request.")).accepted, true);
  assert.equal(validateRewrite("The queue holds at most four hundred jobs.",
    rewrite("The queue holds four hundred jobs.")).reason, "quantifier-changed");
  // The trade is a one-way door: a periphrasis may collapse to the plain word, never
  // the other way round.
  assert.equal(validateRewrite("In most cases, the retry logic recovers the request.",
    rewrite("In the majority of cases, the retry logic recovers the request.")).reason,
  "quantifier-changed");
});

test("SPAN-6: a negative pronoun is a negation", () => {
  // Found while working the quantifier family, and the more serious half of it: none of
  // "nobody", "nothing", "nowhere" or "no one" matches "\\bno\\b", so the negation tally
  // never saw them and BOTH of these meaning inversions were accepted outright.
  assert.equal(validateRewrite("The service writes nothing to the primary.",
    rewrite("The service writes to the primary.")).reason, "negation-changed");
  assert.equal(validateRewrite("We looked everywhere and found nothing.",
    rewrite("We looked everywhere.")).reason, "negation-changed");
  assert.equal(validateRewrite("The audit found nobody at fault.",
    rewrite("The audit found people at fault.")).reason, "negation-changed");
});

// ---------------------------------------------------------------------------
// Precision round 1: defects found by auditing what the gate ACCEPTS, rather than
// what it refuses. bench/corpus/accepted-labels.json is the hand reading; these are
// the rows it exposed. Every one of these rewrites was reaching the writer.
// ---------------------------------------------------------------------------

test("PREC-1: a survivor elsewhere in the sentence is not the deleted word's meaning", () => {
  // English repeats content words constantly, and a SET of survivors cannot tell a word
  // that was carried from a word that merely occurs twice. Here the second "right"
  // excused deleting the first — and with it, which of the two boosters struck the wing.
  assert.deepEqual(lostContentWords(
    "There was evidence that during the breakup sequence, the right Solid Rocket Booster struck the outboard end of the Orbiter's right wing and right outboard elevon.",
    "There was evidence that the Solid Rocket Booster struck the Orbiter's right wing and right outboard elevon during the breakup sequence.",
  ), ["right", "outboard"]);
  // Same shape, and the result was vacuous: "a payload structure and a structure".
  assert.deepEqual(lostContentWords(
    "The spacecraft body structure consists of a payload structure and a spacecraft structure.",
    "The spacecraft body structure consists of a payload structure and a structure.",
  ), ["spacecraft"]);
  // And the related survivor can be a word that was already in the source doing its own
  // job: "summarised" excused deleting "summary", leaving "the briefest possible fault".
  assert.deepEqual(lostContentWords(
    "She summarised the briefest possible summary of the fault.",
    "She summarized the briefest possible fault.",
  ), ["summarised", "summary"]);
});

test("PREC-1: a pro-form carries the noun it stands in for", () => {
  // The count rule must not refuse the ordinary pro-form substitution. "one" points back
  // at the occurrence still standing, so nothing left the sentence.
  assert.deepEqual(lostContentWords("The new process is more efficient than the old process was.",
    "The new process is more efficient than the old one."), []);
  // The antecedent has to BE standing. Here there is nothing for "it" to point at.
  assert.deepEqual(lostContentWords("Ship the report to Maya.", "Ship it to Maya."), ["report"]);
});

test("PREC-1: connectives keep their own rule", () => {
  // Their repetition is governed by distinct membership in the discourse guard, which
  // exists so this tidy is allowed; counting occurrences here would contradict it.
  assert.deepEqual(lostContentWords(
    "Because the vendor missed the deadline and because the budget was committed, we descoped.",
    "Because the vendor missed the deadline and the budget was committed, we descoped.",
  ), []);
});

test("PREC-6: a dissolved coordination is refused, not put to the verifier", () => {
  // "smaller and more reliable" -> "smaller" drops an asserted property and loses exactly
  // ONE content word, which is the case the deletion policy defers. Asked whether
  // "reliable" was already implied, the 2B verifier said yes. Nothing is implied by the
  // word it was coordinated WITH — that is what "and" means — so it is settled here.
  assert.deepEqual(lostContentWords("The end result was a smaller and more reliable component.",
    "The end result was a smaller component."), ["reliable"]);
  assert.equal(dropsConjunct("The end result was a smaller and more reliable component.",
    "The end result was a smaller component.", ["reliable"]), true);
  // A fixed binomial says once what it appears to say twice.
  assert.equal(dropsConjunct("First and foremost, we need to confirm the account owner.",
    "First, we need to confirm the account owner.", ["foremost"]), false);
  // And a coordination the rewrite keeps is not a coordination it dissolved.
  assert.equal(dropsConjunct("Bring the manual, the torque wrench and a spare seal.",
    "Bring the manual, torque wrench, and spare seal.", []), false);
});

test("PREC-7: a word the sentence still contains, only fewer times, is refused not deferred", () => {
  // "a payload structure and a spacecraft structure" -> "and a structure" leaves
  // "spacecraft" standing earlier in the sentence, doing different work. This is the one
  // case where the verifier's question invites the wrong answer, because a copy of the
  // word IS what survives — asked about this very sentence it replied that "spacecraft"
  // was "already implied by the noun 'spacecraft structure'".
  assert.equal(dropsRepeatedWord(
    "The spacecraft body structure consists of a payload structure and a spacecraft structure.",
    "The spacecraft body structure consists of a payload structure and a structure.",
    ["spacecraft"],
  ), true);
  // A word that occurred once and left is an ordinary deletion, and the verifier's
  // question about it is a fair one.
  assert.equal(dropsRepeatedWord("The consultant logged 31 hours against the job.",
    "The consultant logged 31 hours.", ["job"]), false);
});

test("PREC-8: a deadline phrase that got shorter moved the deadline", () => {
  // Same preposition, same time it governs, fewer words between: "until end of day
  // tomorrow" -> "until tomorrow" keeps both ends and moves the deadline earlier by most
  // of a day. Nothing was swapped, so the preposition guard cannot see it, and the loss
  // is one content word, so the policy deferred it to a verifier that showed it.
  assert.equal(deadlineNarrowed(
    "Just a heads up the design review ran long so the mockups won't be ready until end of day tomorrow.",
    "Just a heads up the design review ran long, so the mockups won't be ready until tomorrow.",
    ["day"],
  ), true);
  // The time itself has to survive. A phrase that went entirely is an ordinary deletion
  // and the policy already has an opinion about it.
  assert.equal(deadlineNarrowed("Ice closed the access track for a week.",
    "Ice closed the access track.", ["week"]), false);
  // And a rewrite that touches no deadline phrase is not one.
  assert.equal(deadlineNarrowed("Deliver the parts before 5 and invoice us after 6.",
    "Deliver the parts before 5, and invoice us after 6.", []), false);
});

test("PREC-9: a comma that moved across a subordinator re-attached its clause", () => {
  // The source makes the STALL conditional on the rate limits; the rewrite makes the
  // FLAGGING conditional on them. No word changed, so no other signature sees it.
  assert.equal(validateRewrite(
    "Wanted to flag a risk early, if the API rate limits kick in during peak hours the whole checkout flow could stall.",
    rewrite("Wanted to flag a risk early if the API rate limits kick in during peak hours, as the whole checkout flow could stall."),
  ).reason, "order-changed");
  // A comma ARRIVING in front of a subordinator is an ordinary punctuation repair.
  assert.equal(validateRewrite(
    "The loads measured on the struts are good indicators of stress since all loads are carried through the struts.",
    rewrite("The loads measured on the struts are good indicators of stress, since all loads are carried through the struts."),
  ).accepted, true);
  // And a comma that goes rather than moves is a tidy, not a re-attachment.
  assert.equal(validateRewrite("We shipped, because the tests passed.",
    rewrite("We shipped because the tests passed.")).accepted, true);
});

test("PREC-10: a verb's object and its locative phrase folded into one compound", () => {
  // "the failure in the incident log" says where the failure was documented; "the
  // incident log failure" says what failed. Every content word survives and only "in"
  // goes, so this was the last CHANGED rewrite the gate accepted outright.
  assert.equal(validateRewrite("Ravi documented the failure in the incident log.",
    rewrite("Ravi documented the incident log failure.")).reason, "order-changed");
  assert.equal(validateRewrite("She posted the notice on the board.",
    rewrite("She posted the board notice.")).reason, "order-changed");
  // A subject's own modifier compounds safely: nothing else could have been in the
  // schedule, so the attachment was never open.
  assert.equal(validateRewrite("The changes in the schedule were approved.",
    rewrite("The schedule changes were approved.")).accepted, true);
  // "of" is never ambiguous that way, and folding it is an ordinary compression.
  assert.equal(validateRewrite("The failure of the pump was logged.",
    rewrite("The pump failure was logged.")).accepted, true);
  // A phrase that stays a phrase is untouched, whatever else changed around it.
  assert.equal(validateRewrite("Ravi made a note of the failure in the incident log.",
    rewrite("Ravi noted the failure in the incident log.")).accepted, true);
});

test("PREC-11: a topic complement dropped while its nominal became a verb of ruling", () => {
  // "a determination regarding the budget" rules on the budget; "determine the budget"
  // sets it. The light-verb frame is rightly read as carried, and the only word that
  // said which the writer meant was the preposition — one content word, so the policy
  // put it to a verifier whose question cannot reach a sense shift.
  assert.equal(validateRewrite("The committee will make a determination regarding the revised budget.",
    rewrite("The committee will determine the revised budget.")).reason, "word-substituted");
  assert.equal(validateRewrite("The board reached a decision on the merger.",
    rewrite("The board decided the merger.")).reason, "word-substituted");
  // For most verbs the topic IS the object, and unpacking is a compression: nothing
  // here is refused by this guard, whatever the deletion policy later says.
  assert.notEqual(validateRewrite("Rina provided an explanation regarding the new approval process.",
    rewrite("Rina explained the new approval process.")).reason, "word-substituted");
  // "of" already made the complement an object; nothing changes sense.
  assert.equal(validateRewrite("The committee will make a determination of the revised budget.",
    rewrite("The committee will determine the revised budget.")).accepted, true);
});

test("PREC-12: a commonly confused spelling resolved by deriving from it", () => {
  // "loose" here is "lose" misspelt. The rewrite read the spelling as written and built
  // "loosening" on it — a verb the writer never used, doing something else to the
  // alignment. One content word lost, so the policy sent it to a verifier whose question
  // cannot see that the source word was already the wrong one.
  assert.equal(validateRewrite("Make sure you loosen the bolts before you loose the alignment.",
    rewrite("Make sure you loosen the bolts before loosening the alignment.")).reason, "word-substituted");
  // The swap to the partner is the repair CONFUSABLES exists to license.
  assert.equal(validateRewrite("Make sure you loosen the bolts before you loose the alignment.",
    rewrite("Make sure you loosen the bolts before you lose the alignment.")).accepted, true);
  // A plain inflection of a confusable is a form of it, not a new word: untouched.
  assert.equal(validateRewrite("She will lead the team during the audit.",
    rewrite("She will be leading the team during the audit.")).accepted, true);
  // Likewise when the inflection is the very word that replaced the confusable: "affected"
  // begins with "affect" and is a form of it, so nothing was resolved by the derivation.
  assert.equal(validateRewrite("The change had an affect on the schedule.",
    rewrite("The change affected the schedule.")).accepted, true);
});

test("PREC-2: a word inside a protected token is not the writer's vocabulary", () => {
  // The content-word list already stripped protected tokens; the literal fallback beside
  // it still read the raw source, so "audit" inside /srv/reports/audit.md licensed
  // "the audit notes". Same hole the false-unlock control once found with a URL.
  assert.equal(validateRewrite("Read the notes in /srv/reports/audit.md before the meeting.",
    rewrite("Read the audit notes in /srv/reports/audit.md before the meeting.")).reason,
  "word-substituted");
});

test("PREC-5: an agentless passive introduced over an active verb moves the subject", () => {
  // "Will the parts clear inspection?" asks whether the parts pass it; "Will the parts
  // be cleared for inspection?" asks whether someone will authorise them to undergo it.
  // rolesFlipped cannot see this: it needs a "by" phrase to compare, and there is none.
  assert.equal(validateRewrite("Will the parts clear inspection before Friday?",
    rewrite("Will the parts be cleared for inspection before Friday?")).reason, "order-changed");
  // Voice conversions in both directions, with the agent named, stay accepted.
  assert.equal(validateRewrite("The loader reads the configuration file at startup.",
    rewrite("The configuration file is read by the loader at startup.")).accepted, true);
  assert.equal(validateRewrite("The configuration file is read by the loader at startup.",
    rewrite("The loader reads the configuration file at startup.")).accepted, true);
  // A progressive repair leaves its auxiliary where it was, so no auxiliary is inserted.
  assert.equal(validateRewrite("She is listen to the operator.",
    rewrite("She is listening to the operator.")).accepted, true);
});

test("PREC-4: swapping one deadline preposition for another moves the boundary", () => {
  // "before Thursday" excludes Thursday and "by Thursday" includes it, and nothing
  // noticed: both are function words and no content word moved. The source needed no
  // edit at all. Refused in both directions.
  assert.equal(validateRewrite("Could you send the revised drawings before Thursday?",
    rewrite("Could you send the revised drawings by Thursday?")).reason, "direction-changed");
  assert.equal(validateRewrite("The report is due by Friday.",
    rewrite("The report is due before Friday.")).reason, "direction-changed");
  // "by" alone cannot be guarded — it marks the agent of every passive in the language,
  // and this rewrite is one the gate deliberately accepts.
  assert.equal(validateRewrite("The migration was delayed for a period of three weeks.",
    rewrite("The migration was delayed by three weeks.")).accepted, true);
  assert.equal(validateRewrite("The report was signed before noon by the auditor.",
    rewrite("The auditor signed the report before noon.")).accepted, true);
});

test("PREC-3: a lone derivational swap is not a repair", () => {
  // related() treats a derivational tail as an inflection, which is right nearly
  // everywhere — it is what lets "a proposal" become "proposed" — and wrong when the
  // derivation is the entire edit: "tested the bonding" and "tested the bond" are
  // different claims about what was tested.
  assert.equal(validateRewrite("On Tuesday the electrician tested the bonding.",
    rewrite("On Tuesday the electrician tested the bond.")).reason, "word-substituted");
  // Inflections, confusables and multi-word rewrites are all untouched.
  assert.equal(validateRewrite("Every students must submit the waiver.",
    rewrite("Every student must submit the waiver.")).accepted, true);
  assert.equal(validateRewrite("The outage effected every customer.",
    rewrite("The outage affected every customer.")).accepted, true);
  assert.equal(validateRewrite("We conducted a review of the invoices.",
    rewrite("We reviewed the invoices.")).accepted, true);
  // Under a be-auxiliary "-ing" is the progressive, and supplying it IS the repair.
  assert.equal(validateRewrite("She is listen to the operator.",
    rewrite("She is listening to the operator.")).accepted, true);
});

test("PREC-1: 'process' is padding only in 'in the process of'", () => {
  // It sat in STOCK_PHRASE_NOUNS, which made it free to delete anywhere.
  assert.deepEqual(lostContentWords("The engineers are in the process of preparing the release package.",
    "The engineers are preparing the release package."), []);
  assert.deepEqual(lostContentWords("The alpha process is fast and the beta process is slow.",
    "The alpha process is fast and the beta is slow."), ["process"]);
});

// ---------------------------------------------------------------------------
// Span-scoped guards, round 7: the long tail. Each of these guards was refusing a
// rewrite for something the sentence had not done — a path that had not moved, an
// agent that was a duration, roles with nothing to flip, a "not" that spells rather
// than denies. Every one is paired with the case it must still catch.
// ---------------------------------------------------------------------------

test("SPAN-9: a path is recognised by what precedes the slash, not by a space", () => {
  assert.deepEqual(protectedTokenList("The config file (/etc/app/config.yaml) must be readable."),
    ["/etc/app/config.yaml", "config.yaml"]);
  // The lookbehind still keeps "and/or" and the inside of a URL out.
  assert.deepEqual(protectedTokenList("Choose the primary and/or the replica."), []);
  assert.deepEqual(protectedTokenList("Read https://example.test/a for detail."),
    ["https://example.test/a"]);
  assert.equal(validateRewrite("The config file (/etc/app/config.yaml) must be readable.",
    rewrite("The config file (/etc/app/other.yaml) must be readable.")).reason,
  "protected-token-changed");
});

test("SPAN-9: a duration after 'by' is not an agent", () => {
  // The deadline exclusion caught "by 3 weeks" and missed "by three weeks", so the
  // candidate read as a passive with an agent called three and the rewrite as a
  // reversal of roles it does not have.
  assert.equal(validateRewrite("The migration was delayed for a period of three weeks.",
    rewrite("The migration was delayed by three weeks.")).accepted, true);
  assert.equal(validateRewrite("The outage was caused by the alert.",
    rewrite("The outage caused the alert.")).reason, "order-changed");
});

test("SPAN-9: an expletive passive over a that-clause has no roles to flip", () => {
  assert.equal(validateRewrite("It has been demonstrated by previous research that caching improves throughput.",
    rewrite("Previous research has demonstrated that caching improves throughput.")).accepted, true);
  // Anaphoric "it" stands for something, so the reversal is exactly what it would suffer.
  assert.equal(validateRewrite("It was caused by the alert.",
    rewrite("It caused the alert.")).reason, "order-changed");
});

test("SPAN-9: a 'not' that spells rather than denies", () => {
  assert.equal(validateRewrite("Do you know whether or not the job finished?",
    rewrite("Do you know whether the job finished?")).accepted, true);
  assert.equal(validateRewrite("Please make sure that you do not forget to rotate the credentials.",
    rewrite("Please make sure you rotate the credentials.")).accepted, true);
  // The "fail to" half of the litotes policy is kept: failures() counts it separately.
  assert.equal(validateRewrite("The service failed to notify the customer.",
    rewrite("The service notified the customer.")).reason, "negation-changed");
  assert.equal(validateRewrite("The job did not finish.",
    rewrite("The job finished.")).reason, "negation-changed");
});

test("SPAN-9: an inanimate anaphor names nobody", () => {
  assert.equal(validateRewrite("In the event of a failure, the client will retry the request three times.",
    rewrite("If the request fails, the client will retry it three times.")).accepted, true);
  // Every other family stays guarded, and an "it" that swallows its antecedent is
  // caught by the deletion policy rather than by this guard.
  assert.equal(validateRewrite("The engineer approved the change.",
    rewrite("She approved the change.")).reason, "pronoun-changed");
  assert.deepEqual(lostContentWords("Ship the report to Maya.", "Ship it to Maya."), ["report"]);
});

test("SPAN-9: a failure put straight back is not a failure removed", () => {
  // The inversion rule bills every deletion in its run, which billed the stock noun
  // "event" too. It only applies when the failure actually leaves.
  assert.deepEqual(lostContentWords("In the event of a failure, the client will retry the request three times.",
    "If the request fails, the client will retry it three times."), []);
  assert.deepEqual(lostContentWords("The service failed to notify the customer.",
    "The service notified the customer."), ["failed", "notify"]);
});

test("SPAN-9: a sentence adverbial is not a name, and an epistemic one is still a hedge", () => {
  // "Arguably" had nowhere to be classified, so dropping it was refused as a change of
  // NAME. It belongs with "apparently" in the modal group, which refuses the same edit
  // for the reason its sibling "It could be argued that X" -> "X" is refused.
  assert.equal(validateRewrite("Arguably, the results are fairly encouraging in a general sense.",
    rewrite("The results are fairly encouraging overall.")).reason, "certainty-changed");
  // A real name at the head of a sentence is untouched by the adverbial list.
  assert.equal(validateRewrite("Maya approved the change.",
    rewrite("Priya approved the change.")).reason, "name-changed");
});

// ---------------------------------------------------------------------------
// Span-scoped guards, round 6: the deletion policy. The validator had already
// accepted every rewrite below; the policy then billed the writer for words the
// validator had just excused, and the two halves of the gate disagreed about what
// the sentence said.
// ---------------------------------------------------------------------------

test("SPAN-8: a light verb in an unpacked nominalization carries nothing", () => {
  assert.deepEqual(lostContentWords("They put forward a proposal for restructuring the data model.",
    "They proposed restructuring the data model."), []);
  assert.deepEqual(lostContentWords("The board took the decision to close the office.",
    "The board decided to close the office."), []);
  assert.deepEqual(lostContentWords("Legal undertook a review of the licence terms.",
    "Legal reviewed the licence terms."), []);
});

test("SPAN-8: an idiom built on the same shape keeps its verb billed", () => {
  // The discriminator is the noun. A real nominalization wears a derivational suffix
  // or takes a nominal complement ("a review OF"); "blame" and "issue" do neither, so
  // "took the blame for the outage" -> "blamed the outage" — an inversion — still
  // reports the loss that sends it to the verifier.
  assert.deepEqual(lostContentWords("The engineer took the blame for the outage.",
    "The engineer blamed the outage."), ["took"]);
  assert.deepEqual(lostContentWords("The auditor took issue with the revised figures.",
    "The auditor issued the revised figures."), ["took"]);
});

test("SPAN-8: filler and politeness are spans, not words", () => {
  // Matched as spans because each is built from words that mean something elsewhere.
  assert.deepEqual(lostContentWords("We are flying blind without proper observability in place.",
    "We are flying blind without proper observability."), []);
  assert.deepEqual(lostContentWords("I would just like to suggest that we perhaps delay the announcement.",
    "I suggest we delay the announcement."), []);
  // "in place of" is "instead of" — a different phrase, and its "place" is not filler.
  assert.deepEqual(lostContentWords("We used a spare bolt in place of the broken one.",
    "We used a spare bolt of the broken one."), ["place"]);
});

test("SPAN-8: a hedge is lost only when no hedge is left", () => {
  assert.deepEqual(lostContentWords("There is a chance that the job could possibly time out under load.",
    "The job could time out under load."), []);
  // Nothing hedges the candidate, so the writer's qualification really has gone.
  assert.deepEqual(lostContentWords("There is a chance that the job times out under load.",
    "The job times out under load."), ["chance"]);
});

test("SPAN-8: the policy still bills a real deletion", () => {
  assert.deepEqual(lostContentWords("We shipped the parts to the customer in bulk.",
    "We shipped the parts."), ["customer", "bulk"]);
});

test("SPAN-7: the negator does not carry tense", () => {
  // "not" sits in the same slot as an adverb — "has not been approved", "is not read by
  // the loader" — but the walk that finds the governing auxiliary skipped only adverbs.
  // So "is read" was present while "is not read" was past, and negating a passive
  // flipped its tense: every rewrite that faithfully kept the negation was refused for
  // changing a tense it had not touched. Both of these were refused before.
  assert.equal(validateRewrite("We regret to inform you that your request has not been approved at this time.",
    rewrite("We regret to inform you that we have not approved your request at this time.")).accepted, true);
  assert.equal(validateRewrite("The alert has not been acknowledged by the on-call engineer.",
    rewrite("The on-call engineer has not acknowledged the alert.")).accepted, true);
  // The negation guard is untouched by this: the count still has to match.
  assert.equal(validateRewrite("The alert has not been acknowledged by the on-call engineer.",
    rewrite("The on-call engineer has acknowledged the alert.")).reason, "negation-changed");
});

test("SPAN-7: a verb spelled the same in past and base says nothing about tense", () => {
  // "They put forward a proposal" is past or present depending on nothing the words
  // record, so resolving it to a past contradicts no one. tense() read it as present,
  // which made this nominalization unpack — on Grammarly's own list — look like a flip.
  assert.equal(validateRewrite("The team put forward a proposal for restructuring the data model.",
    rewrite("The team proposed restructuring the data model.")).accepted, true);
  // One-way, and source-side only: an unambiguous present may not become a past, and
  // losing a past is still refused outright.
  assert.equal(validateRewrite("The loader reads the configuration file.",
    rewrite("The loader read the configuration file.")).reason, "tense-changed");
  assert.equal(validateRewrite("The service restarted after the upgrade.",
    rewrite("The service restarts after the upgrade.")).reason, "tense-changed");
});

test("SPAN-6: emphasis is not a counting artefact", () => {
  // "There is no doubt that X" -> "X" is on the list of differences the project keeps
  // on purpose (docs/GRAMMARLY-BEHAVIOUR.md §3, emphasis and nuance dropped), so the
  // "no longer" narrowing above must not reach it.
  assert.equal(validateRewrite("There is no doubt that the current approach will not scale.",
    rewrite("The current approach will not scale.")).reason, "quantifier-changed");
});

test("SPAN-5: the stack rule never licenses a hedge the writer did not write", () => {
  // Relaxation applies to the emptied-group test only. Introducing a hedge, or a
  // second one, is refused exactly as before.
  assert.equal(validateRewrite("I suggest we delay the announcement.",
    rewrite("I suggest we perhaps delay the announcement.")).reason, "certainty-changed");
  assert.equal(validateRewrite("The migration completes on Friday.",
    rewrite("The migration could complete on Friday.")).reason, "certainty-changed");
  // And the documented certainty-strengthening refusals are untouched.
  assert.equal(validateRewrite("It could be argued that the current design is somewhat fragile.",
    rewrite("The current design is somewhat fragile.")).reason, "certainty-changed");
  assert.equal(validateRewrite("Perhaps it might be worth taking another look at the retry policy.",
    rewrite("I recommend taking another look at the retry policy.")).reason, "certainty-changed");
});
