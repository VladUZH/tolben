// Projecting a markdown sentence to the prose a reader sees, and mapping back.
//
// The model is shown prose and answers in prose. Everything that makes the suggestion
// land in the right place — the underline, and the edit Replace performs — is this
// mapping's job.

import test from "node:test";
import assert from "node:assert/strict";
import { flattenMarkdown, sourceRuns, sourceEdits } from "../obsidian-plugin/markdown.mjs";

const prose = (source) => flattenMarkdown(source).text;

test("emphasis, strong, highlight and strikethrough delimiters are not prose", () => {
  assert.equal(prose("**The archive** is *copied on a weekly basis*."), "The archive is copied on a weekly basis.");
  assert.equal(prose("__The archive__ is _copied_."), "The archive is copied.");
  assert.equal(prose("The ==archive== is ~~copied~~."), "The archive is copied.");
});

test("a delimiter that cannot be one is left as prose", () => {
  assert.equal(prose("The product is 3 * 4 today."), "The product is 3 * 4 today.");
  assert.equal(prose("Set api_key before the run."), "Set api_key before the run.");
});

test("links contribute their text, never their target", () => {
  assert.equal(prose("We reviewed the [draft](notes/draft.md)."), "We reviewed the draft.");
  assert.equal(prose("We reviewed the [[draft note]]."), "We reviewed the draft note.");
  assert.equal(prose("We reviewed the [[notes/draft|draft note]]."), "We reviewed the draft note.");
});

test("inline code contributes its contents, and they are protected", () => {
  const projection = flattenMarkdown("The tool has the ability to run `npm test` first.");
  assert.equal(projection.text, "The tool has the ability to run npm test first.");
  assert.deepEqual(projection.protectedTerms, ["npm test"]);
});

test("link text is protected, so a rewrite cannot hollow out the link", () => {
  assert.deepEqual(flattenMarkdown("We reviewed the [[draft note]].").protectedTerms, ["draft note"]);
  assert.deepEqual(flattenMarkdown("We reviewed the [draft](d.md).").protectedTerms, ["draft"]);
});

test("embeds and images are not prose at all", () => {
  assert.equal(prose("See ![[diagram.png]] for the layout."), "See  for the layout.");
  assert.equal(prose("See ![a diagram](d.png) for the layout."), "See  for the layout.");
});

test("an escaped delimiter is the character itself", () => {
  assert.equal(prose("The \\*literal\\* asterisks stay."), "The *literal* asterisks stay.");
});

test("leading block markers are not prose", () => {
  assert.equal(prose("- The archive is copied."), "The archive is copied.");
  assert.equal(prose("> - [ ] The archive is copied."), "The archive is copied.");
  assert.equal(prose("## The archive is copied."), "The archive is copied.");
});

test("every prose character maps back to the character it came from", () => {
  const source = "**The archive** is *copied on a weekly basis*.";
  const projection = flattenMarkdown(source);
  for (let index = 0; index < projection.text.length; index += 1) {
    assert.equal(source[projection.offsets[index]], projection.text[index], `index ${index}`);
  }
});

test("a prose range inside one markup run maps to one source range", () => {
  const source = "**The archive** is *copied on a weekly basis*.";
  const projection = flattenMarkdown(source);
  const from = projection.text.indexOf("on a weekly");
  const runs = sourceRuns(projection, from, from + "on a weekly".length);
  assert.equal(runs.length, 1);
  assert.equal(source.slice(runs[0].from, runs[0].to), "on a weekly");
});

test("a prose range crossing a delimiter splits into runs that skip it", () => {
  // The screenshot's sentence: the italics close after "weekly", so the phrase the
  // rewrite removes straddles the closing delimiter.
  const source = "**The archive** is *copied on a weekly* basis.";
  const projection = flattenMarkdown(source);
  const from = projection.text.indexOf("on a weekly basis");
  const runs = sourceRuns(projection, from, from + "on a weekly basis".length);
  assert.equal(runs.length, 2);
  assert.equal(source.slice(runs[0].from, runs[0].to), "on a weekly");
  assert.equal(source.slice(runs[1].from, runs[1].to), " basis");
  // The delimiter between them is untouched by either run.
  assert.equal(source.slice(runs[0].to, runs[1].from), "*");
});

// Applying the edits by hand, exactly as CodeMirror applies a transaction.
function applyEdits(source, edits) {
  let result = "";
  let cursor = 0;
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    result += source.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  return result + source.slice(cursor);
}

const EDITS = [
  // The case from the screenshot: the removed words straddle the closing delimiter.
  [
    "**The archive** is *copied on a weekly* basis.",
    "The archive is copied weekly.",
    "**The archive** is *copied weekly*.",
  ],
  [
    "**The archive** is *copied on a weekly basis*.",
    "The archive is copied weekly.",
    "**The archive** is *copied weekly*.",
  ],
  ["The archive is copied on a weekly basis.", "The archive is copied weekly.", "The archive is copied weekly."],
  ["*The archive is copied on a weekly basis.*", "The archive is copied weekly.", "*The archive is copied weekly.*"],
  ["**The archive** is copied on a weekly basis.", "The archive is copied weekly.", "**The archive** is copied weekly."],
  ["- The tool has the ability to recover files.", "The tool can recover files.", "- The tool can recover files."],
  ["> The tool has the ability to recover files.", "The tool can recover files.", "> The tool can recover files."],
  [
    "The tool has the ability to run `npm test` first.",
    "The tool can run npm test first.",
    "The tool can run `npm test` first.",
  ],
  [
    "We conducted a review of the [[draft note]].",
    "We reviewed the draft note.",
    "We reviewed the [[draft note]].",
  ],
  // A capitalisation repair inside emphasis: the edit is entirely within one run.
  ["The workshop starts on *wednesday*.", "The workshop starts on Wednesday.", "The workshop starts on *Wednesday*."],
];

for (const [source, replacement, expected] of EDITS) {
  test(`replace: ${source} -> ${expected}`, () => {
    const projection = flattenMarkdown(source);
    const edits = sourceEdits(projection, replacement);
    assert.equal(applyEdits(source, edits), expected);
  });
}

test("edits are within the sentence and never overlap", () => {
  const source = "**The archive** is *copied on a weekly basis*.";
  const edits = sourceEdits(flattenMarkdown(source), "The archive is copied weekly.");
  let previousEnd = 0;
  for (const edit of edits) {
    assert.ok(edit.from >= previousEnd, "edits overlap");
    assert.ok(edit.to >= edit.from, "an edit runs backwards");
    assert.ok(edit.to <= source.length, "an edit runs past the sentence");
    previousEnd = edit.to;
  }
});

test("a replacement identical to the prose produces no edits", () => {
  const source = "**The archive** is copied weekly.";
  const projection = flattenMarkdown(source);
  assert.deepEqual(sourceEdits(projection, projection.text), []);
});
