// Word-level diff computed locally. Model-provided offsets are never trusted.

export function tokenize(text) {
  const tokens = [];
  const pattern = /(\s+)|([\p{L}\p{N}]+(?:['’][\p{L}]+)*)|([^\s\p{L}\p{N}]+)/gu;
  for (const match of text.matchAll(pattern)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      space: Boolean(match[1]),
    });
  }
  return tokens;
}

function lcsTable(left, right) {
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i].key === right[j].key
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function keyed(tokens) {
  return tokens.map((token) => ({ ...token, key: token.text.toLowerCase() }));
}

// Ops: { type: "equal" | "delete" | "insert", source?, target? }
export function diffWords(source, target) {
  const left = keyed(tokenize(source).filter((token) => !token.space));
  const right = keyed(tokenize(target).filter((token) => !token.space));
  const table = lcsTable(left, right);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i].key === right[j].key) {
      ops.push({ type: "equal", source: left[i], target: right[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "delete", source: left[i] });
      i += 1;
    } else {
      ops.push({ type: "insert", target: right[j] });
      j += 1;
    }
  }
  while (i < left.length) ops.push({ type: "delete", source: left[i++] });
  while (j < right.length) ops.push({ type: "insert", target: right[j++] });
  return ops;
}

// Contiguous source character ranges that the rewrite touches: what gets underlined.
// An insertion with no deletion anchors to the neighbouring equal token so the
// underline has somewhere to live.
export function changedSourceRanges(source, target) {
  const ops = diffWords(source, target);
  const ranges = [];
  const push = (start, end) => {
    const last = ranges[ranges.length - 1];
    // Merge ranges separated only by whitespace so one edit reads as one mark.
    if (last && source.slice(last.end, start).trim() === "") {
      last.end = Math.max(last.end, end);
      return;
    }
    ranges.push({ start, end });
  };
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    // Tokens are keyed case-insensitively, so a capitalisation repair pairs the two
    // spellings in one `equal` op. It is still a change to the writer's text, and without
    // this it was the one accepted edit that reached the screen with nothing underlined:
    // "wednesday" -> "Wednesday" produced no ops of any other kind.
    if (op.type === "equal") {
      if (op.source.text !== op.target.text) push(op.source.start, op.source.end);
      continue;
    }
    if (op.type === "delete") {
      push(op.source.start, op.source.end);
      continue;
    }
    if (op.type !== "insert") continue;
    const previous = ops.slice(0, index).reverse().find((candidate) => candidate.source);
    const next = ops.slice(index + 1).find((candidate) => candidate.source);
    const anchor = previous?.source ?? next?.source;
    if (anchor) push(anchor.start, anchor.end);
  }
  return ranges.filter((range) => range.end > range.start);
}

// Merged inline view for the hover card: kept text, struck deletions, added insertions.
// A capitalisation repair pairs its two spellings in one case-insensitive `equal` op;
// the card must show that change as a strike and an insertion, or a suggestion whose
// whole content is "wednesday" -> "Wednesday" renders as the writer's own sentence
// with nothing visibly proposed.
export function inlineDiffParts(source, target) {
  const parts = [];
  for (const op of diffWords(source, target)) {
    if (op.type === "equal" && op.source.text !== op.target.text) {
      parts.push({ type: "delete", text: op.source.text });
      parts.push({ type: "insert", text: op.target.text });
      continue;
    }
    parts.push({ type: op.type, text: (op.type === "insert" ? op.target : op.source).text });
  }
  return parts;
}
