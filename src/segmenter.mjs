// Sentence segmentation with byte-accurate offsets.
// Deterministic by design: this decides WHEN the engine runs, never WHAT it says.

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "rev", "hon",
  "inc", "ltd", "co", "corp", "dept", "est", "fig", "no", "vol", "ed", "eds",
  "al", "etc", "vs", "approx", "min", "max", "ca", "cf", "ibid", "op",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "a.m", "p.m", "e.g", "i.e", "u.s", "u.k", "ph.d", "d.c",
]);

const TERMINATORS = /[.!?…]/u;
// Quotes and brackets always belong to the sentence that just ended.
const CLOSERS = /["'’”)\]}]/u;
// Emphasis and code markers are ambiguous: the same characters close "**Done!**" and
// open "passed.**Note:** tomorrow". They are taken only when the run is NOT immediately
// followed by a word character, which is what distinguishes a closer from an opener.
const EMPHASIS = /[*~`_]/u;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

// A terminator that is really part of a token: 3.14, report.csv, /srv/x.log, https://a.b/c
function isInsideToken(text, index) {
  const before = text[index - 1];
  const after = text[index + 1];
  if (!before || !after) return false;
  if (/\d/u.test(before) && /\d/u.test(after)) return true;          // 3.14, 14:30.5
  // An underscore AFTER the dot is ambiguous: emphasis opening the next sentence
  // ("passed._Note:_ deploy") or a token interior ("obj._prop"). Emphasis has to
  // CLOSE, so the underscore only opens a sentence when a partner "_" follows nearby;
  // with none, the dot is inside an identifier and the sentence stays whole.
  if (/[\w/\\-]/u.test(before) && /[\p{L}\p{N}/\\-]/u.test(after)) return true; // file.csv, a/b.log
  if (after === "_" && /[\w/\\-]/u.test(before)) {
    const close = text.indexOf("_", index + 2);
    if (close === -1 || close - index > 40) return true;             // obj._prop, this._bar
  }
  return false;
}

// How far back an abbreviation decision may need to look. The longest entry in
// ABBREVIATIONS is 6 characters, so 12 is generous — and the bound is what keeps this
// O(1): the end-anchored match below walks backwards from the terminator, and handing it
// the whole document head made segmentation quadratic in document length. Measured on a
// 40k-word note that was 2.85 s of every keystroke; the window is 4 ms with byte-identical
// output (pinned by the reference fuzz in tests/segmenter-lookbehind.test.mjs).
const ABBREVIATION_LOOKBEHIND = 12;

// "1." opening an ordered list is a marker, not the end of a sentence. Bounded like the
// abbreviation lookbehind, and for the same reason: an unbounded backward scan for the
// line start is quadratic on a long paragraph.
//
// The window is sized to hold everything LIST_ITEM_LINE can accept — a newline plus
// LIST_INDENT_MAX of indent plus LIST_DIGITS_MAX of digits — because the two decisions
// must agree: any line wide enough to open a list block must have its marker
// suppressed here, or the bare "1." is cut loose as its own segment and the web app
// sends it to the model as a complete sentence.
const LIST_INDENT_MAX = 32;
const LIST_DIGITS_MAX = 12;
const LIST_MARKER_LOOKBEHIND = 1 + LIST_INDENT_MAX + LIST_DIGITS_MAX;

function isOrderedListMarker(text, index) {
  if (text[index] !== ".") return false;
  const from = Math.max(0, index - LIST_MARKER_LOOKBEHIND);
  const head = text.slice(from, index);
  // The digit run and the indent must match BLOCK_START_LINE exactly, or a marker wide
  // enough to open a block ("12345. ") is not suppressed and is cut loose as a segment.
  const match = head.match(/(?:^|\n)[ \t]*\d+$/u);
  if (!match) return false;
  // A match anchored at the window's left edge rather than a real newline only counts
  // when the window truly began at the start of the document.
  return match[0].startsWith("\n") || from === 0;
}

function isAbbreviation(text, index) {
  if (text[index] !== ".") return false;
  const head = text.slice(Math.max(0, index - ABBREVIATION_LOOKBEHIND), index);
  const word = head.match(/[\p{L}.]+$/u)?.[0];
  if (!word) return false;
  // A run that fills the window may extend further left, so it is at least 12 characters
  // long — twice the longest abbreviation and never a single initial. Anyone adding an
  // entry longer than 11 characters to ABBREVIATIONS must widen the window with it.
  if (word.length === ABBREVIATION_LOOKBEHIND) return false;
  if (ABBREVIATIONS.has(word.toLowerCase())) return true;
  // Single initial: "J. R. R. Tolkien"
  return /^\p{Lu}$/u.test(word);
}

// Lines that ARE a block on their own: a heading, a table row, a fence, a rule. Nothing
// may join them to the text above or below.
const SELF_CONTAINED_LINE =
  /^[ \t]{0,3}(?:#{1,6}[ \t]|\||(?:[-*_][ \t]*){3,}$|={3,}[ \t]*$)/u;
// The line that opens or closes a fenced code block. Indent is unbounded on purpose: a
// fence inside a list item is indented under it, and a 4-space-indented block is code
// either way — treating it atomically is right in both readings.
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})(.*)$/u;
// Lines that OPEN a block but may be continued by the wrapped lines beneath them: list
// items and block quotes. Only the line above them is cut off.
// Each list item is its own block: "- one\n- two" is two sentences, not one.
// Indent and digit width are bounded to what LIST_MARKER_LOOKBEHIND can see — the two
// regexes must accept the same lines (see the lookbehind's comment).
const LIST_ITEM_LINE = new RegExp(`^[ \\t]{0,${LIST_INDENT_MAX}}(?:[-*+][ \\t]|\\d{1,${LIST_DIGITS_MAX}}[.)][ \\t])`, "u");
// A quote is one block for its whole RUN of "> " lines. Cutting at every line split a
// sentence wrapped across a multi-line quote — which is the common shape, since Obsidian
// continues "> " for you on Enter — and handed the model a fragment with no subject.
const QUOTE_LINE = /^[ \t]*>/u;

// Offsets where a block ends and another begins.
//
// Sentence boundaries used to be terminal punctuation and nothing else, so any line
// that did not end in ".!?" — a heading, a list item, a table row, a signature — was
// glued to the paragraph below it across the blank line. The model was then asked about
// a span that was not a sentence, and its answer was refused for losing the OTHER
// paragraph's names or markup: the suggestion was computed, then silently thrown away.
// A blank line and a block opener are structure, and structure ends a sentence.
//
// A single newline is NOT a boundary: prose wrapped across consecutive lines is one
// sentence, which is what makes this different from splitting on every line break.
function blockBoundaries(text) {
  const bounds = new Set([0, text.length]);
  // Blocks that must be emitted whole, never scanned for sentences: fenced code. A full
  // stop inside a code sample is not the end of a sentence.
  const atomic = new Set();
  let lineStart = 0;
  let fence = null;    // the marker that opened the fenced block being scanned
  let quoting = false; // the previous line was part of a block quote
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const afterLine = newline === -1 ? text.length : newline + 1;
    // The carriage return would otherwise defeat every end-anchored test below, so on a
    // CRLF document horizontal rules, setext underlines and YAML frontmatter fences all
    // stopped being boundaries — and the frontmatter block glued itself to the note's
    // first sentence, which is the very bug this pass exists to kill.
    // Trimmed by character code rather than a regex: this runs once per LINE of the
    // document on every sync, and the regex form measured ~100ns a line — most of the
    // cost of the whole boundary pass on line-dense input.
    const rawEnd = lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    const line = text.slice(lineStart, rawEnd);
    const fenceMatch = line.match(FENCE_LINE);
    const fenceMark = fenceMatch?.[1];
    if (fence) {
      // A fenced block is ONE block to its closing marker: a blank line inside code is
      // code, and splitting there would hand the fence's contents to the model as prose
      // with the backticks — the proof that it is code — left behind on another segment.
      // The closer must use the same character, be at least as long as the opener, and
      // carry no info string; otherwise the inner ``` of a ````-fenced block closes it
      // and the code body is scanned as prose.
      const closes = fenceMark
        && fenceMark[0] === fence[0]
        && fenceMark.length >= fence.length
        && fenceMatch[2].trim() === "";
      if (closes) {
        fence = null;
        bounds.add(afterLine);
      }
      // A fenced block ends any quote run: without this, `quoting` stayed true across
      // the fence and the next "> " line was glued to whatever paragraph followed it.
      quoting = false;
    } else if (fenceMark) {
      fence = fenceMark;
      bounds.add(lineStart);
      atomic.add(lineStart);
      quoting = false;
    } else if (line.trim() === "" || SELF_CONTAINED_LINE.test(line)) {
      bounds.add(lineStart);
      bounds.add(afterLine);
      // Atomic as well as bounded: scanning a table row for sentences cut it at the full
      // stop inside a cell, leaving "| One | Copied weekly." as a complete "sentence"
      // whose leading pipe the flattener does not strip — so accepting the rewrite
      // deleted the pipe and the table stopped rendering. A row is one structural unit.
      if (line.trim() !== "") atomic.add(lineStart);
      quoting = false;
    } else if (QUOTE_LINE.test(line)) {
      // Only the first line of a quote run opens a block.
      if (!quoting) bounds.add(lineStart);
      quoting = true;
    } else if (LIST_ITEM_LINE.test(line)) {
      bounds.add(lineStart);
      quoting = false;
    } else {
      // A plain line under a list item or quote with no blank line between them is a
      // lazy continuation of it — markdown's own reading, and cutting there split
      // wrapped sentences into fragments the model answered as though they were whole.
      // A lazy line inside a quote run CONTINUES the run — resetting `quoting` here
      // made the next "> " line open a new block mid-sentence. Only a blank line or a
      // self-contained line ends the run.
    }
    if (newline === -1) break;
    lineStart = afterLine;
  }
  return { bounds: [...bounds].sort((left, right) => left - right), atomic };
}

// The sentence scan, bounded to one block. Character tests still read the WHOLE text —
// an abbreviation or a decimal point is decided by its neighbours, which do not stop
// existing at a block edge — but no segment may extend past `to`.
function segmentBlock(text, from, to, out) {
  let start = from;
  for (let index = from; index < to; index += 1) {
    const char = text[index];
    if (!TERMINATORS.test(char)) continue;
    if (isInsideToken(text, index) || isAbbreviation(text, index) || isOrderedListMarker(text, index)) continue;
    let end = index + 1;
    while (end < to && TERMINATORS.test(text[end])) end += 1; // "?!" "..."
    while (end < to && CLOSERS.test(text[end])) end += 1;     // closing quote or bracket
    // Emphasis only when it closes rather than opens the next sentence. The character
    // after the run is read as a full code point: testing one UTF-16 unit saw an
    // astral letter as a lone surrogate and absorbed an opener into this sentence.
    let withEmphasis = end;
    while (withEmphasis < to && EMPHASIS.test(text[withEmphasis])) withEmphasis += 1;
    const afterEmphasis = withEmphasis < to ? String.fromCodePoint(text.codePointAt(withEmphasis)) : "";
    if (withEmphasis > end && !(afterEmphasis && WORD_CHARACTER.test(afterEmphasis))) {
      end = withEmphasis;
    }
    // A closing quote or bracket may follow the emphasis that follows the terminator —
    // '(*really!*)', '“**Done!**”' — and belongs to this sentence like any closer.
    while (end < to && CLOSERS.test(text[end])) end += 1;
    while (end < to && /[ \t]/u.test(text[end])) end += 1;    // trailing spaces
    if (end < to && text[end] === "\r") end += 1;             // CRLF travels together
    if (end < to && text[end] === "\n") end += 1;
    out.push({ text: text.slice(start, end), start, end });
    start = end;
    index = end - 1;
  }
  if (start < to) out.push({ text: text.slice(start, to), start, end: to });
}

export function segmentSentences(text) {
  const segments = [];
  const { bounds, atomic } = blockBoundaries(text);
  for (let block = 0; block < bounds.length - 1; block += 1) {
    const from = bounds[block];
    const to = bounds[block + 1];
    if (atomic.has(from)) segments.push({ text: text.slice(from, to), start: from, end: to });
    else segmentBlock(text, from, to, segments);
  }
  return segments.filter((segment) => segment.text.trim().length > 0);
}

export function isCompleteSentence(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Trailing emphasis is stripped along with closers, so the two exports agree on what
  // a finished sentence is: segmentSentences absorbs the "**" of "**Done!**" into the
  // sentence, and refusing to recognise it here hid every fully-emphasised sentence
  // from analysis and let a two-sentence rewrite ending in ".**" past the
  // multiple-sentences guard.
  const withoutClosers = trimmed.replace(/["'’”)\]}*~`_]+$/u, "");
  const last = withoutClosers[withoutClosers.length - 1];
  if (!last || !TERMINATORS.test(last)) return false;
  return !isAbbreviation(withoutClosers, withoutClosers.length - 1);
}

// The text a sentence carries once leading/trailing whitespace is set aside.
export function trimSegment(segment) {
  const leading = segment.text.length - segment.text.trimStart().length;
  const trailing = segment.text.length - segment.text.trimEnd().length;
  return {
    text: segment.text.slice(leading, segment.text.length - trailing),
    start: segment.start + leading,
    end: segment.end - trailing,
  };
}
