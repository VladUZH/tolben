// Derives the per-construction flag rate in docs/GRAMMARLY-BEHAVIOUR.md from the corpus,
// so the table in that document is reproducible rather than transcribed.
//
//   node tools/grammarly-classes.mjs            # the markdown table, ready to paste
//   node tools/grammarly-classes.mjs --check    # exit 1 if the document disagrees
//
// The corpus is bench/corpus/grammarly-pairs.json: 200 sentences typed into Grammarly's
// editor with every suggestion accepted, 20 construction themes of 10. `changed: true`
// means the sentence came back different. See bench/corpus/THIRD-PARTY.md for what that
// file is and why it is in the repository.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CORPUS = fileURLToPath(new URL("../bench/corpus/grammarly-pairs.json", import.meta.url));
const DOC = fileURLToPath(new URL("../docs/GRAMMARLY-BEHAVIOUR.md", import.meta.url));

// One row per theme, most-flagged first; ties keep the corpus's own theme order so the
// output is stable across runs rather than dependent on sort implementation.
export function classCounts(pairs) {
  const order = [];
  const counts = new Map();
  for (const pair of pairs) {
    if (!counts.has(pair.theme)) { counts.set(pair.theme, { total: 0, changed: 0 }); order.push(pair.theme); }
    const entry = counts.get(pair.theme);
    entry.total += 1;
    if (pair.changed) entry.changed += 1;
  }
  return order
    .map((theme) => ({ theme, ...counts.get(theme) }))
    .sort((a, b) => (b.changed / b.total) - (a.changed / a.total) || order.indexOf(a.theme) - order.indexOf(b.theme));
}

export function renderTable(rows) {
  const lines = ["| Flagged | Construction |", "|---|---|"];
  for (const row of rows) lines.push(`| ${row.changed}/${row.total} | ${row.theme} |`);
  return lines.join("\n");
}

const { pairs, counts } = JSON.parse(await readFile(CORPUS, "utf8"));
const rows = classCounts(pairs);
const table = renderTable(rows);

if (process.argv.includes("--check")) {
  // Emphasis markers are the document's business, not the data's: the rows the document
  // bolds (the two safety themes) must still match, so `*` is stripped before comparing.
  const doc = (await readFile(DOC, "utf8")).replace(/\*/gu, "");
  const missing = rows.filter((row) => !doc.includes(`| ${row.changed}/${row.total} | ${row.theme} |`));
  if (missing.length > 0) {
    process.stderr.write(`docs/GRAMMARLY-BEHAVIOUR.md is out of date. Missing rows:\n${renderTable(missing)}\n`);
    process.exit(1);
  }
  process.stdout.write(`docs/GRAMMARLY-BEHAVIOUR.md matches the corpus: ${rows.length} themes.\n`);
} else {
  const changed = rows.reduce((sum, row) => sum + row.changed, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  process.stdout.write(`${table}\n\n${changed} of ${total} sentences came back changed`);
  process.stdout.write(counts ? ` (the corpus records ${counts.changed}/${counts.total}).\n` : ".\n");
}
