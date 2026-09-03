// The gate playground, in the browser.
//
// Every verdict on this page is reached by the shipping code. `analyzeSentence` from
// src/pipeline.mjs is the whole acceptance policy — the validator, then the deletion
// policy, then the verifier tier — so it is what the page calls, rather than a
// transcription of the order those tiers run in. Nothing here re-implements a rule:
// `repairMechanics`, `applyClarityRules`, `explainEdit` and `validateRewrite` all run,
// but they run where the product runs them, inside the pipeline.
//
// The two places the page reaches past `analyzeSentence` are both read-only:
//
//   - The verifier stub. There is no model in a browser, so the checker's engine throws
//     an abort out of `engine.verify`, which the pipeline rethrows. That is not a
//     shortcut: it is the exact point at which the plugin would make its second model
//     call, so catching it is how the page knows a pair was REFERRED rather than decided.
//
//   - The trace table. After a verdict is in, the individual guards are called again to
//     say WHICH of them fired, because "information-dropped" is one label over six
//     different questions. They report on a decision that has already been made by the
//     pipeline; they never make it.

import { analyzeSentence, NEVER_VERIFY } from "../../src/pipeline.mjs";
import {
  REJECTION_REASONS,
  validateRewrite,
  lostContentWords,
  deletesTrailingPhrase,
  dropsConjunct,
  dropsRepeatedWord,
  deadlineNarrowed,
  dropsScopeWord,
} from "../../src/safety.mjs";
import { segmentSentences, isCompleteSentence, trimSegment } from "../../src/segmenter.mjs";
import { changedSourceRanges, inlineDiffParts } from "../../src/diff.mjs";

// ---------------------------------------------------------------------------------------
// Small DOM helpers. No framework, and nothing is ever built by string concatenation:
// every sentence on this page came out of a corpus or out of the reader's own keyboard.
// ---------------------------------------------------------------------------------------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const byId = (id) => document.getElementById(id);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// The hover card and the mark list both show the model's edit the way the plugin's card
// does: kept text plain, deletions struck, insertions marked. The spacing rule is the
// plugin's — no space before punctuation that closes a word, none after a hyphen or an
// opening mark — so that "goods-in" stays one word.
function diffInto(node, source, target) {
  const parts = inlineDiffParts(source, target);
  const pieces = [];
  parts.forEach((part, index) => {
    const previous = index > 0 ? parts[index - 1].text : "";
    const joined = index > 0
      && !/^[,.;:!?)\]}'’”\-/]/u.test(part.text)
      && !/[-(\[{'‘“/]$/u.test(previous);
    if (joined) pieces.push(" ");
    if (part.type === "delete") pieces.push(el("span", { class: "del", text: part.text }));
    else if (part.type === "insert") pieces.push(el("span", { class: "ins", text: part.text }));
    else pieces.push(part.text);
  });
  node.replaceChildren(...pieces);
  return node;
}

// ---------------------------------------------------------------------------------------
// What each refusal name means, in one line.
//
// The names themselves are not written here: REJECTION_REASONS is imported, and a reason
// the gate grows without a line in this table still appears, with its name and a note that
// nobody has described it yet. The alternative — a hand-kept list of reasons — is exactly
// the copy that drifts.
// ---------------------------------------------------------------------------------------

const EXPLAIN = {
  "action-mismatch": "The answer was not a rewrite at all, so there is nothing to offer.",
  "empty": "The rewrite is empty once its whitespace is trimmed.",
  "unchanged": "The rewrite is the writer's own sentence, so it is not a suggestion.",
  "instruction-output": "The rewrite reads as an instruction being obeyed or declined rather than as the writer's sentence.",
  "multiple-sentences": "The rewrite is more than one complete sentence, and a suggestion replaces exactly one.",
  "numbers-changed": "The numbers in the rewrite are not the numbers in the sentence.",
  "protected-token-changed": "Something the writer marked untouchable — inline code, a link's text, a protected term — did not survive with its occurrences intact.",
  "markup-changed": "The markup tokens differ, so the edit reached into the writer's formatting.",
  "name-changed": "A proper name was added, dropped or altered.",
  "certainty-changed": "A hedge or a commitment marker was added, dropped, or moved between groups, so how sure the sentence is has changed.",
  "quantifier-changed": "A quantifier, a bound or an ordinal differs — “only”, “all”, “more than”, “first”.",
  "content-dropped": "The rewrite loses several content words with nothing put back, or drops a connective that headed its own clause.",
  "negation-changed": "The two sentences do not carry the same number of negations, or the same failure verbs.",
  "tense-changed": "The tense differs, and nothing in the sentence marks the change as a repair.",
  "question-changed": "One of the two is a question and the other is not.",
  "terminal-punctuation-changed": "The rewrite does not end in the mark the writer typed.",
  "word-substituted": "A word appears in the rewrite with no antecedent in the sentence to license it.",
  "reason-contradicts-action": "The model said it was keeping the sentence while returning a rewrite of it.",
  "trivial-edit": "The only change is an article, or a respelling with nothing substantive beside it — not worth interrupting a writer for.",
  "excessive-edit": "More than 58% of the tokens across the two sentences differ, which is a rewrite rather than a clarity edit.",
  "pronoun-changed": "A pronoun in the rewrite does not have the referent it had in the sentence.",
  "direction-changed": "A direction or a deadline was reversed or moved — “before Thursday” to “by Thursday”, “above” to “below”.",
  "order-changed": "Much the same words in a different arrangement: the participants have swapped roles, or a modifier has reattached to something else.",
  "information-dropped": "The rewrite deletes content the deletion policy will not put to a verifier: a count adverb, half of a coordination, a repeated word, a narrowed deadline, a scope word, or more than one content word at once.",
  "verifier-hidden": "The verifier was asked whether the missing word was still implied by what survived, and answered that it was not.",
  "verifier-unavailable": "The verifier could not be reached, and an unanswered question fails closed.",
  "invisible-edit": "The rewrite differs from the sentence, but the diff marks nothing in it, so there would be no underline to open the card from.",
  "dropped-content": "An older name for content-dropped, still carried by runs recorded before the two names were merged.",
};

const explain = (reason) =>
  EXPLAIN[reason] ?? "No description has been written for this reason yet; it is listed because the gate names it.";

const CANONICAL = new Set(REJECTION_REASONS);

// ---------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------

const tabs = [...document.querySelectorAll('[role="tab"]')];
const panelOf = (tab) => byId(tab.getAttribute("aria-controls"));
const slugOf = (tab) => tab.id.replace(/^tab-/u, "");

function selectTab(target, { focus = false, hash = true } = {}) {
  for (const tab of tabs) {
    const active = tab === target;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
    panelOf(tab).hidden = !active;
  }
  if (focus) target.focus();
  if (hash && location.hash !== `#${slugOf(target)}`) {
    history.replaceState(null, "", `#${slugOf(target)}`);
  }
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    selectTab(tabs[(index + step + tabs.length) % tabs.length], { focus: true });
  });
}

{
  const wanted = tabs.find((tab) => slugOf(tab) === location.hash.slice(1));
  if (wanted) selectTab(wanted, { hash: false });
}

// ---------------------------------------------------------------------------------------
// Tab 1 — Write: the deterministic tiers, live
//
// analyzeSentence with no engine is the pipeline's own fallback path: the mechanical
// repair, then a fired clarity rule which supersedes it. Which tier answered is read off
// `stages`, in the plugin's own precedence, so the badge on an underline cannot credit the
// wrong one.
// ---------------------------------------------------------------------------------------

const editor = byId("write-editor");
const overlay = byId("write-overlay");
const markList = byId("write-list");
const card = byId("write-card");
const cardTier = byId("write-card-tier");
const cardDiff = byId("write-card-diff");
const cardReason = byId("write-card-reason");

let suggestions = [];
let writeToken = 0;
let writeTimer = 0;

async function analyseWrite() {
  const token = ++writeToken;
  const text = editor.value;
  const found = [];

  for (const segment of segmentSentences(text)) {
    const sentence = trimSegment(segment);
    if (!isCompleteSentence(sentence.text)) continue;
    const outcome = await analyzeSentence(sentence.text, { mechanics: true, rules: true });
    if (token !== writeToken) return;
    if (!outcome.replacement) continue;
    found.push({
      id: `s${found.length}`,
      // The plugin's attribution, in the plugin's order. The model tier cannot fire here.
      tier: outcome.stages.rule ? "rule" : "mechanics",
      source: outcome.source,
      replacement: outcome.replacement,
      reason: outcome.reason,
      start: sentence.start,
      ranges: changedSourceRanges(outcome.source, outcome.replacement),
    });
  }

  suggestions = found;
  renderOverlay(text);
  renderMarkList();
}

function renderOverlay(text) {
  const marks = suggestions
    .flatMap((suggestion) => suggestion.ranges.map((range) => ({
      id: suggestion.id,
      tier: suggestion.tier,
      start: suggestion.start + range.start,
      end: suggestion.start + range.end,
    })))
    .sort((a, b) => a.start - b.start);

  const pieces = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) pieces.push(text.slice(cursor, mark.start));
    pieces.push(el("mark", {
      dataset: { id: mark.id, tier: mark.tier },
    }, text.slice(mark.start, mark.end)));
    cursor = mark.end;
  }
  pieces.push(text.slice(cursor));
  // A textarea keeps the empty line after a trailing newline and a pre-wrap element drops
  // it, which leaves the mirror one line short in a scrolled document.
  if (text.endsWith("\n")) pieces.push("​");
  overlay.replaceChildren(...pieces);
  overlay.scrollTop = editor.scrollTop;
  overlay.scrollLeft = editor.scrollLeft;
}

function renderMarkList() {
  if (suggestions.length === 0) {
    markList.replaceChildren(el("li", {},
      el("p", {
        class: "empty",
        text: "Neither deterministic tier has anything to say about the finished sentences here. In the plugin the model would now be asked about each of them.",
      })));
    return;
  }
  markList.replaceChildren(...suggestions.map((suggestion) => {
    const quoted = suggestion.ranges
      .map((range) => suggestion.source.slice(range.start, range.end))
      .join(" · ");
    const diff = el("p", { class: "diff" });
    diffInto(diff, suggestion.source, suggestion.replacement);
    return el("li", {},
      el("button", {
        type: "button",
        onclick: () => focusSuggestion(suggestion.id),
      },
        el("span", { class: "row" },
          el("span", { class: "badge", dataset: { tier: suggestion.tier }, text: suggestion.tier }),
          el("span", { class: "quoted", text: quoted })),
        diff,
        el("span", { class: "why", text: suggestion.reason || "" })));
  }));
}

function suggestionById(id) {
  return suggestions.find((suggestion) => suggestion.id === id) ?? null;
}

function openCard(id, anchor) {
  const suggestion = suggestionById(id);
  if (!suggestion) return closeCard();
  for (const mark of overlay.querySelectorAll("mark")) {
    mark.dataset.active = mark.dataset.id === id ? "true" : "false";
  }
  cardTier.textContent = suggestion.tier;
  cardTier.dataset.tier = suggestion.tier;
  diffInto(cardDiff, suggestion.source, suggestion.replacement);
  const tierName = suggestion.tier === "rule" ? "Clarity rule" : "Mechanical fix";
  cardReason.textContent = `${suggestion.reason || ""} · ${tierName}`;
  card.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const left = Math.min(rect.left + window.scrollX, window.innerWidth - card.offsetWidth - 16);
  card.style.top = `${rect.bottom + window.scrollY + 8}px`;
  card.style.left = `${Math.max(16, left)}px`;
}

function closeCard() {
  card.hidden = true;
  for (const mark of overlay.querySelectorAll("mark")) mark.dataset.active = "false";
}

function focusSuggestion(id) {
  const mark = overlay.querySelector(`mark[data-id="${id}"]`);
  if (!mark) return;
  mark.scrollIntoView({ block: "nearest" });
  openCard(id, mark);
}

overlay.addEventListener("mouseover", (event) => {
  const mark = event.target.closest("mark");
  if (mark) openCard(mark.dataset.id, mark);
});
overlay.addEventListener("click", (event) => {
  const mark = event.target.closest("mark");
  if (mark) openCard(mark.dataset.id, mark);
});
// The mark sits above the textarea, so a press on it would otherwise take the caret with
// it. Swallowing the press leaves the writer where they were.
overlay.addEventListener("mousedown", (event) => {
  if (event.target.closest("mark")) event.preventDefault();
});

editor.addEventListener("input", () => {
  closeCard();
  clearTimeout(writeTimer);
  writeTimer = setTimeout(analyseWrite, 120);
});
editor.addEventListener("scroll", () => {
  overlay.scrollTop = editor.scrollTop;
  overlay.scrollLeft = editor.scrollLeft;
  closeCard();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCard();
});
document.addEventListener("click", (event) => {
  if (!card.hidden && !card.contains(event.target) && !event.target.closest("mark")) closeCard();
});

analyseWrite();

// ---------------------------------------------------------------------------------------
// Tab 2 — Check a rewrite: the gate itself
// ---------------------------------------------------------------------------------------

// A property name nothing else will carry, so the abort thrown out of the verifier stub is
// told apart from a real abort rather than swallowed with it.
const REFERRED = Symbol.for("tolben.playground.referred");

// The pipeline options the torture corpus is scored under, and the ones that make this tab
// mean what it says: the deterministic tiers are OFF, because the question here is what the
// gate does with a MODEL's answer. A mechanical repair or a fired rule would otherwise
// answer for the sentence before the gate was reached.
const CHECK_OPTIONS = { mechanics: false, rules: false, gate: false, verify: true, deletionPolicy: "verify" };

// Read after a verdict, never before it: which of the guards behind the single label
// "information-dropped" actually answered yes for this pair. Each is called once.
function diagnose(source, decision, protectedTerms) {
  const validation = validateRewrite(source, decision, { protectedTerms });
  if (!validation.accepted) return { validation, lost: [], guards: null };

  const candidate = validation.replacement;
  const lost = lostContentWords(source, candidate);
  const guards = [[
    "lostContentWords(sentence, rewrite)",
    lost.length ? lost.map((word) => `“${word}”`).join(", ") : "none",
    lost.length > 0,
  ]];
  const add = (label, fired) => guards.push([label, fired ? "yes" : "no", fired]);
  add("a count or frequency adverb — NEVER_VERIFY",
    lost.some((word) => NEVER_VERIFY.has(word.toLowerCase())));
  add("dropsConjunct — half of a coordination", dropsConjunct(source, candidate, lost));
  add("dropsRepeatedWord", dropsRepeatedWord(source, candidate, lost));
  add("deadlineNarrowed", deadlineNarrowed(source, candidate, lost));
  add("dropsScopeWord — unless, until, except, only, own", dropsScopeWord(source, candidate));
  add("deletesTrailingPhrase — consulted when exactly one word is lost",
    deletesTrailingPhrase(source, candidate));
  add("more than one content word lost", lost.length > 1);
  return { validation, lost, guards };
}

async function runGate(source, rewrite, { protectedTerms = [], trace = true } = {}) {
  // What the engine would have returned. `reason` is the model's own account of its edit;
  // the gate reads it (a model that says it kept the sentence while rewriting it is
  // refused), so a value has to be supplied, and this is the one the corpus is scored with.
  const decision = { action: "rewrite", replacement: rewrite, reason: "shorter", latencyMs: 0 };
  const asked = { lost: [] };
  const engine = {
    rewrite: async () => ({ ...decision }),
    verify: async (base, candidate, options) => {
      asked.lost = options?.lost ?? [];
      throw Object.assign(new Error("A browser has no verifier to ask."), { kind: "aborted", [REFERRED]: true });
    },
  };

  let result = null;
  let referred = false;
  try {
    result = await analyzeSentence(source, { engine, protectedTerms, ...CHECK_OPTIONS });
  } catch (error) {
    if (!error?.[REFERRED]) throw error;
    referred = true;
  }

  const verdict = referred ? "verifier" : result.replacement ? "shown" : "refused";
  const reason = referred ? null : (result?.rejection ?? result?.modelRejection ?? null);
  if (!trace) return { verdict, reason, result, lost: asked.lost };

  const { validation, lost, guards } = diagnose(source, decision, protectedTerms);
  return { verdict, reason, result, validation, guards, lost: referred ? asked.lost : lost };
}

const checkForm = byId("check-form");
const checkSource = byId("check-source");
const checkRewrite = byId("check-rewrite");
const checkProtected = byId("check-protected");

// Terms the writer has told the plugin must survive a rewrite verbatim. Without this the
// page could not reach the verdict the plugin reaches for a configured install, and two
// pairs in the torture corpus (t40, t40b) turn on exactly that: `--force` is not one of the
// tokens protectedTokens() recognises by shape, so with the box empty the gate accepts
// dropping the dashes, and with `--force` in it the gate refuses.
const protectedTermsFromField = () =>
  checkProtected.value.split(",").map((term) => term.trim()).filter(Boolean);
const checkResult = byId("check-result");
const checkBadge = byId("check-badge");
const checkText = byId("check-text");
const checkFired = byId("check-fired");
const checkDiff = byId("check-diff");
const checkTeaches = byId("check-teaches");
const checkTrace = byId("check-trace");
const checkTraceBody = byId("check-trace-body");

const VERDICT_BADGE = {
  shown: "Shown to the writer",
  refused: "Refused",
  verifier: "Sent to the verifier",
};

async function check(source, rewrite, { protectedTerms = [], teaches = null } = {}) {
  if (!source.trim() || !rewrite.trim()) return;
  const outcome = await runGate(source, rewrite, { protectedTerms });

  checkResult.dataset.verdict = outcome.verdict;
  checkBadge.textContent = VERDICT_BADGE[outcome.verdict];

  if (outcome.verdict === "shown") {
    checkText.textContent = "The gate found no way this rewrite changed the meaning, so the writer would see it underlined.";
    checkFired.replaceChildren(
      el("span", { text: "No check fired. The writer's card would read: " }),
      el("span", { class: "name", text: outcome.result.reason || "(no reason derived)" }));
  } else if (outcome.verdict === "refused") {
    checkText.textContent = "The rewrite never reaches the writer. Nothing is shown and nothing is silently changed.";
    checkFired.replaceChildren(
      el("span", { text: "Refused under " }),
      el("span", { class: "name", text: outcome.reason ?? "an unnamed reason" }),
      el("span", { text: `${CANONICAL.has(outcome.reason) ? "" : " (raised by the pipeline rather than by the validator)"} — ${explain(outcome.reason)}` }));
  } else {
    const words = outcome.lost.map((word) => `“${word}”`).join(", ") || "a content word";
    checkText.textContent = "The gate will not decide this one alone. It refers the pair to a second model call, which cannot happen in a browser.";
    checkFired.replaceChildren(
      el("span", { text: "The deletion policy in " }),
      el("span", { class: "name", text: "src/pipeline.mjs" }),
      el("span", {
        text: ` fired: the rewrite drops ${words} and none of the guards that settle a deletion outright applies, so the plugin would ask the verifier whether the missing word is still implied by what survived. The answer decides it; there is no model here to give one.`,
      }));
  }
  checkFired.hidden = false;

  diffInto(checkDiff, source, rewrite);
  checkDiff.hidden = false;

  checkTeaches.textContent = teaches ?? "";
  checkTeaches.hidden = !teaches;

  renderTrace(outcome);
  checkTrace.hidden = false;
}

function renderTrace(outcome) {
  const rows = [];
  rows.push(["validateRewrite(sentence, rewrite) — src/safety.mjs",
    outcome.validation.accepted ? "accepted" : `rejected: ${outcome.validation.reason}`,
    !outcome.validation.accepted]);

  if (outcome.guards) {
    for (const guard of outcome.guards) rows.push(guard);
    rows.push([
      "the outcome of the deletion policy",
      outcome.verdict === "verifier"
        ? "referred to the verifier"
        : outcome.verdict === "refused"
          ? `refused: ${outcome.reason}`
          : "nothing lost, so nothing to refer",
      outcome.verdict !== "shown",
    ]);
  } else {
    rows.push(["the deletion policy in src/pipeline.mjs", "never reached — the validator had already refused", false]);
  }

  const table = el("table", { class: "tracetable" },
    el("caption", { text: "Each call, and what it returned for this pair. These are read after the verdict; they do not produce it." }),
    el("tbody", {}, rows.map(([name, value, fired]) =>
      el("tr", {},
        el("th", { scope: "row", text: name }),
        el("td", { class: fired ? "flagged" : null, text: value })))));
  checkTraceBody.replaceChildren(table);
}

checkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  for (const button of document.querySelectorAll(".examples button")) {
    button.setAttribute("aria-pressed", "false");
  }
  check(checkSource.value, checkRewrite.value, { protectedTerms: protectedTermsFromField() });
});

byId("check-clear").addEventListener("click", () => {
  checkSource.value = "";
  checkRewrite.value = "";
  checkProtected.value = "";
  checkSource.focus();
  checkResult.dataset.verdict = "none";
  checkBadge.textContent = "Nothing checked yet";
  checkText.textContent = "Pick a pair below, or type your own, and run the gate.";
  for (const node of [checkFired, checkDiff, checkTeaches, checkTrace]) node.hidden = true;
  for (const button of document.querySelectorAll(".examples button")) {
    button.setAttribute("aria-pressed", "false");
  }
});

function loadPair(source, rewrite, options = {}) {
  checkSource.value = source;
  checkRewrite.value = rewrite;
  // The field is part of the input, so it has to show what the pair was actually run with;
  // leaving a stale term in it would make the verdict unreproducible by the reader.
  checkProtected.value = (options.protectedTerms ?? []).join(", ");
  check(source, rewrite, options);
}

function exampleButton({ title, chip, pair, onpick }) {
  const button = el("button", {
    type: "button",
    "aria-pressed": "false",
    onclick: () => {
      for (const other of document.querySelectorAll(".examples button")) {
        other.setAttribute("aria-pressed", "false");
      }
      button.setAttribute("aria-pressed", "true");
      onpick();
    },
  },
    el("span", { class: "title", text: title }),
    chip ? el("span", { class: "chip", text: chip }) : null,
    pair ? el("span", { class: "pair", text: pair }) : null);
  return button;
}

// ---------------------------------------------------------------------------------------
// Tab 3 — Replay
// ---------------------------------------------------------------------------------------

const replayBody = byId("replay-body");
const replayCount = byId("replay-count");
const filterOutcome = byId("replay-outcome");
const filterReason = byId("replay-reason");
const filterRun = byId("replay-run");
const filterSearch = byId("replay-search");

let replayRows = [];

function renderReplay() {
  const outcome = filterOutcome.value;
  const reason = filterReason.value;
  const run = filterRun.value;
  const needle = filterSearch.value.trim().toLowerCase();

  const rows = replayRows.filter((row) => {
    if (outcome && row.outcome !== outcome) return false;
    if (reason && row.rejection !== reason) return false;
    if (run && row.run !== run) return false;
    if (!needle) return true;
    return [row.source, row.proposed, row.surfaced, row.rejection, row.id, row.issueClass]
      .some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
  });

  replayCount.textContent = rows.length === replayRows.length
    ? `${plural(rows.length, "row", "rows")}, unfiltered.`
    : `${rows.length} of ${replayRows.length} rows.`;

  if (rows.length === 0) {
    replayBody.replaceChildren(el("tr", {}, el("td", { class: "emptyrow", colspan: "5", text: "No recorded row matches those filters." })));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    fragment.append(el("tr", {},
      el("td", { class: "src", dataset: { label: "Sentence" } },
        el("span", { text: row.source }),
        el("span", { class: "rid", text: `${row.id} · ${row.run}${row.issueClass ? ` · ${row.issueClass}` : ""}` })),
      el("td", { dataset: { label: "Proposed" } },
        row.proposed
          ? el("span", { text: row.proposed })
          : el("span", { class: "nothing", text: row.outcome === "quiet" ? "nothing proposed" : "not recorded in this run" })),
      el("td", { dataset: { label: "Gate" } },
        el("span", { class: "outcome", dataset: { outcome: row.outcome }, text: row.outcome === "surfaced" ? "shown" : row.outcome === "refused" ? "refused" : "quiet" }),
        row.rejection ? el("span", { class: "reasonname", text: row.rejection }) : null,
        row.lostWords?.length ? el("span", { class: "rid", text: `lost: ${row.lostWords.join(", ")}` }) : null),
      el("td", { dataset: { label: "The writer saw" } },
        row.surfaced
          ? el("span", { text: row.surfaced })
          : el("span", { class: "nothing", text: "nothing" }),
        row.stage ? el("span", { class: "rid", text: `stage: ${row.stage}` }) : null),
      el("td", { class: "actioncell" },
        row.proposed
          ? el("button", {
            type: "button",
            class: "button tiny",
            onclick: () => {
              selectTab(byId("tab-check"), { focus: true });
              loadPair(row.source, row.proposed, {
                teaches: `Row ${row.id} of the recorded run ${row.run}. In that run the gate answered “${row.outcome}”${row.rejection ? ` under ${row.rejection}` : ""}.`,
              });
            },
          }, "Check")
          : null)));
  }
  replayBody.replaceChildren(fragment);
}

for (const control of [filterOutcome, filterReason, filterRun]) {
  control.addEventListener("change", renderReplay);
}
filterSearch.addEventListener("input", renderReplay);

// ---------------------------------------------------------------------------------------
// Tab 4 — Ledger
// ---------------------------------------------------------------------------------------

function reasonCard(reason, { compact = false } = {}) {
  const runs = Object.entries(reason.runs ?? {}).sort((a, b) => b[1] - a[1]);
  return el("article", { class: "reason" },
    el("p", { class: "reason-head" },
      el("span", { class: "reason-name", text: reason.reason }),
      el("span", { class: "reason-count" },
        el("b", { text: String(reason.count) }),
        ` ${reason.count === 1 ? "refusal" : "refusals"}`),
      el("span", { class: "reason-src", text: reason.raisedBy })),
    el("p", { class: "reason-why", text: explain(reason.reason) }),
    compact || runs.length === 0 ? null : el("p", {
      class: "reason-runs",
      text: runs.map(([name, count]) => `${name} ${count}`).join("  ·  "),
    }),
    compact || !reason.examples?.length ? null : el("ul", { class: "reason-examples" },
      reason.examples.map((example) => el("li", {},
        el("span", { class: "rid", text: `${example.id} · ${example.run}${example.lostWords?.length ? ` · lost: ${example.lostWords.join(", ")}` : ""}` }),
        example.proposed
          ? diffInto(el("span", {}), example.source, example.proposed)
          : el("span", { text: example.source })))));
}

// ---------------------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------------------

const FIGURE_LABELS = {
  suite: "Test suite",
  oracleCeiling: "Oracle ceiling",
  precisionAndUnlockControls: "Precision and false-unlock controls",
  readmeSuite: "Suite, as the README states it",
};

// REPORT.md's status rows are markdown table rows and its README lines are shell. Both are
// shown as the file has them, with only the cell walls and runs of spaces tidied, so the
// figure on the card is the line a reader will find at that line number.
function tidyFigure(text) {
  const cells = text.split("|").map((cell) => cell.trim()).filter(Boolean);
  const joined = cells.length > 1 ? cells.join(" — ") : text.trim();
  return joined.replace(/\s{2,}/gu, " ");
}

function metaTable(caption, headings, rows) {
  return el("table", { class: "metatable" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, headings.map((heading) => el("th", { scope: "col", text: heading })))),
    el("tbody", {}, rows.map((row) => el("tr", {}, row.map((cell) => el("td", { text: cell }))))));
}

// ---------------------------------------------------------------------------------------
// Load the four data files and fill the three recorded tabs
// ---------------------------------------------------------------------------------------

async function loadJSON(name) {
  const response = await fetch(`./data/${name}.json`);
  if (!response.ok) throw new Error(`data/${name}.json returned ${response.status}`);
  return response.json();
}

function failed(where, error) {
  const node = byId(where);
  if (node) node.textContent = `The generated data could not be read: ${error.message}. Run node playground/build.mjs and reload.`;
}

async function boot() {
  let examples, replay, ledger, meta;
  try {
    [examples, replay, ledger, meta] = await Promise.all(
      ["examples", "replay", "ledger", "meta"].map(loadJSON),
    );
  } catch (error) {
    for (const where of ["replay-note", "ledger-note", "meta-line"]) failed(where, error);
    byId("check-examples").replaceChildren(el("p", { class: "loading", text: `The pre-loaded pairs could not be read: ${error.message}` }));
    byId("check-extra").replaceChildren();
    return;
  }

  fillExamples(examples);
  fillReplay(replay);
  fillLedger(ledger);
  fillMeta(meta);
  // Only once the tabs are usable: this walks the recorded rows through the gate.
  findReferredPair(replay);
}

function fillExamples(data) {
  const host = byId("check-examples");
  host.replaceChildren(...data.examples.map((example) => exampleButton({
    title: example.title,
    chip: example.family,
    onpick: () => loadPair(example.original, example.rewrite, {
      protectedTerms: example.protectedTerms ?? [],
      teaches: example.teaches,
    }),
  })));
}

// The verifier tier has to be demonstrable, and no pair in the torture corpus reaches it:
// the corpus is adversarial, and the deletion policy settles every one of its deletions
// outright. So the page finds one for itself — it walks the recorded rows through the same
// gate the checker uses and stops at the first pair that gets referred. The pair is a real
// row from bench/results, and which row it is depends only on what is in the data.
async function findReferredPair(replay) {
  const host = byId("check-extra");
  let examined = 0;
  for (const row of replay.rows) {
    if (!row.source || !row.proposed) continue;
    // Every twentieth pair, hand the thread back, so a slow device stays responsive while
    // this walk is going on behind an already-usable page.
    if ((examined += 1) % 20 === 0) await new Promise((resume) => setTimeout(resume, 0));
    const { verdict, lost } = await runGate(row.source, row.proposed, { trace: false });
    if (verdict !== "verifier") continue;
    host.replaceChildren(exampleButton({
      title: `A single lost word: ${lost.map((word) => `“${word}”`).join(", ")}`,
      chip: `${row.id} · ${row.run}`,
      pair: `${row.source}  →  ${row.proposed}`,
      onpick: () => loadPair(row.source, row.proposed, {
        teaches: `Row ${row.id} of the recorded run ${row.run}. There, a real verifier was asked and the run recorded the outcome “${row.outcome}”${row.rejection ? ` under ${row.rejection}` : ""}. Here the question is asked and left unanswered, which is where a browser has to stop.`,
      }),
    }));
    return;
  }
  host.replaceChildren(el("p", {
    class: "loading",
    text: "No row in the recorded runs reaches the verifier under the current policy. The verdict is still reachable by hand: a rewrite that drops exactly one ordinary content word from the middle of a sentence, rather than off its end, is referred rather than refused.",
  }));
}

function fillReplay(data) {
  replayRows = data.rows;

  const reasons = [...new Set(data.rows.map((row) => row.rejection).filter(Boolean))].sort();
  filterReason.append(...reasons.map((reason) => el("option", { value: reason, text: reason })));
  filterRun.append(...data.runs.map((run) => el("option", { value: run.name, text: `${run.name} (${run.total})` })));

  for (const [key, description] of Object.entries(data.fields ?? {})) {
    const column = { source: 0, proposed: 1, outcome: 2, surfaced: 3 }[key];
    const header = column === undefined ? null : document.querySelectorAll("#replay-table thead th")[column];
    if (header) header.title = description;
  }

  const runs = data.runs.length;
  const corpora = new Set(data.runs.map((run) => run.corpusName)).size;
  byId("replay-note").textContent =
    `${data.totals.rows} recorded rows from ${plural(runs, "run", "runs")} over ${plural(corpora, "corpus", "corpora")}: `
    + `${data.totals.surfaced} reached the writer, ${data.totals.refused} were refused, and on ${data.totals.quiet} the model kept the sentence.`;

  if (data.truncated) {
    byId("replay-truncation").textContent =
      `${data.truncated.shown} of ${data.truncated.total} rows are in this table. ${data.truncated.policy}`;
  }

  renderReplay();
}

function fillLedger(data) {
  const scope = data.scope;
  byId("ledger-note").textContent =
    `${scope.reasonsFired} of ${scope.reasonsListed} reasons fired across ${scope.rejections} refusals `
    + `in ${plural(scope.rows, "recorded row", "recorded rows")}, over ${plural(scope.runs.length, "run", "runs")}. `
    + `Reasons are ordered by how often they fired. ${data.note}`;

  const fired = data.reasons.filter((reason) => reason.count > 0).sort((a, b) => b.count - a.count);
  const silent = data.reasons.filter((reason) => reason.count === 0);
  byId("ledger-fired").replaceChildren(...fired.map((reason) => reasonCard(reason)));
  byId("ledger-silent").replaceChildren(...silent.map((reason) => reasonCard(reason, { compact: true })));
}

function fillMeta(data) {
  byId("meta-line").textContent =
    `Built ${data.builtAtUTC.replace("T", " ").replace(/\.\d+Z$/u, " UTC")}`
    + `${data.commit ? ` from commit ${data.commit.slice(0, 12)}` : ""}. ${data.note}`;

  const cards = Object.entries(data.figures ?? {}).map(([key, figure]) =>
    el("div", {},
      el("dt", { text: FIGURE_LABELS[key] ?? key }),
      el("dd", { text: tidyFigure(figure.text) },
        el("span", { class: "where", text: `${figure.source}${figure.line ? `:${figure.line}` : ""}` }))));

  cards.push(el("div", {},
    el("dt", { text: "The gate itself" }),
    el("dd", { text: `${data.gate.reasonsListed} reasons listed, ${data.gate.reasonsFired} fired over ${data.gate.rowsReplayed} recorded rows` },
      el("span", { class: "where", text: "src/safety.mjs, src/pipeline.mjs, bench/results/" }))));

  byId("meta-figures").replaceChildren(...cards);

  const body = byId("meta-body");
  const parts = [];

  parts.push(metaTable(
    "Recorded runs",
    ["Run", "File", "sha256", "Rows", "Shown", "Refused", "Quiet"],
    data.results.map((run) => [
      run.name, run.file, run.sha256, String(run.rows),
      String(run.surfaced), String(run.refused), String(run.quiet),
    ])));

  parts.push(metaTable(
    "Corpora",
    ["Corpus", "File", "sha256", "Rows", "Used for"],
    data.corpora.map((corpus) => [
      corpus.name, corpus.file, corpus.sha256, String(corpus.counts?.total ?? ""), corpus.used ?? "",
    ])));

  parts.push(metaTable(
    "The model every recorded number was produced on",
    ["Field", "Value"],
    [
      ["File", data.model.file],
      ["Bytes", data.model.bytes.toLocaleString("en-GB")],
      ["sha256", data.model.sha256],
      ["Licence", data.model.licence],
      ["Weights repository", data.model.weightsRepo],
      ["Fetched from", (data.model.sources ?? []).join(" ")],
      ["Pinned in", (data.model.pinnedIn ?? []).join(", ")],
      ["Pinned on", data.model.pinnedOn],
      ["Role", data.model.role],
    ]));

  parts.push(metaTable(
    `The model server, pinned to ${data.runtime.tag} in ${data.runtime.source}`,
    ["Platform", "Asset", "Bytes", "sha256"],
    data.runtime.assets.map((asset) => [
      asset.id, asset.asset, asset.bytes.toLocaleString("en-GB"), asset.sha256,
    ])));

  parts.push(metaTable(
    "Baselines the controls are held against",
    ["Baseline", "File", "Snapshot", "Entries"],
    [
      ["Precision", data.baselines.precision.file, data.baselines.precision.snapshot, String(data.baselines.precision.count)],
      ["Refusal", data.baselines.refusal.file, data.baselines.refusal.snapshot, String(data.baselines.refusal.count)],
      ["Oracle labels", data.baselines.oracleLabels.file, data.baselines.oracleLabels.labelled,
        Object.entries(data.baselines.oracleLabels.counts).map(([name, count]) => `${name} ${count}`).join(", ")],
    ]));

  body.replaceChildren(...parts);
}

// ---------------------------------------------------------------------------------------
// The plugin folder path, for anyone adding it by hand
// ---------------------------------------------------------------------------------------

{
  const button = byId("copy-path");
  const state = byId("copy-state");
  button?.addEventListener("click", async () => {
    const path = button.dataset.path;
    try {
      await navigator.clipboard.writeText(path);
      state.textContent = `Copied ${path}`;
    } catch {
      state.textContent = `Copy it by hand: ${path}`;
    }
  });
}

boot();
