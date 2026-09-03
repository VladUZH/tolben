// The explanation shown to the writer is derived from the diff we computed, not from
// the model's own account of what it did. The model's prose was measurably unreliable:
// it described edits it had not made. Anything quoted below is a token that actually
// appears in the diff.

import { diffWords } from "./diff.mjs";
import { INTENSIFIERS, CONFUSABLES } from "./safety.mjs";

const ARTICLES = new Set(["a", "an", "the"]);
const AGREEMENT_FORMS = new Set([
  "is", "are", "was", "were", "has", "have", "had", "does", "do", "did",
  "needs", "need", "requires", "require", "works", "work", "sign", "signs",
]);

// Always given a span taken verbatim from one of the two sentences, never a token
// list rejoined with spaces: "big, red" is not "big , red".
const quote = (text) => `“${text}”`;

function isConfusablePair(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return CONFUSABLES.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function sameStem(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a !== b && (a.startsWith(b) || b.startsWith(a) || a.slice(0, 4) === b.slice(0, 4));
}

// Splits the diff into runs of consecutive changes. Runs separated by a single unchanged
// word are treated as one edit, so "on a quarterly basis" -> "quarterly" reads as one
// change rather than two disconnected deletions.
function editGroups(source, replacement) {
  const ops = diffWords(source, replacement);
  const runs = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") { index += 1; continue; }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    runs.push({ start: index, end });
    index = end;
  }

  const groups = [];
  for (const run of runs) {
    const previous = groups[groups.length - 1];
    if (previous && run.start - previous.end <= 1) previous.end = run.end;
    else groups.push({ ...run });
  }

  return groups.map((group) => {
    const span = ops.slice(group.start, group.end);
    const removed = span.filter((op) => op.type === "delete").map((op) => op.source.text);
    const added = span.filter((op) => op.type === "insert").map((op) => op.target.text);
    const sourceTokens = span.filter((op) => op.source).map((op) => op.source);
    const targetTokens = span.filter((op) => op.target).map((op) => op.target);
    const slice = (text, tokens) => tokens.length
      ? text.slice(tokens[0].start, tokens[tokens.length - 1].end)
      : "";
    // The unchanged words flanking the run, for wording that depends on the
    // neighbourhood: "removes X, which repeats the word beside it" must only be said
    // when the word beside it actually repeats the meaning.
    const neighbour = (op) => (op && op.type === "equal" ? op.source.text : "");
    return {
      removed,
      added,
      merged: group.end - group.start > span.filter((op) => op.type !== "equal").length,
      sourceSpan: slice(source, sourceTokens),
      targetSpan: slice(replacement, targetTokens),
      beforeWord: neighbour(ops[group.start - 1]),
      afterWord: neighbour(ops[group.end]),
    };
  });
}

const capitals = (word) => (word.match(/\p{Lu}/gu) ?? []).length;

// A repair that only changes capitalisation produces an `equal` op, because the diff
// keys case-insensitively. Read those ops directly: pairing tokens by position instead
// silently dropped every capitalisation change the moment the rewrite also added or
// removed a word — the mainline shape, where mechanics capitalises the opener and the
// model shortens a phrase in the same replacement. Say which way it went: lowering
// "The" to "the" is not capitalising it.
function capitalisationChanges(source, replacement) {
  const raised = [];
  const lowered = [];
  for (const op of diffWords(source, replacement)) {
    if (op.type !== "equal") continue;
    const before = op.source.text;
    const after = op.target.text;
    if (before !== after && before.toLowerCase() === after.toLowerCase()) {
      (capitals(after) >= capitals(before) ? raised : lowered).push(after);
    }
  }
  return { raised, lowered };
}

function describeRun({ removed, added, merged, sourceSpan, targetSpan, beforeWord, afterWord }) {
  if (merged) {
    if (!targetSpan) return `removes ${quote(sourceSpan)}`;
    // Only a genuinely shorter result is "shortened"; a merged group can be net-insertive.
    if (targetSpan.length < sourceSpan.length) return `shortens ${quote(sourceSpan)} to ${quote(targetSpan)}`;
    return `changes ${quote(sourceSpan)} to ${quote(targetSpan)}`;
  }
  if (removed.length && !added.length) {
    // "Repeats the word beside it" is the doubled-intensifier case and needs the word
    // beside it to be an intensifier too: removing a lone "really" repeats nothing.
    const doubled = removed.every((word) => INTENSIFIERS.has(word.toLowerCase()))
      && [beforeWord, afterWord].some((word) => INTENSIFIERS.has(word.toLowerCase()));
    if (doubled) {
      return `removes ${quote(sourceSpan)}, which repeats the word beside it`;
    }
    return `removes ${quote(sourceSpan)}`;
  }

  if (added.length && !removed.length) {
    if (added.length === 1 && /^[^\p{L}\p{N}]+$/u.test(added[0])) {
      return added[0] === "," ? "adds a comma" : `adds ${quote(targetSpan)}`;
    }
    if (added.length === 1 && ARTICLES.has(added[0].toLowerCase())) {
      return `adds the missing article ${quote(targetSpan)}`;
    }
    return `adds ${quote(targetSpan)}`;
  }

  if (removed.length === 1 && added.length === 1) {
    const [from] = removed;
    const [to] = added;
    if (from.toLowerCase() === to.toLowerCase()) {
      return capitals(to) >= capitals(from)
        ? `capitalizes ${quote(targetSpan)}`
        : `lowercases ${quote(targetSpan)}`;
    }
    if (isConfusablePair(from, to)) return `corrects ${quote(sourceSpan)} to ${quote(targetSpan)}`;
    if (AGREEMENT_FORMS.has(from.toLowerCase()) && AGREEMENT_FORMS.has(to.toLowerCase())) {
      return `changes ${quote(sourceSpan)} to ${quote(targetSpan)} to match the subject`;
    }
    if (sameStem(from, to)) return `changes ${quote(sourceSpan)} to ${quote(targetSpan)}`;
    return `replaces ${quote(sourceSpan)} with ${quote(targetSpan)}`;
  }

  if (removed.length > added.length && targetSpan.length < sourceSpan.length) {
    return `shortens ${quote(sourceSpan)} to ${quote(targetSpan)}`;
  }
  return `replaces ${quote(sourceSpan)} with ${quote(targetSpan)}`;
}

// One sentence naming every change, in reading order. Returns "" when the visible text
// is unchanged (a pure whitespace repair, which the mechanical pass describes instead).
export function explainEdit(source, replacement) {
  const groups = editGroups(source, replacement);
  const parts = groups.slice(0, 3).map(describeRun);
  const { raised, lowered } = capitalisationChanges(source, replacement);
  const names = (words) => {
    const quoted = words.map(quote);
    return quoted.length === 1
      ? quoted[0]
      : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  };
  if (raised.length) parts.push(`capitalizes ${names(raised)}`);
  if (lowered.length) parts.push(`lowercases ${names(lowered)}`);
  if (!parts.length) return "";
  if (groups.length > 3) parts.push(`makes ${groups.length - 3} further small changes`);
  const joined = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}
