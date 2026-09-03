// The clarity gate: is this sentence even worth a model call?
//
// A generative call costs 300-1000ms of the model's single slot; this costs ~6
// microseconds. Measured on a 40-sentence live mix, 52% of model calls produced nothing
// the writer ever saw, and skipping the sentences the gate clears saves ~40% of model
// time — the cheap end of the cascade Grammarly's own engineering describes (rules and
// a tagger always on; generation only where something looks improvable).
//
// The patterns are surface constructions mined from bench/corpus/grammarly-pairs.json —
// 200 pairs harvested live from Grammarly's editor, organised by construction family —
// and are kept EXACTLY as scored: fires on 88.1% of Grammarly's real rewrites, 12.2% on
// sentences it left unchanged, 9.9% on held-out neutral prose (every number derived
// twice, independently). tests/gate.test.mjs re-runs the corpus scoring with a margin,
// so an edit here that quietly moves the operating point fails there.
//
// The gate only ever decides WHETHER the model is asked. It never edits, so a false
// fire costs one model call and a false clear costs one missed suggestion — the same
// trade Grammarly's paid tier makes against their free one.
//
// Every in-sentence gap is bounded ({0,160} rather than *): an unbounded [^.?!]* after
// a repeating anchor backtracks quadratically, and a pasted unpunctuated 50KB run
// measured seconds per checkGate against the ~6µs the header promises. No corpus
// sentence puts 160 characters between the anchored halves of one construction.

export const FAMILIES = [
  { family: "wordy-phrase", patterns: [
    ["for the purpose of", /\bfor the purpose of\b/i],
    ["in the majority of", /\bin the majority of\b/i],
    ["on account of the fact", /\bon account of the fact\b/i],
    ["with the exception of", /\bwith the exception of\b/i],
    ["the fact that", /\bthe fact that\b/i],
    ["for a period of", /\bfor a period of\b/i],
    ["in accordance with", /\bin accordance with\b/i],
    ["during the course of", /\bduring the course of\b/i],
    ["in the vicinity of", /\bin the vicinity of\b/i],
    ["in order to/for", /\bin order (to|for)\b/i],
    ["at this point in time", /\bat (this point in time|the present moment)\b/i],
    ["prior to", /\bprior to\b/i],
    ["subsequent to", /\bsubsequent to\b/i],
    ["with regard/respect to", /\b(with regard to|in regards to|with respect to)\b/i],
    ["in the event of/that", /\bin the event (of|that)\b/i],
    ["in close proximity", /\bin close proximity\b/i],
    ["a large/significant number of", /\ba (large|significant|considerable) number of\b/i],
    ["has the ability/capability", /\b(ha(s|ve|d) the (ability|capability|capacity)|the capability of)\b/i],
    ["is able to", /\b(is|are|was|were|be) able to\b/i],
    ["makes use of", /\bmake(s)? use of\b/i],
    ["whether or not", /\bwhether or not\b/i],
    ["each and every", /\beach and every\b/i],
    ["as to whether", /\bas to whether\b/i],
    ["in terms of", /\bin terms of\b/i],
    ["on a daily/weekly basis", /\bon a \w+ basis\b/i],
    ["due to the ... nature of", /\bdue to the \w+ nature of\b/i],
    ["it should be noted", /\bit should be noted\b/i],
    ["it is worth noting", /\bit is worth not(ing|ed)\b/i],
    ["it is important to note", /\bit is important to note\b/i],
    ["give consideration to", /\bg(i|a)ve(s|n)? consideration to\b/i],
    ["the reason being", /\bthe reason being\b/i],
    ["the reason why", /\bthe reason why\b/i],
    ["in the process of", /\bin the process of\b/i],
    ["at the end of the day", /\bat the end of the day\b/i],
    ["going forward", /\bgoing forward\b/i],
    ["in a general sense", /\bin a general sense\b/i],
    ["in light of", /\bin light of\b/i],
    ["in the near future", /\bin the near future\b/i],
    ["make changes to", /\bmak(e|es|ing) changes to\b/i],
    ["with the aim of", /\bwith the aim of\b/i],
    ["in spite of the fact", /\bin spite of the fact\b/i],
    ["owing to the fact", /\bowing to the fact\b/i],
  ]},
  { family: "expletive", patterns: [
    ["there is a need for", /\bthere (is|was) a need for\b/i],
    ["there is no doubt that", /\bthere (is|was) no doubt that\b/i],
    ["there be X that/who", /\bthere (is|are|was|were)\s+(a|an|no|many|several|three|four|five|numerous|some)?\s*\w+(\s\w+){0,2}\s+(that|who|which)\b/i],
    ["it is ADJ that", /\bit (is|was) (necessary|essential|important|vital|crucial|clear|evident|apparent|likely|unlikely|possible|probable) that\b/i],
    ["it was VERBed that/by", /\bit (was|has been|had been) (decided|agreed|determined|demonstrated|noted|shown|suggested|reported|observed) (that|by)\b/i],
    ["it is our N that", /\bit (is|was) (our|my|their) \w+ that\b/i],
    ["it has come to our attention", /\bit has come to (our|my) attention\b/i],
    ["it seems (to me) that", /\bit (seems|appears|seemed|appeared) (to (me|us) )?that\b/i],
    ["it could be argued", /\bit (could|can|might) be argued\b/i],
    ["there is a chance that", /\bthere (is|was) a (chance|possibility) that\b/i],
    ["there was agreement that", /\bthere (is|was) (general )?(agreement|consensus) that\b/i],
  ]},
  { family: "passive-by-agent", patterns: [
    ["be PP by AGENT", /\b(is|are|was|were|be|been|being)\s+(all\s+|\w+ly\s+)?\w+(ed|wn|en|ne|lt|ung|eld|ade|aid|ept|ent|old|uilt|ead|one)\s+by\s+(the|a|an|our|their|its|my)\b/i],
  ]},
  { family: "nominalisation", patterns: [
    ["light-verb + deverbal noun", /\b(make|makes|made|making|perform|performs|performed|performing|conduct|conducts|conducted|carry|carries|carried|undertake|undertakes|undertook|give|gives|gave|given|provide|provides|provided|reach|reaches|reached|put|puts|take|takes|took)\b(\s+\w+){0,2}?\s+(a|an|the)?\s*\w*(tion|sion|ment|ance|ence|ysis|proposal|review|comparison|approval|mention|warning)s?\b/i],
    ["is/are in agreement", /\b(is|are|was|were) in (agreement|alignment|compliance)\b/i],
  ]},
  { family: "hedge-stack", patterns: [
    ["it seems to me", /\bit seems to (me|us)\b/i],
    ["I would just like to", /\bi would just like to\b/i],
    ["perhaps it might", /\bperhaps (it|we) (might|may|could)\b/i],
    ["could possibly", /\b(could|might|may) possibly\b/i],
    ["may want to consider", /\b(may|might) want to consider\b/i],
    ["arguably (sentence-initial)", /^arguably,/i],
  ]},
  { family: "redundant-pair", patterns: [
    ["revert back", /\brevert(s|ed|ing)? back\b/i],
    ["advance warning", /\badvance (warning|planning|notice)\b/i],
    ["consensus of opinion", /\bconsensus of opinion\b/i],
    ["cooperate together", /\b(cooperat|collaborat|join|merg)\w* together\b/i],
    ["brand new", /\bbrand new\b/i],
    ["end result", /\bend result\b/i],
    ["final outcome", /\bfinal outcome\b/i],
    ["exact same", /\bexact same\b/i],
    ["repeat ... again", /\brepeat\b[^.?!]{0,25}\bagain\b/i],
    ["plan ahead", /\bplan(s|ned|ning)? ahead\b/i],
    ["complete(ly) and total(ly)", /\bcomplete(ly)? and total(ly)?\b/i],
    ["basic fundamentals", /\bbasic fundamentals\b/i],
    ["past history / future plans", /\b(past history|future plans|added bonus|unexpected surprise)\b/i],
  ]},
  { family: "relative-bloat", patterns: [
    ["which/that/who + be", /\b(which|that|who) (is|are|was|were)\b/i],
  ]},
  { family: "run-on-coordination", patterns: [
    ["chained pronoun clauses", /\b(and|but|or)\s+(then\s+)?(we|it|they|i)\b[^.?!]{0,160}\b(and|but|or)\s+(then\s+|after that\s+)?(we|it|they|i)\b/i],
    ["repeated subordinator", /\b(because|if|after|although|when)\b[^,.;]{3,60}\band\s+(because|if|after|although|when)\b/i],
  ]},
  { family: "parallelism-fault", patterns: [
    ["mixed gerund/infinitive/that list", /,\s*(to\s+\w+|that\s+\w+|\w+ing\b|\w+\s+of\s+the\b)[^.?!]{0,160},\s*and\s+(then\s+)?(to\s+\w+|that\s+\w+|\w+ing\b|it\s|\w+\s+must\b)/i],
  ]},
  { family: "wordy-phrase-2", patterns: [
    ["a number of", /\b(a number of|there remains? )\b/i],
    ["the present study", /\bthe present (study|paper|report|work)\b/i],
    ["seeks to investigate", /\b(seeks?|aims?) to (investigate|examine|explore|determine|assess)\b/i],
    ["would seem to", /\bwould (seem|appear) to\b/i],
    ["results obtained from", /\b(results|data|findings) obtained\b/i],
    ["methodology employed", /\b(methodology|method|approach) (employed|utilised|utilized)\b/i],
    ["enable us to", /\benable(s|d)? (us|you|them|me) to\b/i],
    ["circle back / touch base", /\b(circle back|touch base|reach out)\b/i],
    ["do not hesitate to", /\bdo not hesitate to\b/i],
    ["has not been VERBed", /\b(has|have|had) not been \w+(ed|en|wn)\b/i],
    [", having VERBed,", /,\s*having \w+(ed|en|wn)\b/i],
    ["parenthetical (which ...)", /\(\s*(which|that|who)\b/i],
    ["chained modal pronoun", /\b(we|they|i|it) (could|can|should|would|will) \w+[^.?!]{0,160}\b(or|and)\s+(we|they|i|it)\s+(could|can|should|would|will)\b/i],
  ]},
  { family: "parallelism-2", patterns: [
    // The gerund is boundary-anchored and bounded: a bare \w+ing made every position
    // inside one long pasted token (a hash, a base64 blob) a candidate start, which
    // was quadratic all over again.
    ["gerund list + and to VERB", /\b\w{1,40}ing\b[^.?!]{0,160},\s*and\s+to\s+\w+/i],
    ["wh-clause inside list", /,\s*(what|how|who|when)\s+\w+[^,]{0,160},\s*and\b/i],
  ]},
  { family: "question-bloat", patterns: [
    ["would it be possible for you", /\bwould it be possible for (you|us|me)\b/i],
    ["do you happen to know", /\bdo you happen to know\b/i],
    ["let me know what X is", /\blet me know what\b[^.?!]{0,160}\bis\?/i],
    ["do not forget to", /\bdo not forget to\b/i],
    ["provide us with", /\bprovide (us|me|them|you) with\b/i],
    ["wanted to reach out", /\bwanted to reach out\b/i],
    ["just to give", /^just to\b/i],
    ["the question of who/what", /\bthe question of (who|what|whether|how)\b/i],
  ]},
];

const PATTERNS = FAMILIES.flatMap((entry) =>
  entry.patterns.map(([name, pattern]) => ({ family: entry.family, name, pattern })),
);

// First hit wins: the caller only needs a yes and a reason for diagnostics.
export function checkGate(sentence) {
  for (const { family, name, pattern } of PATTERNS) {
    if (pattern.test(sentence)) return { family, name };
  }
  return null;
}
