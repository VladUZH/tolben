// Markdown in, prose out — and back again.
//
// The model is a prose model. Shown `**The archive** is *copied weekly*.` it answers in
// plain prose, and the safety layer then refuses the rewrite for losing the markup: the
// writer gets silence on every sentence they bothered to format. So the sentence is
// projected to the prose a reader actually sees, the model is asked about that, and the
// answer is mapped back through an offset map onto the original characters.
//
// The map is per character and deliberately dumb: `offsets[i]` is the index in the source
// that prose character `i` came from. Everything else here reads it.

import { diffWords } from "../src/diff.mjs";

// A line's leading block markers: bullets and numbers, task checkboxes, blockquote
// arrows, heading hashes, and any nesting of them. Structure, not prose. The trailing
// space is required, so "-5 degrees" and "Well-known" are untouched.
// A quote marker needs no space after it (">Quoted." is a quote), and a table row's
// leading pipe is a marker too. Both used to survive into the projected prose, where a
// model rewrite could drop them and an accepted edit would delete the writer's structure.
const BLOCK_MARKER =
  /^(?:\s{0,3}(?:>+[ \t]*|\|[ \t]*|(?:#{1,6}|[-*+]|\d+[.)])[ \t]+)(?:\[[ xX]\][ \t]+)?)+/u;

const ESCAPE = /^\\([\\`*_{}[\]()#+\-.!~=|>])/u;
const EMBED_WIKI = /^!\[\[[^\]\n]*\]\]/u;
const EMBED_IMAGE = /^!\[[^\]\n]*\]\([^)\n]*\)/u;
const WIKILINK = /^\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/u;
const LINK = /^\[([^\]\n]*)\]\([^)\n]*\)/u;
const DELIMITER = /^(\*\*|__|\*|_|==|~~)/u;

const isSpace = (char) => char === undefined || /\s/u.test(char);
const isAlphanumeric = (char) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

// Whether a run of delimiter characters is acting as markup here. " 3 * 4 " is
// multiplication and `api_key` is an identifier; dropping either would corrupt the prose
// the model is asked about, which is worse than leaving a stray asterisk in it.
function isDelimiter(source, index, delimiter) {
  const before = source[index - 1];
  const after = source[index + delimiter.length];
  if (delimiter === "_" || delimiter === "__") {
    return !(isAlphanumeric(before) && isAlphanumeric(after));
  }
  return !(isSpace(before) && isSpace(after));
}

// A CommonMark code span closes on a backtick run of EXACTLY the opener's length — the
// only reason multi-backtick spans exist is to hold backticks. A regex whose content
// class excludes backticks could never match one, so "``a`b``" misprojected. Returns
// { content, length } for the whole span at the head of `rest`, or null.
function inlineCodeSpan(rest) {
  const open = rest.match(/^`+/u)?.[0];
  if (!open) return null;
  let search = open.length;
  while (true) {
    const at = rest.indexOf(open, search);
    if (at === -1) return null;
    const run = rest.slice(at).match(/^`+/u)[0];
    if (run.length === open.length) {
      return { content: rest.slice(open.length, at), opener: open.length, length: at + open.length };
    }
    search = at + run.length;
  }
}

// { text, offsets, escaped, protectedTerms }
//
// `protectedTerms` are the substrings that carry meaning beyond their prose — code, and
// the text of a link — which the safety layer holds immutable so that a rewrite cannot
// quietly retarget a link or edit a command. `escaped` holds the source indices of
// characters that stand for a backslash escape, so an edit that removes one can take
// its governing backslash with it.
export function flattenMarkdown(source) {
  const characters = [];
  const offsets = [];
  const protectedTerms = [];
  const escaped = new Set();
  // Delimiters currently open, by mark. A run only counts as markup when it closes an
  // open one or a partner exists ahead: the lone "*" of "3*4" is prose, and deleting
  // it silently turned multiplication into "34".
  const openDelimiters = new Map();

  const emit = (text, at) => {
    for (let index = 0; index < text.length; index += 1) {
      characters.push(text[index]);
      offsets.push(at + index);
    }
  };

  let cursor = source.match(BLOCK_MARKER)?.[0]?.length ?? 0;
  // A line that is nothing but its marker has no prose to project; leaving the marker in
  // lets it fail the completeness check on its own rather than becoming an empty sentence.
  if (cursor >= source.length) cursor = 0;

  while (cursor < source.length) {
    const rest = source.slice(cursor);

    // Block markers repeat on every line of a quote run ("> " on each wrapped line):
    // stripping them only at the segment head leaked the interior ">" into the prose,
    // where the model saw it and safety refused every rewrite as markup-changed.
    if (cursor > 0 && source[cursor - 1] === "\n") {
      const marker = rest.match(BLOCK_MARKER)?.[0]?.length ?? 0;
      if (marker > 0) {
        cursor += marker;
        continue;
      }
    }

    const escapedChar = ESCAPE.exec(rest);
    if (escapedChar) {
      emit(escapedChar[1], cursor + 1);
      escaped.add(cursor + 1);
      cursor += escapedChar[0].length;
      continue;
    }

    const code = inlineCodeSpan(rest);
    if (code) {
      emit(code.content, cursor + code.opener);
      if (code.content.trim()) protectedTerms.push(code.content);
      cursor += code.length;
      continue;
    }

    // An embed renders as an image, not as words. Nothing about it is prose.
    const embed = EMBED_WIKI.exec(rest) ?? EMBED_IMAGE.exec(rest);
    if (embed) {
      cursor += embed[0].length;
      continue;
    }

    const wikilink = WIKILINK.exec(rest);
    if (wikilink) {
      // [[target|alias]] shows the alias; [[target]] shows the target.
      const shownIndex = wikilink[2] === undefined ? 1 : 2;
      const shown = wikilink[shownIndex];
      emit(shown, cursor + wikilink[0].indexOf(shown, shownIndex === 2 ? wikilink[0].indexOf("|") : 2));
      if (shown.trim()) protectedTerms.push(shown);
      cursor += wikilink[0].length;
      continue;
    }

    const link = LINK.exec(rest);
    if (link) {
      emit(link[1], cursor + 1);
      if (link[1].trim()) protectedTerms.push(link[1]);
      cursor += link[0].length;
      continue;
    }

    const delimiter = DELIMITER.exec(rest);
    if (delimiter && isDelimiter(source, cursor, delimiter[1])) {
      const mark = delimiter[1];
      const open = openDelimiters.get(mark) ?? 0;
      if (open > 0) {
        openDelimiters.set(mark, open - 1);        // closes the open span
        cursor += mark.length;
        continue;
      }
      if (rest.indexOf(mark, mark.length) !== -1) {
        openDelimiters.set(mark, open + 1);        // opens one a later partner closes
        cursor += mark.length;
        continue;
      }
      // No partner anywhere ahead: this run is prose ("3*4", "x==4"), and dropping it
      // corrupted the text the model was asked about.
      emit(mark, cursor);
      cursor += mark.length;
      continue;
    }

    emit(source[cursor], cursor);
    cursor += 1;
  }

  return { text: characters.join(""), offsets, escaped, protectedTerms, source };
}

// The source index a prose caret sits at. One past the last prose character maps to just
// after the character it came from, so an insertion at the end of the sentence lands
// inside any markup that closes it rather than after it.
export function sourcePosition(projection, plainIndex) {
  if (projection.offsets.length === 0) return 0;
  if (plainIndex >= projection.offsets.length) {
    return projection.offsets[projection.offsets.length - 1] + 1;
  }
  return projection.offsets[Math.max(0, plainIndex)];
}

// A prose range as source ranges: one per contiguous run, so markup falling inside the
// range sits in the gaps between them and is never covered by any of them. A character
// that stands for an escape brings its governing backslash into the run: deleting the
// "*" of "\*" must delete the "\" too, or the orphaned backslash re-attaches to
// whatever follows.
export function sourceRuns(projection, from, to) {
  if (to <= from) {
    const at = sourcePosition(projection, from);
    return [{ from: at, to: at }];
  }
  const runs = [];
  for (let index = from; index < to && index < projection.offsets.length; index += 1) {
    const at = projection.offsets[index];
    const start = projection.escaped?.has(at) ? at - 1 : at;
    const last = runs[runs.length - 1];
    if (last && last.to >= start) last.to = at + 1;
    else runs.push({ from: start, to: at + 1 });
  }
  return runs;
}

// The document edits that turn the source sentence into one whose prose reads as
// `replacement`, expressed in source coordinates relative to the sentence.
//
// Computed from the word-level diff rather than from one prefix/suffix window: the
// window form poured the whole changed stretch into its FIRST source run and emptied
// the rest, which relocated the contents of any untouched atom inside the window —
// "[[Sync Tool]]" bracketed by two edits came back as "Sync Tool[[]]", the alias
// demoted to prose and the link destroyed.
//
// The kept (equal) tokens anchor everything: whatever lies BETWEEN two consecutive
// kept tokens in the prose is replaced by whatever lies between them in the
// replacement — deleted words, inserted words, and the separators themselves, so a
// whitespace-only repair (a removed space before a comma) is an edit like any other,
// and an inserted comma arrives with exactly the spacing the replacement wrote.
// Unchanged words keep their own source characters, so markup around them survives
// by construction.
export function sourceEdits(projection, replacement) {
  const prose = projection.text;
  if (prose === replacement) return [];

  const edits = [];
  const push = (from, to, insert) => {
    if (from !== to || insert !== "") edits.push({ from, to, insert });
  };
  // A quote's line marker sits outside the offset map, so a replaced stretch that
  // spans the line break would leave the marker glued between the kept words; a gap
  // that is nothing but quote markers is folded into the edit.
  const MARKER_GAP = /^(?:[ \t]*>[ \t]*)+$/u;
  // Replace a prose span with `insert`: the text goes into the first source run, the
  // rest are emptied. Gap markup between runs survives — except swallowed markers.
  const replaceSpan = (start, end, insert) => {
    const runs = [];
    for (const run of sourceRuns(projection, start, end)) {
      const last = runs[runs.length - 1];
      const gap = last && projection.source ? projection.source.slice(last.to, run.from) : null;
      if (gap !== null && gap !== "" && MARKER_GAP.test(gap)) last.to = run.to;
      else runs.push({ ...run });
    }
    runs.forEach((run, index) => push(run.from, run.to, index === 0 ? insert : ""));
  };

  const kept = diffWords(prose, replacement).filter((op) => op.type === "equal");
  let prosePos = 0;
  let replacementPos = 0;
  for (const op of kept) {
    const proseGap = prose.slice(prosePos, op.source.start);
    const replacementGap = replacement.slice(replacementPos, op.target.start);
    if (proseGap !== replacementGap) replaceSpan(prosePos, op.source.start, replacementGap);
    // A case-insensitively equal pair with different text is a capitalisation repair.
    if (op.source.text !== op.target.text) {
      replaceSpan(op.source.start, op.source.end, op.target.text);
    }
    prosePos = op.source.end;
    replacementPos = op.target.end;
  }
  if (prose.slice(prosePos) !== replacement.slice(replacementPos)) {
    replaceSpan(prosePos, prose.length, replacement.slice(replacementPos));
  }

  return edits;
}
