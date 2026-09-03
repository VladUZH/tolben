// One completed sentence in, at most one validated suggestion out.
//
// Stage 1 repairs unquestionably mechanical faults deterministically.
// Stage 2 asks the local model for a clarity decision on the repaired text.
// Stage 3 refuses any model output that fails deterministic safety validation.
//
// Precedence, cheapest-first but not equally trusted. A fired clarity RULE is a FLOOR,
// not a full stop: it is first-party and context-free, so it outranks every other
// deterministic answer, but returning it outright meant the model was never asked about
// a sentence a rule happened to touch — and a rule only ever repairs the wordiness it
// matched. "In order to ship, the tests was run." was answered "To ship, the tests was
// run.", with the agreement error shipped to the writer and the sentence then marked
// decided. The rule's answer is now held as a candidate the model supersedes.
//
// The model is always shown `base` — the mechanically repaired ORIGINAL. A deterministic
// tier's output must not become the text the model reasons about, or the model would
// polish that tier's error instead of overruling it.
//
// Attribution is kept per stage so that a report can never credit the model for
// a rule's work, or a rule for the model's.

import { repairMechanics } from "./mechanics.mjs";
import { checkGate } from "./gate.mjs";
import { applyClarityRules } from "./clarity-rules.mjs";
import { markupTokens, protectedTokens } from "./safety.mjs";
import { explainEdit } from "./explain.mjs";
import { changedSourceRanges } from "./diff.mjs";
import {
  validateRewrite, lostContentWords, deletesTrailingPhrase, dropsConjunct,
  dropsRepeatedWord, deadlineNarrowed, dropsScopeWord,
} from "./safety.mjs";

// What the writer is told, built from the diff we computed rather than from the model's
// account of its own edit. The mechanical pass's own wording is only a last resort: a
// repair the diff names nothing for is refused before this runs, so in practice the
// derived sentence is always there.
function describe(source, replacement, mechanical) {
  const derived = explainEdit(source, replacement);
  if (derived) return derived;
  return mechanical?.reason ?? "";
}

// What a deterministic rule could break from outside its own table. Markup tokens must
// be identical on both sides (a phrase straddling a delimiter would eat it), and every
// protected term — inline code, link text — must survive with its occurrence count
// intact, or the rewrite has reached inside something the writer marked untouchable.
function ruleRewriteSafe(source, replacement, protectedTerms) {
  const before = markupTokens(source);
  const after = markupTokens(replacement);
  if (before.length !== after.length || before.some((token, index) => token !== after[index])) return false;
  // The same boundary-aware occurrence sequence the validators use: a bare substring
  // count read the "use" inside "uses" as the protected word surviving, so this tier
  // surfaced the exact deletion the other two refuse.
  const protectedBefore = protectedTokens(source, protectedTerms);
  const protectedAfter = protectedTokens(replacement, protectedTerms);
  return protectedBefore.length === protectedAfter.length
    && protectedBefore.every((token, index) => token === protectedAfter[index]);
}

// Count and frequency adverbs. Dropping one loses how many times something happened, and
// no word that survives the edit implies it back. The 2B verifier was measured approving
// exactly this deletion ("counted the coins twice" -> "counted the coins"), so the class is
// refused here instead of being put to it — the same call the verifier prompt already
// makes for "again", now made deterministically.
// Exported so the scorer and the redteam suite consult THIS set rather than a copy
// that drifts.
export const NEVER_VERIFY = new Set(["twice", "once", "thrice", "repeatedly", "rarely", "frequently", "again"]);

export async function analyzeSentence(
  sentence,
  { engine, signal, mechanics = true, verify = true, deletionPolicy = "verify", protectedTerms = [], gate = false, rules = false } = {},
) {
  const mechanical = mechanics ? repairMechanics(sentence) : null;
  const base = mechanical?.replacement ?? sentence;
  // A fired clarity rule, held as a candidate the model supersedes — see the precedence
  // note above.
  let ruleFix = null;

  const result = {
    source: sentence,
    replacement: null,
    reason: null,          // derived from the diff, shown to the writer
    modelReason: null,     // what the model said it did, kept for diagnostics only
    stages: { mechanics: Boolean(mechanical), rule: false, model: false },
    gated: false,          // the gate cleared the sentence, so the model was never asked
    rejection: null,       // why this sentence got nothing; null whenever something surfaced
    modelRejection: null,  // why the model's own rewrite was refused, whatever else surfaced
    rejectedText: null,
    latencyMs: 0,
    error: null,
  };

  // Nothing is offered that the writer cannot see. Both questions are asked against the
  // ORIGINAL sentence and never against the repaired `base`, because the original is what
  // is on their screen: a replacement equal to it is not a suggestion at all, and one the
  // diff marks nowhere would arrive as a card with no underline to open it from.
  // Returns the reason it is unshowable, or null when it is fine.
  function unshowable(replacement) {
    if (replacement.trim() === sentence.trim()) return "unchanged";
    if (changedSourceRanges(sentence, replacement).length === 0) return "invisible-edit";
    return null;
  }

  // What is left to offer whenever the model's rewrite is not used — because it was
  // never asked (no engine, gate-cleared), because it kept the sentence, or because
  // safety refused what it said.
  //
  // A whitespace-only mechanical repair has nothing to underline and is dropped rather
  // than surfaced.
  function fallback() {
    if (ruleFix) {
      result.replacement = ruleFix.replacement;
      result.reason = ruleFix.reason;
      result.stages.rule = true;
      return result;
    }
    if (!mechanical || unshowable(base)) return result;
    result.replacement = base;
    result.reason = describe(sentence, base, mechanical);
    return result;
  }

  // A refused model rewrite is not this sentence's outcome while the mechanical repair
  // still has something to show. Recording it as `rejection` in that case would let a
  // report count the same sentence as surfaced and rejected at once.
  function refuse(reason, rejectedText) {
    result.modelRejection = reason;
    result.rejectedText = rejectedText;
    fallback();
    if (!result.replacement) result.rejection = reason;
    return result;
  }

  // Deterministic clarity rewrites: idioms whose short form means the same thing in
  // every context, mined from the Grammarly corpus and refereed against it. It costs
  // microseconds and gives the same answer every time. The rules are first-party code
  // with their own referee tests, so the model-output safety gauntlet does not run on
  // them; what does run is what a rule could genuinely break from outside its own table:
  // markup and protected terms must survive, and the result must be showable.
  //
  // What survives is a CANDIDATE, not the outcome: the model is still asked about this
  // sentence, and is shown `base` rather than the rule's output, so the safety layer
  // still judges the model's rewrite against the writer's own words — one delta to
  // validate, not two stacked ones whose dropped words no single check can see.
  if (rules) {
    const ruled = applyClarityRules(base);
    if (ruled && ruleRewriteSafe(base, ruled.replacement, protectedTerms) && !unshowable(ruled.replacement)) {
      ruleFix = ruled;
    }
  }

  if (!engine) return fallback();

  // The gate runs on the repaired text — what the model would otherwise be shown. A
  // cleared sentence skips the model entirely: not a refusal (nothing was judged), just
  // a call not worth its 300-1000ms. The mechanical repair, if any, still surfaces.
  if (gate && !checkGate(base)) {
    result.gated = true;
    return fallback();
  }

  let decision;
  try {
    decision = await engine.rewrite(base, { signal });
    result.latencyMs = decision.latencyMs ?? 0;
  } catch (error) {
    // An aborted call is not an answer. The sentence it was asked about has already moved
    // on, so there is nothing to commit and the caller has to see the abort itself.
    if (error?.kind === "aborted" || signal?.aborted) throw error;
    result.error = { kind: error.kind ?? "failed", message: error.message };
    return fallback();
  }

  if (decision.action === "rewrite") {
    const validation = validateRewrite(base, decision, { protectedTerms });
    // Only a rewrite that removes information is worth a second opinion; everything else
    // is committed straight away, which keeps the common case at one model call.
    const lost = validation.accepted ? lostContentWords(base, validation.replacement) : [];
    // Losing two or more content words at once is how a rewrite quietly eats a phrase.
    // The 2B verifier is not reliable enough to adjudicate those, so they are refused
    // outright; a single lost word is the case where "already implied" is plausible,
    // and that is the only question the verifier is asked — except for the one class it
    // was measured getting wrong, which is refused before it can be consulted.
    const countLost = lost.some((word) => NEVER_VERIFY.has(word.toLowerCase()));
    // A conjunct is a second class the verifier was measured getting wrong, and for a
    // reason no prompt is likely to fix: asked whether "reliable" is already implied by
    // the sentence around it, the model said yes. Nothing is implied by the word it was
    // coordinated WITH — that is what "and" means — so this is settled here instead.
    const conjunctLost = dropsConjunct(base, validation.replacement, lost);
    const repeatLost = dropsRepeatedWord(base, validation.replacement, lost);
    const deadlineLost = deadlineNarrowed(base, validation.replacement, lost);
    // Scope words — unless, until, except, only, own — are function words, so most of
    // them never appear in `lost` at all and the verifier is never even asked about
    // them; the two that do appear ("unless", "except") were reaching it and being
    // waved through. One guard settles all five here, before any model is consulted,
    // rather than half of them via NEVER_VERIFY and half not at all.
    const scopeLost = validation.accepted && dropsScopeWord(base, validation.replacement);
    const refuseOutright = countLost || conjunctLost || repeatLost || deadlineLost || scopeLost
      || (deletionPolicy === "refuse"
      ? lost.length > 0
      : lost.length > 1 || (lost.length === 1 && deletesTrailingPhrase(base, validation.replacement)));
    if (validation.accepted && refuseOutright) {
      result.lostWords = lost;
      return refuse("information-dropped", validation.replacement);
    }
    if (validation.accepted && verify && engine.verify && lost.length > 0) {
      let verdict;
      try {
        verdict = await engine.verify(base, validation.replacement, { signal, lost });
      } catch (error) {
        // Symmetrical with the rewrite call above. An abort is not an answer; anything
        // else is a verifier that could not be reached, which fails closed here rather
        // than escaping analyzeSentence and taking the whole sentence down with it.
        if (error?.kind === "aborted" || signal?.aborted) throw error;
        verdict = { verdict: "unavailable", reason: error.message };
      }
      result.lostWords = lost;
      if (verdict.verdict === "unavailable") {
        if (verdict.kind === "aborted" || signal?.aborted) {
          throw Object.assign(new Error(verdict.reason || "Request superseded"), { kind: "aborted" });
        }
        // Fail closed, but say what actually happened: a verifier that could not be
        // reached is an engine failure, and a report must not read it as a refusal.
        // `cause` carries the engine's own classification of WHY the verifier was
        // unavailable. "failed" means unparseable or unrecognisable output — deterministic
        // at temperature 0 for this (source, replacement) pair, so a caller's retry policy
        // must not treat it as a passing outage.
        result.error = { kind: "verifier-unavailable", cause: verdict.kind ?? "transient", message: verdict.reason };
        result.verifierReason = verdict.reason;
        return refuse("verifier-unavailable", validation.replacement);
      }
      if (verdict.verdict === "hide") {
        result.verifierReason = verdict.reason;
        return refuse("verifier-hidden", validation.replacement);
      }
    }
    if (validation.accepted) {
      // The validator compares the candidate against the repaired `base`, so a rewrite
      // that simply undoes the mechanical repair passes it and lands back on the writer's
      // own sentence. Refusing it here also closes the A -> B -> A loop that gap could
      // drive: the reverted text can no longer be surfaced for the mechanical pass to
      // repair again on the next pass.
      const hidden = unshowable(validation.replacement);
      if (hidden) return refuse(hidden, validation.replacement);
      result.replacement = validation.replacement;
      result.modelReason = decision.reason;
      result.reason = describe(sentence, validation.replacement, mechanical);
      result.stages.model = true;
      return result;
    }
    return refuse(validation.reason, decision.replacement);
  }

  return fallback();
}
