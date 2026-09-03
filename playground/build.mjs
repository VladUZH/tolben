// Builds the gate playground: one page a sceptical reader can open, with no install and
// no network call, to satisfy themselves that the safety gate does what Tolben claims.
//
// Two halves, and the second is the one that matters.
//
// The BUNDLE is thin. Every module under src/ imports only relative paths and no Node
// builtins, so the deterministic core — mechanics, the clarity rules, the safety gate,
// the diff — runs in a browser unmodified. The page therefore runs the SHIPPING code, not
// a reimplementation of it; a copy would drift, and a playground that agrees with a
// drifted copy proves nothing about the product.
//
// The DATA is generated here, from the repository's own corpora and results, so that no
// figure on the page was typed by hand. examples.json comes out of bench/corpus, and
// carries no expected verdict: the page computes every verdict live and is free to
// disagree with the labelling in this file. replay.json, ledger.json and meta.json are
// read out of bench/results, src/safety.mjs and the two manifests, and every number they
// carry is traceable to a file named in meta.json.
//
// The model tiers do not run in the browser, because there is no model in a browser.
// Everything the page shows is either deterministic or a recorded artefact.
//
// Usage:
//   node playground/build.mjs              build into playground/dist
//   node playground/build.mjs --dev        the same, unminified, for reading the output
//   node playground/build.mjs --data-only  regenerate dist/data/ alone; no bundle, no copy
//   node playground/build.mjs --check      build into a temporary directory and prove the
//                                          output cannot make a third-party request
//   node playground/build.mjs --out DIR    write somewhere other than playground/dist
//
// --check is the enforcement of a product claim. "No analytics, no trackers, no external
// fonts, no CDN, works offline" is not something to assert in prose next to a page that
// nobody re-reads; it is a property of the built bytes, and this script fails the build
// when the bytes stop having it. .github/workflows/pages.yml runs --check before it
// deploys, so a page that would phone home never reaches Pages.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The canonical reason list, imported rather than transcribed: a reason added to the gate
// and not to a copy of the list here would otherwise vanish from the ledger, and the
// ledger would overstate what the gate covers.
import { REJECTION_REASONS } from "../src/safety.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(here, "..");
const repoPath = (...parts) => path.join(repoRoot, ...parts);
// Repository-relative, forward-slashed, so the provenance in meta.json reads the same on
// every platform and can be pasted straight into a `cat`. A path outside the repository —
// the temporary directory --check builds into — is left absolute rather than turned into a
// ladder of `../`.
const rel = (absolute) => {
  const relative = path.relative(repoRoot, absolute);
  return relative.startsWith("..") ? absolute : relative.split(path.sep).join("/");
};

// ---------------------------------------------------------------------------------------
// Which recorded runs the page replays
// ---------------------------------------------------------------------------------------

// The sealed holdout runs are the honest evidence: each was recorded against a corpus the
// prompt had never been tuned on. dev-closing is the development partition as it stood at
// the end, included because it is the only run carrying the rule and grammar tiers as
// well, and the only one that records what the MODEL proposed separately from what
// finally surfaced.
const EXTRA_RUNS = ["dev-closing-qwen3.5-2b-cpu.json"];

// Around four hundred rows loads immediately on a phone; the whole set is 485 and the
// difference is not worth the wait. Truncation is recorded in the file itself — see
// buildReplay — because a silently shortened table misrepresents the evidence it is
// showing.
const REPLAY_ROW_CAP = 400;

// ---------------------------------------------------------------------------------------
// The eight pre-loaded pairs
// ---------------------------------------------------------------------------------------

// Chosen to cover, in order: an ordinary edit that should reach the writer; a lost
// qualifier; a moved deadline; a changed quantity; swapped roles; a dropped negation; a
// deletion of the kind the verifier tier exists for; and one case that looks like a
// refusal and is not.
//
// Only the id, the title and the teaching line live here. The sentences themselves are
// read out of bench/corpus/torture.json at build time, and the corpus's own `expect` and
// `reason` labels are deliberately NOT copied into the output: the page runs the real
// gate against these pairs in the reader's browser and must be free to return a verdict
// that contradicts the label. A pre-baked verdict would make the demonstration circular.
const EXAMPLES = [
  {
    id: "t56",
    title: "An ordinary clarity edit",
    teaches:
      "A nominalisation unpacked into its verb: the same facts, in the same order, in fewer words. This is the shape of edit the product exists to make, so it is the control on everything else on this page.",
  },
  {
    id: "t24",
    title: "A qualifier goes missing",
    teaches:
      "One word separates an exclusive permission from a permission. Nothing else in the sentence moves, so this turns entirely on whether a guard reads 'only' as content.",
  },
  {
    id: "t51",
    title: "A deadline moves by a day",
    teaches:
      "'before Thursday' excludes Thursday; 'by Thursday' includes it. No word is deleted and no number changes, so the whole difference is carried by a preposition.",
  },
  {
    id: "t06",
    title: "A floor becomes a point",
    teaches:
      "'More than 40%' is a lower bound; '40%' is a measurement. The digits are identical, so a check that compared only the numbers would find nothing to report.",
  },
  {
    id: "t01",
    title: "Two roles change places",
    teaches:
      "Every word of the original survives into the rewrite, and only who did what to whom has moved. Comparing the two as bags of words cannot see this at all.",
  },
  {
    id: "t41",
    title: "A negation disappears",
    teaches:
      "'must never restart' becomes 'must restart'. The result is shorter and reads more smoothly, which is exactly why a model trained on fluency offers it.",
  },
  {
    id: "t50",
    title: "One half of a pair deleted",
    teaches:
      "A single lost content word is the case the verifier tier exists for — a second model call asking whether the surviving sentence still implies the missing word. A conjunct is one class the 2B verifier was measured getting wrong, so the deletion policy is written to settle it before any model is consulted. There is no model in this page, so what you are watching is that policy on its own.",
  },
  {
    id: "t13",
    title: "A bound that bounds nothing",
    teaches:
      "'more than happy' is the same two words as the bound in the 40% pair above, and underneath them sits a nominalisation worth unpacking. A guard keyed to the words rather than to what they quantify would cost the writer a good edit.",
  },
];

// ---------------------------------------------------------------------------------------
// Reading the repository
// ---------------------------------------------------------------------------------------

async function readJSON(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function sha256Of(absolute) {
  return createHash("sha256").update(await readFile(absolute)).digest("hex");
}

// Everything read out of the repository fails loudly rather than quietly producing a page
// with a hole in it: a missing corpus is a broken build, not a smaller table.
function required(value, what) {
  if (value === undefined || value === null) throw new Error(`playground/build.mjs: could not read ${what}`);
  return value;
}

async function collectRunFiles() {
  const dir = repoPath("bench", "results");
  const entries = await readdir(dir);
  // -sealed and -pinned are the naming this repository gives a run recorded against a
  // corpus the prompt was not tuned on, and against pinned artefacts. Whichever of the two
  // exist are preferred; there are no -pinned runs today, and the glob is here so that the
  // page picks them up on the day there are.
  const sealed = entries.filter((name) => /-(sealed|pinned)\.json$/.test(name)).sort();
  const extra = EXTRA_RUNS.filter((name) => entries.includes(name));
  const missing = EXTRA_RUNS.filter((name) => !entries.includes(name));
  if (missing.length) throw new Error(`playground/build.mjs: bench/results/ is missing ${missing.join(", ")}`);
  if (!sealed.length) throw new Error("playground/build.mjs: no sealed runs in bench/results/");
  return [...sealed, ...extra].map((name) => ({
    name: name.replace(/\.json$/, ""),
    file: repoPath("bench", "results", name),
  }));
}

// One row of a recorded run, reduced to what the page shows. The recorded schema grew over
// the runs — the three oldest sealed runs have no `rejectedText`, and only dev-closing
// separates `modelRejection` from `rejection` — so every field that may be absent is
// normalised to null here rather than left for the page to guess at.
function normaliseRow(row, runName) {
  const stages = row.stages ?? {};
  const stage = ["mechanics", "rule", "grammar", "model"].find((name) => stages[name]) ?? null;
  // `modelRejection` is the gate's verdict on the model's rewrite; `rejection` is "this
  // sentence got nothing at all". They differ only when a mechanical or rule repair
  // surfaced despite the model's rewrite being refused. Older runs record the second
  // alone, so the first is preferred and the second is the fallback.
  const rejection = row.modelRejection ?? row.rejection ?? null;
  const surfacedText = row.surfaced ? (row.replacement || null) : null;
  // What the model proposed, where the recording lets us know it: the refused text when
  // the gate refused, and the surfaced text when the surfacing stage was the model.
  const proposed = row.rejectedText ?? (stages.model && row.replacement ? row.replacement : null);
  return {
    id: row.id,
    run: runName,
    issueClass: row.issueClass ?? null,
    source: row.source,
    proposed,
    surfaced: surfacedText,
    outcome: row.surfaced ? "surfaced" : rejection ? "refused" : "quiet",
    rejection,
    stage,
    lostWords: row.lostWords ?? null,
    verifierReason: row.verifierReason ?? null,
    milliseconds: typeof row.milliseconds === "number" ? row.milliseconds : null,
  };
}

async function loadRuns() {
  const files = await collectRunFiles();
  const runs = [];
  for (const { name, file } of files) {
    const raw = await readJSON(file);
    const rows = required(raw.rows, `rows in ${rel(file)}`).map((row) => normaliseRow(row, name));
    const counted = { surfaced: 0, refused: 0, quiet: 0 };
    for (const row of rows) counted[row.outcome] += 1;
    runs.push({
      name,
      file,
      path: rel(file),
      corpusName: raw.corpusName ?? null,
      corpusSHA256: raw.corpusSHA256 ?? null,
      promptSHA256: raw.promptSHA256 ?? null,
      generatedAtUTC: raw.generatedAtUTC ?? null,
      model: raw.model?.id ?? null,
      options: raw.options ?? null,
      runtime: raw.runtime ?? null,
      // Said plainly rather than left for the page to infer from a column of nulls: the
      // three oldest sealed runs recorded THAT a rewrite was refused without recording the
      // text that was refused, so their refused rows carry no `proposed`.
      refusedWithProposedText: rows.filter((row) => row.outcome === "refused" && row.proposed).length,
      sha256: await sha256Of(file),
      bytes: (await stat(file)).size,
      total: rows.length,
      ...counted,
      rows,
    });
  }
  return runs;
}

// ---------------------------------------------------------------------------------------
// examples.json
// ---------------------------------------------------------------------------------------

async function buildExamples() {
  const file = repoPath("bench", "corpus", "torture.json");
  const corpus = await readJSON(file);
  const byId = new Map(corpus.pairs.map((pair) => [pair.id, pair]));
  const examples = EXAMPLES.map(({ id, title, teaches }) => {
    const pair = byId.get(id);
    if (!pair) throw new Error(`playground/build.mjs: ${rel(file)} has no pair ${id}`);
    return {
      id,
      title,
      original: pair.source,
      rewrite: pair.replacement,
      teaches,
      // The corpus's family label, which is a description of the pair rather than a
      // verdict on it. `expect` and `reason` are deliberately left behind.
      family: pair.class,
      // An input to the gate, not an expectation of it: the writer's protected terms.
      protectedTerms: pair.protectedTerms ?? [],
    };
  });
  return {
    schemaVersion: 1,
    source: rel(file),
    sourceSHA256: await sha256Of(file),
    note:
      "The eight pre-loaded pairs, taken verbatim from the torture corpus. No expected verdict is shipped with them: the page runs the real gate in your browser and prints whatever it returns, including a verdict that contradicts the description above it.",
    corpus: {
      name: corpus.name,
      description: corpus.description,
      policy: corpus.policy,
      counts: corpus.counts,
    },
    examples,
  };
}

// ---------------------------------------------------------------------------------------
// replay.json
// ---------------------------------------------------------------------------------------

function selectReplayRows(runs, cap) {
  const evidence = [];
  const quiet = new Map();
  for (const run of runs) {
    quiet.set(run.name, []);
    for (const row of run.rows) {
      if (row.outcome === "quiet") quiet.get(run.name).push(row);
      else evidence.push(row);
    }
  }
  if (evidence.length >= cap) {
    // Not reachable with the runs in the repository today, and left explicit rather than
    // silently dropping evidence if it ever is.
    throw new Error(
      `playground/build.mjs: ${evidence.length} rows carry evidence, which is more than the cap of ${cap}; raise REPLAY_ROW_CAP rather than dropping any of them`,
    );
  }
  // Fill the remaining slots round-robin so that no run is over-represented among the
  // rows where the pipeline offered nothing.
  const fill = [];
  const queues = [...quiet.values()];
  let index = 0;
  while (evidence.length + fill.length < cap && queues.some((queue) => queue.length)) {
    const queue = queues[index % queues.length];
    if (queue.length) fill.push(queue.shift());
    index += 1;
  }
  const kept = new Set([...evidence, ...fill]);
  // Emitted in run order and then in the original file order, so a reader comparing the
  // table against bench/results/ reads down the same sequence.
  return runs.flatMap((run) => run.rows.filter((row) => kept.has(row)));
}

function buildReplay(runs) {
  const rows = selectReplayRows(runs, REPLAY_ROW_CAP);
  const totals = { rows: 0, surfaced: 0, refused: 0, quiet: 0 };
  for (const run of runs) {
    totals.rows += run.total;
    totals.surfaced += run.surfaced;
    totals.refused += run.refused;
    totals.quiet += run.quiet;
  }
  const includedPerRun = new Map(runs.map((run) => [run.name, 0]));
  for (const row of rows) includedPerRun.set(row.run, includedPerRun.get(row.run) + 1);

  return {
    schemaVersion: 1,
    note:
      "Every proposal the model made in the recorded runs below, with what the gate did about it. These are recordings, not live inference: there is no model in this page.",
    fields: {
      id: "the row id in the recorded run",
      run: "which recorded run this row came from; see `runs`",
      issueClass: "the corpus's label for what is wrong with the source sentence",
      source: "the writer's sentence, as the pipeline received it",
      proposed: "the model's proposed replacement, or null where the run did not record it",
      surfaced: "the text that reached the writer, or null when nothing did",
      outcome: "surfaced | refused | quiet — quiet means the model kept the sentence and nothing was proposed",
      rejection: "the gate's reason for refusing the model's rewrite, or null",
      stage: "which tier produced what surfaced: mechanics | rule | grammar | model",
      lostWords: "content words the rewrite dropped, where the run recorded them",
      verifierReason: "what the verifier said, where it was consulted",
      milliseconds: "wall-clock time for the row in the recorded run",
    },
    totals,
    // The counts above and everything in ledger.json are computed over ALL the recorded
    // rows. Only this table is shortened.
    truncated:
      rows.length < totals.rows
        ? {
            shown: rows.length,
            total: totals.rows,
            dropped: totals.rows - rows.length,
            scope: "this table only",
            policy:
              "Every row where something surfaced or something was refused is kept — that is the evidence. The remaining slots are filled with rows where the model kept the sentence, taken in file order and round-robin across the runs so no run is over-represented. The totals in this file, and every count in ledger.json, are computed over all the recorded rows rather than over the rows kept here.",
          }
        : null,
    runs: runs.map((run) => ({
      name: run.name,
      file: run.path,
      sha256: run.sha256,
      corpusName: run.corpusName,
      corpusSHA256: run.corpusSHA256,
      promptSHA256: run.promptSHA256,
      generatedAtUTC: run.generatedAtUTC,
      model: run.model,
      options: run.options,
      runtime: run.runtime,
      refusedWithProposedText: run.refusedWithProposedText,
      total: run.total,
      shown: includedPerRun.get(run.name),
      surfaced: run.surfaced,
      refused: run.refused,
      quiet: run.quiet,
    })),
    rows,
  };
}

// ---------------------------------------------------------------------------------------
// ledger.json
// ---------------------------------------------------------------------------------------

const LEDGER_EXAMPLES = 3;

// REJECTION_REASONS is the validator's list, and it is not quite the whole set of answers a
// writer can get: the deletion policy in src/pipeline.mjs refuses under names of its own.
// Those are read out of the pipeline rather than transcribed, for the same reason the
// canonical list is imported — so that a reason added there cannot go missing from here.
async function pipelineRaisedReasons() {
  const file = repoPath("src", "pipeline.mjs");
  const source = await readFile(file, "utf8");
  return [...source.matchAll(/\brefuse\(\s*"([a-z-]+)"/gu)].map((match) => match[1]);
}

function buildLedger(runs, pipelineReasons) {
  const counts = new Map();
  const perRun = new Map();
  const candidates = new Map();
  let rejections = 0;
  let rows = 0;

  // Everything a writer can be refused under starts at zero, so that a reason which never
  // fired is visible as a gap in the evidence rather than absent from the page.
  for (const reason of [...REJECTION_REASONS, ...pipelineReasons]) {
    counts.set(reason, 0);
    perRun.set(reason, {});
    candidates.set(reason, []);
  }
  for (const run of runs) {
    for (const row of run.rows) {
      rows += 1;
      if (!row.rejection) continue;
      rejections += 1;
      const reason = row.rejection;
      if (!counts.has(reason)) {
        counts.set(reason, 0);
        perRun.set(reason, {});
        candidates.set(reason, []);
      }
      counts.set(reason, counts.get(reason) + 1);
      const seenIn = perRun.get(reason);
      seenIn[row.run] = (seenIn[row.run] ?? 0) + 1;
      candidates.get(reason).push(row);
    }
  }

  // A refusal is only worth reading beside the text that was refused, and the three oldest
  // sealed runs did not record it. Rows that carry the refused text are therefore shown
  // first; a reason seen only in those older runs still gets its examples, with `proposed`
  // null and the run named so a reader can see why.
  const examples = new Map(
    [...candidates].map(([reason, rows_]) => [
      reason,
      [...rows_.filter((row) => row.proposed), ...rows_.filter((row) => !row.proposed)]
        .slice(0, LEDGER_EXAMPLES)
        .map((row) => ({
          id: row.id,
          run: row.run,
          source: row.source,
          proposed: row.proposed,
          lostWords: row.lostWords,
        })),
    ]),
  );

  const canonical = new Set(REJECTION_REASONS);
  const fromPipeline = new Set(pipelineReasons);
  const raisedBy = (reason) => (canonical.has(reason) ? "safety" : fromPipeline.has(reason) ? "pipeline" : "recorded-only");

  // The canonical list first, in the order src/safety.mjs writes it; then the pipeline's
  // own names; then anything the recordings carry that neither list names — an older
  // spelling from before a rename, most likely, which is listed as recorded rather than
  // folded into its successor, because the file it came from still says what it says.
  const rank = { safety: 0, pipeline: 1, "recorded-only": 2 };
  const order = [
    ...REJECTION_REASONS,
    ...[...counts.keys()].filter((reason) => !canonical.has(reason)).sort((a, b) => rank[raisedBy(a)] - rank[raisedBy(b)] || a.localeCompare(b)),
  ];
  const reasons = order.map((reason) => ({
    reason,
    canonical: canonical.has(reason),
    raisedBy: raisedBy(reason),
    count: counts.get(reason),
    runs: perRun.get(reason),
    examples: examples.get(reason),
  }));

  return {
    schemaVersion: 1,
    note:
      "Every reason a rewrite can be refused under, with how often it fired across the recorded runs. A reason that never fired is listed with a count of zero rather than omitted: leaving it out would make the gate look better covered by this evidence than it is. Counts are over all the recorded rows, including any the replay table shortens away.",
    sources: {
      safety: "src/safety.mjs — REJECTION_REASONS, the validator's list",
      pipeline: "src/pipeline.mjs — the names the deletion policy and the verifier tier refuse under",
      "recorded-only": "neither list names it: a label a recorded run carries from before a rename",
    },
    scope: {
      runs: runs.map((run) => run.name),
      rows,
      rejections,
      reasonsListed: reasons.length,
      reasonsFired: reasons.filter((entry) => entry.count > 0).length,
      reasonsSilent: reasons.filter((entry) => entry.count === 0).length,
      nonCanonicalObserved: reasons
        .filter((entry) => !entry.canonical && entry.count > 0)
        .map((entry) => ({ reason: entry.reason, raisedBy: entry.raisedBy })),
    },
    reasons,
  };
}

// ---------------------------------------------------------------------------------------
// meta.json
// ---------------------------------------------------------------------------------------

// The suite and control figures are read out of REPORT.md, which is an append-only
// engineering log: the LAST line that states a figure is the current one. Each is
// returned with the line number and the line itself, so a reader who doubts the number on
// the page can open the file at that line and see it. A figure that cannot be found fails
// the build rather than being guessed at.
function lastMatch(lines, test) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const found = test(lines[index].replace(/\*/gu, ""), index);
    if (found) return { line: index + 1, text: lines[index].trim(), ...found };
  }
  return null;
}

async function readSuiteFigures() {
  const reportFile = repoPath("REPORT.md");
  const readmeFile = repoPath("README.md");
  const report = (await readFile(reportFile, "utf8")).split("\n");
  const readme = (await readFile(readmeFile, "utf8")).split("\n");

  const suite = required(
    lastMatch(report, (line) => {
      const m = line.match(
        /(\d+)\s+tests,\s*(\d+)\s+pass(?:,\s*(\d+)\s+fail)?(?:,\s*(\d+)\s+skipped[^,|]*)?(?:,\s*(\d+)\s+todo)?/u,
      );
      if (!m) return null;
      const n = (value) => (value === undefined ? null : Number(value));
      return { tests: Number(m[1]), pass: Number(m[2]), fail: n(m[3]), skipped: n(m[4]), todo: n(m[5]) };
    }),
    "the suite figures in REPORT.md",
  );

  const oracle = required(
    lastMatch(report, (line) => {
      if (!/^\|\s*Oracle\b/u.test(line)) return null;
      const m = line.match(/(\d+)\s*\/\s*(\d+)/u);
      return m ? { accepted: Number(m[1]), of: Number(m[2]) } : null;
    }),
    "the oracle ceiling in REPORT.md",
  );

  const precision = required(
    lastMatch(report, (line) => (/^\|\s*Precision\b/u.test(line) ? {} : null)),
    "the precision control in REPORT.md",
  );

  const readmeSuite = required(
    lastMatch(readme, (line) => {
      const m = line.match(/#\s*(\d+)\s+tests/u);
      return m ? { tests: Number(m[1]) } : null;
    }),
    "the suite figure in README.md",
  );

  return {
    suite: { ...suite, source: rel(reportFile) },
    oracleCeiling: { ...oracle, source: rel(reportFile) },
    precisionAndUnlockControls: { ...precision, source: rel(reportFile) },
    readmeSuite: { ...readmeSuite, source: rel(readmeFile) },
  };
}

// The commit the page was built from, read straight out of .git rather than by spawning
// git, so the build has no dependency beyond esbuild and degrades to null in a checkout
// that is not a repository (a source tarball, for instance).
async function readHeadCommit() {
  try {
    const head = (await readFile(repoPath(".git", "HEAD"), "utf8")).trim();
    if (!head.startsWith("ref:")) return /^[0-9a-f]{40}$/u.test(head) ? head : null;
    const ref = head.slice(4).trim();
    const file = repoPath(".git", ...ref.split("/"));
    if (!existsSync(file)) return null;
    const sha = (await readFile(file, "utf8")).trim();
    return /^[0-9a-f]{40}$/u.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

async function buildMeta(runs, replay, ledger, examples) {
  const runtimeFile = repoPath("obsidian-plugin", "runtime", "manifest.json");
  const modelsFile = repoPath("models", "MANIFEST.json");
  const runtime = await readJSON(runtimeFile);
  const models = await readJSON(modelsFile);

  const measured = required(
    runtime.models.find((entry) => entry.measured),
    `the measured model in ${rel(runtimeFile)}`,
  );
  const pinnedWeights = required(
    models.artifacts.find((entry) => entry.sha256 === measured.sha256),
    `the measured model in ${rel(modelsFile)}`,
  );

  const baselineFiles = {
    precision: repoPath("bench", "corpus", "precision-baseline.json"),
    refusal: repoPath("bench", "corpus", "refusal-baseline.json"),
    oracleLabels: repoPath("bench", "corpus", "oracle-labels.json"),
  };
  const precisionBaseline = await readJSON(baselineFiles.precision);
  const refusalBaseline = await readJSON(baselineFiles.refusal);
  const oracleLabels = await readJSON(baselineFiles.oracleLabels);

  const figures = await readSuiteFigures();

  return {
    schemaVersion: 1,
    product: "Tolben",
    builtAtUTC: new Date().toISOString(),
    commit: await readHeadCommit(),
    note:
      "Provenance for everything on this page. Every figure here was read out of the file named beside it at build time; none was typed into the build script.",

    // What the page ran to produce the replay and the ledger.
    results: runs.map((run) => ({
      name: run.name,
      file: run.path,
      sha256: run.sha256,
      bytes: run.bytes,
      corpusName: run.corpusName,
      generatedAtUTC: run.generatedAtUTC,
      rows: run.total,
      contributedToReplay: replay.runs.find((entry) => entry.name === run.name).shown,
      contributedToLedger: run.total,
      surfaced: run.surfaced,
      refused: run.refused,
      quiet: run.quiet,
    })),

    corpora: [
      {
        name: examples.corpus.name,
        file: examples.source,
        sha256: examples.sourceSHA256,
        counts: examples.corpus.counts,
        used: `${examples.examples.length} pairs pre-loaded into the checker`,
      },
    ],

    model: {
      id: measured.id,
      file: measured.file,
      bytes: measured.bytes,
      sha256: measured.sha256,
      licence: measured.licence,
      role: measured.role,
      sources: measured.sources,
      pinnedIn: [rel(runtimeFile), rel(modelsFile)],
      pinnedOn: runtime.pinned,
      weightsPinnedOn: models.pinned,
      weightsRepo: pinnedWeights.repo,
    },

    runtime: {
      repo: runtime.runtimeRepo,
      tag: runtime.runtimeTag,
      pinnedOn: runtime.pinned,
      source: rel(runtimeFile),
      assets: runtime.runtimes.map((entry) => ({
        id: entry.id,
        asset: entry.asset,
        bytes: entry.bytes,
        sha256: entry.sha256,
      })),
    },

    figures,

    baselines: {
      precision: {
        file: rel(baselineFiles.precision),
        snapshot: precisionBaseline.snapshot,
        count: precisionBaseline.count,
      },
      refusal: {
        file: rel(baselineFiles.refusal),
        snapshot: refusalBaseline.snapshot,
        count: refusalBaseline.count,
      },
      oracleLabels: {
        file: rel(baselineFiles.oracleLabels),
        labelled: oracleLabels.labelled,
        counts: oracleLabels.counts,
      },
    },

    gate: {
      reasonsListed: ledger.scope.reasonsListed,
      reasonsFired: ledger.scope.reasonsFired,
      rejections: ledger.scope.rejections,
      rowsReplayed: replay.totals.rows,
      sources: ledger.sources,
    },
  };
}

// ---------------------------------------------------------------------------------------
// The three build stages
// ---------------------------------------------------------------------------------------

async function generateData(outDir) {
  const dataDir = path.join(outDir, "data");
  await mkdir(dataDir, { recursive: true });

  const runs = await loadRuns();
  const examples = await buildExamples();
  const replay = buildReplay(runs);
  const ledger = buildLedger(runs, await pipelineRaisedReasons());
  const meta = await buildMeta(runs, replay, ledger, examples);

  const written = [];
  for (const [name, value] of [
    ["examples.json", examples],
    ["replay.json", replay],
    ["ledger.json", ledger],
    ["meta.json", meta],
  ]) {
    const file = path.join(dataDir, name);
    await writeFile(file, `${JSON.stringify(value, null, 1)}\n`);
    written.push({ name, bytes: (await stat(file)).size });
  }
  return { written, runs, examples, replay, ledger, meta };
}

// The browser entry point. The playground is a page, not a plugin, so nothing is external:
// the whole deterministic core is bundled in, which is the point — the reader is running
// src/, not a description of it.
export function bundleOptions({ outDir, minify }) {
  return {
    entryPoints: [path.join(here, "src", "main.js")],
    outfile: path.join(outDir, "app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    // Modern browsers only. The page is a launch artefact opened this year, and the cost
    // of down-levelling is a larger bundle for nobody.
    target: ["es2022", "chrome111", "firefox115", "safari16.4"],
    minify,
    // External, so the deployed page ships readable sources for anyone who wants to check
    // that the bundled gate is the gate in src/. The reference esbuild writes is relative.
    sourcemap: true,
    logLevel: "info",
    // The same loader the plugin build uses: the prompt files travel inside the bundle
    // rather than being read off a path that can break.
    loader: { ".txt": "text" },
  };
}

async function bundle(outDir, { minify }) {
  const entry = path.join(here, "src", "main.js");
  if (!existsSync(entry)) {
    throw new Error(
      `playground/build.mjs: no browser entry point at ${rel(entry)}. Run with --data-only to regenerate dist/data alone.`,
    );
  }
  await mkdir(outDir, { recursive: true });
  await build(bundleOptions({ outDir, minify }));
}

const STATIC_FILES = ["index.html", "styles.css"];

async function copyStatic(outDir) {
  await mkdir(outDir, { recursive: true });
  for (const name of STATIC_FILES) {
    const from = path.join(here, name);
    if (!existsSync(from)) throw new Error(`playground/build.mjs: ${rel(from)} does not exist`);
    await writeFile(path.join(outDir, name), await readFile(from));
  }
}

// ---------------------------------------------------------------------------------------
// --check: the no-third-party-request claim, enforced against the built bytes
// ---------------------------------------------------------------------------------------

// The rule applied to markup, styles and script is the strict one: an absolute http(s) URL
// may not appear at all. Not "may not appear in a src attribute" — may not appear. A URL in
// a comment survives into a readable build, a URL in a string is one assignment away from
// an href, and the difference is not worth the argument. Anything the page wants to SHOW a
// reader (the Hugging Face URL the weights come from, say) belongs in the generated data,
// which is text the page renders and cannot itself fetch.
//
// The single exception is a loopback address. src/engine.mjs carries
// http://127.0.0.1:8080/v1 as the default llama-server endpoint, and a loopback literal
// cannot reach a third party by construction. Every one found is listed in the report
// rather than passed over in silence.
const ABSOLUTE_URL = /https?:\/\/[^\s"'`)<>\]}\\]+/giu;
const PROTOCOL_RELATIVE =
  /(?:\b(?:src|href|action|formaction|poster|data|srcset|imagesrcset|xlink:href)\s*=\s*["']?|url\(\s*["']?|@import\s+["'])\/\//giu;
const LOOPBACK = /^(?:127\.\d+\.\d+\.\d+|localhost|\[::1\]|::1)(?::\d+)?$/u;

// Only to make a violation report say WHY the URL is a request rather than a mention. The
// verdict does not depend on it.
const REQUEST_POSITION = [
  [/(?:\bsrc|\bhref|\baction|\bformaction|\bposter|\bsrcset|\bimagesrcset|xlink:href)\s*=\s*["']?$/iu, "a src/href attribute"],
  [/url\(\s*["']?$/iu, "a CSS url()"],
  [/@import\s+["']?$/iu, "a CSS @import"],
  [/(?:fetch|importScripts|sendBeacon|open|connect)\s*\(\s*["'`]$/iu, "a fetch or request call"],
  [/new\s+(?:URL|WebSocket|EventSource|Worker|Request)\s*\(\s*["'`]$/iu, "a URL, socket or worker constructor"],
  [/import\s*\(\s*["'`]$/u, "a dynamic import"],
];

function scanText(text, file) {
  const violations = [];
  const loopback = [];
  const lineOf = (index) => text.slice(0, index).split("\n").length;

  for (const match of text.matchAll(ABSOLUTE_URL)) {
    const url = match[0];
    const host = url.replace(/^https?:\/\//iu, "").split(/[/?#]/u)[0];
    const before = text.slice(Math.max(0, match.index - 60), match.index);
    const position = REQUEST_POSITION.find(([pattern]) => pattern.test(before))?.[1] ?? "a literal in the built file";
    const entry = { file, line: lineOf(match.index), url, host, position };
    if (LOOPBACK.test(host)) loopback.push(entry);
    else violations.push(entry);
  }
  for (const match of text.matchAll(PROTOCOL_RELATIVE)) {
    violations.push({
      file,
      line: lineOf(match.index),
      url: text.slice(match.index, match.index + 60).split("\n")[0].trim(),
      host: "(protocol-relative)",
      position: "a protocol-relative reference, which inherits https:// when served",
    });
  }
  return { violations, loopback };
}

async function walk(dir, base = dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(absolute, base)));
    else found.push({ absolute, name: path.relative(base, absolute).split(path.sep).join("/") });
  }
  return found;
}

async function checkOutput(outDir) {
  const files = await walk(outDir);
  // .map is a debugging artefact carrying the full text of src/*.mjs, including the
  // comments that mention example URLs. It is never parsed and never executed, so it is
  // reported on rather than judged.
  const scanned = files.filter((file) => /\.(?:html?|css|js|mjs|svg|webmanifest)$/iu.test(file.name));
  const data = files.filter((file) => /\.json$/iu.test(file.name));

  const violations = [];
  const loopback = [];
  for (const file of scanned) {
    const result = scanText(await readFile(file.absolute, "utf8"), file.name);
    violations.push(...result.violations);
    loopback.push(...result.loopback);
  }

  // Not a verdict: URLs in the generated data are strings the page renders as text, and a
  // page with no fetch of its own cannot turn them into a request. Listed so the report is
  // complete and nothing is hidden behind the word "data".
  const inData = [];
  for (const file of data) {
    for (const match of (await readFile(file.absolute, "utf8")).matchAll(ABSOLUTE_URL)) {
      inData.push({ file: file.name, url: match[0] });
    }
  }

  return { files, scanned, violations, loopback, inData };
}

function reportCheck(report) {
  const out = process.stdout;
  out.write(`\nchecked ${report.scanned.length} of ${report.files.length} built files for external references\n`);
  for (const file of report.scanned) out.write(`  scanned  ${file.name}\n`);
  for (const file of report.files.filter((f) => !report.scanned.includes(f))) out.write(`  skipped  ${file.name} (not markup, styles or script)\n`);

  if (report.loopback.length) {
    out.write(`\n${report.loopback.length} loopback address(es), which cannot reach a third party:\n`);
    for (const entry of report.loopback) out.write(`  ${entry.file}:${entry.line}  ${entry.url}\n`);
  }
  if (report.inData.length) {
    const unique = [...new Set(report.inData.map((entry) => entry.url))];
    out.write(`\n${unique.length} URL(s) appear as text in the generated data, which the page renders and cannot fetch:\n`);
    for (const url of unique) out.write(`  ${url}\n`);
  }
  if (report.violations.length) {
    out.write(`\nFAIL — ${report.violations.length} external reference(s) in the built page:\n`);
    for (const entry of report.violations) {
      out.write(`  ${entry.file}:${entry.line}  ${entry.url}\n      in ${entry.position}\n`);
    }
    out.write(
      "\nThe playground must work with the network off. Inline the asset, or move the URL into the\n" +
        "generated data, where it is text on the page rather than a request from it.\n",
    );
    return false;
  }
  out.write("\nOK — no external reference in the built page. It loads nothing it did not ship with.\n");
  return true;
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

function argument(name) {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

async function main() {
  const check = process.argv.includes("--check");
  const dataOnly = process.argv.includes("--data-only");
  const dev = process.argv.includes("--dev");
  const explicitOut = argument("--out");
  if (check && dataOnly) throw new Error("playground/build.mjs: --check cannot be combined with --data-only");

  // --check builds the DEPLOYED configuration, minified, into a directory it then throws
  // away: checking anything else would be checking bytes nobody will be served.
  const outDir = check
    ? await mkdtemp(path.join(tmpdir(), "tolben-playground-"))
    : path.resolve(repoRoot, explicitOut ?? path.join("playground", "dist"));

  try {
    const { written, replay, ledger, meta } = await generateData(outDir);
    process.stdout.write(`data → ${rel(outDir)}/data\n`);
    for (const file of written) process.stdout.write(`  ${file.name.padEnd(15)} ${file.bytes} bytes\n`);
    process.stdout.write(
      `  ${replay.rows.length} replay rows of ${replay.totals.rows} recorded, ` +
        `${ledger.scope.reasonsFired} of ${ledger.scope.reasonsListed} rejection reasons fired, ` +
        `suite ${meta.figures.suite.tests} tests\n`,
    );

    if (dataOnly) return 0;

    await bundle(outDir, { minify: check ? true : !dev });
    await copyStatic(outDir);
    process.stdout.write(`built → ${rel(outDir)}\n`);

    if (!check) return 0;
    return reportCheck(await checkOutput(outDir)) ? 0 : 1;
  } finally {
    if (check) await rm(outDir, { recursive: true, force: true });
  }
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  try {
    process.exitCode = await main();
  } catch (error) {
    // Every failure this script raises is a sentence a person can act on. The stack behind
    // it is for debugging the build itself, so it is available and not in the way.
    process.stderr.write(`\n${error.message}\n`);
    if (process.env.DEBUG) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  }
}
