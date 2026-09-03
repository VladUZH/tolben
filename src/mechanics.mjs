// A deliberately tiny deterministic pass for mechanical errors that admit no judgement:
// spacing around punctuation and capitalisation of the sentence opener, weekdays, and months.
//
// This is NOT the clarity engine and must never be reported as it. It exists because the
// 2B model measurably ignores single-character mechanical faults, and because these
// repairs have exactly one correct answer that needs no meaning judgement at all.

import { protectedTokenList } from "./safety.mjs";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// "may" and "march" are ordinary words too; only capitalise them beside a date signal.
// Prepositions only: "this may", "next march" and "last august" read as modal or noun
// at least as often as month ("This may be wrong."), and a pass that must never be
// wrong skips what it cannot decide.
const DATE_CONTEXT = /\b(?:on|in|by|since|until|before|after|during|from)\s+$/iu;

// Spans no mechanical repair may reach inside. A comma in "https://a.test/x,y" or in
// "/srv/data,backup" is part of the address, not a punctuation fault; a comma in `f(a,b)`
// is code the writer quoted exactly; and a lowercase day name inside a path is a
// directory. These run wider than the safety patterns on purpose: they must cover the
// whole atom, including the characters a repair would otherwise insert a space into.
const UNTOUCHABLE = [
  /https?:\/\/\S+/giu,                                                    // URLs
  // Bounded like the safety pattern: an unbounded local part backtracks quadratically.
  /\b[\w.+-]{1,64}@[\w.-]{1,255}\.[A-Za-z]{2,24}\S*/gu,                   // email
  // A path counts wherever a delimiter precedes it — "(/srv/data,backup)" is as much a
  // path as " /srv/data,backup"; only a word character or another slash rules it out.
  /(?<![\w~/])~?(?:\/[^\s/]+)+\/?/gu,                                     // posix paths
  /\b[A-Za-z]:\\\S+/gu,                                                   // windows paths
  /\b[\w-]+\.(?:csv|json|log|md|txt|ya?ml|pdf|js|py|sql|xml|html)\S*/giu,  // file names
  /`[^`\n]*`/gu,                                                          // inline code spans
  // The atoms safety.mjs holds immutable are untouchable here too: a comma inside
  // $f(a,b)$ is math, and a day name inside [[wednesday log]] is a link target. The
  // math shapes mirror safety.mjs exactly — a looser pair pattern read the prose
  // between "$5" and "$10" as one phantom span and silently disabled repairs there.
  /\$\$[^$\n]+\$\$|(?<!\d)\$(?![\s\d$])[^$\n]*?(?<!\s)\$|(?<!\d)\$\d[^\s$\n]*\$/gu, // math spans
  /!?\[\[[^\]\n]*\]\]/gu,                                                 // wikilinks and embeds
  /!?\[[^\]\n]*\]\([^)\n]*\)/gu,                                          // links and images
];

function untouchableSpans(text) {
  const spans = [];
  for (const pattern of UNTOUCHABLE) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
}

const touches = (spans, start, end) =>
  spans.some((span) => span.start < end && start < span.end);

// A leading token carrying a dot, a slash, or a digit after its letters is a file name,
// a path, or an identifier — spelled the way it is on purpose, not a missing capital.
const IDENTIFIER_OPENER = /[./\\@_]|^[\p{L}]+\d/u;

// Sentence-final punctuation is not part of the opener: without stripping it, the "."
// in a one-word sentence ("done.") read as an identifier dot and the capitalisation
// this fix exists to make was silently skipped.
const opensWithIdentifier = (text) =>
  IDENTIFIER_OPENER.test((text.trim().split(/\s/u)[0] ?? "").replace(/[.!?…]+$/u, ""));

const FIXES = [
  {
    id: "non-breaking-space",
    label: "Replaces a non-breaking space with an ordinary space.",
    // Only between two visible characters, where a no-break space pasted in from another
    // document is doing a plain word separator's job. Nothing downstream can mark such a
    // space, so leaving it to the model produced a suggestion with no underline behind it.
    // Runs first: every later fix then sees ordinary spaces.
    //
    // The whole horizontal run goes, not just the no-break characters in it. Matching only
    // a no-break space with a visible neighbour on each side is not idempotent: in
    // "x\u00A0 ,y" the ordinary space shields it on this pass, the punctuation rules then
    // close the gap, and the next pass finds a repair the first one missed.
    apply: (text, spans) =>
      text.replace(/(\S)[ \t\u00A0\u202F]*[\u00A0\u202F][ \t\u00A0\u202F]*(?=\S)/gu, (match, first, offset) =>
        touches(spans, offset + 1, offset + match.length) ? match : `${first} `),
  },
  {
    id: "space-before-punctuation",
    label: "Removes a space before punctuation.",
    // A "." that opens the next token is that token's first character — "./build.sh",
    // ".gitignore", ".5" — not a stray sentence mark, so it is left alone. The other
    // marks stay unconditional: " ,word" is the glued-comma fault this fix repairs.
    apply: (text, spans) =>
      text.replace(/[ \t]+([,;:!?]|\.(?![\w/\\]))/gu, (match, mark, offset) =>
        touches(spans, offset, offset + match.length) ? match : mark),
  },
  {
    id: "space-after-punctuation",
    label: "Adds the missing space after punctuation.",
    // The space lands between the mark and the character after it, so both count as
    // touched: a comma inside a URL keeps its neighbour.
    apply: (text, spans) =>
      text.replace(/([,;:])(?=[\p{L}])|(?<!\d)([,;:])(?=\d)/gu, (match, _a, _b, offset) =>
        touches(spans, offset, offset + match.length + 1) ? match : `${match} `),
  },
  {
    id: "repeated-space",
    label: "Removes a repeated space.",
    // The lookahead leaves the following character unconsumed, so alternating runs
    // ("Section  A  is  ready.") are all collapsed rather than every other one.
    apply: (text, spans) =>
      text.replace(/(\S)[ \t]{2,}(?=\S)/gu, (match, first, offset) =>
        touches(spans, offset + 1, offset + match.length) ? match : `${first} `),
  },
  {
    id: "sentence-capitalisation",
    label: "Capitalizes the first word.",
    // A first word with an interior capital ("eBay", "iPhone") is cased on purpose and
    // is skipped; so is an opener whose uppercase form is more than one character (the
    // ligature "ﬁ" upcases to "FI"), because a two-letter expansion is never the one
    // correct answer this pass is limited to.
    apply: (text) => (opensWithIdentifier(text)
      ? text
      : text.replace(/^(\s*)(\p{Ll})(?![\p{L}]*\p{Lu})/u, (match, space, letter) => {
        const upper = letter.toUpperCase();
        return upper.length === 1 ? space + upper : match;
      })),
  },
  {
    id: "proper-noun-capitalisation",
    label: "Capitalizes a day or month name.",
    apply: (text, spans) =>
      text.replace(/\b(\p{Ll}[\p{Ll}]+)\b/gu, (word, lower, offset, whole) => {
        if (!WEEKDAYS.includes(lower) && !MONTHS.includes(lower)) return word;
        if (touches(spans, offset, offset + word.length)) return word;
        const ambiguous = lower === "may" || lower === "march" || lower === "august";
        if (ambiguous && !DATE_CONTEXT.test(whole.slice(0, offset))) return word;
        return lower[0].toUpperCase() + lower.slice(1);
      }),
  },
];

// Every protected substring of the original, compared as written. A mechanical repair
// that renames a URL, a path, or a file has done harm no label can excuse.
function guardTokens(text) {
  const spans = untouchableSpans(text).map((span) => text.slice(span.start, span.end).trim());
  return [...spans, ...protectedTokenList(text)].sort();
}

const sameTokens = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

// Returns { replacement, reason, ids } or null. Only reports a change it actually made.
export function repairMechanics(sentence) {
  let replacement = sentence;
  const reasons = [];
  const ids = [];
  for (const fix of FIXES) {
    // Recomputed each round: an earlier repair moves every offset after it.
    const next = fix.apply(replacement, untouchableSpans(replacement));
    if (next !== replacement) {
      replacement = next;
      reasons.push(fix.label);
      ids.push(fix.id);
    }
  }
  if (replacement === sentence) return null;
  if (!sameTokens(guardTokens(sentence), guardTokens(replacement))) return null;
  return { replacement, reason: reasons.join(" "), ids };
}
