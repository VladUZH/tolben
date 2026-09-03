// Block structure as a sentence boundary.
//
// The segmenter used to split on terminal punctuation and nothing else, so any line that
// did not end in ".!?" — a heading, a list item, a table row, a signature — was glued to
// the paragraph below it across the blank line. Measured on a real vault note: 27 such
// spans, 6% of the document. The consequence was silent: the model was asked about a
// span that was not a sentence, answered about the prose half, and the safety layer
// refused the answer for losing the OTHER half's names or markup. The suggestion was
// computed and thrown away, and the writer saw no underline at all.
//
// The negative case at the bottom is the one that keeps this honest: a single newline is
// NOT a boundary, because prose wrapped across consecutive lines is one sentence.
import test from "node:test";
import assert from "node:assert/strict";
import { segmentSentences } from "../src/segmenter.mjs";

const texts = (input) => segmentSentences(input).map((segment) => segment.text);

test("a blank line ends a sentence even when the line above has no full stop", () => {
  // The reported bug: a signature line carries no full stop, so it used to swallow the
  // paragraph beneath it. Shape taken from the note that reported it, name neutralised.
  assert.deepEqual(
    texts("Sincerely, Dr. A. Sender \n\nThe archive is copied on a weekly basis."),
    ["Sincerely, Dr. A. Sender \n", "The archive is copied on a weekly basis."],
  );
});

test("a blank line that carries whitespace is still blank", () => {
  // The note's blank lines contain a space; a strict /\n\n/ test would miss them.
  assert.deepEqual(
    texts("No full stop here\n \t \nA real sentence follows."),
    ["No full stop here\n", "A real sentence follows."],
  );
  assert.deepEqual(
    texts("No full stop here\r\n\r\nA real sentence follows."),
    ["No full stop here\r\n", "A real sentence follows."],
  );
});

test("a heading is its own block on both sides", () => {
  assert.deepEqual(
    texts("## Scratch\n\nthe cat and dog runs over a bench."),
    ["## Scratch\n", "the cat and dog runs over a bench."],
  );
  // …including with no blank line under it, which is where gluing was worst.
  assert.deepEqual(
    texts("## Title\nParagraph right under the heading."),
    ["## Title\n", "Paragraph right under the heading."],
  );
});

test("list items are separate sentences, and a wrapped item stays whole", () => {
  assert.deepEqual(
    texts("- first item\n- second item\n\nA paragraph."),
    ["- first item\n", "- second item\n", "A paragraph."],
  );
  // A continuation line is not a new item, so it must not be cut off.
  assert.deepEqual(
    texts("- an item that wraps\n  onto the next line\n"),
    ["- an item that wraps\n  onto the next line\n"],
  );
  assert.deepEqual(texts("1. first\n2. second\n"), ["1. first\n", "2. second\n"]);
});

test("table rows and rules do not absorb the text around them", () => {
  assert.deepEqual(
    texts("| a | b |\n| c | d |\n\nAfter the table."),
    ["| a | b |\n", "| c | d |\n", "After the table."],
  );
  assert.deepEqual(texts("Above the rule\n---\nBelow the rule."), ["Above the rule\n", "---\n", "Below the rule."]);
});

test("a table row is atomic, so its cells are never offered as prose", () => {
  // Scanning inside the row cut it at the full stop in a cell, leaving
  // "| One | Copied on a weekly basis." — a "complete sentence" whose leading pipe the
  // flattener did not strip, so accepting a rewrite deleted it and broke the table.
  const row = "| One | Copied on a weekly basis. |\n";
  assert.deepEqual(texts(row), [row]);
});

test("a quote is one block for its whole run, and prose may continue it lazily", () => {
  // Cutting at every "> " line split a sentence wrapped across a multi-line quote and
  // handed the model a fragment with no subject — and Obsidian writes multi-line quotes
  // for you by continuing "> " on Enter, so this is the common shape.
  assert.deepEqual(
    texts("> The review of the vendor was conducted\n> in a thorough manner.\n"),
    ["> The review of the vendor was conducted\n> in a thorough manner.\n"],
  );
  // Sentence boundaries inside the run still work.
  assert.deepEqual(texts("> First one.\n> Second one.\n"), ["> First one.\n", "> Second one.\n"]);
  // A plain line under a quote or a list item is markdown's lazy continuation of it.
  assert.deepEqual(texts("> quoted line\nA new paragraph."), ["> quoted line\nA new paragraph."]);
  assert.deepEqual(texts("- item that wraps\nwithout indent.\n"), ["- item that wraps\nwithout indent.\n"]);
  // A blank line still ends it, which is what the original bug was about.
  assert.deepEqual(texts("> quoted line\n\nA new paragraph."), ["> quoted line\n", "A new paragraph."]);
});

test("a fenced code block is one atomic segment, blank lines and full stops included", () => {
  // Splitting inside a fence handed the model code as prose AND left the backticks —
  // the only proof it was code — behind on a different segment.
  assert.deepEqual(
    texts("```\nThe code has the ability to run.\n```\n"),
    ["```\nThe code has the ability to run.\n```\n"],
  );
  assert.deepEqual(
    texts("Before it.\n\n```js\nconst a = 1;\n\nrun(). go().\n```\n\nAfter it."),
    ["Before it.\n", "```js\nconst a = 1;\n\nrun(). go().\n```\n", "After it."],
  );
  assert.deepEqual(texts("~~~\ntildes. two of them.\n~~~\n"), ["~~~\ntildes. two of them.\n~~~\n"]);
  // An unclosed fence runs to the end of the document rather than leaking prose out.
  assert.deepEqual(
    texts("An unclosed fence.\n\n```\nstill code. here."),
    ["An unclosed fence.\n", "```\nstill code. here."],
  );
});

test("trailing emphasis stays with its sentence", () => {
  // Without emphasis in CLOSERS the trailing "**" was cut loose and travelled into the
  // next paragraph as its own segment.
  assert.deepEqual(
    texts("**Teh and cat leak a table!**  \n\nthe cat and dog runs."),
    ["**Teh and cat leak a table!**  \n", "the cat and dog runs."],
  );
});

test("a single newline is NOT a boundary: wrapped prose is one sentence", () => {
  assert.deepEqual(
    texts("A wrapped sentence that\ncontinues on the next line."),
    ["A wrapped sentence that\ncontinues on the next line."],
  );
  assert.deepEqual(
    texts("First.\nSecond on its own line."),
    ["First.\n", "Second on its own line."],
  );
});

test("offsets still address the source exactly", () => {
  const document = [
    "## Heading",
    "",
    "Sincerely, Dr. A. Sender ",
    "",
    "The archive is copied on a weekly basis. It also runs nightly.",
    "",
    "- item one",
    "- item two that wraps",
    "  onto here",
    "",
    "```",
    "code. with stops.",
    "```",
    "",
    "| a | b |",
    "",
    "A wrapped final paragraph that",
    "continues here.",
  ].join("\n");
  const segments = segmentSentences(document);
  for (const segment of segments) {
    assert.equal(segment.text, document.slice(segment.start, segment.end));
    assert.ok(segment.start < segment.end);
  }
  // Ordered and non-overlapping.
  for (let index = 1; index < segments.length; index += 1) {
    assert.ok(segments[index].start >= segments[index - 1].end, "segments must not overlap");
  }
  // Nothing but whitespace may be dropped between neighbours.
  for (let index = 1; index < segments.length; index += 1) {
    const gap = document.slice(segments[index - 1].end, segments[index].start);
    assert.equal(gap.trim(), "", `dropped content: ${JSON.stringify(gap)}`);
  }
  assert.equal(document.slice(0, segments[0].start).trim(), "");
  assert.equal(document.slice(segments[segments.length - 1].end).trim(), "");
});

test("a document of ordinary prose is unaffected by block splitting", () => {
  const prose = "The first one. The second one! And a third? Yes.";
  assert.deepEqual(texts(prose), ["The first one. ", "The second one! ", "And a third? ", "Yes."]);
});

// --- Defects found by the adversarial review of this change (2026-08-30) ---

test("a fence closes only on a longer-or-equal run of its own character", () => {
  // The inner ``` used to close the ````-fenced block, so the code body was scanned as
  // prose — exactly what the atomic block exists to prevent.
  assert.deepEqual(
    texts("Intro paragraph here.\n\n````md\n```js\nx\n```\n````\n\nAfter the block.\n"),
    ["Intro paragraph here.\n", "````md\n```js\nx\n```\n````\n", "After the block.\n"],
  );
  // The mirror case lost prose entirely: the premature close reopened a fence that never
  // closed, and the real paragraph was swallowed to EOF.
  assert.deepEqual(
    texts("`````\ncode.here\n```\nstill code here.\n`````\n\nAfter.\n"),
    ["`````\ncode.here\n```\nstill code here.\n`````\n", "After.\n"],
  );
  // A closing fence may not carry an info string.
  assert.deepEqual(texts("```\na. b.\n``` js\n```\n"), ["```\na. b.\n``` js\n```\n"]);
});

test("CRLF documents get the same boundaries as LF ones", () => {
  // The end-anchored rule and setext tests never matched while the line still carried
  // its carriage return, so on a CRLF note these were not boundaries at all.
  assert.deepEqual(texts("Regards\r\n---\r\nSent from my phone\r\n"),
    ["Regards\r\n", "---\r\n", "Sent from my phone\r\n"]);
  assert.deepEqual(texts("Alpha\r\n-------\r\nBravo charlie\r\n"),
    ["Alpha\r\n", "-------\r\n", "Bravo charlie\r\n"]);
  // The worst instance: YAML frontmatter glued to the note's first sentence.
  assert.deepEqual(texts("---\r\ntitle: Meeting\r\n---\r\nAlice and Bob agreed the plan\r\n"),
    ["---\r\n", "title: Meeting\r\n", "---\r\n", "Alice and Bob agreed the plan\r\n"]);
  // A CRLF pair travels with the sentence it ends, rather than opening the next one.
  assert.deepEqual(texts("One sentence.\r\nTwo sentence.\r\n"), ["One sentence.\r\n", "Two sentence.\r\n"]);
});

test("a fence indented under a list item is still a fence", () => {
  assert.deepEqual(
    texts("1. Step one:\n\n    ```js\n    const a = 1.5;\n    // Sentence. Another.\n    ```\n\n2. Step two.\n"),
    ["1. Step one:\n", "    ```js\n    const a = 1.5;\n    // Sentence. Another.\n    ```\n", "2. Step two.\n"],
  );
});

test("nested and wide ordered-list markers are never cut loose as their own segment", () => {
  assert.deepEqual(texts("1. First item.\n    1. Nested item.\n"), ["1. First item.\n", "    1. Nested item.\n"]);
  // The marker regexes used to disagree on width: \d{1,4} suppressed vs \d+ recognised.
  assert.deepEqual(texts("12345. Do the thing.\n"), ["12345. Do the thing.\n"]);
  assert.deepEqual(texts("   12345. Do the thing.\n"), ["   12345. Do the thing.\n"]);
});

test("emphasis is absorbed only when it closes a sentence, never when it opens the next", () => {
  // Taking these left BOTH segments as unbalanced markdown, which is the same condition
  // that makes the safety layer refuse a rewrite for losing markup.
  assert.deepEqual(texts("The build passed.**Note:** deploy tomorrow.\n"),
    ["The build passed.", "**Note:** deploy tomorrow.\n"]);
  assert.deepEqual(texts("end.*emphasis starts here* more"), ["end.", "*emphasis starts here* more"]);
  assert.deepEqual(texts("value.~~strike~~ rest"), ["value.", "~~strike~~ rest"]);
  assert.deepEqual(texts("Run it.`npm i` then wait."), ["Run it.", "`npm i` then wait."]);
  // …while a genuine trailing closer still stays put.
  assert.deepEqual(texts("**Done!**  \n\nNext."), ["**Done!**  \n", "Next."]);
});
