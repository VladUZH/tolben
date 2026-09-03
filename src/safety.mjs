// Deterministic safety validation. A rewrite reaches the UI only by passing every check.
// These rules never generate a suggestion; they only refuse one.

import { tokenize, diffWords } from "./diff.mjs";
import { segmentSentences, isCompleteSentence } from "./segmenter.mjs";

// A reply that rewrites while explaining that nothing is wrong has contradicted itself,
// and in practice such replies delete a clause rather than improve anything.
const KEEP_REASON = /\b(?:already (?:clear|correct|concise|direct)|is clear and (?:direct|correct)|no (?:change|issue|problem)s? (?:is |are )?(?:needed|found))\b/iu;

const INSTRUCTION_OUTPUT =
  /^(?:certainly|okay|sure|here(?:'s| is)|rewritten|revised|improved|suggestion|output)\b[^:]{0,40}:/iu;

// The other shape an assistant's non-answer takes: not a preamble before the rewrite but
// a refusal INSTEAD of one. INSTRUCTION_OUTPUT cannot see these — they carry no leading
// "Here is:" — and the guards that do catch them today catch them for the wrong reason
// ("I will not revise it." is refused as certainty-changed, which tells a maintainer
// nothing about what happened).
//
// A writer may legitimately write any of these sentences themselves, and the model may
// legitimately rewrite one, so the pattern alone is not enough: the guard fires only when
// the candidate ALSO shares no content word with the source, which is what distinguishes
// a reply about the request from a rewrite of the sentence. "I will not attend the
// meeting." -> "I will not attend." keeps "attend" and is untouched.
const REFUSAL_PROSE =
  /^\s*(?:i(?:'m| am)? ?(?:'m)? ?sorry\b|sorry[,.]|i (?:will not|won'?t|cannot|can'?t|do not|don'?t|am unable to|am not able to)\b|as an ai\b|unfortunately[,.]? i\b)|\b(?:violates?|against|contrary to) (?:my|our|the) (?:guidelines?|policy|policies|rules?|content policy)\b|\bi (?:cannot|can'?t|will not|won'?t) (?:help|assist|comply|do that|provide)\b/iu;

function refusesInsteadOfRewriting(source, candidate) {
  if (!REFUSAL_PROSE.test(candidate)) return false;
  const content = (text) => new Set(tokenize(text)
    .filter((token) => !token.space && isContentWord(token))
    .map((token) => token.text.toLowerCase()));
  const before = content(source);
  if (before.size === 0) return false;
  return [...content(candidate)].every((word) => !before.has(word));
}

// Words common enough that a capital at the start of a sentence is no evidence of a name.
// A capitalised word absent from this list is treated as a name and must be preserved,
// so the failure direction is refusing a rewrite rather than corrupting an identity.
// Sentence adverbials, kept as their own list so the alphabetical block below stays
// readable. A capitalised word at the head of a sentence is a name only if it could be
// one, and none of these could: "Arguably, the results are fairly encouraging in a
// general sense." -> "The results are fairly encouraging overall." was refused for
// changing a NAME, because "Arguably" had nowhere else to be classified.
const SENTENCE_ADVERBS = [
  "accordingly", "additionally", "admittedly", "apparently", "arguably", "basically",
  "briefly", "broadly", "certainly", "clearly", "consequently", "conversely",
  "effectively", "essentially", "evidently", "fortunately", "frankly", "frequently",
  "furthermore", "historically", "honestly", "hopefully", "ideally", "importantly",
  "interestingly", "naturally", "nevertheless", "nonetheless", "normally", "notably",
  "obviously", "occasionally", "ordinarily", "particularly", "presumably", "rarely",
  "realistically", "roughly", "strictly", "surely", "technically", "ultimately",
  "undoubtedly",
];

const SENTENCE_STARTERS = new Set([
  ...SENTENCE_ADVERBS,
  "a", "about", "above", "according", "across", "after", "again", "against", "all", "almost",
  "along", "already", "also", "although", "always", "among", "an", "and", "another", "any",
  "anyone", "approximately", "are", "around", "as", "at", "avoid", "based", "be", "because",
  "become", "been", "before", "behind", "being", "below", "beside", "besides", "between",
  "beyond", "both", "but", "by", "can", "cannot", "check", "collect", "come", "compared",
  "concerning", "consider", "consult", "contact", "could", "create", "currently", "data",
  "despite", "did", "do", "does", "doing", "done", "down", "due", "during", "each", "earlier",
  "either", "else", "engineers", "enough", "even", "eventually", "ever", "every", "everyone",
  "everything", "except", "expect", "few", "finally", "first", "following", "for", "from",
  "further", "fewer", "generally", "give", "given", "go", "had", "half", "has", "have", "having", "he",
  "help", "her", "here", "hers", "high", "him", "his", "how", "however", "i", "if", "in",
  "include", "including", "initially", "inside", "instead", "into", "is", "it", "its", "just",
  "keep", "last", "later", "least", "leave", "less", "let", "like", "likely", "little", "long",
  "look", "make", "many", "may", "maybe", "me", "meanwhile", "might", "more", "moreover", "most",
  "much", "must", "my", "near", "nearly", "need", "neither", "never", "new", "next", "no",
  "none", "nor", "not", "note", "nothing", "notice", "now", "of", "off", "often", "on", "once",
  "one", "only", "open", "or", "originally", "other", "others", "otherwise", "our", "ours",
  "out", "outside", "over", "overall", "owing", "past", "per", "perhaps", "please", "plus",
  "possibly", "practically", "previously", "prior", "probably", "provide", "put", "rather", "read",
  "recently", "regarding", "remember", "remove", "results", "review", "run", "same", "see",
  "send", "several", "she", "short", "should", "similarly", "since", "so", "some", "someone",
  "something", "sometimes", "soon", "specifically", "start", "still", "stop", "subsequently",
  "such", "sure", "take", "team", "teams", "than", "thanks", "that", "the", "their", "theirs",
  "them", "then", "there", "therefore", "these", "they", "this", "those", "though", "through",
  "throughout", "thus", "to", "today", "together", "tomorrow", "too", "toward", "towards",
  "try", "typically", "under", "unfortunately", "unless", "until", "up", "upon", "us", "use",
  "used", "users", "using", "usually", "very", "via", "virtually", "was", "we", "well", "were", "what",
  "when", "whenever", "where", "whether", "which", "while", "who", "whose", "why", "will",
  "with", "within", "without", "would", "yes", "yesterday", "yet", "you", "your", "yours",
]);

// Grouped by the commitment they express. Noun and verb forms of one lemma sit in the
// same group so that "made a recommendation" -> "recommended" is not read as a change.
const CERTAINTY_GROUPS = [
  // Epistemic modals: how likely the writer says the claim is. Split from the degree
  // adverbs below, which used to share this group. Conflating them made a stack of two
  // hedges indistinguishable from two unrelated ones, so "could possibly time out" ->
  // "could time out" (same modality, one redundant hedge) could not be told apart from
  // "It could be argued that X is somewhat fragile." -> "X is somewhat fragile." (the
  // claim's own modal gone, a degree word left standing in its place).
  // "chance" and "risk" sit beside "possibility", which was already here: all three are
  // the noun form of the same hedge, and without them "There is a chance that X" -> "X"
  // dropped the writer's whole qualification with nothing to notice it.
  // "arguably" and its siblings sit beside "apparently", which was already here: all of
  // them mark the claim as reported or entertained rather than asserted. Without them
  // "Arguably, the results are encouraging." -> "The results are encouraging." dropped
  // the writer's whole qualification, while the sibling edit "It could be argued that X"
  // -> "X" was refused — the same strengthening, judged two different ways.
  ["may", "might", "could", "perhaps", "possibly", "possible", "possibility", "chance", "risk",
   "likely", "unlikely", "probably", "probable", "apparently", "seems", "seem", "appears",
   "appear", "tendency", "tend", "tends",
   "arguably", "presumably", "supposedly", "reportedly", "allegedly", "conceivably", "ostensibly"],
  // Degree and approximation: how much, not how likely.
  ["generally", "typically", "basically", "essentially", "roughly",
   "mostly", "largely", "broadly", "fairly", "somewhat", "relatively"],
  // "needed" and the bare "suggest"/"advise" were missing while their other inflections
  // were present, so the group emptied on a rewrite that had in fact kept the word:
  // "will be required" -> "is needed" read as a dropped obligation because "needed" was
  // in no group at all. An inflection gap is not a policy.
  ["must", "shall", "required", "requires", "require", "requirement", "need", "needs", "needed",
   "necessary", "necessity", "mandatory", "obligation", "obliged"],
  ["should", "ought", "recommend", "recommends", "recommended", "recommendation", "advise",
   "advises", "advised", "advice", "suggest", "suggests", "suggested", "suggestion"],
  ["will", "would", "promise", "promises", "promised", "commit", "commits", "committed",
   "commitment", "guarantee", "guarantees", "guaranteed"],
  ["can", "cannot", "able", "ability", "unable", "capable", "capability"],
  // Hedges that guard a universal: "nearly every test passed" is not "every test passed".
  ["nearly", "almost", "virtually", "practically"],
];

// Quantity and scope words. Dropping one silently changes what the sentence claims.
const QUANTIFIER_GROUPS = [
  ["all", "every", "each", "any", "both", "either", "neither", "none", "no"],
  ["some", "several", "many", "few", "most", "much", "number", "lot", "lots", "plenty", "majority"],
  ["only", "just", "solely", "exclusively", "merely"],
  ["exactly", "approximately", "about", "around", "roughly", "least", "most"],
  ["always", "never", "sometimes", "often", "rarely", "usually"],
];

// "about" and "around" only approximate when a quantity stands beside them. As plain
// prepositions — "discussed about the budget" — they claim nothing, and trapping them in
// the approximation group blocks a whole family of ordinary repairs.
const APPROXIMATORS = new Set(["about", "around"]);
// A currency symbol before the digits is still a quantity: "about $10" hedges the
// amount exactly as "about ten dollars" does, and dropping the hedge changes the claim.
const QUANTITY_NEIGHBOUR =
  "(?:[$€£¥₹]\\s?\\d[\\d.,]*|\\d[\\d.,]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand|million|billion|half|dozen)";

// Comparative BOUNDS over a quantity. "More than 40% of the tests failed." states a
// floor; "40% of the tests failed." states a point, and every other guard sees the same
// number on both sides, the same words around it, and nothing to object to. These are
// multi-word, so they cannot join QUANTIFIER_GROUPS, whose members are matched one word
// at a time — and "more"/"less" as bare words would collide with the direction table and
// refuse half the comparisons in the language.
//
// A quantity must stand beside the phrase. "more than happy to help" and "it is up to
// the team" bound nothing, and trapping them here would refuse a whole family of
// ordinary repairs. The count must match EXACTLY, not merely not decrease: adding a
// bound the writer did not state ("40%" -> "more than 40%") invents a claim as surely as
// dropping one discards it.
const BOUND_PHRASES = [
  "no more than", "no fewer than", "no less than",
  "more than", "fewer than", "less than", "up to",
];

function boundCounts(text) {
  const lowered = text.toLowerCase();
  return BOUND_PHRASES.map((phrase) =>
    [...lowered.matchAll(new RegExp(`\\b${phrase}\\s+${QUANTITY_NEIGHBOUR}`, "gu"))].length);
}

function boundsPreserved(source, candidate) {
  const before = boundCounts(source);
  const after = boundCounts(candidate);
  return before.every((count, index) => count === after[index]);
}

const PAST_IRREGULAR = new Set([
  "became", "began", "broke", "brought", "built", "came", "chose", "did", "drew", "drove", "fell",
  "felt", "found", "gave", "grew", "had", "held", "kept", "knew", "led", "left", "lost", "made",
  "met", "paid", "ran", "read", "said", "saw", "sent", "set", "spoke", "stood", "took", "told",
  "was", "went", "were", "won", "wrote",
]);

const PROTECTED_PATTERNS = [
  // Money: the symbol is the unit, so "$40" -> "€40" is a change of quantity, not of style.
  /[$€£¥₹]\s?\d[\d.,]*/gu,                                // currency before the amount
  /\d[\d.,]*\s?[$€£¥₹]/gu,                                // currency after the amount
  /https?:\/\/[^\s<>{}[\]]+/giu,                          // URLs
  // Quantifiers bounded to the RFC limits (64-char local part, 63-char labels), which
  // is what keeps the scan linear: an unbounded local part re-walked the whole tail of
  // a long dotted non-email token from every start position — measured seconds of
  // backtracking on a pasted 30KB run.
  /\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})*\.[A-Za-z]{2,24}\b/gu, // email
  // A path is recognised by what precedes the slash, not by a space in front of it: the
  // old "(?:^|\s)" missed every path in brackets, so "(which lives in /etc/app/x.yaml)"
  // -> "(/etc/app/x.yaml)" reported the path as changed when only the words around it
  // had gone. The lookbehind still excludes "and/or" and the inside of a URL.
  /(?<![\w.@+:/-])(?:\/[\w.@+-]+)+/gu,                    // posix paths
  /\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+/gu,               // windows paths
  /\b[\w-]+\.(?:csv|json|log|md|txt|ya?ml|pdf|js|py|sql|xml|html)\b/giu, // file names
  /\b(?:[A-Z]{2,}[A-Z0-9_-]*|[A-Za-z]+_[A-Za-z0-9_]+)\b/gu, // identifiers, API_V2, snake_case
  /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/gu,                        // versions and labels, v2, Q3, phase2b
  /\b\d{1,2}:\d{2}\b/gu,                                  // clock times
  /\[\d+\]/gu,                                            // citations
  /\b\d+(?:[.,]\d+)?\s*(?:(?:ms|s|min|h|hz|khz|mhz|ghz|kb|mb|gb|tb|kib|mib|gib|mm|cm|m|km|kg|g|v|w|kw|volts?|°c|°f|utc)\b|%)/giu,
];

function reject(reason) {
  return { accepted: false, reason };
}

// A SEQUENCE, deliberately not a sorted multiset: "$40 to the vendor, $60 to the client"
// and its reverse hold the same values and pay different people. Sorting made every
// permutation invisible to the numbers, name, and protected-token checks alike.
function sequence(values) {
  return values.map((value) => value.toLowerCase().trim());
}

function same(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function numbers(text) {
  // The optional sign is part of the quantity: "-5 °C" and "5 °C" are different claims.
  // It only counts as a sign when nothing word-like precedes it, so "2020-2021" still
  // reads as two plain numbers rather than a number and a negative one. The sign may
  // span a currency symbol ("-$5" is a negative amount), and the Unicode minus is
  // normalised to ASCII so retyping the glyph is not read as a quantity change.
  // The currency symbol travels with the SIGN only ("-$5" is one negative amount);
  // unsigned "$40" stays a bare number here, so swapping its symbol is still reported
  // as the protected-token change it is.
  return sequence(
    [...text.matchAll(/(?:(?<![\p{L}\p{N}])[-−](?:[$€£¥₹]\s?)?)?\b\d+(?:[.,:]\d+)*(?:st|nd|rd|th)?\b%?/gu)]
      .map((m) => m[0].replace(/−/gu, "-")),
  );
}

// The protected substrings themselves, case and order preserved. The mechanical pass
// uses these to keep its repairs out of URLs, paths, and file names.
export function protectedTokenList(text) {
  return PROTECTED_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[0].trim()),
  );
}

// Markdown markup, in document order.
//
// Structure, not prose: the sentence a writer sees in Obsidian's Live Preview has its
// syntax characters hidden, so a rewrite that drops a `**` or reaches inside a
// `[[wikilink]]` destroys formatting the writer never sees leave. The demo's textarea
// shows the characters, but the loss is just as real there.
//
// One pass over a single alternation, so the alternatives act as precedence: a `**`
// inside inline code is code, and a `*` opening a list item is a list marker. Matching
// each pattern separately would count both twice and order them by pattern rather than
// by position.
const MARKUP_PATTERN = new RegExp([
  "`[^`\\n]*`",                              // inline code, contents included
  // Math only where the delimiters could BE math delimiters: an opener followed by a
  // space is prose, an opener preceded by a digit is postfix currency ("40$"), and
  // "Pay $40 to vendor and $50 to client." must not become one giant markup token
  // that refuses every edit between the amounts. A digit-leading span still counts as
  // math when its content holds no whitespace ("$3x+2$", "$2n$") — real inline TeX
  // very often opens with a digit, and losing its token let a sign flip inside the
  // math through both validator tiers.
  "\\$\\$[^$\\n]+\\$\\$",                       // display math
  "(?<!\\d)\\$(?![\\s\\d$])[^$\\n]*?(?<!\\s)\\$", // inline math
  "(?<!\\d)\\$\\d[^\\s$\\n]*\\$",                // digit-leading inline math, no spaces
  "\\|",                                     // table cell separator
  "!?\\[\\[[^\\]\\n]*\\]\\]",                   // wikilinks and embeds
  "!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)",            // links and images
  "^\\s{0,3}#{1,6}(?=\\s)",                    // heading marker
  "^\\s{0,3}(?:[-*+]|\\d+[.)])(?=\\s)",        // list marker
  "^\\s{0,3}>+(?=\\s|$)",                      // blockquote marker
  // Emphasis delimiters only where they can BE delimiters. " 3 * 4 " is multiplication
  // and `api_key` is an identifier; demanding either survive a rewrite would refuse
  // every edit to the sentence around it.
  "(?<!\\s)(?:\\*{1,2}|~~|==)|(?:\\*{1,2}|~~|==)(?!\\s)",
  "(?<![\\p{L}\\p{N}])_{1,2}|_{1,2}(?![\\p{L}\\p{N}])",
].join("|"), "gmu");

export function markupTokens(text) {
  return [...text.matchAll(MARKUP_PATTERN)].map((match) => match[0].trim()).filter(Boolean);
}

// A \b anchor next to a non-word character can never match, so a term like "--force"
// or ".env" wrapped in \b...\b silently matched NOTHING on either side and its
// protection was void. Word-edged terms keep the boundary; the rest are counted as
// plain substrings, which is exact for the code spans and link text the caller sends.
function occurrenceCount(text, term) {
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + 1);
  }
  return count;
}

const WORD_EDGE = /[\p{L}\p{N}_]/u;

export function protectedTokens(text, extraTerms = []) {
  const values = protectedTokenList(text);
  for (const term of extraTerms) {
    if (!term) continue;
    if (WORD_EDGE.test(term[0]) && WORD_EDGE.test(term[term.length - 1])) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      values.push(...[...text.matchAll(new RegExp(`\\b${escaped}\\b`, "gu"))].map((m) => m[0]));
    } else {
      for (let count = occurrenceCount(text, term); count > 0; count -= 1) values.push(term);
    }
  }
  return values.map((value) => value.trim());
}

// Auxiliary contractions and their expansions. Stripping "'t" off "Don't" leaves "Don",
// which reads as a person's name; "won't" contains no "will", so expanding it looked like
// a commitment appearing from nowhere. Every signature that counts auxiliaries expands
// first, so the contracted and written-out forms describe the same sentence.
const AUX_CONTRACTIONS = new Map([
  ["don't", "do not"], ["doesn't", "does not"], ["didn't", "did not"],
  ["isn't", "is not"], ["aren't", "are not"], ["ain't", "is not"],
  ["wasn't", "was not"], ["weren't", "were not"],
  ["hasn't", "has not"], ["haven't", "have not"], ["hadn't", "had not"],
  ["won't", "will not"], ["can't", "can not"], ["cannot", "can not"],
  ["couldn't", "could not"], ["shouldn't", "should not"], ["wouldn't", "would not"],
  ["mustn't", "must not"], ["shan't", "shall not"], ["mightn't", "might not"],
  ["needn't", "need not"],
]);

// The auxiliary a contraction is built on: "don't" is the verb "do", not the name "Don".
function auxiliaryBase(word) {
  const lowered = word.toLowerCase().replace(/[’]/gu, "'");
  const expansion = AUX_CONTRACTIONS.get(lowered);
  if (expansion) return expansion.split(" ")[0];
  return lowered.replace(/['’](?:re|s|ve|ll|d|m|t)$/u, "").replace(/n['’]$/u, "");
}

function expandAuxiliaries(text) {
  return text.replace(/\b[\p{L}]+(?:['’][\p{L}]+)?\b/gu, (word) => {
    const expansion = AUX_CONTRACTIONS.get(word.toLowerCase().replace(/[’]/gu, "'"));
    return expansion ?? word;
  });
}

// Number words are never names, however they are capitalised. Without this, "Fewer than
// ten tests failed." -> "Ten tests failed." was refused as `name-changed`: the right
// refusal (a floor became a point) reported as a person called Ten. The bound guard
// below now refuses it as `quantifier-changed`, which is what it is.
const NUMBER_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "thousand", "million", "billion", "trillion", "half", "dozen",
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
]);

// Capitalised words, compared case-insensitively so that repairing "monday" -> "Monday"
// is allowed while substituting "Maya" -> "Nadia" is not.
function properNouns(text) {
  // A contraction keeps its stem's status: sentence-initial "You're" is not a name.
  // "Sentence-initial" means the first word, not character zero: an opening bracket or
  // quote must not turn "(The panel" into a sentence about someone called The.
  const opensSentence = (index) => /^[^\p{L}\p{N}]*$/u.test(text.slice(0, index));
  return [...text.matchAll(/\b\p{Lu}[\p{L}’']*\b/gu)]
    .filter((match) => !(opensSentence(match.index) && SENTENCE_STARTERS.has(auxiliaryBase(match[0]))))
    .map((match) => match[0].toLowerCase())
    .filter((word) => !NUMBER_WORDS.has(word));
}

// Every occurrence of a name, in order. The vocabulary is the union of both sides' proper
// nouns so that repairing "monday" -> "Monday" still lines the two sequences up, while
// "Maya emailed Priya" -> "Priya emailed Maya" — same identities, reversed roles — does not.
function nameSequence(text, vocabulary) {
  return [...text.matchAll(/\b[\p{L}][\p{L}’']*\b/gu)]
    .map((match) => match[0].toLowerCase())
    .filter((word) => vocabulary.has(word));
}

function namesPreserved(source, candidate) {
  const vocabulary = new Set([...properNouns(source), ...properNouns(candidate)]);
  if (vocabulary.size === 0) return true;
  return same(nameSequence(source, vocabulary), nameSequence(candidate, vocabulary));
}

// Personal pronouns grouped by referent. A swap changes who the sentence is about, and
// pronouns are function words, so nothing else in the gate looks at them. Only a referent
// the source never mentioned is refused: dropping the expletive in "It is the case that
// the queue is empty" is an ordinary compression, not a lost person.
const PRONOUN_FAMILIES = [
  ["i", "me", "my", "mine", "myself"],
  ["we", "us", "our", "ours", "ourselves"],
  ["you", "your", "yours", "yourself", "yourselves"],
  ["he", "him", "his", "himself"],
  ["she", "her", "hers", "herself"],
  ["they", "them", "their", "theirs", "themselves"],
  ["it", "its", "itself"],
];

function pronounFamilies(text) {
  const present = new Set();
  for (const match of text.matchAll(/\b[\p{L}]+(?:['’][\p{L}]+)*\b/gu)) {
    const base = match[0].toLowerCase().replace(/['’](?:re|s|ve|ll|d|m)$/u, "");
    const index = PRONOUN_FAMILIES.findIndex((family) => family.includes(base));
    if (index >= 0) present.add(index);
  }
  return present;
}

// The "it" family, which is the last entry in PRONOUN_FAMILIES.
const IT_FAMILY = PRONOUN_FAMILIES.length - 1;

function referentsPreserved(source, candidate) {
  const left = pronounFamilies(source);
  // "it" names nobody. This guard exists to stop a rewrite changing WHO a sentence is
  // about, and an inanimate anaphor cannot do that: "In the event of a failure, the
  // client will retry the request three times." -> "If the request fails, the client
  // will retry it three times." introduces an "it" whose antecedent is standing right
  // beside it. What stops an "it" swallowing its antecedent instead is the deletion
  // policy: "Ship the report to Maya." -> "Ship it to Maya." loses "report", and that is
  // where such a rewrite is caught. Every other family stays guarded.
  return [...pronounFamilies(candidate)].every((family) => left.has(family) || family === IT_FAMILY);
}

function countWords(text, words) {
  const lowered = text.toLowerCase();
  return words.reduce((total, word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return total + (lowered.match(new RegExp(`\\b${escaped}\\b`, "gu"))?.length ?? 0);
  }, 0);
}

function certainty(text) {
  const expanded = expandAuxiliaries(text);
  return CERTAINTY_GROUPS.map((group) => countWords(expanded, group));
}

// How many DISTINCT members of each group the text carries — not how many times they
// occur, and not which ones.
//
// Counting occurrences means a coordinate structure that says the same modal twice —
// "We could either rewrite it, or we could refactor it" — cannot be tidied to
// "We could either rewrite it or refactor it", because the count falls from two to one
// with nothing lost. The gate's own "repeated subordinator" family exists to FIND that
// redundancy, so refusing its repair is the engine contradicting itself.
//
// Distinct members rather than presence-per-word, because within a group the words are
// interchangeable by construction: that is exactly what licenses the flagship
// reduction "has the ability to" -> "can", where the group's one member is swapped for
// another. And distinct members rather than a bare "is the group non-empty", because
// that would accept "It could be argued that the design is somewhat fragile." -> "The
// design is somewhat fragile." on the strength of the surviving "somewhat" — the
// certainty strengthening the project refuses on purpose.
function distinctMembers(text, groups) {
  const expanded = expandAuxiliaries(text).toLowerCase();
  return groups.map((group) => group.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "u").test(expanded);
  }).length);
}

// "would" as politeness rather than as a claim about the future. English spells both the
// same way and this file counts words, so "Would it be possible for you to send it?" ->
// "Could you send it?" was refused as a dropped commitment: the softener is the only
// thing that left. These are fixed collocations, listed rather than parsed, and the
// lookahead removes ONLY a softening "would" — the conditional ("we would ship if the
// tests passed") and the reported future ("it was decided that the flag would remain")
// carry real meaning and are untouched, as is a negated "would not like".
const SOFTENER_WOULD =
  /\bwould\b(?=\s+(?:just\s+)?(?:like|love|prefer|say|argue|appreciate)\b|\s+it\s+be\b|\s+you\s+(?:please|mind|be)\b)/giu;

// An evidential raising hedge stacked directly on an evidential verb: "would seem to
// suggest", "appears to indicate". Both halves hedge the SAME claim, so reducing the
// stack to the inner verb leaves the proposition exactly as non-committal as the writer
// left it — the reasoning that already lets "could possibly time out" become "could time
// out", carried across a raising construction. "would seem to suggest" is on Grammarly's
// own fixed periphrasis list (docs/GRAMMARLY-BEHAVIOUR.md §1).
const EVIDENTIAL_RAISING =
  /\b(?:(?:would|could|might|may)\s+)?(?:seems?|appears?)\s+to\s+(?=(?:suggests?|indicates?|imply|implies|shows?|points?)\b)/giu;

// The text the certainty groups are counted over. Normalisation is confined to this one
// comparison: every other guard still sees the sentence the writer wrote.
function hedgeNormalised(text) {
  return text.replace(EVIDENTIAL_RAISING, "").replace(SOFTENER_WOULD, "");
}

// The groups whose members hedge the CLAIM — how likely it is, and whether it is being
// asserted at all — as opposed to the writer's obligation ("must"), ability ("can") or
// the degree of something ("somewhat"). Only these take part in the stack rule below.
const EPISTEMIC_GROUPS = [0, 3];

// A hedge sitting inside the scope of another hedge is one claim hedged twice, not two
// claims: "I suggest that we perhaps delay it" is no more an assertion than "I suggest
// we delay it", so dropping the inner "perhaps" takes nothing away. Scope is approximated
// by position — the dropped hedge must FOLLOW one that survives the rewrite — and that
// ordering is exactly what separates this from the case the guard exists for: "The tool
// could recommend an action" -> "The tool recommends an action" drops a modal standing
// BEFORE the surviving word, and stays refused, because there "recommend" is the
// sentence's content rather than a hedge over it.
//
// Only the emptied-group test is relaxed. A hedge the writer never wrote is still refused
// wherever it appears, so this cannot license strengthening in the other direction.
function epistemicStackReduced(source, candidate) {
  const src = expandAuxiliaries(hedgeNormalised(source)).toLowerCase();
  const cand = expandAuxiliaries(hedgeNormalised(candidate)).toLowerCase();
  let survivor = Infinity;
  const dropped = [];
  for (const index of EPISTEMIC_GROUPS) {
    for (const word of CERTAINTY_GROUPS[index]) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "u");
      const at = src.search(pattern);
      if (at < 0) continue;
      if (pattern.test(cand)) survivor = Math.min(survivor, at);
      else dropped.push(at);
    }
  }
  if (survivor === Infinity || dropped.length === 0) return false;
  return dropped.every((at) => at > survivor);
}

// Ordinals name a position in a sequence: "the second attempt" and "the first attempt"
// are different events, so the word survives the rewrite or the rewrite does not.
const ORDINALS = [
  "first", "second", "third", "fourth", "fifth",
  "sixth", "seventh", "eighth", "ninth", "tenth",
];

function ordinals(text) {
  return ORDINALS.map((word) => countWords(text, [word]));
}

// "just" is two words wearing one spelling. The exclusive restricts what the sentence is
// about — "just three tenants have enabled it" — and dropping it changes the claim, which
// is why the word is in the quantifier group at all. The softener merely opens a remark:
// "Just to give a quick update", "Just following up", "I would just like to suggest".
// It restricts nothing, and refusing to drop it cost a whole family of ordinary trims.
//
// The two are told apart by what follows. A softener is followed by a VERB — an
// infinitive or a participle — and stands at the head of the sentence, or else sits in
// the fixed "would just like to". An exclusive is followed by the thing it restricts, so
// "Just three tenants", "just the config file" and "It just works" all stay guarded.
const SOFTENER_JUST =
  /^\s*just\b(?=\s+(?:to\s+\p{L}|\p{L}+ing\b))|\bjust\b(?=\s+like\s+to\b)/giu;

// Words whose membership of a particular group is narrower than the bare spelling, keyed
// by "<group index>:<word>" because a word can sit in two groups and mean a different
// thing in each.
//
// - "no longer" is a temporal adverbial, not a quantity: "which nobody maintains" ->
//   "no longer maintained" introduces no "no" the writer did not mean. The emphatic
//   "there is no doubt that" is deliberately NOT exempted — flattening that is the
//   emphasis-dropping we refuse on purpose (docs/GRAMMARLY-BEHAVIOUR.md §3).
// - "most" and "least" are bounds only in "at most" / "at least". Ungated, the bound
//   sense fired on every ordinary "most cases", so "in the majority of cases" -> "in
//   most cases" read as an upper bound arriving from nowhere. The vague-amount sense of
//   "most" is untouched: it lives in its own group.
const NARROWED_SENSE = new Map([
  ["0:no", /\bno\b(?!\s+longer\b)/u],
  ["3:most", /\bat\s+most\b/u],
  ["3:least", /\bat\s+least\b/u],
]);

function quantifierPresent(lowered, word, groupIndex) {
  const narrowed = NARROWED_SENSE.get(`${groupIndex}:${word}`);
  if (narrowed) return narrowed.test(lowered);
  if (!APPROXIMATORS.has(word)) return new RegExp(`\\b${word}\\b`, "u").test(lowered);
  return new RegExp(`\\b${word}\\s+${QUANTITY_NEIGHBOUR}\\b|\\b${QUANTITY_NEIGHBOUR}\\s+${word}\\b`, "u")
    .test(lowered);
}

function quantifierSets(text) {
  const lowered = text.toLowerCase().replace(SOFTENER_JUST, "");
  return QUANTIFIER_GROUPS.map((group, index) =>
    new Set(group.filter((word) => quantifierPresent(lowered, word, index))));
}

// The one quantity trade a clarity edit is allowed to make: a periphrastic quantity
// noun ("a number of", "a lot of") standing in for a plain vague quantifier. Anything
// else in the vague-amount group — "many" for "few", "few" for "several" — changes the
// claim, so the exemption is a one-way door, not a licence to swap within the group.
const VAGUE_AMOUNT_GROUP = 1;
// "majority" joins them: "in the majority of cases" -> "in most cases" is the same trade
// as "a number of" -> "several", and is on Grammarly's own periphrasis list
// (docs/GRAMMARLY-BEHAVIOUR.md §1). Without it the group was empty on the source side and
// "most" read as a quantifier invented from nothing.
const PERIPHRASTIC_QUANTITY = new Set(["number", "lot", "lots", "plenty", "majority"]);
const VAGUE_QUANTIFIERS = new Set(["some", "several", "many", "few", "most", "much"]);

function periphrasisTrade(removedWord, addedWord) {
  return PERIPHRASTIC_QUANTITY.has(removedWord.toLowerCase()) &&
    VAGUE_QUANTIFIERS.has(addedWord.toLowerCase());
}

// Preserved when the candidate introduces no quantifier the source lacked and empties
// no group the source filled. "each and every" -> "each" passes; "every" -> "all" does not.
function quantifiersPreserved(source, candidate) {
  const left = quantifierSets(source);
  const right = quantifierSets(candidate);
  return left.every((sourceSet, index) => {
    const candidateSet = right[index];
    if (sourceSet.size > 0 && candidateSet.size === 0) return false;
    return [...candidateSet].every((word) => {
      if (sourceSet.has(word)) return true;
      if (index !== VAGUE_AMOUNT_GROUP) return false;
      // "a number of issues" -> "several issues": the periphrasis the word replaces
      // has to be gone from the candidate, or nothing was traded at all.
      return [...sourceSet].some((sourceWord) =>
        periphrasisTrade(sourceWord, word) && !candidateSet.has(sourceWord));
    });
  });
}

// The negative pronouns were missing: "nobody", "nothing", "no one" and "nowhere" are as
// negative as "none", but none of them matches "\bno\b", so a rewrite that traded one for
// an explicit "not" or "no longer" looked like a negation appearing from nowhere. Counting
// them makes the tally more accurate in both directions, not more permissive.
// Two places where a "not" is spelling rather than denial, removed before the tally.
//
// "whether or not X" is "whether X" — the "or not" spells out the alternative the word
// already carries, and it is on Grammarly's own wordiness list.
//
// "do not forget to X" is "X", the litotes docs/GRAMMARLY-BEHAVIOUR.md §4 records them
// resolving. The "fail to" member of that family is left in on purpose: failures() counts
// it separately and keeps "did not fail to notify" -> "notified" refused, which is the
// half of the split policy we keep.
const NOT_AS_SPELLING = [
  /\bwhether\s+or\s+not\b/giu,
  /\b(?:do|does|did|to)?\s*not\s+(?:forget|forgets|forgot|neglect|neglects|neglected|omit|omits|omitted|hesitate|hesitates|hesitated)\s+to\b/giu,
];

function negations(text) {
  let counted = text;
  for (const pattern of NOT_AS_SPELLING) counted = counted.replace(pattern, " ");
  return (counted.match(
    /\b(?:no\s+one|nobody|nothing|nowhere|no|not|never|neither|nor|without|cannot|none)\b|n['’]t\b/giu,
  ) ?? []).length;
}

// Words that end in "ed" without being a past tense.
// "used" is deliberately NOT here: it is the ordinary past of "use", and listing it made
// the tense gate blind to "We used the pump yesterday." -> "We use the pump yesterday.".
// The adjectival "is used" reading is already excused by the presentAuxiliaries guard.
const NOT_PAST_ED = new Set([
  "need", "needs", "indeed", "seed", "feed", "speed", "deed", "creed", "breed", "greed",
  "exceed", "proceed", "succeed", "embed", "shed", "sled", "bed", "red", "wed",
]);

const AUXILIARIES = new Set(["was", "were", "is", "are", "am", "did", "do", "does", "has", "have", "had"]);

const IRREGULAR_ENDINGS = [
  "took", "went", "came", "gave", "saw", "made", "said", "paid", "held", "led", "ran",
  "stood", "wrote", "drew", "knew", "grew", "threw", "brought", "bought", "caught",
  "taught", "thought", "found", "built", "sent", "spent", "lost", "left", "felt", "kept",
];
// A word ending in an irregular past is only that past when what precedes it is a verb
// prefix. Otherwise "present", "consent", and "jigsaw" would all read as past tense.
const VERB_PREFIXES = new Set(["", "un", "re", "over", "under", "with", "fore", "mis", "out", "up"]);
const endsIrregular = (word) =>
  IRREGULAR_ENDINGS.some((ending) =>
    word.length >= ending.length && word.endsWith(ending) &&
    VERB_PREFIXES.has(word.slice(0, word.length - ending.length)));

// Participles with no "-ed": without them "have gone" reads as no tense at all, so
// repairing "I have went" to "I have gone" looked like a tense change.
const PAST_PARTICIPLES = new Set([
  "gone", "taken", "written", "known", "seen", "done", "been", "begun", "given", "chosen",
  "spoken", "broken", "driven", "eaten", "fallen", "forgotten", "hidden", "ridden", "risen",
  "shaken", "stolen", "thrown", "worn", "torn", "flown", "grown", "drawn", "blown", "shown",
  "sung", "held", "kept", "met", "run", "come", "become", "left", "lost", "sent", "built",
]);

const PERFECT_AUXILIARIES = new Set(["has", "have", "had"]);

// Evidence in the source that the sentence is about the past. When the writer already
// wrote "yesterday", moving the verb into the past is the repair, not a claim change.
const PAST_EVIDENCE =
  /\b(?:yesterday|ago|last\s+(?:night|week|month|year|quarter|friday|monday|tuesday|wednesday|thursday|saturday|sunday))\b/iu;

function tense(text) {
  const trimmed = expandAuxiliaries(text.trim().replace(/[.!?…]+["'’”)\]}]*$/u, ""));
  const all = [...trimmed.matchAll(/\b[\p{L}’']+\b/gu)].map((match) => match[0].toLowerCase());
  // Drop a clause-final auxiliary with nothing to govern: that is ellipsis.
  const words = all.filter((word, index) => !(AUXILIARIES.has(word) && index === all.length - 1));
  const presentAuxiliaries = new Set(["am", "are", "is", "be", "been", "being"]);
  const participle = (word) =>
    /(?:ed|en)$/u.test(word) || PAST_IRREGULAR.has(word) || PAST_PARTICIPLES.has(word);
  // In a passive, the AUXILIARY carries the tense and the participle carries none:
  // "the file is read by the loader" is present, "was read" is past. The -ed branch
  // below already knew this ("are presented" is not past); the irregular branches did
  // not, so "is read" scored as past while its own active voice "reads" did not, and
  // every present-tense passive-to-active conversion read as a tense flip.
  // Adverbs between the auxiliary and its participle are skipped, however many: with
  // "is very completely sealed" the governing word is "is", not "completely". Skipping
  // a fixed number instead made the test asymmetric — one adverb counted as present
  // tense and two did not, so a rewrite that merely dropped an adverb read as a tense
  // flip.
  // The negator counts as an adverbial for this walk. It sits in exactly the same slot —
  // "has not been approved", "is not read by the loader" — and leaving it out made the
  // tense reading depend on the negation: "is read" was present and "is not read" was
  // past, so negating a passive flipped its tense and every rewrite that kept the
  // negation was refused for changing a tense it had not touched. Negation itself is
  // counted by its own guard; nothing here weakens that.
  const adverbial = (word) => word !== undefined && !presentAuxiliaries.has(word)
    && (/ly$/u.test(word) || INTENSIFIERS.has(word) || word === "not" || word === "never");
  const governing = (index) => {
    let at = index - 1;
    while (at >= 0 && adverbial(words[at])) at -= 1;
    return words[at];
  };
  const underPresentBe = (index) => presentAuxiliaries.has(governing(index));
  // The perfect auxiliary is found through the same walk, for the same reason: in
  // "has not been approved" the word before the participle is the negator, so a literal
  // words[index - 1] saw no perfect at all and the aspect vanished from the comparison.
  return {
    past: words.some((word, index) =>
      ((PAST_IRREGULAR.has(word) || endsIrregular(word)) && !underPresentBe(index)) ||
      // An irregular participle is a past only under "have"/"has"/"had": "the work is
      // done" is a present state, "we have done the work" is not.
      (PAST_PARTICIPLES.has(word) && PERFECT_AUXILIARIES.has(governing(index))) ||
      (/ed$/u.test(word) && !NOT_PAST_ED.has(word) && !underPresentBe(index))),
    future: words.some((word) => word === "will" || word === "shall"),
    perfect: words.some((word, index) =>
      index > 0 && PERFECT_AUXILIARIES.has(governing(index)) && participle(word)),
  };
}

// Verbs spelled the same in the base and the past. A sentence built on one of them does
// not say which it is — "They put forward a proposal" is past or present depending on
// nothing the words record — so a rewrite that resolves it to a past has not contradicted
// the writer. tense() reads them as present, which made every such nominalization unpack
// ("put forward a proposal" -> "proposed", on Grammarly's own list) look like a flip.
const INVARIANT_PAST = new Set([
  "put", "set", "cut", "hit", "let", "cost", "hurt", "shut", "split", "spread", "cast",
  "burst", "read", "bet", "quit", "bid", "thrust", "upset", "broadcast", "forecast",
]);

const carriesInvariantPast = (text) =>
  [...text.toLowerCase().matchAll(/\b[\p{L}’']+\b/gu)].some((match) => INVARIANT_PAST.has(match[0]));

// The two tense moves a repair may make, both of them one-way: the source already names a
// past moment and the verb has not caught up, or the source is built on a verb whose past
// and base are the same word. Gaining a past tense is permitted; losing one never is, and
// the other two axes must match exactly either way.
function tenseRepairedToMatchEvidence(source, left, right) {
  return left.past === false && right.past === true &&
    left.future === right.future && left.perfect === right.perfect &&
    (PAST_EVIDENCE.test(source) || carriesInvariantPast(source));
}

// Connectives grouped by the relation they assert: contrast, condition, cause. Losing
// one changes what the sentence claims about how its parts relate.
const DISCOURSE_GROUPS = [
  ["although", "but", "despite", "however", "though", "whereas", "yet", "nevertheless"],
  ["if", "unless"],
  ["because", "since", "therefore", "so", "thus"],
];

// Flattened, for the one question the deletion policy asks of them: is this word a
// connective whose repetition the discourse guard already governs?
const DISCOURSE_WORDS = new Set(DISCOURSE_GROUPS.flat());

// Words whose opposite is another function word, so every other rule reads the swap as
// nothing at all: "runs before the release" -> "runs after the release" reverses the
// order of two events for free. Dropping one is caught by the content rules, so only
// introducing a member the source lacked is refused here.
const DIRECTION_GROUPS = [
  // Temporal subordinators. "before" and "after" reverse each other outright; "when",
  // "while" and "once" place the event differently again — "Run the migration before the
  // deploy starts." and "... when the deploy starts." schedule two different things, and
  // swapping one for another moves no content word, no number and no name, so nothing
  // else in this file notices. They share one group because any exchange among them
  // changes the relation, not only the before/after pair.
  ["before", "after", "when", "while", "once"],
  ["and", "or"],
  ["until", "since"],
  ["on", "off"],
  ["up", "down"],
  ["above", "below"],
  ["over", "under"],
  ["more", "less"],
];

// "once" and "while" carry a second, non-temporal sense that must not be read as a
// subordinator: "once a day" is a frequency and "a while" is a noun. Narrowed the same
// way the quantifier table narrows "no" and "at most" — by the company the word keeps.
const DIRECTION_NARROWED = new Map([
  ["once", /(?<!\b(?:at|just|only|every|for)\s)\bonce\b(?!\s+(?:a|an|per|every|more|again|or\s+twice)\b)/u],
  ["while", /(?<!\b(?:a|the|short|long|little|good)\s)\bwhile\b/u],
]);

// "on"/"off" directly after these verbs is a phrasal particle, not a direction: the
// canonical usage repair "based off" -> "based on" must not read as a reversal.
const PHRASAL_HOSTS =
  /\b(?:base|based|basing|sign|signs|signed|signing|log|logs|logged|logging)\s+$/iu;

function directionsPreserved(source, candidate) {
  const lowered = candidate.toLowerCase();
  const original = source.toLowerCase();
  const outsidePhrasal = (word) =>
    [...lowered.matchAll(new RegExp(`\\b${word}\\b`, "gu"))]
      .some((match) => !PHRASAL_HOSTS.test(lowered.slice(0, match.index)));
  const present = (text, word) =>
    (DIRECTION_NARROWED.get(word) ?? new RegExp(`\\b${word}\\b`, "u")).test(text);
  return DIRECTION_GROUPS.every((group) => {
    const phrasal = group.includes("on");
    const introduced = group.filter((word) =>
      (phrasal ? outsidePhrasal(word) : present(lowered, word))
      && !present(original, word));
    // A word the source never used is only a reversal if its partner was there to reverse.
    return introduced.every((word) =>
      !group.some((other) => other !== word && present(original, other)));
  });
}

// Prepositions that fix a deadline. Swapping one for another over the SAME time
// expression moves the boundary — "before Thursday" excludes Thursday and "by Thursday"
// includes it — and nothing else notices, because both are function words and no content
// word moved. Found by the precision audit on a sentence that needed no edit at all.
//
// Matched as a PAIR over one complement, and only when that complement is a time. "by"
// alone cannot be guarded: it marks the agent of every passive in the language, and
// "delayed for a period of three weeks" -> "delayed by three weeks" is a rewrite this
// gate deliberately accepts.
const DEADLINE_PREPOSITIONS = ["before", "by", "after", "until", "till", "from", "on"];
const TIME_COMPLEMENT =
  /^(?:\d[\d:.]*|noon|midnight|midday|dawn|dusk|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/iu;

function deadlines(text) {
  const found = new Map();
  // A dot is part of the complement only before digits ("by 5.30"); at the end of a
  // sentence it is punctuation, and swallowing it made "by Friday." and "before Friday."
  // two different complements that never met.
  const pattern = new RegExp(`\\b(${DEADLINE_PREPOSITIONS.join("|")})\\s+([\\p{L}\\p{N}][\\p{L}\\p{N}:]*(?:\\.\\d+)?)`, "giu");
  for (const match of text.matchAll(pattern)) {
    if (TIME_COMPLEMENT.test(match[2])) found.set(match[2].toLowerCase(), match[1].toLowerCase());
  }
  return found;
}

// The same deadline preposition, the same time it governs, and fewer words in between:
// "won't be ready until end of day tomorrow" -> "until tomorrow" keeps "until" and keeps
// "tomorrow" and moves the deadline earlier by most of a day. deadlineMoved cannot see it
// — nothing was swapped — and the loss is one content word, so the policy deferred it.
export function deadlineNarrowed(source, candidate, lost) {
  if (!lost.length) return false;
  // Every deadline phrase in a text: the words from a deadline preposition up to and
  // including the first time expression within five words of it. Scanned rather than
  // matched with one regex, because a lazy quantifier stops at "until end" and a greedy
  // one runs past the sentence — the phrase wanted here is "until end of day tomorrow".
  const phrases = (text) => {
    // A dot or colon belongs to the word only before digits ("5.30", "17:00"); at the end
    // of a sentence it is punctuation, and swallowing it hid "tomorrow." from the time
    // test — the same trap the preposition-swap guard fell into.
    const words = [...text.toLowerCase().matchAll(/[\p{L}\p{N}]+(?:[:.]\d+)*/gu)].map((m) => m[0]);
    const found = [];
    words.forEach((word, index) => {
      if (!DEADLINE_PREPOSITIONS.includes(word)) return;
      for (let at = index + 1; at <= Math.min(index + 5, words.length - 1); at += 1) {
        if (!TIME_COMPLEMENT.test(words[at])) continue;
        found.push(words.slice(index + 1, at + 1));
        return;
      }
    });
    return found;
  };
  const inSource = phrases(source);
  if (!inSource.length) return false;
  const inCandidate = phrases(candidate);
  return lost.some((word) => inSource.some((phrase) => {
    if (!phrase.includes(word.toLowerCase())) return false;
    // The time itself has to survive, or the whole phrase went and the deletion policy
    // already has an opinion about that.
    const time = phrase[phrase.length - 1];
    return inCandidate.some((other) => other[other.length - 1] === time && other.length < phrase.length);
  }));
}

function deadlineMoved(source, candidate) {
  const before = deadlines(source);
  for (const [complement, preposition] of deadlines(candidate)) {
    const was = before.get(complement);
    if (was && was !== preposition) return true;
  }
  return false;
}

// "failed to notify" and "notified" are opposites, but the only word that carries the
// inversion is a plain verb, so the negation count never moves. Counted as its own class.
const FAILURE_WORDS = new Set(["fail", "fails", "failed", "failing", "failure", "failures"]);

function failures(text) {
  return countWords(text, [...FAILURE_WORDS]);
}

function terminal(text) {
  return text.trim().match(/[.!?…]+(?=["'’”)\]}]*$)/u)?.[0] ?? "";
}

function editRatio(source, candidate) {
  const left = tokenize(source).filter((token) => !token.space);
  const right = tokenize(candidate).filter((token) => !token.space);
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i].text.toLowerCase() === right[j].text.toLowerCase()
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const common = table[0][0];
  return (left.length + right.length - 2 * common) / Math.max(1, left.length + right.length);
}


// Commonly confused pairs: a one-for-one swap between them is a repair, not an invention.
export const CONFUSABLES = [
  ["affect", "effect"], ["affects", "effects"], ["affected", "effected"],
  ["then", "than"], ["its", "it's"], ["your", "you're"], ["their", "there"],
  ["there", "they're"], ["lead", "led"], ["to", "too"], ["loose", "lose"],
  ["principal", "principle"], ["complement", "compliment"], ["ensure", "insure"],
  ["accept", "except"], ["advice", "advise"], ["farther", "further"],
];

// Derivational and inflectional endings, longest first. Stripping them twice takes
// "recommendation" and "recommended" to the same stem, and "comparison" and "compare"
// to stems that differ only in their tail.
const SUFFIXES = ["ation", "ison", "sion", "tion", "ance", "ence", "ment", "ing", "ion", "ed", "es", "al", "s", "e"];
const MIN_STEM = 3;

function stem(word) {
  let current = word;
  for (let round = 0; round < 2; round += 1) {
    const suffix = SUFFIXES.find((ending) =>
      current.endsWith(ending) && current.length - ending.length >= MIN_STEM);
    if (!suffix) break;
    current = current.slice(0, current.length - suffix.length);
  }
  return current;
}

function commonPrefix(a, b) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

// Two words are related when one is a form of the other. A blanket edit distance of one
// is not that test: "hired" and "fired" are one edit apart and mean opposite things. The
// difference has to sit in the ending, after both words are reduced to their stems, so
// "decision"/"decided" pass on a shared "deci" while "confirmed"/"confused" do not.
function sharedStem(a, b) {
  const left = stem(a);
  const right = stem(b);
  if (left === right) return true;
  const shared = commonPrefix(left, right);
  return shared >= 4 && left.length - shared <= 2 && right.length - shared <= 2;
}

// Forms that suffix-stripping cannot reach: "meeting"/"met" share two letters and
// "agreement"/"agreed" stem to "agre"/"agr", so an ordinary nominalisation reduction read
// as an invented word. One lemma per row, listed with every form the gate sees.
const LEMMAS = new Map(Object.entries({
  meet: ["meet", "meets", "meeting", "meetings", "met"],
  go: ["go", "goes", "going", "went", "gone"],
  take: ["take", "takes", "taking", "took", "taken"],
  write: ["write", "writes", "writing", "wrote", "written"],
  see: ["see", "sees", "seeing", "saw", "seen"],
  agree: ["agree", "agrees", "agreed", "agreeing", "agreement", "agreements"],
  hold: ["hold", "holds", "holding", "held"],
  give: ["give", "gives", "giving", "gave", "given"],
  speak: ["speak", "speaks", "speaking", "spoke", "spoken"],
  choose: ["choose", "chooses", "choosing", "chose", "chosen", "choice", "choices"],
  begin: ["begin", "begins", "beginning", "began", "begun"],
  send: ["send", "sends", "sending", "sent"],
  build: ["build", "builds", "building", "built"],
  buy: ["buy", "buys", "buying", "bought"],
  bring: ["bring", "brings", "bringing", "brought"],
  think: ["think", "thinks", "thinking", "thought", "thoughts"],
  lose: ["lose", "loses", "losing", "lost", "loss", "losses"],
  find: ["find", "finds", "finding", "found"],
  know: ["know", "knows", "knowing", "knew", "known", "knowledge"],
  pay: ["pay", "pays", "paying", "paid", "payment", "payments"],
}));

const LEMMA_OF = new Map(
  [...LEMMAS].flatMap(([lemma, forms]) => forms.map((form) => [form, lemma])),
);

// What one word may add to another and still be a form of it. A bare startsWith let any
// extension through — "car" -> "carpet", "plan" -> "planet", "man" -> "manager" — and,
// through lostContentWords, let a surviving "to" claim to carry a deleted "tomorrow".
const INFLECTION_TAILS = new Set([
  "s", "es", "ed", "d", "ing", "ly", "er", "ers", "est", "or", "ors",
  "ion", "ions", "ment", "ments", "ance", "ence", "ally", "ness",
]);

// Whether `longer` is an inflected form of `shorter`. The bare tail lookup alone both
// missed genuine inflections (run/running doubles the consonant; ad/ads is under the
// stem floor) and admitted non-inflections (car/card, wit/witness), so the ambiguous
// tails carry extra shape requirements.
function inflectionOf(shorter, longer) {
  const residue = longer.slice(shorter.length);
  // A plural needs no stem floor: "ad" -> "ads".
  if (shorter.length >= 2 && (residue === "s" || residue === "es")) return true;
  if (shorter.length >= MIN_STEM && INFLECTION_TAILS.has(residue)) {
    // "-d" only continues an e-final stem (hope/hoped); on anything else it is a new
    // word (car/card). "-ness" on a short stem is likewise a new word (wit/witness).
    if (residue === "d" && !shorter.endsWith("e")) return false;
    if (residue === "ness" && shorter.length < 4) return false;
    return true;
  }
  // A doubled final consonant before the tail: run/running, set/setting.
  const last = shorter[shorter.length - 1];
  return shorter.length >= MIN_STEM && residue.length > 1 && residue[0] === last
    && INFLECTION_TAILS.has(residue.slice(1));
}

function related(left, right) {
  const a = left.toLowerCase().replace(/['’]/gu, "");
  const b = right.toLowerCase().replace(/['’]/gu, "");
  if (a === b) return true;
  if (CONFUSABLES.some(([x, y]) => (a === x && b === y) || (a === y && b === x))) return true;
  // An irregular form of one verb is that verb: "held a meeting" -> "met".
  if (LEMMA_OF.has(a) && LEMMA_OF.get(a) === LEMMA_OF.get(b)) return true;
  if (a.startsWith(b) || b.startsWith(a)) {              // engineer / engineers
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (inflectionOf(shorter, longer)) return true;
  }
  return sharedStem(a, b);                               // compare / comparison
}

const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "nor", "but", "so", "yet", "for", "of", "to", "in", "on",
  "at", "by", "with", "from", "into", "onto", "over", "under", "above", "below", "between",
  "through", "during", "before", "after", "since", "until", "while", "about", "against",
  "among", "across", "behind", "beside", "beyond", "within", "without", "upon", "per",
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had", "having",
  "do", "does", "did", "done", "doing", "will", "would", "shall", "should", "can", "could",
  "may", "might", "must", "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
  "who", "whom", "whose", "which", "what", "when", "where", "why", "how", "there", "here",
  "not", "no", "if", "then", "than", "as", "such", "very", "too", "also", "just", "only",
  "each", "every", "all", "any", "some", "both", "either", "neither", "one", "more", "most",
  "less", "least", "other", "another", "same", "own", "up", "down", "out", "off",
]);

// "don't" is the auxiliary "do", not a content word called "don": auxiliaryBase maps the
// contraction back before the lookup, so repairing "She don't" -> "She doesn't" is not
// read as inventing vocabulary.
const isContentWord = (token) =>
  /[\p{L}]/u.test(token.text) && !FUNCTION_WORDS.has(auxiliaryBase(token.text));

// Standard compressions the engine is allowed to introduce. Every other new content
// word must trace back to a word the source already contained.
const REDUCTION_LEXICON = new Set([
  "soon", "later", "now", "today", "daily", "weekly", "monthly", "quarterly", "yearly",
  "annually", "near", "nearby", "because", "although", "though", "whether", "if", "unless",
  // "first" is deliberately absent: it is an ordinal, and licensing it as a reduction let
  // "the second attempt" become "the first attempt" free of charge.
  "while", "since", "after", "before", "during", "tends", "tend", "ensure",
  "ensures", "can", "cannot", "must", "may", "might", "should", "will", "would",
  "believes", "believe", "believed", "thinks", "think", "expects", "expect",
]);

// Refuses a rewrite that introduces vocabulary with no antecedent in the sentence.
// Compressing a phrase to a shorter word stays allowed when the shorter word is
// derived from the phrase or is a standard reduction; trading "passed" for "expired",
// "confusing" for "clear", or "made an inquiry" for "queried" does not.
function vocabularyHasAntecedent(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = 0;
  // Protected tokens are opaque atoms, not prose the writer can be said to have used:
  // without stripping them, the "bulletins" inside https://example.test/bulletins
  // licensed the model to introduce "the bulletin at" as though the word were already
  // in the sentence. Caught by the false-unlock control on a recorded refusal.
  let prose = source;
  for (const token of protectedTokenList(source)) prose = prose.split(token).join(" ");
  const sourceContent = tokenize(prose)
    .filter((token) => !token.space && isContentWord(token))
    .map((token) => token.text);
  while (index < ops.length) {
    if (ops[index].type === "equal") { index += 1; continue; }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source).filter(isContentWord);
    const added = run.filter((op) => op.type === "insert").map((op) => op.target).filter(isContentWord);
    for (const token of added) {
      const word = token.text.toLowerCase();
      if (REDUCTION_LEXICON.has(word)) continue;
      if (removed.some((token) => periphrasisTrade(token.text, word))) continue;
      if (removed.some((candidateToken) => related(candidateToken.text, word))) continue;
      // A word already present elsewhere in the source is not an invention — nor is an
      // inflection of one. The run-scoped test above cannot see it: a voice conversion
      // moves the verb, so the inserted "reads" and the removed "read" land in
      // different diff runs and never meet, and the literal fallback below does not
      // match across the inflection. Scoped to CONTENT words, so a new word still
      // cannot be licensed by an unrelated function word somewhere in the sentence.
      //
      // Tested against `prose`, not `source`: the protected tokens are stripped there.
      // Reading the raw source let the "audit" inside /srv/reports/audit.md license
      // "Read the audit notes in /srv/reports/audit.md", which is the same hole the
      // false-unlock control once found with a URL — closed for the content-word list
      // above at the time, and left open on this line.
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu").test(prose)) continue;
      if (sourceContent.some((sourceWord) => related(sourceWord, word))) continue;
      return false;
    }
    index = end;
  }
  return true;
}

// Degree words: removing one changes emphasis, not information.
export const INTENSIFIERS = new Set([
  "very", "completely", "totally", "absolutely", "entirely", "utterly", "really", "quite",
  "extremely", "highly", "fully", "truly", "simply", "wholly", "altogether", "thoroughly",
  "together", "definitely", "certainly", "particularly", "especially", "rather", "somewhat",
]);

// Nouns that exist only to pad a stock phrase: "at a later point in time", "on a weekly
// basis", "in close proximity to", "in receipt of". Removing them removes no information.
const STOCK_PHRASE_NOUNS = new Set([
  "point", "time", "basis", "proximity", "receipt", "order", "regard",
  "respect", "fact", "event", "purpose", "means", "terms", "nature",
]);

// Modifiers whose meaning the word beside them already carries. This list permits an
// edit the model proposed; it never proposes one.
const REDUNDANT_MODIFIERS = new Set([
  "brand", "end", "exactly", "ahead", "back", "again", "future", "past", "added",
  "mutual", "advance", "basic", "unexpected", "final", "close", "joined", "free",
  "personal", "true", "actual", "general", "overall", "total", "sum", "new", "own",
  "different", "various", "separate", "individual", "current", "still",
]);

// "back" and "again" are redundant only next to a word that already says the action is a
// repeat: "repeated the instruction back again" keeps all of its meaning in "repeated".
// With no such carrier left in the candidate, "again" is the only word saying this has
// happened before, and dropping it loses that — the call the verifier prompt already
// makes for "Following up again on the budget approval." Listed explicitly rather than
// matched as a "re-" prefix, because "report", "review" and "result" are not repetitions;
// the bare "re" is the carrier for a hyphenated re-verb, which the tokenizer splits at the
// hyphen into "re" and "run".
const REPETITION_MODIFIERS = new Set(["back", "again"]);
const REPETITION_CARRIER =
  /^(?:repeat(?:s|ed|edly|ing)?|repetition|return(?:s|ed|ing)?|revert(?:s|ed|ing)?|resend|resent|resubmit(?:s|ted|ting)?|restart(?:s|ed|ing)?|reissue[ds]?|retry|retries|retried|recur(?:s|red|ring)?|twice|still|re)$/iu;

// Content words the rewrite removes without putting anything related back. These are the
// only edits that can silently cost the writer information, so they are the only ones
// worth a second model call.
// What a conventional one-word reduction stands for, beyond what the stock-noun and
// redundant-modifier lists already excuse: "in the near future" -> "soon" carries
// "near"; "has the ability to" -> "can" carries "ability". Keyed by the inserted
// reduction word; a deleted content word in the same run that the reduction does not
// license is a real loss. The old rule forgave EVERY deletion in a run holding one
// reduction insert, which laundered whole-clause deletion: "shipped the parts to the
// customer in bulk" -> "shipped the parts soon" reported nothing lost.
const REDUCTION_CARRIERS = new Map(Object.entries({
  because: ["fact", "account", "reason", "due", "owing", "light"],
  although: ["spite", "fact"],
  though: ["spite", "fact"],
  soon: ["near", "future", "shortly"],
  now: ["present", "moment", "current", "currently", "time", "point"],
  later: ["subsequent", "subsequently", "stage", "point", "time"],
  today: ["day"],
  daily: ["day", "days", "basis"],
  weekly: ["week", "weeks", "basis"],
  monthly: ["month", "months", "basis"],
  quarterly: ["quarter", "quarters", "basis"],
  yearly: ["year", "years", "basis"],
  annually: ["year", "years", "basis"],
  // "located"/"situated" are filler in place expressions: "is located near" IS "is near".
  near: ["close", "proximity", "vicinity", "located", "situated", "positioned"],
  nearby: ["close", "proximity", "vicinity", "located", "situated", "positioned"],
  can: ["able", "ability", "capability", "capacity"],
  cannot: ["unable", "inability", "ability", "capability", "capacity"],
  must: ["necessary", "necessity", "mandatory", "obliged", "obligation"],
  may: ["possible", "possibility", "chance", "perhaps", "likely"],
  might: ["possible", "possibility", "chance", "perhaps", "likely"],
  should: ["recommended", "recommendation", "advisable", "advised"],
  will: ["going", "committed", "commitment"],
  would: ["going"],
  tends: ["tendency"],
  tend: ["tendency"],
  if: ["event", "case", "condition"],
  unless: ["event", "case", "condition"],
  whether: ["question"],
  // The rest of REDUCTION_LEXICON: every licensed reduction needs its carriers, or the
  // canonical compression into it reports a loss — "make sure that" -> "ensure" was
  // refused outright as information-dropped for want of these entries.
  ensure: ["sure", "certain", "make", "makes", "made"],
  ensures: ["sure", "certain", "make", "makes", "made"],
  before: ["prior", "advance", "ahead"],
  after: ["subsequent", "subsequently", "following"],
  during: ["course", "duration", "middle", "midst"],
  while: ["time", "period"],
  since: ["time", "point"],
  believes: ["opinion", "view", "belief", "impression"],
  believe: ["opinion", "view", "belief", "impression"],
  believed: ["opinion", "view", "belief", "impression"],
  thinks: ["opinion", "view", "belief", "impression"],
  think: ["opinion", "view", "belief", "impression"],
  expects: ["expectation", "expectations", "anticipation"],
  expect: ["expectation", "expectations", "anticipation"],
  // The quantity periphrases the quantifier guard already licenses as a one-way trade:
  // "a number of open questions" -> "several open questions". Without the matching
  // carriers the validator accepted the trade and the deletion policy then billed the
  // writer for the "number" it had just approved swapping out.
  several: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  many: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  most: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  much: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  some: ["number", "lot", "lots", "plenty", "amount", "quantity"],
  few: ["number", "lot", "lots", "plenty", "amount", "quantity", "minority"],
  // "with regard to", "in terms of", "regarding" -> "about", all on Grammarly's list.
  about: ["regard", "regards", "regarding", "concerning", "respect", "terms", "relation", "reference"],
  // "the present study" -> "this study", "at the present moment" -> "now".
  this: ["present", "current"],
}));

// Verbs that carry no meaning of their own in a nominalization: the noun beside them
// does. "put forward a proposal", "conduct an investigation into", "give consideration
// to", "carried out a review of" — Grammarly's periphrasis list is largely made of these,
// and unpacking one into its verb ("proposed", "investigate", "consider", "reviewed")
// drops nothing at all. "seek" is deliberately absent: "seeks to investigate" states an
// intention that "investigates" does not, and that is a fact about the world, not padding.
const LIGHT_VERBS = new Set([
  "make", "makes", "made", "take", "takes", "took", "give", "gives", "gave",
  "put", "puts", "perform", "performs", "performed", "conduct", "conducts", "conducted",
  "carry", "carries", "carried", "undertake", "undertakes", "undertook",
  "provide", "provides", "provided", "hold", "holds", "held", "reach", "reaches", "reached",
]);
// Words that stand in for a noun phrase rather than naming one.
const PRO_FORMS = new Set(["one", "ones", "it", "them", "this", "that", "these", "those", "some"]);

// The particles those verbs take. Alone they are directions; inside an unpacked
// nominalization they are part of the frame.
const LIGHT_PARTICLES = new Set(["forward", "out", "into"]);

// What tells a nominalization apart from an idiom's object: a derivational suffix, or a
// nominal complement standing right after it.
const NOMINALIZING_TAIL = /(?:ion|ment|ance|ence|ure|ity|al)$/u;
const NOMINAL_COMPLEMENT = new Set(["of", "into", "regarding", "concerning"]);

const wordAfter = (text, token) =>
  text.slice(token.end).match(/^[^\p{L}]*([\p{L}’']+)/u)?.[1]?.toLowerCase() ?? "";

// Fixed spans that pad a sentence without saying anything. Matched as spans rather than
// as words because every one of them is built from words that mean something elsewhere:
// "in place" is filler, "in place of" is "instead of", and "the place" is a location.
const FILLER_SPANS = [
  /\bin\s+place\b(?!\s+of)/giu,
  // "process" used to sit in STOCK_PHRASE_NOUNS, which made it free to delete anywhere:
  // "the alpha process is fast and the beta process is slow" -> "and the beta is slow"
  // lost a real noun for nothing. Only this frame is padding.
  /\bin\s+the\s+process\s+of\b/giu,
  // "time" is on the stock-phrase list and "present" is not, so deleting the phrase
  // outright was billed for half of itself. Found by running the development corpus
  // against a live model: the model dropped the phrase instead of compressing it to
  // "now", which is the shape the clarity rule handles.
  /\bat\s+the\s+present\s+(?:time|moment)\b/giu,
  /\bin\s+question\b/giu,
  /\bat\s+hand\b/giu,
  /\bin\s+nature\b/giu,
  /\bas\s+such\b/giu,
];

// The words of a politeness frame, which is manners rather than information: "I would
// just like to suggest that X" says exactly what "I suggest X" says. Also matched as
// spans, since "like" and "possible" are ordinary words outside the frame.
const POLITENESS_SPANS = [
  /\bwould\s+(?:just\s+)?(?:like|love)\s+to\b/giu,
  /\bdo\s+not\s+hesitate\s+to\b/giu,
  /\bplease\s+feel\s+free\s+to\b/giu,
];

// Character offsets covered by any of the given span patterns.
function spanCover(text, patterns) {
  const covered = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) covered.push([match.index, match.index + match[0].length]);
  }
  return covered;
}

const withinSpan = (covered, token) =>
  covered.some(([from, to]) => token.start >= from && token.end <= to);

// Whether any member of an epistemic certainty group is still standing. A hedge deleted
// while another hedge survives is a stack being reduced, not information leaving — the
// same judgement validateRewrite has already made by the time this runs; without it the
// two halves of the gate disagreed, the validator accepting the edit and the deletion
// policy then refusing it for the very words the validator had excused.
function epistemicSurvives(text) {
  const expanded = expandAuxiliaries(hedgeNormalised(text)).toLowerCase();
  return EPISTEMIC_GROUPS.some((index) => CERTAINTY_GROUPS[index].some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "u").test(expanded);
  }));
}

const EPISTEMIC_WORDS = new Set(EPISTEMIC_GROUPS.flatMap((index) => CERTAINTY_GROUPS[index]));

// Fixed binomials whose second half adds nothing to the first. Listed, because the rule
// below cannot tell them from a real pair: "first and foremost" says what "first" says,
// and "smaller and more reliable" does not say what "smaller" says.
const FIXED_PAIRS = /\b(?:first\s+and\s+foremost|null\s+and\s+void|each\s+and\s+every|one\s+and\s+only|aches\s+and\s+pains|law\s+and\s+order)\b/iu;

// Whether a lost word was one half of a coordination the rewrite dissolved. "The end
// result was a smaller and more reliable component." -> "a smaller component" drops an
// asserted property, and it loses exactly ONE content word, which is the case the
// deletion policy hands to the 2B verifier — measured to show it. A conjunct is never
// "already implied by" the word it was coordinated WITH: that is what coordination means.
export function dropsConjunct(source, candidate, lost) {
  if (!lost.length || FIXED_PAIRS.test(source)) return false;
  const coordinators = (text) => (text.match(/\b(?:and|or)\b/giu) ?? []).length;
  if (coordinators(candidate) >= coordinators(source)) return false;
  return lost.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    // Up to two words either side, which reaches across the "more" of "and more reliable"
    // and the determiner of "the manual and the wrench" without crossing a clause.
    return new RegExp(`\\b(?:and|or)\\s+(?:\\S+\\s+){0,2}${escaped}\\b|\\b${escaped}\\s+(?:\\S+\\s+){0,2}(?:and|or)\\b`, "iu")
      .test(source);
  });
}

// A lost word the sentence still contains, just fewer times. "consists of a payload
// structure and a spacecraft structure" -> "and a structure" leaves "spacecraft" standing
// earlier in the sentence, where it is doing different work. This is the one case where
// the verifier's whole question — is the removed word already implied by what survives? —
// invites the wrong answer, because a copy of the word IS what survives; asked about this
// very sentence it replied that "spacecraft" was "already implied by the noun 'spacecraft
// structure'". So it is settled here rather than asked.
export function dropsRepeatedWord(source, candidate, lost) {
  if (!lost.length) return false;
  const content = (text) => tokenize(text)
    .filter((token) => !token.space && isContentWord(token))
    .map((token) => token.text.toLowerCase());
  const sourceWords = content(source);
  const candidateWords = content(candidate);
  const occurrences = (words, word) => words.filter((other) => other === word).length;
  return lost.some((word) => {
    const lowered = word.toLowerCase();
    const before = occurrences(sourceWords, lowered);
    return before > 1 && occurrences(candidateWords, lowered) < before;
  });
}

export function lostContentWords(source, candidate) {
  // Span-scoped, for the same reason validateRewrite is: a deleted formulaic attention
  // frame costs the writer nothing, so its own words ("noted", "noting") must not be
  // billed as lost information. Without this the validator accepts the edit and the
  // deletion policy then sends it to the verifier anyway, for words the reader never
  // needed — the two halves of the gate disagreeing about what the sentence is.
  const proposition = attentionProposition(source);
  if (proposition && !ATTENTION_FRAME.test(candidate)) {
    return lostContentWords(proposition, candidate);
  }
  const ops = diffWords(source, candidate);
  // Only surviving CONTENT words can carry a deleted word's meaning: letting a
  // surviving "to" vouch for a deleted "tomorrow" was how trailing deletions hid.
  const survivors = new Set(
    ops.filter((op) => op.type !== "delete")
      .map((op) => op.target ?? op.source)
      .filter((token) => isContentWord(token))
      .map((token) => token.text.toLowerCase()),
  );
  // How many words related to `word` each side carries. A SET of survivors cannot tell
  // a word that was carried from a word that merely occurs twice, and English repeats
  // content words constantly: in "the right Solid Rocket Booster struck the ... right
  // wing" the second "right" excused deleting the first, and with it which booster the
  // sentence was about. "consists of a payload structure and a spacecraft structure" ->
  // "and a structure" went the same way. Comparing COUNTS asks the right question —
  // does the candidate still carry as much of this word as the source did — and it also
  // catches the case where the related survivor was already in the source doing its own
  // job, as "summarised" was for the deleted "summary".
  const contentWords = (text) => tokenize(text)
    .filter((token) => !token.space && isContentWord(token))
    .map((token) => token.text.toLowerCase());
  const sourceWords = contentWords(source);
  const candidateWords = contentWords(candidate);
  const carriedCount = (words, word) => words.filter((other) => related(other, word)).length;
  // Connectives are exempt: their repetition is already governed, by distinct membership,
  // in the discourse guard, which exists precisely so that "Because A and because B, C"
  // may be tidied to "Because A and B, C". Counting occurrences here would contradict it.
  const stillCarried = (word) => DISCOURSE_WORDS.has(word)
    || carriedCount(candidateWords, word) >= carriedCount(sourceWords, word);
  const repetitionSurvives = [...survivors].some((word) => REPETITION_CARRIER.test(word));
  const hedgeSurvives = epistemicSurvives(candidate);
  const failureWords = (words) => words.filter((word) => FAILURE_WORDS.has(word)).length;
  const failurePreserved = failureWords(candidateWords) >= failureWords(sourceWords);
  const filler = spanCover(source, FILLER_SPANS);
  const politeness = spanCover(source, POLITENESS_SPANS);
  const lost = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") { index += 1; continue; }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    // A stock phrase compressed into its conventional single word loses nothing:
    // "due to the fact that" -> "because", "in the near future" -> "soon". The
    // exemption is PER WORD — only what the inserted reduction actually stands for —
    // never the whole run, or one inserted "soon" forgives an unrelated clause.
    // Keyed straight off REDUCTION_CARRIERS. It used to be gated on REDUCTION_LEXICON as
    // well, which was harmless while every key happened to be in both, but the two lists
    // answer different questions: the lexicon says which words may be INTRODUCED without
    // an antecedent, this map says what an introduced word STANDS FOR.
    const carried = new Set(run
      .filter((op) => op.type === "insert")
      .flatMap((op) => REDUCTION_CARRIERS.get(op.target.text.toLowerCase()) ?? []));
    // A nominalization unpacked into its verb: the run puts back a word derived from a
    // noun it removes, and what is left over is the light-verb frame that held the noun.
    //
    // Relatedness alone is not enough, because English builds idioms out of the same
    // shape: "took the blame for the outage" -> "blamed the outage" and "took issue
    // with the figures" -> "issued the figures" both pass a bare related() test while
    // inverting the sentence. What separates the two is the noun. A real nominalization
    // either wears a derivational suffix ("consideration", "measurement", "proposal",
    // "decision") or takes a nominal complement ("a review OF", "an investigation
    // INTO"); the idiomatic objects — blame, floor, issue — do neither.
    const insertsProForm = run.some((op) =>
      op.type === "insert" && PRO_FORMS.has(op.target.text.toLowerCase()));
    const unpacked = run.some((op) => op.type === "insert" && isContentWord(op.target)
      && run.some((other) => other.type === "delete" && isContentWord(other.source)
        && related(other.source.text, op.target.text)
        && (NOMINALIZING_TAIL.test(other.source.text.toLowerCase())
          || NOMINAL_COMPLEMENT.has(wordAfter(source, other.source)))));
    // A run that deletes "failed to" is not a compression of anything: it reverses the
    // sentence. Nothing it removes counts as carried by a surviving relative, so the loss
    // is large enough for the pipeline to refuse it outright rather than ask a verifier.
    // ... unless the sentence puts a failure word straight back. "In the event of a
    // failure, the client will retry" -> "If the request fails, the client will retry"
    // keeps the failure; it is the periphrasis around it that goes. Billing every deletion
    // in that run also billed the stock noun "event", which costs the reader nothing.
    //
    // Counted over the WHOLE sentence, not the run: "documented the failure in the log"
    // -> "documented the incident log failure" moves the word into a different diff run,
    // and a run-scoped test called it removed. The verifier was then asked whether a word
    // still sitting in the proposed sentence had been lost.
    const inverts = run.some((op) =>
      op.type === "delete" && FAILURE_WORDS.has(op.source.text.toLowerCase()))
      && !failurePreserved;
    for (const op of run) {
      if (op.type !== "delete" || !isContentWord(op.source)) continue;
      const word = op.source.text.toLowerCase();
      if (inverts) { lost.push(op.source.text); continue; }
      if (INTENSIFIERS.has(word)) continue;
      if (STOCK_PHRASE_NOUNS.has(word)) continue;
      if (withinSpan(filler, op.source) || withinSpan(politeness, op.source)) continue;
      if (unpacked && (LIGHT_VERBS.has(word) || LIGHT_PARTICLES.has(word))) continue;
      if (hedgeSurvives && EPISTEMIC_WORDS.has(word)) continue;
      if (REPETITION_MODIFIERS.has(word)) {
        if (repetitionSurvives) continue;
        lost.push(op.source.text);
        continue;
      }
      if (REDUNDANT_MODIFIERS.has(word)) continue;
      if (carried.has(word)) continue;
      // A related word still in the sentence means the meaning was carried, not dropped —
      // provided the candidate carries as many of them as the source did.
      const antecedentStands = [...survivors].some((survivor) => related(survivor, word));
      if (antecedentStands && stillCarried(word)) continue;
      // ... or the run put a pro-form where the noun was. "the old process was" -> "the
      // old one" drops an occurrence and loses nothing, because "one" points back at the
      // occurrence that is still standing. The antecedent has to BE standing: "Ship the
      // report to Maya." -> "Ship it to Maya." has nothing for "it" to point at, and
      // still reports the loss.
      if (antecedentStands && insertsProForm) continue;
      lost.push(op.source.text);
    }
    index = end;
  }
  return lost;
}

// An edit whose whole content is deleting an article improves nothing; it just puts an
// underline under the writer's sentence. Inserting one can fix a real fault (a missing
// article), so only deletion-only edits count as trivial.
//
// Narrowed to articles: deleting a stray auxiliary ("I am work here" -> "I work here"),
// a doubled intensifier ("very completely sealed"), or a stray preposition ("discussed
// about the budget") is the entire repair in each case, and the old rule refused all
// three. Every other function word remains guarded by its own signature — negation,
// quantifier, direction, discourse — so relaxing this one does not reopen those.
const TRIVIAL_DELETIONS = new Set(["a", "an", "the"]);

// Contractions and the longhand they stand for, for the single question "are these two
// spellings of the same thing?". Deliberately wider than AUX_CONTRACTIONS, which other
// signatures depend on and must not grow: the "'s"/"'re" family is the commonest way a
// model spells a sentence out, and leaving it uncovered let exactly the reported card
// through in a different tense. "ain't" is absent on purpose — it is nonstandard, so
// writing it out is a register repair rather than a respelling.
const RESPELLINGS = new Map([
  ...[...AUX_CONTRACTIONS].filter(([word]) => word !== "ain't"),
  ["it's", "it is"], ["that's", "that is"], ["there's", "there is"], ["here's", "here is"],
  ["he's", "he is"], ["she's", "she is"], ["what's", "what is"], ["who's", "who is"],
  ["let's", "let us"], ["i'm", "i am"],
  ["you're", "you are"], ["we're", "we are"], ["they're", "they are"],
  ["i've", "i have"], ["you've", "you have"], ["we've", "we have"], ["they've", "they have"],
  ["i'll", "i will"], ["you'll", "you will"], ["he'll", "he will"], ["she'll", "she will"],
  ["we'll", "we will"], ["they'll", "they will"], ["it'll", "it will"],
  ["i'd", "i would"], ["you'd", "you would"], ["he'd", "he would"], ["she'd", "she would"],
  ["we'd", "we would"], ["they'd", "they would"],
]);

function respelled(words) {
  return words
    .map((word) => RESPELLINGS.get(word.toLowerCase().replace(/[’]/gu, "'")) ?? word.toLowerCase())
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

// What one run of adjacent changes is worth.
//   "respelling" — the same auxiliary written out longhand, or merely retyped with a
//                  different apostrophe. Never worth showing.
//   "article"    — an article lifted out with nothing put back. Worth nothing on its own
//                  in a clarity rewrite, but a real repair when the article was
//                  ungrammatical ("I ate a rice"), which is why the grammar tier judges
//                  these differently and why several of them together are left alone.
//   "substantive"— everything else, including any insertion.
function runValue(run, all) {
  // A run that removes one half of "the the" is a repair wherever it sits.
  for (const op of run) {
    if (op.type !== "delete") continue;
    const at = all.indexOf(op);
    const word = op.source.text.toLowerCase();
    const same = (other) => (other?.source ?? other?.target)?.text.toLowerCase() === word;
    if (same(all[at - 1]) || same(all[at + 1])) return "substantive";
  }
  const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text);
  const added = run.filter((op) => op.type === "insert").map((op) => op.target.text);
  if (added.length === 0) {
    return removed.every((word) => TRIVIAL_DELETIONS.has(word.toLowerCase())) ? "article" : "substantive";
  }
  if (removed.length === 0) return "substantive";
  // Same words, different spelling. Only the longer side is worthless — contracting
  // shortens and is what Grammarly suggests — but an equal-length respelling (a curly
  // apostrophe for a straight one) is a pure no-op and goes too.
  if (respelled(removed) !== respelled(added)) return "substantive";
  return added.join(" ").length >= removed.join(" ").length ? "respelling" : "substantive";
}

function runsOf(source, candidate) {
  const all = diffWords(source, candidate);
  const runs = [];
  for (let index = 0; index < all.length; index += 1) {
    if (all[index].type === "equal") continue;
    const start = index;
    while (index < all.length && all[index].type !== "equal") index += 1;
    runs.push(runValue(all.slice(start, index), all));
  }
  return runs;
}

// Refuses an edit the writer would gain nothing from. Two shapes:
//   - one article removed and nothing else (the long-standing rule);
//   - an auxiliary spelled out longhand, with nothing substantive alongside it. This is
//     the card that prompted the change: "doesn't block the OCR delivery" -> "does not
//     block OCR delivery" expands a contraction, drops an article, and reads "Shortens".
// SEVERAL articles removed together stay accepted — dropping "the" from two abstract
// nouns is an article-misuse repair, not a cosmetic tidy.
function isTrivialEdit(source, candidate) {
  const runs = runsOf(source, candidate);
  if (runs.length === 0) return false;
  if (runs.length === 1 && runs[0] === "article") return true;
  if (runs.some((kind) => kind === "substantive")) return false;
  return runs.includes("respelling");
}



// A candidate that holds exactly the source's words in a different order has added
// nothing and lost nothing, so every count-based and set-based check above passes it.
// "We ship only on Fridays" -> "We only ship on Fridays" and "Maya emailed Priya" ->
// "Priya emailed Maya" are both this shape. Requires an exact multiset match — except
// for articles, whose insertion or removal is worth nothing on its own: "The outage
// caused the alert." -> "The alert caused outage." is the same reversal with one
// dropped "the", and demanding the exact multiset let it through. A legitimate rewrite
// that moves an adjunct also changes some non-article word along the way.
function isPurePermutation(source, candidate) {
  const all = (text) => tokenize(text)
    .filter((token) => !token.space && /[\p{L}\p{N}]/u.test(token.text))
    .map((token) => token.text.toLowerCase());
  // Ignoring articles must not swallow a real repair: unwinding "Attached is signed
  // contract." to "The signed contract is attached." ADDS the missing article, and
  // that insertion is the repair. Only a candidate that adds no article gets the
  // article-insensitive comparison — dropping one is never the substance of a rewrite.
  const articles = (words) => words.filter((word) => TRIVIAL_DELETIONS.has(word)).length;
  const leftAll = all(source);
  const rightAll = all(candidate);
  if (articles(rightAll) > articles(leftAll)) return false;
  const left = leftAll.filter((word) => !TRIVIAL_DELETIONS.has(word));
  const right = rightAll.filter((word) => !TRIVIAL_DELETIONS.has(word));
  if (left.length !== right.length || left.length === 0) return false;
  if (same(left, right)) return false;                    // only punctuation, case or articles moved
  return same([...left].sort(), [...right].sort());
}

// Subordinators whose clause a comma delimits. Which side of them the comma sits on is
// what says where the clause attaches.
const SUBORDINATORS = [
  "if", "unless", "because", "since", "while", "although", "though", "when", "after",
  "before", "as",
];

// A comma that left the front of a subordinator and reappeared after its clause has
// re-attached that clause to something else. "Wanted to flag a risk early, if the rate
// limits kick in the flow could stall." makes the STALL conditional; "…flag a risk early
// if the rate limits kick in, as the flow could stall." makes the FLAGGING conditional.
// No word changed, so no other signature sees it, and the pinned todo about hedges in
// coordinated clauses is the same blindness from the other end.
//
// Directional, and both halves are load-bearing. A comma ARRIVING in front of a
// subordinator is an ordinary punctuation repair, which is why the source must be the
// side that had it; and a comma count that drops is a tidy rather than a move, which is
// why the candidate must keep as many as it started with.
function subordinatorReattached(source, candidate) {
  const commaBefore = (text, word) => {
    const match = new RegExp(`(,\\s*)?\\b${word}\\b`, "iu").exec(text);
    return match ? Boolean(match[1]) : null;
  };
  const occurrences = (text, word) => (text.match(new RegExp(`\\b${word}\\b`, "giu")) ?? []).length;
  const commas = (text) => (text.match(/,/gu) ?? []).length;
  return SUBORDINATORS.some((word) => {
    if (occurrences(source, word) !== 1 || occurrences(candidate, word) !== 1) return false;
    return commaBefore(source, word) === true && commaBefore(candidate, word) === false
      && commas(candidate) >= commas(source);
  });
}

// Prepositions that place a verb's object somewhere or sometime. After an object they are
// ambiguous: "documented the failure in the incident log" can say where the failure was
// documented or which failure it was, and only the first reading is what the writer
// meant. "of" is absent because it is never ambiguous that way — "the failure of the
// pump" is the pump's failure whatever verb precedes it — and folding it into a compound
// ("the pump failure") is an ordinary compression.
const OBJECT_ADJUNCT_PREPOSITIONS = new Set([
  "in", "on", "at", "within", "inside", "during", "under", "beneath", "behind", "beside", "near", "throughout",
]);
const NOUN_DETERMINERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "its", "their", "his", "her", "our", "my", "your",
  "each", "every", "any", "some",
]);

// A verb's object and the locative phrase after it, folded into a single compound with the
// object as its head. "Ravi documented the failure in the incident log." -> "Ravi documented
// the incident log failure." keeps every content word and drops only "in", so no other
// signature sees it — but the phrase that said WHERE the failure was recorded now says WHAT
// failed. The candidate has picked one side of a prepositional attachment the source left
// open, and it picked the side the writer did not mean.
//
// Scoped to an object: the noun must sit behind a determiner with a content word — the
// verb — in front of that. A subject's own modifier compounds safely ("The changes in the
// schedule were approved." -> "The schedule changes were approved.": nothing else could
// have been in the schedule), and that shape is left alone.
function objectAdjunctCompounded(source, candidate) {
  const wordsOf = (text) => tokenize(text)
    .filter((token) => !token.space && /[\p{L}\p{N}]/u.test(token.text))
    .map((token) => token.text.toLowerCase());
  const content = (word) => /\p{L}/u.test(word) && !FUNCTION_WORDS.has(word);
  const left = wordsOf(source);
  const right = wordsOf(candidate);
  for (let index = 1; index + 2 < left.length; index += 1) {
    const head = left[index];
    const preposition = left[index + 1];
    if (!content(head) || !OBJECT_ADJUNCT_PREPOSITIONS.has(preposition)) continue;
    let governor = index - 1;
    while (governor >= 0 && NOUN_DETERMINERS.has(left[governor])) governor -= 1;
    if (governor < 0 || governor === index - 1 || !content(left[governor])) continue;
    let after = index + 2;
    while (after < left.length && NOUN_DETERMINERS.has(left[after])) after += 1;
    const modifier = [];
    while (after < left.length && content(left[after])) { modifier.push(left[after]); after += 1; }
    if (modifier.length === 0) continue;
    if (right.some((word, at) => word === head && right[at + 1] === preposition)) continue;
    for (let at = 0; at + modifier.length < right.length; at += 1) {
      if (modifier.every((word, offset) => right[at + offset] === word) && right[at + modifier.length] === head) {
        return true;
      }
    }
  }
  return false;
}

// A passive clause names its agent after "by"; the active form names the agent first.
// Converting between the two therefore REVERSES the order of the content words around
// the verb. A conversion that keeps their order has kept the surface subject and
// swapped the ROLES instead: "The outage was caused by the alert." -> "The outage
// caused the alert." states the opposite causality, and every other check reads the
// lost "was ... by" as nothing at all — function words, no name moved, tense intact.
// Only refused when the shared content words hold their exact order, so a genuine
// voice conversion (which reorders them) is untouched.
// The "by" phrase must be able to NAME an agent: "by noon", "by Friday", "by then" are
// deadlines, and a stative sentence rewritten around one has no roles to flip. A DURATION
// is the same kind of non-agent and was missing: the digit exclusion caught "by 3 weeks"
// while "by three weeks" read as an agent called three, so "delayed for a period of three
// weeks" -> "delayed by three weeks" was refused as a reversal of roles it does not have.
const DURATION_AFTER_BY =
  "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|\\d+)\\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?)\\b";
const PASSIVE_SKELETON =
  new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(?:\\w+(?:ed|en|wn|ne|lt|ung|eld|ade|aid|ept|ent|old|uilt|ead|one))\\s+by\\s+(?!(?:noon|midnight|midday|dawn|dusk|dark|then|now|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|next|early|late|end|the\\s+end|\\d)\\b|${DURATION_AFTER_BY})`, "iu");

// An expletive "it" over a that-clause has no patient noun phrase to move: in "It has
// been demonstrated by previous research that caching improves throughput" the other
// participant is a whole clause, and a clause stays where it is. The order test measures
// nothing there, so it must not speak. Anaphoric "It was caused by the alert." is
// deliberately NOT matched — there "it" stands for something, and the reversal this
// guard exists to catch is exactly what that sentence would suffer.
const EXPLETIVE_PASSIVE = /^\s*it\s+(?:\w+\s+){1,3}by\b[^.]*\bthat\b/iu;

function rolesFlipped(source, candidate) {
  if (PASSIVE_SKELETON.test(source) === PASSIVE_SKELETON.test(candidate)) return false;
  if (EXPLETIVE_PASSIVE.test(source)) return false;
  const content = (text) => tokenize(text)
    .filter((token) => !token.space && isContentWord(token))
    .map((token) => token.text.toLowerCase());
  const left = content(source);
  const right = content(candidate);
  const shared = left.filter((word) => right.includes(word));
  const sharedRight = right.filter((word) => left.includes(word));
  if (shared.length < 2) return false;
  return same(shared, sharedRight);
}

// Two common nouns exchanged for each other. "The auditor reviewed the vendor's
// controls." -> "The vendor reviewed the auditor's controls." states the opposite, and
// nothing else in this file sees it: neither noun is capitalised, so the name detector is
// silent; the word multiset differs, because the possessive travels with the noun, so
// isPurePermutation is silent; no voice changed, so rolesFlipped is silent; the tense,
// the numbers and the negation count all hold.
//
// Only an exact exchange is refused — two spans, each replaced by the other and nothing
// else substituted — so an ordinary reordering, a compression or a single substitution is
// untouched. The spans may be more than one word ("the parent company" for "the
// subsidiary"), which is why runs are compared rather than tokens. The possessive clitic
// is stripped before comparing, which is what lets the swap be seen at all.
function commonNounRolesSwapped(source, candidate) {
  const ops = diffWords(source, candidate).filter((op) => op.type !== "equal");
  // Consecutive edits of one kind are one span. An exchange is exactly two spans on each
  // side, and every token in them must be a content word: a swap that also moves a
  // function word is some other edit, and this guard has nothing to say about it.
  const runs = [];
  for (const op of ops) {
    const token = op.source ?? op.target;
    if (!isContentWord(token)) return false;
    const last = runs[runs.length - 1];
    if (last && last.type === op.type) last.tokens.push(token);
    else runs.push({ type: op.type, tokens: [token] });
  }
  if (runs.length !== 4) return false;
  const stem = (run) => run.tokens.map((token) => token.text.toLowerCase().replace(/['’]s$/u, "")).join(" ");
  const removed = runs.filter((run) => run.type === "delete").map(stem);
  const added = runs.filter((run) => run.type === "insert").map(stem);
  if (removed.length !== 2 || added.length !== 2) return false;
  if (removed[0] === removed[1]) return false;
  return removed[0] === added[1] && removed[1] === added[0];
}

// A one-for-one swap between two commonly confused spellings is the repair CONFUSABLES
// exists to license. Checked early because another signature fires first on two of the
// pairs: "lead" -> "led" reads as a tense change and "advice" -> "advise" as a dropped
// commitment. Numbers and protected tokens are still enforced before this point.
function isConfusableRepair(source, candidate) {
  const ops = diffWords(source, candidate).filter((op) => op.type !== "equal");
  if (ops.length !== 2) return false;
  const removed = ops.find((op) => op.type === "delete")?.source.text.toLowerCase();
  const added = ops.find((op) => op.type === "insert")?.target.text.toLowerCase();
  if (!removed || !added) return false;
  return CONFUSABLES.some(([x, y]) => (removed === x && added === y) || (removed === y && added === x));
}

// Formulaic ATTENTION frames. These direct the reader's attention and assert nothing
// about how likely, certain or committed the claim behind them is, so deleting one
// leaves the proposition — and its epistemic status — exactly as the writer left it.
//
// Every guard in this file counts words across the WHOLE sentence, which means the
// frame's own vocabulary is read as part of the writer's claim: "It should be noted
// that X" -> "X" was refused as certainty-changed because the frame contains "should",
// while the identical edit on "It is worth noting that X" was accepted because that
// frame happens to contain no counted word. That is an artefact of counting, not a
// policy anyone chose, and this is the narrowest fix for it: judge the surviving
// proposition rather than the whole sentence.
//
// EPISTEMIC frames are deliberately absent — "it could be argued that", "there is a
// chance that", "it is possible that". Those carry the claim's strength, so dropping
// one asserts what the writer hedged, and refusing them is the documented policy
// (docs/GRAMMARLY-BEHAVIOUR.md §3, certainty strengthening).
const ATTENTION_FRAME =
  /^(?:it should be noted that|it is worth noting that|it is worth mentioning that|it is important to note that|it must be noted that|it bears mentioning that|please note that)\s+/iu;

// The sentence with a leading attention frame removed, recapitalised, or null when it
// carries none. Only a frame the writer put at the very start counts: mid-sentence the
// same words are ordinary prose.
function attentionProposition(text) {
  const frame = ATTENTION_FRAME.exec(text);
  if (!frame) return null;
  const rest = text.slice(frame[0].length).trim();
  if (!rest) return null;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// Determiners that fix nothing about how many things a noun phrase is about. A determiner
// that does — "Both engineer" -> "Both engineers", "Each engineers" -> "Each engineer" —
// is itself the trigger for the repair, so only this neutral list refuses one.
const NUMBER_NEUTRAL_DETERMINERS = new Set([
  "the", "my", "our", "your", "his", "her", "its", "their", "no", "any", "some",
]);

// Refuses the lone edit that pluralises or singularises a noun with nothing in the
// sentence asking for it. Scoped to the case where that swap is the whole rewrite and the
// word sits directly behind a determiner, so verb agreement ("The valves needs" -> "The
// valves need") and triggered noun agreement ("Both engineer" -> "Both engineers") are
// untouched.
// Tails that make a DIFFERENT word rather than a different form of the same one. "bond"
// and "bonding" name different things; "student" and "students" do not. related() treats
// both alike, which is right nearly everywhere — it is what lets "a proposal" become
// "proposed" — and wrong when the derivation is the entire edit.
const DERIVATIONAL_TAILS = new Set([
  "ion", "ions", "ment", "ments", "ance", "ence", "ness", "ing", "al", "ure", "ity", "er", "ers", "or", "ors",
]);

// The lone edit that swaps a word for a noun derived from it, with nothing in the
// sentence asking for it: "tested the bonding" -> "tested the bond" changes what was
// tested, and every other guard reads the pair as one word. Scoped to the case where the
// swap is the WHOLE rewrite, so a voice conversion or a nominalization unpack — which
// move other words too — are untouched, as are the confusable repairs the gate exists to
// permit.
function isLoneDerivationSwap(source, candidate) {
  const changed = diffWords(source, candidate).filter((op) => op.type !== "equal");
  if (changed.length !== 2) return false;
  const removed = changed.find((op) => op.type === "delete")?.source.text.toLowerCase();
  const added = changed.find((op) => op.type === "insert")?.target.text.toLowerCase();
  if (!removed || !added || removed === added) return false;
  if (CONFUSABLES.some(([x, y]) => (removed === x && added === y) || (removed === y && added === x))) {
    return false;
  }
  const [shorter, longer] = removed.length <= added.length ? [removed, added] : [added, removed];
  if (!longer.startsWith(shorter)) return false;
  const tail = longer.slice(shorter.length);
  // Under a be-auxiliary, "-ing" is the progressive inflection rather than a derivation,
  // and supplying it is the whole repair: "She is listen to the operator." -> "She is
  // listening to the operator." Only away from that frame does "-ing" make a new word.
  if (tail === "ing" && new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+${longer}\\b`, "iu")
    .test(`${source} ${candidate}`)) {
    return false;
  }
  return DERIVATIONAL_TAILS.has(tail);
}

// Prepositions that make a nominal's complement its TOPIC rather than its object: "a
// determination regarding the budget" is a ruling about the budget, where "a
// determination of the budget" would be the budget being worked out.
const TOPIC_PREPOSITIONS = new Set(["regarding", "concerning", "about", "on"]);

// Verbs of ruling. For most verbs the topic of the nominal is the object of the verb,
// and unpacking one into the other is a compression ("an explanation regarding the
// delay" -> "explained the delay"). For these the object is what gets FIXED, not what
// the ruling was about: "make a determination regarding the revised budget" -> "determine
// the revised budget" turns ruling on the budget into setting it, and "reach a decision
// on the merger" -> "decide the merger" does the same. The nominalization exemption in
// lostContentWords rightly reads the light verb as carried, and what it cannot see is
// that the dropped preposition was the only word saying which of the two the writer meant.
const RULING_VERBS = new Set([
  "determine", "determines", "determined", "decide", "decides", "decided",
  "rule", "rules", "ruled", "settle", "settles", "settled", "judge", "judges", "judged",
  "resolve", "resolves", "resolved",
]);

// A nominal's topic complement dropped in the same run that turned the nominal into a
// verb of ruling. The verb must come from the noun (related(), and the noun must wear a
// derivational suffix) so that an ordinary preposition tidy and an unrelated verb swap
// are both untouched; and the preposition must GO — "make a determination regarding" ->
// "make a determination on" swaps one topic marker for another and changes nothing.
function topicComplementObjectified(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") { index += 1; continue; }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text.toLowerCase());
    const added = run.filter((op) => op.type === "insert").map((op) => op.target.text.toLowerCase());
    const topicDropped = removed.some((word) => TOPIC_PREPOSITIONS.has(word))
      && !added.some((word) => TOPIC_PREPOSITIONS.has(word));
    const ruling = added.some((verb) => RULING_VERBS.has(verb)
      && removed.some((noun) => noun !== verb && NOMINALIZING_TAIL.test(noun) && related(noun, verb)));
    if (topicDropped && ruling) return true;
    index = end;
  }
  return false;
}

// Confusables that are content words. The pairs the list also carries for function words
// ("to"/"too", "then"/"than", "its"/"it's") are left out: nothing is derived from a
// pronoun, and "to" is the head of too many real words ("today", "together") to ask.
const CONFUSABLE_PARTNERS = new Map();
for (const [x, y] of CONFUSABLES) {
  if (FUNCTION_WORDS.has(x) || FUNCTION_WORDS.has(y)) continue;
  CONFUSABLE_PARTNERS.set(x, [...(CONFUSABLE_PARTNERS.get(x) ?? []), y]);
  CONFUSABLE_PARTNERS.set(y, [...(CONFUSABLE_PARTNERS.get(y) ?? []), x]);
}

// A commonly confused spelling resolved by building on it. "Before you loose the
// alignment" is "lose" misspelt, and the one repair CONFUSABLES licenses is the swap to
// its partner. "Before loosening the alignment" does something else: it reads the
// spelling as written, derives a verb the writer never used, and makes the alignment the
// thing being slackened rather than the thing at risk. Three things have to hold in one
// diff run — a content-word confusable deleted, no form of it or of its partner anywhere
// in the candidate (so a repair, a move and a plain inflection are all untouched), and an
// inserted word that begins with the deleted spelling. related() is the arbiter of "a
// form of": it already says "loosening" is not a form of "loose", which is why the
// deletion policy reports the word as lost at all.
function confusableResolvedByDerivation(source, candidate) {
  const ops = diffWords(source, candidate);
  const survivors = tokenize(candidate)
    .filter((token) => !token.space && isContentWord(token))
    .map((token) => token.text.toLowerCase());
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") { index += 1; continue; }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text.toLowerCase());
    const added = run.filter((op) => op.type === "insert").map((op) => op.target.text.toLowerCase());
    for (const word of removed) {
      const partners = CONFUSABLE_PARTNERS.get(word);
      if (!partners) continue;
      if (survivors.some((other) => related(other, word))) continue;
      if (survivors.some((other) => partners.some((partner) => related(other, partner)))) continue;
      if (added.some((other) => other.length > word.length && other.startsWith(word))) return true;
    }
    index = end;
  }
  return false;
}

// A verb that was doing something becomes a verb something is done to. "Will the parts
// clear inspection?" asks whether the parts pass it; "Will the parts be cleared for
// inspection?" asks whether someone will authorise them to undergo it — the subject moves
// from agent to patient, and no content word changed to say so. rolesFlipped cannot see
// this one: it needs a "by" phrase to compare against, and an agentless passive has none.
//
// Scoped to the run that makes the change, so a passive-to-active conversion (which
// deletes the auxiliary rather than inserting it) and a progressive repair (where the
// auxiliary was already there, unchanged) are both untouched.
const BE_FORMS = new Set(["be", "been", "being", "is", "are", "was", "were", "am"]);

function passiveIntroduced(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") { index += 1; continue; }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const inserted = run.filter((op) => op.type === "insert").map((op) => op.target.text.toLowerCase());
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text.toLowerCase());
    for (let at = 0; at < inserted.length - 1; at += 1) {
      if (!BE_FORMS.has(inserted[at])) continue;
      const participle = inserted[at + 1];
      if (!/(?:ed|en)$/u.test(participle)) continue;
      if (removed.some((word) => !BE_FORMS.has(word) && related(word, participle))) return true;
    }
    index = end;
  }
  return false;
}

function isUntriggeredNumberChange(source, candidate) {
  const ops = diffWords(source, candidate);
  const changed = ops.filter((op) => op.type !== "equal");
  if (changed.length !== 2) return false;
  const removed = changed.find((op) => op.type === "delete")?.source;
  const added = changed.find((op) => op.type === "insert")?.target;
  if (!removed || !added) return false;
  const before = removed.text.toLowerCase();
  const after = added.text.toLowerCase();
  // Every regular plural spelling: +s, +es, y->ies, f/fe->ves. Recognising only the
  // first two let "policy" -> "policies" pluralise a noun behind "the" unchallenged.
  const inflects = (one, other) => `${one}s` === other || `${one}es` === other
    || (one.endsWith("y") && `${one.slice(0, -1)}ies` === other)
    || (/fe?$/u.test(one) && `${one.replace(/fe?$/u, "ves")}` === other);
  if (!inflects(before, after) && !inflects(after, before)) return false;
  // The word directly behind the change. A determiner there makes the changed word a noun;
  // anything else — a noun, a pronoun — means it is the verb, and verb agreement is not
  // this rule's business.
  const index = ops.indexOf(changed.find((op) => op.type === "delete"));
  const previous = ops.slice(0, index).reverse()
    .find((op) => op.type !== "insert" && /[\p{L}]/u.test(op.source.text));
  const determiner = previous?.source.text.toLowerCase();
  return Boolean(determiner) && NUMBER_NEUTRAL_DETERMINERS.has(determiner);
}

// A rewrite that lops off the end of a sentence — "for a week", "before importing it" —
// is the deletion the model is most likely to make and the verifier least likely to
// catch, because the shortened sentence still reads perfectly well.
export function deletesTrailingPhrase(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = ops.length - 1;
  // Step over the terminal mark and over anything the rewrite put at the end, so that
  // "reported the smell" -> "smelled" is still recognised as eating the sentence's tail.
  while (index >= 0) {
    const op = ops[index];
    const token = op.target ?? op.source;
    if (op.type === "insert") { index -= 1; continue; }
    if (op.type === "equal" && !/[\p{L}\p{N}]/u.test(token.text)) { index -= 1; continue; }
    break;
  }
  // Whatever run of deletions ends the sentence: does it carry a content word?
  let carriesContent = false;
  while (index >= 0 && ops[index].type === "delete") {
    if (isContentWord(ops[index].source)) carriesContent = true;
    index -= 1;
  }
  return carriesContent;
}

// Function words that fix the SCOPE of a claim. None is a content word, so
// lostContentWords never reports one and the deletion policy never sees it — yet dropping
// one changes what the sentence claims. "Hold the release until Friday." -> "Hold the
// release Friday." turns a deadline into a date; "her own laptop" -> "her laptop" gives
// up whose it is; "Everyone except the intern signed off." -> "Everyone signed off."
// contradicts the source outright.
//
// Refused when the candidate carries fewer than the source did. Adding one is not a loss
// and is left to the guards that judge invented claims.
const SCOPE_WORDS = ["unless", "until", "except", "only", "own"];

export function dropsScopeWord(source, candidate) {
  const count = (text, word) =>
    (text.toLowerCase().match(new RegExp(`\\b${word}\\b`, "gu")) ?? []).length;
  return SCOPE_WORDS.some((word) => count(candidate, word) < count(source, word));
}

export const REJECTION_REASONS = [
  "action-mismatch", "empty", "unchanged", "instruction-output", "multiple-sentences",
  "numbers-changed", "protected-token-changed", "markup-changed", "name-changed", "certainty-changed",
  "quantifier-changed", "content-dropped",
  "negation-changed", "tense-changed", "question-changed",
  "terminal-punctuation-changed", "word-substituted", "reason-contradicts-action",
  "trivial-edit", "excessive-edit",
  "pronoun-changed", "direction-changed", "order-changed",
  // Raised by the pipeline's lost-content-words policy rather than by a validator here.
  "information-dropped",
];

export function validateRewrite(source, decision, { maxEditRatio = 0.58, protectedTerms = [] } = {}) {
  if (decision?.action !== "rewrite") return reject("action-mismatch");
  const original = source.trim();
  const candidate = typeof decision.replacement === "string" ? decision.replacement.trim() : "";
  if (!candidate) return reject("empty");
  if (candidate === original) return reject("unchanged");
  if (INSTRUCTION_OUTPUT.test(candidate)) return reject("instruction-output");
  if (refusesInsteadOfRewriting(original, candidate)) return reject("instruction-output");
  if (typeof decision.reason === "string" && KEEP_REASON.test(decision.reason)) {
    return reject("reason-contradicts-action");
  }

  const complete = segmentSentences(candidate).filter((segment) => isCompleteSentence(segment.text));
  if (complete.length > 1) return reject("multiple-sentences");

  // Span-scoped: when the writer opened with a formulaic attention frame, the guards
  // below judge the surviving PROPOSITION rather than the whole sentence. Deleting the
  // frame outright is accepted; any further edit is then put to the full gauntlet
  // against the proposition, so nothing is waved through by association — the frames
  // are closed-class and carry no number, protected token or markup of their own.
  const proposition = attentionProposition(original);
  if (proposition) {
    const normalise = (text) => text.replace(/\s+/gu, " ").trim().toLowerCase();
    if (normalise(proposition) === normalise(candidate)) {
      return { accepted: true, reason: "accepted", replacement: candidate };
    }
    return validateRewrite(proposition, decision, { maxEditRatio, protectedTerms });
  }

  if (!same(numbers(original), numbers(candidate))) return reject("numbers-changed");
  if (!same(protectedTokens(original, protectedTerms), protectedTokens(candidate, protectedTerms))) {
    return reject("protected-token-changed");
  }
  // Before the confusable-repair shortcut below, which accepts and returns: a their/there
  // repair that also drops a `**` is still destroying the writer's formatting. Compared
  // as written: a case-only edit inside a code span is still an edit to code.
  if (!same(markupTokens(original), markupTokens(candidate))) {
    return reject("markup-changed");
  }
  // Quantities are settled; a lone confusable swap is a repair the gate means to permit,
  // and the rules below cannot tell it apart from a tense or commitment change.
  if (isConfusableRepair(original, candidate)) {
    return { accepted: true, reason: "accepted", replacement: candidate };
  }
  if (!namesPreserved(original, candidate)) return reject("name-changed");
  // A stack of hedges on one claim may be reduced to a single hedge, PROVIDED the group
  // it belongs to is still occupied: "the job could possibly time out" -> "could time
  // out" keeps the modality exactly, dropping only the redundant second marker. What
  // stays refused is a group emptied ("fairly confident ... most likely hold" ->
  // "confident ... hold") and a hedge introduced where the writer committed. The split
  // between the modal and degree groups above is what makes this safe.
  const sourceCertainty = distinctMembers(hedgeNormalised(original), CERTAINTY_GROUPS);
  const candidateCertainty = distinctMembers(hedgeNormalised(candidate), CERTAINTY_GROUPS);
  const stacked = epistemicStackReduced(original, candidate);
  if (sourceCertainty.some((count, index) => (candidateCertainty[index] > count)
    || (count > 0 && candidateCertainty[index] === 0
      && !(stacked && EPISTEMIC_GROUPS.includes(index)))
    || (count === 0 && candidateCertainty[index] > 0))) {
    return reject("certainty-changed");
  }
  if (!quantifiersPreserved(original, candidate)) return reject("quantifier-changed");
  if (!boundsPreserved(original, candidate)) return reject("quantifier-changed");
  if (!same(ordinals(original).map(String), ordinals(candidate).map(String))) {
    return reject("quantifier-changed");
  }
  if (negations(original) !== negations(candidate)) return reject("negation-changed");
  // A clarity edit compresses phrasing; it does not delete what the sentence says.
  // Losing several content words with nothing put back is a dropped clause, which is
  // how an imperative sentence gets "obeyed" instead of rewritten.
  const ops = diffWords(original, candidate);
  const lost = ops.filter((op) => op.type === "delete" && isContentWord(op.source)).length;
  const gained = ops.filter((op) => op.type === "insert" && isContentWord(op.target)).length;
  const sourceContent = tokenize(original).filter((token) => !token.space && isContentWord(token)).length;
  if (lost - gained > 3 || (lost - gained >= 3 && lost - gained >= sourceContent * 0.5)) {
    return reject("content-dropped");
  }

  // Same distinct-member rule, and for the same construction: "Because A and because
  // B, C" tidied to "Because A and B, C" drops a repeated subordinator that still
  // heads its own clause. A connective that vanishes outright still refuses; as
  // before, only a REDUCTION is refused, since adding a connective is not a loss.
  const sourceDiscourse = distinctMembers(original, DISCOURSE_GROUPS);
  if (distinctMembers(candidate, DISCOURSE_GROUPS).some((count, index) => count < sourceDiscourse[index])) {
    // Formerly `dropped-content`, a second name for the class `content-dropped` already
    // covers: both say the candidate says less than the source, and two names for one
    // decision made the refusal ledger read as two policies.
    return reject("content-dropped");
  }
  if (!directionsPreserved(original, candidate)) return reject("direction-changed");
  if (deadlineMoved(original, candidate)) return reject("direction-changed");
  const sourceTense = tense(original);
  const candidateTense = tense(candidate);
  if (JSON.stringify(sourceTense) !== JSON.stringify(candidateTense) &&
    !tenseRepairedToMatchEvidence(original, sourceTense, candidateTense)) {
    return reject("tense-changed");
  }

  const sourceTerminal = terminal(original);
  const candidateTerminal = terminal(candidate);
  if (sourceTerminal.includes("?") !== candidateTerminal.includes("?")) return reject("question-changed");
  if (sourceTerminal && sourceTerminal !== candidateTerminal) return reject("terminal-punctuation-changed");
  // After the question check: turning a statement into a question moves a word without
  // changing any, and that reading of the sentence is the more useful one to report.
  if (isPurePermutation(original, candidate)) return reject("order-changed");
  if (subordinatorReattached(original, candidate)) return reject("order-changed");
  if (objectAdjunctCompounded(original, candidate)) return reject("order-changed");
  // A voice change that fails to reorder the participants has reversed their roles.
  if (rolesFlipped(original, candidate)) return reject("order-changed");
  // Two common nouns swapped for each other, with no voice change to reorder them.
  if (commonNounRolesSwapped(original, candidate)) return reject("order-changed");
  if (isTrivialEdit(original, candidate)) return reject("trivial-edit");
  if (editRatio(original, candidate) > maxEditRatio) return reject("excessive-edit");
  if (!vocabularyHasAntecedent(original, candidate)) return reject("word-substituted");
  if (isUntriggeredNumberChange(original, candidate)) return reject("word-substituted");
  if (isLoneDerivationSwap(original, candidate)) return reject("word-substituted");
  if (topicComplementObjectified(original, candidate)) return reject("word-substituted");
  if (confusableResolvedByDerivation(original, candidate)) return reject("word-substituted");
  if (passiveIntroduced(original, candidate)) return reject("order-changed");
  // Late: an expletive "It is possible that ..." is a hedge before it is a referent, and a
  // rewrite that shrinks a clause to "Send it." is an over-edit before it is a swap.
  if (!referentsPreserved(original, candidate)) return reject("pronoun-changed");
  // Last, so that swapping "succeeded" for "failed" is still reported as the unsourced
  // substitution it is; what only this catches is "failed to notify" -> "notified".
  if (failures(original) !== failures(candidate)) return reject("negation-changed");

  return { accepted: true, reason: "accepted", replacement: candidate };
}
