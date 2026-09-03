// The CodeMirror 6 half: turns the controller's marks into decorations, and a hovered
// mark into the suggestion card.
//
// Two things are worth noting against the web demo. First, there is no overlay mirror
// here at all — the demo painted a <pre> behind a <textarea> and kept the two scrolled
// together; CodeMirror decorates the real text, so that entire class of alignment bug
// does not exist. Second, Replace is an ordinary transaction, which means it lands in
// CodeMirror's own history and one Cmd+Z reverts it. The demo needed execCommand to get
// that, and could not always have it.

import { Decoration, EditorView, ViewPlugin, hoverTooltip } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { inlineDiffParts } from "../src/diff.mjs";
import { createController } from "./controller.mjs";
import { sentenceRank } from "./rank.mjs";

const setMarks = StateEffect.define();

// Syntax-tree nodes whose text is not prose. Matched by name rather than by an
// enumerated list because Obsidian extends the markdown parser with its own nodes, and a
// name this misses costs a suggestion on a code block while a name it wrongly matches
// costs nothing at all.
const NOT_PROSE = /code|comment|html|math|formula|frontmatter|yaml/iu;

// The stretch of document worth analysing: what CodeMirror has drawn, widened by its own
// length on either side.
//
// CodeMirror renders only the viewport, so a suggestion outside it has nowhere to appear;
// analysing the whole note spends the model's single slot on marks that cannot be drawn,
// ahead of the paragraph the writer is looking at. The margin is expressed as the size of
// the drawn range rather than in pixels: the drawn range is already a screenful plus
// CodeMirror's own overscan, so this comes to roughly a screen either side without any
// coordinate arithmetic to get wrong. The floor keeps a short or narrow pane sensible.
const MIN_MARGIN = 2000;

// The hull of what CodeMirror has actually drawn — the reader's screen, plus CM's own
// small render overscan. This is what ranking is measured against; analysisRange widens
// it into the prefetch window.
function drawnRange(view) {
  const ranges = view.visibleRanges;
  if (ranges.length === 0) return { from: 0, to: 0 };
  return { from: ranges[0].from, to: ranges[ranges.length - 1].to };
}

function analysisRange(view) {
  const { from, to } = drawnRange(view);
  const margin = Math.max(to - from, MIN_MARGIN);
  return { from: Math.max(0, from - margin), to: Math.min(view.state.doc.length, to + margin) };
}

// Document ranges the model must never be shown. Children of an excluded node are
// skipped: a fenced block's contents cannot be less excluded than the fence.
function excludedRanges(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!NOT_PROSE.test(node.name)) return true;
      ranges.push({ from: node.from, to: node.to });
      return false;
    },
  });
  return ranges;
}

const underline = Decoration.mark({ class: "tolben-underline" });

function decorationsFor(marks, docLength) {
  const ranges = [];
  let cursor = 0;
  for (const mark of marks) {
    // Marks are computed from the text the controller last synced. A keystroke since
    // then can put them past the end or out of order, and CodeMirror throws on either.
    const from = Math.max(cursor, Math.min(mark.start, docLength));
    const to = Math.min(mark.end, docLength);
    if (to <= from) continue;
    ranges.push(underline.range(from, to));
    cursor = to;
  }
  return Decoration.set(ranges);
}

const marksField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    // Marks are recomputed only after the debounce, so between a keystroke and the next
    // sync they are carried by the change mapping. Without this the underline lags the
    // text it belongs to by one edit.
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setMarks)) next = decorationsFor(effect.value, transaction.state.doc.length);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// The card's merged inline diff, built exactly as the demo builds it: kept text plain,
// deletions struck, insertions in blue, with the spacing rules that keep "goods-in" one
// word and never put a space before a comma.
function renderDiff(container, source, replacement) {
  const parts = inlineDiffParts(source, replacement);
  container.textContent = "";
  parts.forEach((part, index) => {
    const previous = index > 0 ? parts[index - 1].text : "";
    const joined = index > 0 &&
      !/^[,.;:!?)\]}'’”\-/]/u.test(part.text) &&
      !/[-(\[{'‘“/]$/u.test(previous);
    if (joined) container.appendChild(document.createTextNode(" "));
    if (part.type === "equal") {
      container.appendChild(document.createTextNode(part.text));
      return;
    }
    const span = document.createElement("span");
    span.className = part.type === "delete" ? "tolben-del" : "tolben-ins";
    span.textContent = part.text;
    container.appendChild(span);
  });
}

export function clarityExtension({
  analyze,
  analyzeLocal = null,
  debounceMs = 140,
  onStatus = () => {},
  // "fast" | "balanced" | "off", read per call so a settings change applies live.
  gateMode = () => "balanced",
}) {
  // Every live editor, so a settings change can invalidate decisions that were made
  // under the old setting instead of leaving them on screen unexplained.
  const instances = new Set();

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.pending = null;
        this.controller = createController({
          analyze,
          analyzeLocal,
          debounceMs,
          onChange: () => this.schedule(),
          isExcluded: (sentence) => this.excluded.some(
            (range) => range.from < sentence.end && range.to > sentence.start,
          ),
          isVisible: (sentence) => sentence.start < this.range.to && sentence.end > this.range.from,
          // The window admits a screen of margin either side, but the single model slot
          // serves it in this order: on screen, then below (readers scroll down), then
          // above — and within each, gate-firing sentences before gate-cleared ones,
          // unless the gate is off. See rank.mjs.
          rank: (sentence) => sentenceRank(sentence, this.visible, gateMode() !== "off"),
        });
        this.excluded = [];
        this.range = { from: 0, to: 0 };
        this.visible = { from: 0, to: 0 };
        this.pendingSync = null;
        instances.add(this);
        // Deferred even at construction: the view may not be measured yet, and CodeMirror
        // runs plugin constructors inside its own update cycle, where heavy work blocks
        // the note from painting.
        this.deferSync();
      }

      // Live Preview needs nothing special: it is the same document at the same offsets,
      // with Obsidian's own decorations hiding the syntax characters. What it does need
      // is that the model never sees anything but prose — there, a suggestion on a code
      // fence would underline text the writer is looking at as rendered output.
      sync(state) {
        this.range = analysisRange(this.view);
        this.visible = drawnRange(this.view);
        this.excluded = excludedRanges(state);
        this.controller.sync(state.doc.toString());
      }

      // The resync never runs inside the dispatch that caused it. CodeMirror runs the
      // whole update cycle synchronously inside view.dispatch, so anything done here is
      // paid between a keystroke and its glyph appearing, or between a Replace click and
      // the edit painting — the measured 2-second freeze on a long note. One timer,
      // trailing edge: a burst of keystrokes buys one resync.
      deferSync() {
        if (this.pendingSync) return;
        this.pendingSync = setTimeout(() => {
          this.pendingSync = null;
          if (this.view) this.sync(this.view.state);
        }, 0);
      }

      update(update) {
        if (update.docChanged) {
          // The cheap half now, the heavy half a tick later. Mapping the offsets through
          // the transaction keeps marks, hover hits and the accept guard addressing the
          // characters where they moved to; the resync then re-reads the actual text.
          this.controller.mapOffsets((position, assoc) => update.changes.mapPos(position, assoc));
          this.deferSync();
          return;
        }
        // Scrolling changes no text, so the document is not re-read: only the window
        // moves, and the controller takes a second look at sentences it already knows.
        // `viewportMoved` excludes the viewport merely being remapped after an edit,
        // which the deferred resync covers; older CodeMirror only has `viewportChanged`.
        // Deferred too — refresh is linear in sentences, and this path runs inside every
        // scroll frame.
        if (update.viewportMoved ?? update.viewportChanged) {
          if (this.pendingSync) return;   // a full resync is already on its way
          this.range = analysisRange(update.view);
          this.visible = drawnRange(update.view);
          const controller = this.controller;
          // Exclusion is re-read too: the syntax tree parses lazily, so scrolling into
          // a not-yet-parsed region is exactly when a stale exclusion list would let a
          // code block's contents through as prose.
          setTimeout(() => {
            if (!this.view) return;
            this.excluded = excludedRanges(this.view.state);
            controller.refresh();
          }, 0);
        }
      }

      // CodeMirror forbids dispatching from inside an update, and every caller here is
      // either in one or in an async callback, so the dispatch is always deferred.
      schedule() {
        if (this.pending) return;
        this.pending = setTimeout(() => {
          this.pending = null;
          if (!this.view) return;
          this.view.dispatch({ effects: setMarks.of(this.controller.marks()) });
          onStatus(this.controller.status);
        }, 0);
      }

      replace(id) {
        // Several changes, not one: the model answers in prose, and the markup that
        // prose was threaded through has to survive the edit. The controller has already
        // retired the suggestion, so the resync this dispatch triggers cannot send the
        // model its own output back.
        const applied = this.controller.accept(id);
        if (!applied) return;
        // The sentence must still read exactly as it did when it was analysed.
        if (this.view.state.doc.sliceString(applied.from, applied.to) !== applied.raw) return;
        // One transaction, so one Cmd+Z reverts the whole thing however many changes it
        // took to keep the markup intact.
        this.view.dispatch({ changes: applied.edits });
      }

      dismiss(id) {
        this.controller.dismiss(id);
      }

      destroy() {
        instances.delete(this);
        clearTimeout(this.pendingSync);
        clearTimeout(this.pending);
        this.controller.dispose();
        this.view = null;
      }
    },
  );

  const tooltip = hoverTooltip(
    (view, position) => {
      const instance = view.plugin(plugin);
      if (!instance) return null;
      const hit = instance.controller.suggestionAt(position);
      if (!hit) return null;
      const { suggestion, mark } = hit;
      return {
        pos: mark.start,
        end: mark.end,
        above: false,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "tolben-card";

          // The title is the edit, derived from the diff by explain.mjs — not a slogan.
          // "Improve your text" told the reader nothing they could not see, and it made
          // every card look like every other card, so the one carrying a change worth
          // refusing read exactly like the one fixing a double space.
          const title = document.createElement("div");
          title.className = "tolben-card-title";
          title.textContent = suggestion.reason || "Suggests a change";
          dom.appendChild(title);

          const diff = document.createElement("div");
          diff.className = "tolben-card-diff";
          renderDiff(diff, suggestion.source, suggestion.replacement);
          dom.appendChild(diff);

          // What produced it. Kept separate from the title so a report can never credit
          // the model for a rule's work, or a rule for the model's.
          const reason = document.createElement("div");
          reason.className = "tolben-card-reason";
          reason.textContent = suggestion.stages?.model ? "Local model"
            : suggestion.stages?.rule ? "Clarity rule"
            : "Mechanical fix";
          dom.appendChild(reason);

          const actions = document.createElement("div");
          actions.className = "tolben-card-actions";
          const replace = document.createElement("button");
          replace.className = "tolben-primary";
          replace.textContent = "Replace";
          replace.addEventListener("click", () => instance.replace(suggestion.id));
          const dismiss = document.createElement("button");
          dismiss.textContent = "Dismiss";
          dismiss.addEventListener("click", () => instance.dismiss(suggestion.id));
          actions.append(replace, dismiss);
          dom.appendChild(actions);

          return { dom };
        },
      };
    },
    { hoverTime: 80, hideOn: (transaction) => transaction.docChanged },
  );

  return {
    extension: [marksField, plugin, tooltip],
    invalidateAll() {
      for (const instance of instances) instance.controller.invalidateAll();
    },
  };
}
