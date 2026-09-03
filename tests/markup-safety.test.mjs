// Markdown markup must survive a rewrite untouched.
//
// This is not cosmetic. In Obsidian's Live Preview the syntax characters are hidden, so
// a rewrite that drops a `**` or rewrites the inside of a `[[wikilink]]` destroys
// formatting the writer cannot see going. The web demo has the same exposure — its own
// scratch note contains `**Teh and cat leak a table!**` — it is merely visible there.

import test from "node:test";
import assert from "node:assert/strict";
import { validateRewrite, markupTokens } from "../src/safety.mjs";

const rewrite = (replacement) => ({ action: "rewrite", replacement, reason: "A restrained edit." });

// Prose the gate would otherwise accept, wrapped in markup that the rewrite loses.
const REJECTED = [
  ["**The tool has the ability to recover files.**", "**The tool can recover files.", "markup-changed"],
  ["**The tool has the ability to recover files.**", "The tool can recover files.", "markup-changed"],
  ["*The tool has the ability to recover files.*", "**The tool can recover files.**", "markup-changed"],
  ["We conducted a review of the [[draft note]].", "We reviewed the [[draft]].", "markup-changed"],
  ["We conducted a review of the [[draft note]].", "We reviewed the draft note.", "markup-changed"],
  ["We conducted a review of the [draft](notes/draft.md).", "We reviewed the [draft](draft.md).", "markup-changed"],
  ["The tool has the ability to run `npm test` first.", "The tool can run `npm run test` first.", "markup-changed"],
  ["The tool has the ability to run `npm test` first.", "The tool can run npm test first.", "markup-changed"],
  ["- The tool has the ability to recover files.", "The tool can recover files.", "markup-changed"],
  ["> The tool has the ability to recover files.", "The tool can recover files.", "markup-changed"],
  ["## The tool has the ability to recover files.", "### The tool can recover files.", "markup-changed"],
  ["The tool has ==the ability to recover== files.", "The tool can recover files.", "markup-changed"],
];

for (const [source, replacement, reason] of REJECTED) {
  test(`rejects: ${source} -> ${replacement}`, () => {
    assert.deepEqual(validateRewrite(source, rewrite(replacement)), { accepted: false, reason });
  });
}

// The markup is identical on both sides, so the edit is judged on its prose alone.
const ACCEPTED = [
  ["**The tool has the ability to recover files.**", "**The tool can recover files.**"],
  ["*The tool has the ability to recover files.*", "*The tool can recover files.*"],
  ["We conducted a review of the [[draft note]].", "We reviewed the [[draft note]]."],
  ["We conducted a review of the [draft](notes/draft.md).", "We reviewed the [draft](notes/draft.md)."],
  ["The tool has the ability to run `npm test` first.", "The tool can run `npm test` first."],
  ["- The tool has the ability to recover files.", "- The tool can recover files."],
  ["> The tool has the ability to recover files.", "> The tool can recover files."],
  ["## The tool has the ability to recover files.", "## The tool can recover files."],
];

for (const [source, replacement] of ACCEPTED) {
  test(`accepts: ${source} -> ${replacement}`, () => {
    assert.deepEqual(validateRewrite(source, rewrite(replacement)), {
      accepted: true, reason: "accepted", replacement,
    });
  });
}

test("plain prose carries no markup tokens, so the check cannot fire on it", () => {
  assert.deepEqual(markupTokens("The archive is copied on a weekly basis."), []);
  assert.deepEqual(markupTokens("Costs rose 5% and 3 * 4 = 12 was checked."), []);
});

test("emphasis inside inline code is code, not emphasis", () => {
  // Were the delimiters counted separately, `a**b` in code would demand a matching `**`
  // in the rewrite and refuse every edit to the sentence around it.
  assert.deepEqual(markupTokens("Run `a**b` now."), ["`a**b`"]);
});

test("an underscore inside an identifier is not an emphasis delimiter", () => {
  assert.deepEqual(markupTokens("Set api_key before the run."), []);
});

test("the check runs before the confusable-repair shortcut", () => {
  // isConfusableRepair returns accepted early, so a markup loss riding along with a
  // their/there repair would otherwise bypass every check including this one.
  assert.deepEqual(
    validateRewrite("**Their going to the site.**", rewrite("They're going to the site.")),
    { accepted: false, reason: "markup-changed" },
  );
});
