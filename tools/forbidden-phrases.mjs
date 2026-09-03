// The repo's prose discipline, enforced against the text a reader actually sees.
//
//   node tools/forbidden-phrases.mjs                 # every user-facing file in the tree
//   node tools/forbidden-phrases.mjs docs/FAQ.md     # only the files named
//   node tools/forbidden-phrases.mjs --json          # the same findings, for a machine
//   node tools/forbidden-phrases.mjs --rules         # the rules and their reasons
//
// Exit status: 0 clean, 1 findings, 2 a usage error.
//
// Three kinds of sentence are refused here. Marketing adjectives, because a reader cannot
// check one and this project's whole pitch is that its claims are checkable. Absolute
// correctness claims, because the controls measure a corpus and not every sentence a
// writer will ever type. And claims the tree cannot support: a timed install (the
// third-party measurement was dropped on 2026-09-03), a trademark register search (the
// register was never reachable from this project's container), and any performance figure
// on Apple silicon, Metal, Windows or a 2-core machine.
//
// Quoting is not claiming. Nothing inside a fenced code block, an inline code span, a link
// URL or an HTML comment is matched: those spans are blanked to spaces before any rule
// runs, which keeps every byte offset — and so every line and column — where it was. That
// masking is the part most easily got wrong, so it is a pure function, exported, and
// tested on its own.
//
// Rules that police a claim rather than a word carry guards, and the guards are why this
// file is longer than a word list. "GPU latency on the pinned artefact has not been
// measured, and neither has a 2-core laptop" is a sentence the project wants to keep;
// "p50 on Apple silicon is 400 ms" is one it must refuse. The guards separate the two by
// reading the clause around the match — with the match itself cut out, so a rule's own
// words cannot corroborate it — and looking for a denial, a plan, or a named source. A
// guard that is wrong in a particular place is what the waiver comment is for:
//
//   <!-- forbidden-phrases: allow marketing/boast — quoting a competitor's own page -->
//
// on the line before or the same line. A waiver with no reason is itself a finding: an
// exemption nobody can review is worse than the phrase it hides.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

// The user-facing text. Everything here is prose a reader meets before they have decided
// to trust the project; REPORT.md and CLAUDE.md are working documents and are not scanned,
// because an engineering log has to be able to quote the sentence it is arguing against.
const NAMED_FILES = [
  ["README.md"],
  ["CHANGELOG.md"],
  ["COMPARISON.md"],
  ["SECURITY.md"],
  ["CONTRIBUTING.md"],
  ["obsidian-plugin", "README.md"],
  ["obsidian-plugin", "manifest.json"],
];

const SCANNED_DIRECTORIES = [
  { segments: ["docs"], extensions: [".md"], recursive: false },
  // The playground's pages are generated, and a build that has not run yet leaves
  // nothing to read; a missing directory is not an error, it is a directory nobody has
  // written. Whatever the build does emit is prose a reader meets, so it is scanned.
  { segments: ["playground"], extensions: [".html", ".htm"], recursive: true },
];

// ---------------------------------------------------------------------------
// Guards: what makes a claim-shaped sentence not a claim.
// ---------------------------------------------------------------------------

export const GUARDS = {
  // The clause denies the claim, or records that the measurement was never made.
  denied: /\b(?:not|never|neither|nor|nobody|none|cannot|can't|without|un(?:measured|tested|verified|timed)|dropped|abandoned|rather than|instead of|yet to)\b/iu,
  // The clause is a plan, a condition or an exit criterion — something that would be true,
  // not something that is.
  planned: /\b(?:if|unless|until|would|should|shall|plan|planned|planning|goal|goals|target|criterion|criteria|proposed|intend|intends|aim|aims|re-?measure|go\/no-go)\b/iu,
  // The clause names what establishes the figure: a file in the tree, a corpus, a control
  // instrument, or the conditions the measurement was taken under.
  sourced: /(?:`[^`]*\.(?:mjs|json|md|txt|yml|yaml|js|gguf)`|\bbench\/|\btests?\/|\bREPORT\.md\b|\bROADMAP\.md\b|\bcorpus\b|\bcorpora\b|\bholdout\b|\bbattery\b|\boracle\b|\bprecision-check\b|\bunlock-check\b|\bMB\/s\b|\bMbps\b|\bXeon\b|\bdatacentre\b|\bdatacenter\b|\b\d+\s*\/\s*\d+\b|\b\d[\d,.]*\s+(?:of|accepted|recorded|refusals|sentences|rows|tests)\b)/iu,
  // The clause says which model, rather than gesturing at "AI".
  names_the_model: /\b(?:Qwen[\w.-]*|llama\.cpp|llama-server|GGUF|Ollama|Q6_K|Q4_K_M)\b/iu,
};

const GUARD_LABELS = {
  denied: "the clause denies the claim",
  planned: "the clause states a plan, not a result",
  sourced: "the clause names what establishes it",
  names_the_model: "the clause names the model",
};

// ---------------------------------------------------------------------------
// The rules. `pattern` is what is reported; `needs` is corroboration that has to appear in
// the same clause before the match counts, which is how a bare mention of Windows stays
// legal and a latency figure on Windows does not.
// ---------------------------------------------------------------------------

export const RULES = [
  {
    id: "marketing/boast",
    why: "An adjective a reader cannot check. Say what the program does and what was measured.",
    pattern: /\b(?:revolutionary|game[-\s]?chang(?:ing|er)|seamless(?:ly)?|blazing(?:ly)?|cutting[-\s]edge|state[-\s]of[-\s]the[-\s]art|world[-\s]class|effortless(?:ly)?|magical(?:ly)?|unleash(?:es|ed|ing)?|supercharge(?:s|d|ing)?)\b/giu,
  },
  {
    id: "marketing/multiplier",
    why: "A multiple of what, against which baseline? No such comparison is measured anywhere in this tree.",
    pattern: /\b10\s?-?\s?x\b/giu,
  },
  {
    id: "marketing/ai-powered",
    why: "Name the model and where it runs. \"AI-powered\" tells a reader nothing they can check.",
    pattern: /\bAI[-\s]powered\b/giu,
    allowedWhen: ["names_the_model"],
  },
  {
    id: "marketing/exclamation",
    why: "The prose here is declarative. An exclamation mark is emphasis the sentence has not earned.",
    // Not `!=`, and not the `!` that opens a markdown image.
    pattern: /!(?![=[])/gu,
  },
  {
    id: "absolute/never-wrong",
    why: "The controls measure a corpus, not every sentence a writer will type. Give the corpus and the count instead.",
    pattern: /\b(?:never wrong|always right|always correct|100\s*%\s*(?:accurate|correct|precise|safe|reliable)|always preserves|never changes your meaning|cannot change your meaning|can't change your meaning|will not change your meaning)\b/giu,
  },
  {
    id: "absolute/perfection",
    why: "Nothing here is perfect. The safety gate exists because the model is not.",
    // Two senses of the word are not the boast and are left alone: the grammarian's
    // ("an aspect change from past to perfect") and the intensifier's ("a perfectly good
    // sentence"), which modifies an adjective rather than describing the product.
    pattern: /\bflawless\b|\binfallible\b|(?<!\b(?:past|present|future|to)\s)\bperfect\b(?!\s+(?:aspect|tense|participle))/giu,
  },
  {
    id: "absolute/guarantee",
    why: "A guarantee is a promise about every future input. Name what enforces it — a guarantee as a noun, pinned to the test that keeps it, is a different claim.",
    pattern: /(?<!\b(?:no|not|never|without)\s)(?:\bguarantees\b|\bguaranteed\b|\bguarantee(?=\s+(?:that|to)\b))/giu,
    allowedWhen: ["sourced"],
  },
  {
    id: "absolute/false-positives",
    why: "0 on a named corpus is a measurement; \"zero false positives\" is a promise about text nobody has run.",
    pattern: /\b(?:zero|no|0)\s+false\s+(?:positives|negatives)\b/giu,
    allowedWhen: ["sourced"],
  },
  {
    id: "unsupported/install-time",
    why: "No install has been timed on a domestic line; the third-party timed install was dropped on 2026-09-03. The one honest figure is the 36 s provisioner run on roughly 44 MB/s, and it needs its conditions named.",
    pattern: /\b(?:installs?|installed|installing|installation|set[-\s]?up|setup|provisions?|provisioned|provisioning|up and running)\b/giu,
    // A figure, not the word: "a timed install" as a future exit criterion claims nothing.
    needs: /\b(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)[\s-]*(?:seconds?|secs?|s|minutes?|mins?|hours?)\b/iu,
    allowedWhen: ["denied", "planned", "sourced"],
  },
  {
    id: "unsupported/register-search",
    why: "The trademark register was never reachable from this project's container. What happened was an ordinary search and a preliminary clearance assessment; say that, and no more.",
    pattern: /\b(?:USPTO|TESS|TSDR|trademark register|trademark database|register of trade\s?marks)\b/giu,
    needs: /\b(?:search(?:ed|es|ing)?|check(?:ed|s)?|clear(?:ed|ance)|screen(?:ed)?|looked up|query|queried)\b/iu,
    allowedWhen: ["denied", "planned"],
  },
  {
    id: "unsupported/platform-performance",
    why: "Nothing has been measured on Apple silicon, Metal, Windows or a 2-core machine. Every published figure is 4 × Intel Xeon @ 2.10 GHz, CPU only.",
    pattern: /\b(?:apple[-\s]silicon|metal|windows|(?:2|two)[-\s]core)\b/giu,
    needs: /\b(?:p50|p95|latency|milliseconds?|ms|tokens\/s|tok\/s|throughput|faster|fastest|speedup|benchmarked|measured|timed|runs at)\b/iu,
    allowedWhen: ["denied", "planned", "sourced"],
  },
];

const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

// Findings the scanner raises about waivers themselves. They are not rules — nothing in a
// document can match them — but they read the same way in the output and count the same
// way towards the exit status.
export const WAIVER_FINDINGS = {
  noReason: {
    id: "waiver/no-reason",
    why: "A waiver has to say why the use is legitimate. An exemption nobody can review is worse than the phrase it hides.",
  },
  unknownRule: {
    id: "waiver/unknown-rule",
    why: "This waiver names a rule that does not exist, so it exempts nothing. Check the id against --rules.",
  },
};

// ---------------------------------------------------------------------------
// Masking. Every masker returns a string of exactly the same length as its input, with
// the spans that are quoting rather than claiming replaced by spaces. Offsets survive, so
// a match found in the masked text has the line and column it has in the file.
// ---------------------------------------------------------------------------

function blank(units, start, end) {
  for (let i = start; i < end && i < units.length; i += 1) {
    if (units[i] !== "\n") units[i] = " ";
  }
}

// Fenced code blocks, ``` or ~~~, indented up to three spaces, closed by a fence of the
// same character and at least the same length with nothing after it. The fence lines go
// too: ```bash is not prose either.
export function maskFences(text) {
  const units = text.split("");
  const lines = text.split("\n");
  let offset = 0;
  let fence = null;
  for (const line of lines) {
    const indented = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence === null) {
      if (indented) {
        fence = { char: indented[1][0], length: indented[1].length };
        blank(units, offset, offset + line.length);
      }
    } else {
      blank(units, offset, offset + line.length);
      const closes = indented
        && indented[1][0] === fence.char
        && indented[1].length >= fence.length
        && indented[2].trim() === "";
      if (closes) fence = null;
    }
    offset += line.length + 1;
  }
  return units.join("");
}

export function maskHtmlComments(text) {
  const units = text.split("");
  for (const match of text.matchAll(/<!--[\s\S]*?-->/gu)) {
    blank(units, match.index, match.index + match[0].length);
  }
  return units.join("");
}

// Paragraph spans, so an unbalanced backtick cannot swallow the rest of the document.
// CommonMark bounds a code span to one paragraph too.
function paragraphs(text) {
  const spans = [];
  let start = 0;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      if (offset > start) spans.push([start, offset]);
      start = offset + line.length + 1;
    }
    offset += line.length + 1;
  }
  if (offset > start) spans.push([start, Math.min(offset, text.length)]);
  return spans;
}

// Inline code spans: a run of N backticks closes on the next run of exactly N. An opener
// with no closer is literal text, which is what CommonMark says and what `!` in
// "Finish a sentence with `.`, `!` or `?`" depends on.
export function maskCodeSpans(text) {
  const units = text.split("");
  for (const [start, end] of paragraphs(text)) {
    let i = start;
    while (i < end) {
      if (text[i] !== "`") { i += 1; continue; }
      let run = 0;
      while (i + run < end && text[i + run] === "`") run += 1;
      let j = i + run;
      let close = -1;
      while (j < end) {
        if (text[j] !== "`") { j += 1; continue; }
        let k = 0;
        while (j + k < end && text[j + k] === "`") k += 1;
        if (k === run) { close = j; break; }
        j += k;
      }
      if (close === -1) { i += run; continue; }
      blank(units, i, close + run);
      i = close + run;
    }
  }
  return units.join("");
}

// Link destinations, reference definitions, autolinks and bare URLs. The link TEXT stays:
// a boast in the words a reader clicks is still a boast.
export function maskLinks(text) {
  const units = text.split("");
  for (const match of text.matchAll(/\]\(\s*(<[^>]*>|[^)\s]*)/gu)) {
    const at = match.index + match[0].length - match[1].length;
    blank(units, at, at + match[1].length);
  }
  for (const match of text.matchAll(/^ {0,3}\[[^\]\n]*\]:[ \t]*(\S+)/gmu)) {
    const at = match.index + match[0].length - match[1].length;
    blank(units, at, at + match[1].length);
  }
  const masked = units.join("");
  for (const match of masked.matchAll(/<(?:https?|mailto):[^>\s]*>|(?:https?:\/\/|www\.)[^\s<>()[\]"'`]+/gu)) {
    blank(units, match.index, match.index + match[0].length);
  }
  return units.join("");
}

// Raw HTML: the tag, its attributes and any declaration (`<!doctype html>`, whose `!` is
// markup and not emphasis) are masked. The text between tags is prose and stays.
export function maskHtmlTags(text) {
  const units = text.split("");
  for (const match of text.matchAll(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|<![^-][^>]*>/gu)) {
    blank(units, match.index, match.index + match[0].length);
  }
  return units.join("");
}

function maskHtmlDocument(text) {
  let masked = maskHtmlComments(text);
  const units = masked.split("");
  for (const match of masked.matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu)) {
    blank(units, match.index, match.index + match[0].length);
  }
  masked = maskHtmlTags(units.join(""));
  return maskLinks(masked);
}

// A JSON file contributes one string: the plugin manifest's description, which is what
// Obsidian shows in its catalogue. Everything else in the file is machinery. The value is
// located by scanning rather than by re-encoding it, so the offsets are the file's own and
// the reported column points at the sentence.
export function maskJsonDescription(text) {
  const units = text.split("");
  blank(units, 0, units.length);
  const key = /"description"\s*:\s*"/u.exec(text);
  if (!key) return units.join("");
  const start = key.index + key[0].length;
  let i = start;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === '"') break;
    i += 1;
  }
  for (let at = start; at < Math.min(i, text.length); at += 1) units[at] = text[at];
  return units.join("");
}

export function maskProse(text, syntax = "markdown") {
  if (syntax === "json") return maskJsonDescription(text);
  if (syntax === "html") return maskHtmlDocument(text);
  let masked = maskFences(text);
  masked = maskHtmlComments(masked);
  masked = maskCodeSpans(masked);
  masked = maskHtmlTags(masked);
  return maskLinks(masked);
}

// ---------------------------------------------------------------------------
// Clauses, positions, waivers.
// ---------------------------------------------------------------------------

// Clause boundaries: a newline, a semicolon, a table cell wall, or a full stop, colon,
// question or exclamation mark followed by space. Requiring the space keeps "1.57 GB" and
// "`data.json`.**" in one piece, and the table wall keeps a roadmap row's plan column from
// corroborating a claim in its description column.
export function clauseSpans(text) {
  const spans = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const wall = c === "\n" || c === ";" || c === "|";
    const stop = (c === "." || c === ":" || c === "?" || c === "!")
      && (i + 1 >= text.length || /\s/u.test(text[i + 1]));
    if (!wall && !stop) continue;
    spans.push([start, i]);
    start = i + 1;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans;
}

function clauseAt(spans, index) {
  for (const span of spans) {
    if (index >= span[0] && index <= span[1]) return span;
  }
  return [index, index];
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function positionOf(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= index) low = mid; else high = mid - 1;
  }
  return { line: low + 1, column: index - starts[low] + 1 };
}

const WAIVER = /<!--\s*forbidden-phrases:\s*allow\b([\s\S]*?)-->/giu;
const WAIVER_BODY = /^\s*([A-Za-z0-9/,\s-]+?)(?:\s*(?:—|–|--|:)\s*|\s+-\s+)(\S[\s\S]*)$/u;

// A waiver covers the line it sits on and the line after it, which is the two placements
// a contributor will reach for: above the sentence, or at its end.
export function readWaivers(text) {
  const starts = lineStarts(text);
  const waivers = [];
  const problems = [];
  for (const match of text.matchAll(WAIVER)) {
    const from = positionOf(starts, match.index);
    const to = positionOf(starts, match.index + match[0].length);
    const body = WAIVER_BODY.exec(match[1]);
    if (!body) {
      problems.push({ finding: WAIVER_FINDINGS.noReason, index: match.index, text: match[0].trim() });
      continue;
    }
    const ids = body[1].split(/[,\s]+/u).filter(Boolean);
    const reason = body[2].trim();
    const unknown = ids.filter((id) => !RULES_BY_ID.has(id));
    if (unknown.length > 0) {
      problems.push({ finding: WAIVER_FINDINGS.unknownRule, index: match.index, text: unknown.join(", ") });
      continue;
    }
    waivers.push({ ids, reason, from: from.line, to: to.line + 1, position: from });
  }
  return { waivers, problems };
}

// ---------------------------------------------------------------------------
// The scan.
// ---------------------------------------------------------------------------

export function scanText(text, { file = "<text>", syntax = "markdown", rules = RULES } = {}) {
  const masked = maskProse(text, syntax);
  const starts = lineStarts(text);
  const spans = clauseSpans(masked);
  const { waivers, problems } = readWaivers(text);
  const findings = [];
  const waived = [];

  for (const problem of problems) {
    const at = positionOf(starts, problem.index);
    findings.push({
      file,
      line: at.line,
      column: at.column,
      rule: problem.finding.id,
      why: problem.finding.why,
      text: problem.text,
    });
  }

  for (const rule of rules) {
    for (const match of masked.matchAll(rule.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const span = clauseAt(spans, start);
      const maskedClause = masked.slice(span[0], span[1]);

      let corroboration = null;
      if (rule.needs) {
        const evidence = rule.needs.exec(
          maskedClause.slice(0, start - span[0]) + " " + maskedClause.slice(end - span[0]));
        if (!evidence) continue;
        corroboration = evidence[0].trim();
      }

      // Guards read the ORIGINAL clause, so a source named in backticks still counts, and
      // they read it with the match cut out, so a rule cannot excuse itself.
      const originalClause = text.slice(span[0], start) + " " + text.slice(end, span[1]);
      const excused = (rule.allowedWhen ?? []).find((guard) => GUARDS[guard].test(originalClause));
      if (excused) continue;

      const at = positionOf(starts, start);
      const waiver = waivers.find((entry) => entry.ids.includes(rule.id)
        && at.line >= entry.from && at.line <= entry.to);
      const finding = {
        file,
        line: at.line,
        column: at.column,
        rule: rule.id,
        why: rule.why,
        text: text.slice(start, end),
        ...(corroboration ? { with: corroboration } : {}),
      };
      if (waiver) waived.push({ ...finding, reason: waiver.reason });
      else findings.push(finding);
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  return { file, findings, waived };
}

// ---------------------------------------------------------------------------
// Files.
// ---------------------------------------------------------------------------

export function syntaxFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".html" || extension === ".htm") return "html";
  return "markdown";
}

async function isFile(target) {
  try { return (await stat(target)).isFile(); } catch { return false; }
}

async function walk(directory, extensions, recursive) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) found.push(...await walk(full, extensions, recursive));
      continue;
    }
    if (extensions.includes(path.extname(entry.name).toLowerCase())) found.push(full);
  }
  return found;
}

export async function targetFiles(root = ROOT) {
  const files = [];
  for (const segments of NAMED_FILES) {
    const full = path.join(root, ...segments);
    if (await isFile(full)) files.push(full);
  }
  for (const directory of SCANNED_DIRECTORIES) {
    files.push(...await walk(path.join(root, ...directory.segments), directory.extensions, directory.recursive));
  }
  return files;
}

export async function scanFiles(files, root = ROOT) {
  const results = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    results.push(scanText(text, { file: path.relative(root, file) || path.basename(file), syntax: syntaxFor(file) }));
  }
  return {
    ok: results.every((result) => result.findings.length === 0),
    scanned: results.map((result) => result.file),
    findings: results.flatMap((result) => result.findings),
    waived: results.flatMap((result) => result.waived),
  };
}

export async function checkTree(root = ROOT) {
  return scanFiles(await targetFiles(root), root);
}

// ---------------------------------------------------------------------------
// Command line.
// ---------------------------------------------------------------------------

const USAGE = `usage: node tools/forbidden-phrases.mjs [--json] [--rules] [file ...]

  (no arguments)  scan the user-facing text in the tree
  file ...        scan those files instead
  --json          report findings as JSON on stdout
  --rules         print the rules and their reasons

exit: 0 clean, 1 findings, 2 usage error
`;

function report(result) {
  const lines = [];
  for (const finding of result.findings) {
    const where = `${finding.file}:${finding.line}:${finding.column}`;
    const near = finding.with ? ` (with "${finding.with}")` : "";
    lines.push(`${where}  ${finding.rule}  "${finding.text}"${near}`);
    lines.push(`    ${finding.why}`);
  }
  const waived = result.waived.length > 0 ? `, ${result.waived.length} waived` : "";
  lines.push(result.findings.length === 0
    ? `\n${result.scanned.length} files scanned, no findings${waived}`
    : `\n${result.scanned.length} files scanned, ${result.findings.length} findings${waived}`);
  return `${lines.join("\n")}\n`;
}

async function main(argv) {
  const flags = argv.filter((argument) => argument.startsWith("-"));
  const named = argv.filter((argument) => !argument.startsWith("-"));
  const unknown = flags.filter((flag) => !["--json", "--rules", "--help", "-h"].includes(flag));
  if (unknown.length > 0) {
    process.stderr.write(`unknown option ${unknown[0]}\n\n${USAGE}`);
    return 2;
  }
  if (flags.includes("--help") || flags.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (flags.includes("--rules")) {
    for (const rule of [...RULES, ...Object.values(WAIVER_FINDINGS)]) {
      process.stdout.write(`${rule.id}\n    ${rule.why}\n`);
      const guards = rule.allowedWhen ?? [];
      if (guards.length > 0) {
        process.stdout.write(`    allowed when ${guards.map((guard) => GUARD_LABELS[guard]).join(", or ")}\n`);
      }
    }
    return 0;
  }

  for (const file of named) {
    if (!await isFile(path.resolve(file))) {
      process.stderr.write(`no such file: ${file}\n\n${USAGE}`);
      return 2;
    }
  }

  const files = named.length > 0 ? named.map((file) => path.resolve(file)) : await targetFiles(ROOT);
  const root = named.length > 0 ? process.cwd() : ROOT;
  const result = await scanFiles(files, root);
  process.stdout.write(flags.includes("--json")
    ? `${JSON.stringify(result, null, 2)}\n`
    : report(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 2; });
}
