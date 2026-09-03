// The prose check, tested on fixtures rather than on the repo — except for the last test,
// which runs it over the real tree and is the only one that can fail because somebody
// wrote a sentence.
//
// The fixtures matter more than the word list. A phrase checker that fires inside a code
// fence, an inline code span or a link URL is a checker contributors turn off, and the
// repo's own prose is full of all three: `README.md` says "Finish a sentence with `.`,
// `!` or `?`", which is three code spans and an exclamation mark that is quoted rather
// than exclaimed. Masking has to leave the offsets alone as well, so a hit after a
// 30-line code block still reports its own line.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  RULES, GUARDS, WAIVER_FINDINGS, ROOT,
  scanText, checkTree, maskProse, clauseSpans, readWaivers, syntaxFor,
} from "../tools/forbidden-phrases.mjs";

const TOOL = fileURLToPath(new URL("../tools/forbidden-phrases.mjs", import.meta.url));
const run = promisify(execFile);

const fired = (text, syntax = "markdown") => scanText(text, { syntax }).findings.map((hit) => hit.rule);
const clean = (text, syntax = "markdown") => assert.deepEqual(fired(text, syntax), []);

// ---------------------------------------------------------------------------
// The word list, with the sentence each rule exists to refuse. The table is also the
// completeness check below: a rule with no fixture is a rule nobody has seen fire.
// ---------------------------------------------------------------------------

const REFUSED = [
  ["marketing/boast", "Tolben is a seamless, blazing, game-changing rewrite engine."],
  ["marketing/boast", "A revolutionary, cutting-edge, state-of-the-art, world-class tool."],
  ["marketing/boast", "Effortless, magical rewrites that unleash your prose and supercharge your notes."],
  ["marketing/multiplier", "Tolben is 10x quicker than reading the sentence yourself."],
  ["marketing/ai-powered", "An AI-powered writing companion."],
  ["marketing/exclamation", "It runs entirely on your own machine!"],
  ["absolute/never-wrong", "The gate is never wrong."],
  ["absolute/never-wrong", "The rewrite is 100% accurate."],
  ["absolute/never-wrong", "Tolben always preserves your meaning."],
  ["absolute/never-wrong", "It cannot change your meaning."],
  ["absolute/perfection", "The output is perfect."],
  ["absolute/perfection", "A flawless rewrite of every sentence."],
  ["absolute/guarantee", "Tolben guarantees that your meaning survives."],
  ["absolute/guarantee", "Every rewrite is guaranteed to keep your words."],
  ["absolute/false-positives", "Tolben has zero false positives."],
  ["unsupported/install-time", "Tolben installs in under ten minutes on a home connection."],
  ["unsupported/install-time", "Setup takes about four minutes."],
  ["unsupported/register-search", "We searched the USPTO register before choosing the name."],
  ["unsupported/register-search", "The trademark register was checked and the name is clear."],
  ["unsupported/platform-performance", "p50 latency on Apple silicon is 400 ms."],
  ["unsupported/platform-performance", "Metal makes it faster."],
  ["unsupported/platform-performance", "Measured on a 2-core laptop at p95 900 ms."],
];

for (const [rule, sentence] of REFUSED) {
  test(`refuses: ${sentence}`, () => {
    const hits = scanText(sentence, { file: "fixture.md" }).findings;
    assert.ok(hits.length >= 1, "expected a finding");
    assert.ok(hits.some((hit) => hit.rule === rule), `expected ${rule}, got ${hits.map((h) => h.rule)}`);
    for (const hit of hits) assert.ok(hit.why.length > 20, "a hit carries the reason, not just the pattern");
  });
}

test("every rule has a fixture that fires it", () => {
  const covered = new Set(REFUSED.map(([rule]) => rule));
  const uncovered = RULES.map((rule) => rule.id).filter((id) => !covered.has(id));
  assert.deepEqual(uncovered, [], "a rule nobody has seen fire is a rule nobody has checked");
});

test("rule ids are unique, and every rule says why", () => {
  const ids = RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const rule of RULES) {
    assert.match(rule.id, /^[a-z]+\/[a-z-]+$/u, `${rule.id} is not a category/name id`);
    assert.ok(rule.why.length > 20, `${rule.id} has no reason a contributor could learn from`);
    for (const guard of rule.allowedWhen ?? []) {
      assert.ok(GUARDS[guard], `${rule.id} names a guard that does not exist: ${guard}`);
    }
  }
});

test("matching is case-insensitive", () => {
  assert.deepEqual(fired("SEAMLESS integration."), ["marketing/boast"]);
  assert.deepEqual(fired("Seamless integration."), ["marketing/boast"]);
  assert.deepEqual(fired("SeAmLeSs integration."), ["marketing/boast"]);
});

// ---------------------------------------------------------------------------
// Quoting is not claiming.
// ---------------------------------------------------------------------------

test("a fenced code block is not prose", () => {
  clean("Before.\n\n```bash\nnpm run seamless   # revolutionary! 10x\n```\n\nAfter.");
  clean("~~~\nblazing, effortless, perfect!\n~~~\n");
});

test("a longer fence swallows a shorter one, and the fence closes on its own character", () => {
  clean("````\n```\nseamless\n```\n````\n");
  // A ``` block is not closed by ~~~, so the boast inside it stays inside it.
  clean("```\n~~~\nflawless\n~~~\n```\n");
});

test("text after a code block is still prose, on its own line", () => {
  const text = "Intro.\n\n```\nseamless\nrevolutionary\nblazing\n```\n\nThe result is seamless.\n";
  const hits = scanText(text, { file: "f.md" }).findings;
  assert.deepEqual(hits.map((hit) => hit.rule), ["marketing/boast"]);
  assert.equal(hits[0].line, 9, "masking blanks the fence in place, so line numbers do not shift");
  assert.equal(hits[0].column, 15);
  assert.equal(hits[0].text, "seamless");
});

test("an inline code span is not prose — the repo's own sentence depends on it", () => {
  clean("Finish a sentence with `.`, `!` or `?` and only that sentence is checked.");
  clean("`**Teh and cat leak a table!**` is refused by the ordinary prose rule for turning `!`");
  clean("Pass `--seamless` to the parser, and the other flag is spelled `--blazing`.");
});

test("a double-backtick span can hold a backtick, and an unclosed backtick stays literal", () => {
  clean("Use ``a ` inside seamless`` here.");
  assert.deepEqual(fired("A stray ` backtick and then seamless prose."), ["marketing/boast"]);
});

test("a code span does not run past its paragraph", () => {
  // One unbalanced backtick must not blank the rest of the document.
  const text = "An opening ` backtick.\n\nA seamless claim.\n\nAnd a closing ` backtick.\n";
  assert.deepEqual(fired(text), ["marketing/boast"]);
});

test("a link URL is not prose, but the words a reader clicks are", () => {
  clean("See [the notes](https://example.test/seamless-and-blazing) for more.");
  clean("Read <https://example.test/revolutionary> or write to <mailto:x@example.test>.");
  clean("[ref]: https://example.test/effortless-guide\n");
  clean("A bare https://example.test/10x-faster link, and www.example.test/perfect too.");
  assert.deepEqual(fired("See [the seamless guide](https://example.test/x)."), ["marketing/boast"]);
});

test("a markdown image is not an exclamation", () => {
  clean("![a hover card](demo-hover.png)");
  clean("A comparison of `a != b` in prose.");
});

test("an HTML comment is not prose", () => {
  clean("<!-- seamless, revolutionary, 10x — notes to self -->\nOrdinary prose.");
});

test("masking preserves the length of the file, and so every offset in it", () => {
  const text = "# Title\n\n```\ncode `x` [y](z)\n```\n\nProse with `code`, [a link](https://x.test), <!-- a note -->.\n";
  for (const syntax of ["markdown", "html", "json"]) {
    const masked = maskProse(syntax === "json" ? '{"description":"x"}' : text, syntax);
    assert.equal(masked.length, (syntax === "json" ? '{"description":"x"}' : text).length, syntax);
  }
  assert.equal(maskProse(text).replace(/[^\n]/gu, "").length, text.replace(/[^\n]/gu, "").length,
    "newlines survive, so lines are still lines");
});

// ---------------------------------------------------------------------------
// The guards: the sentences the project must be able to keep.
// ---------------------------------------------------------------------------

test("a denial is not a claim", () => {
  clean("GPU latency on the pinned artefact has not been measured, and neither has a 2-core laptop.");
  clean("Nobody has timed the install on a domestic line, so no figure of ten minutes exists.");
  clean("The register itself could not be searched from here, so no USPTO search happened.");
});

test("a plan is not a result", () => {
  clean("Re-measure on the pinned artefact: a 2-core laptop; Apple-silicon Metal; Windows CPU.");
  clean("Go/no-go: proceed only if a fresh install reaches a suggestion in under 15 minutes on Windows.");
});

test("a sourced figure is a different claim from a bare absolute", () => {
  clean("0 false positives among the 275 accepted rewrites recorded by `bench/precision-check.mjs`.");
  assert.deepEqual(fired("Tolben has zero false positives."), ["absolute/false-positives"]);
  clean("The vault boundary is guaranteed by `tests/plugin-vault.test.mjs`.");
  assert.deepEqual(fired("Tolben guarantees that nothing else is written."), ["absolute/guarantee"]);
});

test("a guarantee named as a noun, and pinned to what keeps it, survives", () => {
  clean("That boundary is a product guarantee, not just a convention.");
  clean("This is a product guarantee rather than a convention, and `tests/plugin-vault.test.mjs` enforces it.");
});

test("naming the model is the alternative to calling it AI-powered", () => {
  clean("The rewrites come from Qwen3.5-2B running under llama-server on your own machine.");
  assert.deepEqual(fired("An AI-powered rewrite engine."), ["marketing/ai-powered"]);
});

test("a platform named without a performance claim is just a platform", () => {
  clean("CI runs the suite on macOS, Windows and Ubuntu on every push.");
  clean("Windows cannot be asked for CPU features cheaply, so there the guess is optimistic.");
  assert.deepEqual(fired("Tolben is faster on Windows."), ["unsupported/platform-performance"]);
});

test("a clause wall stops one table cell corroborating another", () => {
  // A roadmap row's exit criterion sits in its own cell; it is not evidence for the
  // description beside it.
  clean("| 5.1 | Metal on Apple silicon, Vulkan on Windows | 5 | p50 rows for each on named hardware |");
});

test("the word perfect keeps its grammatical and adverbial senses", () => {
  clean("An aspect change from past to perfect is one the gate can see.");
  clean("\"The tenant sued the landlord\" is a perfectly good sentence.");
  assert.deepEqual(fired("The rewrite is perfect."), ["absolute/perfection"]);
});

test("a guard reads the clause with the match cut out, so a rule cannot excuse itself", () => {
  // No shipped rule's pattern can overlap one of its own guards — `absolute/never-wrong`
  // contains a denial but carries no `allowedWhen`, so nothing consults a guard for it —
  // and a mechanism no fixture reaches is one nobody has checked. So the fixture brings
  // its own rule: the match IS the denial, and `denied` is the guard. Cut out, the clause
  // has no alibi left and the rule fires; left in, it would corroborate itself.
  const rules = [{
    id: "fixture/self-excusing",
    why: "A rule whose own match is a denial, which is the case the cut-out exists for.",
    pattern: /\bnever measured\b/giu,
    allowedWhen: ["denied"],
  }];
  const firedWith = (text) => scanText(text, { rules }).findings.map((hit) => hit.rule);
  assert.deepEqual(firedWith("The gate is never measured."), ["fixture/self-excusing"]);
  // A denial the writer supplied, outside the match, still excuses it: the cut-out removes
  // the match and nothing else.
  assert.deepEqual(firedWith("Nobody claims the gate is never measured."), []);
});

test("clauses split on sentence stops, semicolons and table walls, but not on decimals", () => {
  const spans = clauseSpans("1.57 GB moved; a second run took 16 s. Then done.");
  assert.deepEqual(spans.map(([from, to]) => "1.57 GB moved; a second run took 16 s. Then done.".slice(from, to)),
    ["1.57 GB moved", " a second run took 16 s", " Then done"]);
});

// ---------------------------------------------------------------------------
// Waivers.
// ---------------------------------------------------------------------------

test("a waiver on the same line keeps a legitimate use", () => {
  const result = scanText(
    "The vendor calls it seamless. <!-- forbidden-phrases: allow marketing/boast — their word, quoted -->",
    { file: "f.md" });
  assert.deepEqual(result.findings, []);
  assert.equal(result.waived.length, 1);
  assert.equal(result.waived[0].reason, "their word, quoted");
});

test("a waiver on the line before keeps the line under it", () => {
  const result = scanText(
    "<!-- forbidden-phrases: allow marketing/boast — their word, quoted -->\nThe vendor calls it seamless.",
    { file: "f.md" });
  assert.deepEqual(result.findings, []);
  assert.equal(result.waived.length, 1);
});

test("a waiver reaches one line, not the whole file", () => {
  const text = "<!-- forbidden-phrases: allow marketing/boast — quoted -->\nseamless\nseamless\n";
  const result = scanText(text, { file: "f.md" });
  assert.equal(result.waived.length, 1);
  assert.deepEqual(result.findings.map((hit) => hit.line), [3]);
});

test("a waiver with no reason is itself a finding", () => {
  const result = scanText("<!-- forbidden-phrases: allow marketing/boast -->\nseamless", { file: "f.md" });
  const ids = result.findings.map((hit) => hit.rule);
  assert.ok(ids.includes(WAIVER_FINDINGS.noReason.id), "a bare allow is an exemption nobody can review");
  assert.ok(ids.includes("marketing/boast"), "and it exempts nothing");
  assert.deepEqual(result.waived, []);
});

test("a waiver naming a rule that does not exist is a finding", () => {
  const result = scanText("<!-- forbidden-phrases: allow marketing/bogus — a typo -->\nseamless", { file: "f.md" });
  const ids = result.findings.map((hit) => hit.rule);
  assert.ok(ids.includes(WAIVER_FINDINGS.unknownRule.id));
  assert.ok(ids.includes("marketing/boast"));
});

test("a waiver only covers the rule it names", () => {
  assert.deepEqual(
    fired("<!-- forbidden-phrases: allow absolute/perfection — wrong rule -->\nseamless"),
    ["marketing/boast"]);
});

test("a waiver can name several rules, and any of the accepted separators", () => {
  for (const separator of ["—", "--", ":", " - "]) {
    const text = `<!-- forbidden-phrases: allow marketing/boast, absolute/perfection ${separator} quoted from the vendor -->\nA seamless, perfect tool.`;
    const result = scanText(text, { file: "f.md" });
    assert.deepEqual(result.findings, [], `separator ${separator}`);
    assert.equal(result.waived.length, 2, `separator ${separator}`);
  }
});

test("the waiver comment is not itself scanned", () => {
  // Its reason will often have to quote the phrase it is excusing.
  const result = scanText(
    "<!-- forbidden-phrases: allow marketing/boast — the vendor's own word, seamless -->\nTheir seamless tool.",
    { file: "f.md" });
  assert.deepEqual(result.findings, []);
  assert.equal(result.waived.length, 1);
  const { waivers, problems } = readWaivers("<!-- forbidden-phrases: allow marketing/boast — because -->");
  assert.deepEqual(problems, []);
  assert.deepEqual(waivers[0].ids, ["marketing/boast"]);
});

// ---------------------------------------------------------------------------
// The file kinds.
// ---------------------------------------------------------------------------

test("only the description is read out of a manifest", () => {
  const manifest = [
    "{",
    '  "id": "tolben",',
    '  "description": "A seamless rewrite engine!",',
    '  "author": "Effortless Software"',
    "}",
  ].join("\n");
  const hits = scanText(manifest, { file: "manifest.json", syntax: "json" }).findings;
  assert.deepEqual(hits.map((hit) => hit.rule).sort(), ["marketing/boast", "marketing/exclamation"]);
  assert.equal(hits[0].line, 3, "and it is reported where it sits in the file");
  assert.equal(hits[0].text, "seamless");
});

test("HTML is read for its text, not its markup", () => {
  const page = [
    "<!doctype html>",
    "<style>.seamless { color: red }</style>",
    '<script>const revolutionary = "10x";</script>',
    '<a class="blazing" href="https://x.test/effortless">the docs</a>',
    "<p>A revolutionary playground.</p>",
  ].join("\n");
  const hits = scanText(page, { file: "index.html", syntax: "html" }).findings;
  assert.deepEqual(hits.map((hit) => hit.rule), ["marketing/boast"]);
  assert.equal(hits[0].line, 5);
});

test("the syntax comes from the extension", () => {
  assert.equal(syntaxFor(join("docs", "FAQ.md")), "markdown");
  assert.equal(syntaxFor(join("obsidian-plugin", "manifest.json")), "json");
  assert.equal(syntaxFor(join("playground", "dist", "INDEX.HTML")), "html");
});

// ---------------------------------------------------------------------------
// The command line.
// ---------------------------------------------------------------------------

async function withFixtures(files, body) {
  const dir = await mkdtemp(join(tmpdir(), "tolben-prose-"));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function cli(args, cwd) {
  try {
    const { stdout, stderr } = await run(process.execPath, [TOOL, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("the command exits 0 on clean text and 1 on a finding, and points at it", async () => {
  await withFixtures({
    "clean.md": "The gate refuses any rewrite it cannot prove keeps the meaning.\n",
    "boast.md": "One.\nTwo.\nA seamless experience.\n",
  }, async (dir) => {
    const ok = await cli(["clean.md"], dir);
    assert.equal(ok.code, 0);
    assert.match(ok.stdout, /no findings/u);

    const bad = await cli(["boast.md"], dir);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /^boast\.md:3:3 {2}marketing\/boast {2}"seamless"$/mu,
      "file:line:column first, so a terminal makes it clickable");
    assert.match(bad.stdout, /reader cannot check/u, "and the reason a contributor needs");
  });
});

test("--json is the same findings, for a machine", async () => {
  await withFixtures({ "boast.md": "A seamless experience.\n" }, async (dir) => {
    const result = await cli(["--json", "boast.md"], dir);
    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.scanned, ["boast.md"]);
    assert.equal(report.findings.length, 1);
    assert.deepEqual(
      { ...report.findings[0], why: undefined },
      { file: "boast.md", line: 1, column: 3, rule: "marketing/boast", text: "seamless", why: undefined });
    assert.ok(report.findings[0].why.length > 20);
  });
});

test("a usage error exits 2, and is not confused with a finding", async () => {
  const unknownFlag = await cli(["--nope"], ROOT);
  assert.equal(unknownFlag.code, 2);
  assert.match(unknownFlag.stderr, /unknown option --nope/u);

  const missing = await cli([join("docs", "NO-SUCH-FILE.md")], ROOT);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /no such file/u);
});

// ---------------------------------------------------------------------------
// The tree itself.
// ---------------------------------------------------------------------------

test("the repo's own user-facing prose passes its own check", async () => {
  const result = await checkTree(ROOT);
  assert.ok(result.scanned.length >= 8, `only ${result.scanned.length} files found — the target list is wrong`);
  assert.ok(result.scanned.includes("README.md"));
  assert.deepEqual(
    result.findings.map((hit) => `${hit.file}:${hit.line}:${hit.column} ${hit.rule} "${hit.text}"`),
    [],
    "fix the sentence, not the rule");
  assert.equal(result.ok, true);
});
