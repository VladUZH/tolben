// The editor-agnostic half of app-core.mjs: everything that decides WHICH sentences get
// analysed and WHAT is currently suggested, with no DOM and no CodeMirror in sight.
//
// One controller per open editor. It owns the sentence identities, the debounce timers,
// the request coordinator and the suggestion store; the CodeMirror layer above it only
// asks for `marks()` and calls `sync()` when the document changes.

import { reconcileSentences } from "../src/identity.mjs";
import { createStore } from "../src/store.mjs";
import { createCoordinator } from "../src/coordinator.mjs";
import { changedSourceRanges } from "../src/diff.mjs";
import { isCompleteSentence } from "../src/segmenter.mjs";
import { flattenMarkdown, sourceEdits, sourceRuns } from "./markdown.mjs";

// A segment with no letters in it — the "1." an ordered list splits off, a lone "..." —
// is punctuation, not a sentence. There is nothing in it to rewrite.
const HAS_LETTER = /\p{L}/u;

// A fenced code block, recognised from the raw text alone. Exclusion normally comes from
// the editor's syntax tree, but that parses lazily, so a fence in a not-yet-parsed region
// would arrive here looking like prose — and the flattener would read its backticks as
// inline code and let an accepted edit swallow them.
const CODE_FENCE = /^\s{0,3}(?:```|~~~)/mu;

// Raw markdown in, the prose a reader sees out, with the map that gets back. Completeness
// is judged on the prose: "**Teh and cat leak a table!**" ends in an asterisk and would
// never be recognised as a finished sentence otherwise.
// The projection is a pure function of the raw text, so it is computed once per distinct
// text and shared. Consumers (sourceRuns, sourceEdits, the completeness test) only read
// it, which is what makes sharing between identical sentences safe.
function computeProjection(rawText) {
  // A segment carrying a fence line is never analysed — schedulePass withdraws it on the
  // CODE_FENCE test below — so flattening it is pure waste. It is also the expensive
  // case: an UNCLOSED fence makes the whole tail of the note one segment, and every
  // keystroke inside it misses the projection cache and re-flattens the lot. Measured at
  // 18.9 ms per resync on a 40k-word note with one open fence at its midpoint, against a
  // ~15 ms budget; 98 ms at 200k words. The empty offset map is safe precisely because
  // nothing downstream may run: the sentence is incomplete, so it is never sent, never
  // gets a suggestion, and never reaches sourceEdits.
  if (CODE_FENCE.test(rawText)) {
    return { text: rawText, projection: { text: rawText, offsets: [], protectedTerms: [] }, complete: false };
  }
  const projection = flattenMarkdown(rawText);
  return { text: projection.text, projection, complete: isCompleteSentence(projection.text) };
}

export function createController({
  analyze,
  onChange = () => {},
  debounceMs = 140,
  // Asked of every sentence on every sync. The editor owns this decision because only it
  // has the syntax tree; the controller only has to honour it, and has to re-ask rather
  // than cache, because wrapping a paragraph in a code fence excludes text that has not
  // itself changed.
  isExcluded = () => false,
  // Asked of every sentence before it is scheduled. CodeMirror draws no decorations
  // outside the viewport, so a sentence off screen buys a suggestion that cannot be
  // shown — and on a single-slot model server it buys it ahead of one that can.
  // Unlike exclusion this is not a judgement about the text: nothing already decided is
  // forgotten when it scrolls away, so coming back costs nothing.
  isVisible = () => true,
  // Priority for the coordinator's queue, lower first; null means document order. The
  // editor supplies one that puts on-screen sentences before the margins, because the
  // model has one slot and it should serve the reader's eyes.
  rank = null,
  // Injectable for tests; the failure cooldown is the only consumer.
  clock = () => Date.now(),
  // The deterministic pass, no model in it. Runs the moment a sentence's debounce fires,
  // so a mechanical repair is on screen in ~150ms while the model decision follows in
  // ~0.3-2s. The pipeline runs mechanics again inside the model pass, so the later
  // outcome already contains this repair — the provisional card is replaced, not stacked.
  analyzeLocal = null,
} = {}) {
  const store = createStore();
  // Identity is reconciled on the RAW sentences, because that is what the segmenter
  // produces and what the next sync will be matched against; everything downstream works
  // on the projected prose.
  let rawSentences = [];
  let sentences = [];
  // raw text -> computeProjection result, swapped wholesale each sync so entries for
  // deleted text do not accumulate. On a keystroke every sentence but one is unchanged,
  // so re-projecting all of them bought nothing — measured 24 ms per keystroke at 3,048
  // sentences, all but one hit after this.
  let projectionCache = new Map();
  // id -> { text, attempts, max, rounds, heldUntil }. A sentence whose analysis failed is
  // retried a bounded number of times for the same text; without this every typing pause
  // and every scroll bought another wasted call, forever, serialized through the model's
  // single slot. A "failed" kind (unparseable output, a 4xx from a misconfigured server —
  // deterministic for this text) gets one attempt; anything else gets two.
  //
  // Recovery is TIME, deliberately, not "any success clears everything". Clearing on
  // success re-bought an always-timing-out sentence after every success anywhere; and
  // when every visible sentence was held (server down at note-open), no success could
  // ever fire, so nothing recovered even after the server came back. A held sentence
  // instead waits out an exponential cooldown, then gets exactly one more try. On the
  // sentence's own success its entry is dropped.
  const failures = new Map();
  const MAX_ATTEMPTS = 2;
  const BASE_HOLD_MS = 60_000;
  const MAX_HOLD_MS = 10 * 60_000;
  // One real model call fails once, however many debounce-joins are awaiting it: the
  // coordinator rejects every awaiter with the SAME error object, and only the first
  // sight of it may touch the ledger. Without this a refresh during a slow call burned
  // the whole retry budget on a single failure.
  const COUNTED = Symbol("failure-counted");

  function recordFailure(id, text, kind, error) {
    if (error) {
      if (error[COUNTED]) return;
      error[COUNTED] = true;
    }
    let entry = failures.get(id);
    if (!entry || entry.text !== text) {
      entry = { text, attempts: 0, max: MAX_ATTEMPTS, rounds: 0, heldUntil: 0 };
      failures.set(id, entry);
    }
    if (kind === "failed") entry.max = Math.min(entry.max, entry.attempts + 1);
    entry.attempts += 1;
    if (entry.attempts >= entry.max) {
      entry.rounds += 1;
      entry.heldUntil = clock() + Math.min(BASE_HOLD_MS * 2 ** (entry.rounds - 1), MAX_HOLD_MS);
    }
  }

  function heldBack(id, text) {
    const entry = failures.get(id);
    if (!entry || entry.text !== text || entry.attempts < entry.max) return false;
    if (clock() >= entry.heldUntil) {
      // The cooldown grants exactly one more try; failing it holds again, further out.
      entry.attempts = entry.max - 1;
      return false;
    }
    return true;
  }
  const analyzed = new Map(); // id -> text already decided
  const timers = new Map();   // id -> debounce timer
  let text = "";
  let revision = 0;
  let inFlight = 0;
  let rejectedCount = 0;
  let lastError = null;
  let disposed = false;

  const coordinator = createCoordinator({
    analyze,
    // One, deliberately: the llama server has a single slot (-np 1), so a second
    // concurrent request only queues server-side while its own timeout burns, and a
    // request the coordinator still holds client-side can be withdrawn or re-ranked.
    maxConcurrent: 1,
    onResult: ({ id, text: requested, outcome }) => {
      failures.delete(id);   // this sentence answered; its own ledger entry is done
      if (outcome.rejection) rejectedCount += 1;
      const sentence = sentences.find((candidate) => candidate.id === id);
      // Refuse to mark text that has moved on since the request was sent — including
      // the decided-record: an answer discarded as stale must not count as the decision
      // for that text, or undoing back to it silently loses the suggestion forever.
      if (!sentence || sentence.text !== requested) return;
      analyzed.set(id, requested);
      if (store.isDismissed(id, requested)) return;
      if (!outcome.replacement || outcome.replacement === requested) {
        store.remove(id);
        onChange();
        return;
      }
      store.set({
        id,
        source: requested,
        replacement: outcome.replacement,
        reason: outcome.reason ?? "",
        stages: outcome.stages,
        start: sentence.start,
        end: sentence.end,
      });
      onChange();
    },
  });

  function clearTimer(id) {
    const armed = timers.get(id);
    if (!armed) return;
    clearTimeout(armed.timer);
    timers.delete(id);
  }

  function scheduleAnalysis(sentence) {
    const armed = timers.get(sentence.id);
    // A timer already counting down for this exact text keeps its countdown. Re-arming it
    // on every sync meant continuous typing ANYWHERE reset the debounce of EVERY visible
    // sentence — measured: 600 ms of typing produced zero model calls, then a burst.
    if (armed && armed.text === sentence.text) return;
    if (armed) clearTimeout(armed.timer);
    const id = sentence.id;
    const armedText = sentence.text;
    const timer = setTimeout(async () => {
      timers.delete(id);
      if (disposed) return;
      // The sentence is re-read at fire time: a resync may have replaced the arrays, and
      // offsets may have been mapped through an edit since arming. Text that no longer
      // matches means a resync already saw the change and re-armed or withdrew.
      const current = sentences.find((candidate) => candidate.id === id);
      if (!current || current.text !== armedText) return;
      if (analyzed.get(id) === current.text) return;
      if (store.isDismissed(id, current.text)) return;
      if (!isVisible(current)) return;
      if (heldBack(id, current.text)) return;
      // The deterministic repair does not wait for the model. Best-effort: a local pass
      // that throws must not cost the sentence its model analysis.
      if (analyzeLocal && !store.get(id)) {
        try {
          const local = await analyzeLocal(current.text, { protectedTerms: current.projection.protectedTerms });
          const fresh = sentences.find((candidate) => candidate.id === id);
          // Nothing already decided may be displaced: the model's reply can land INSIDE
          // this await, and the provisional card must never overwrite the model's card
          // or a decided verdict.
          if (local?.replacement && local.replacement !== current.text &&
              fresh && fresh.text === current.text && !store.isDismissed(id, current.text) &&
              analyzed.get(id) !== current.text && !store.get(id)?.stages?.model) {
            store.set({
              id,
              source: current.text,
              replacement: local.replacement,
              reason: local.reason ?? "",
              stages: local.stages ?? { mechanics: true, model: false },
              start: fresh.start,
              end: fresh.end,
            });
            onChange();
          }
        } catch { /* the model pass is the one that matters */ }
        // Every fire-time guard is re-asked after the await: the sentence may have been
        // deleted, edited, decided, dismissed or scrolled away while the local pass ran,
        // and each of those made the submit below wrong in a different way.
        if (disposed) return;
        const now = sentences.find((candidate) => candidate.id === id);
        if (!now || now.text !== armedText) return;
        if (analyzed.get(id) === now.text) return;
        if (store.isDismissed(id, now.text)) return;
        if (!isVisible(now)) return;
        if (heldBack(id, now.text)) return;
      }
      revision += 1;
      inFlight += 1;
      onChange();
      try {
        await coordinator.submit({
          id,
          revision,
          text: current.text,
          context: { protectedTerms: current.projection.protectedTerms },
          // Ranked at fire time, not arm time: the reader may have scrolled meanwhile.
          priority: rank ? rank(current) : 0,
        });
        lastError = null;
      } catch (error) {
        lastError = `Local model unavailable: ${error.message}`;
        recordFailure(id, armedText, error.kind, error);
      } finally {
        inFlight -= 1;
        onChange();
      }
    }, debounceMs);
    timers.set(id, { timer, text: armedText });
  }

  function sync(nextText) {
    if (disposed) return;
    text = nextText;
    const known = new Set(sentences.map((sentence) => sentence.id));
    // Projected before anything else looks at them: identity, the dismissal record, the
    // completeness test and every suggestion offset are in terms of the prose.
    rawSentences = reconcileSentences(rawSentences, text);
    const nextCache = new Map();
    sentences = rawSentences.map((raw) => {
      let cached = nextCache.get(raw.text) ?? projectionCache.get(raw.text);
      if (!cached) cached = computeProjection(raw.text);
      nextCache.set(raw.text, cached);
      return { ...raw, raw: raw.text, text: cached.text, projection: cached.projection, complete: cached.complete };
    });
    projectionCache = nextCache;
    store.reconcile(sentences);
    const live = new Set(sentences.map((sentence) => sentence.id));
    for (const id of [...analyzed.keys()]) if (!live.has(id)) analyzed.delete(id);
    for (const id of [...failures.keys()]) if (!live.has(id)) failures.delete(id);
    // Text deleted outright, rather than merely left unfinished, may still have a pending
    // timer and a request in flight. Neither may reach the model. Withdrawn as ONE batch:
    // invalidating one at a time freed a slot that immediately started the next queued
    // request — often another sentence in this same dead set.
    const dead = [];
    for (const id of new Set([...known, ...timers.keys()])) {
      if (live.has(id)) continue;
      clearTimer(id);
      dead.push(id);
    }
    coordinator.withdraw(dead);

    schedulePass();
  }

  // Decides what to ask about, from sentences that have already been segmented. Scrolling
  // changes no text, so this is all a scroll has to do: no re-segmentation and no identity
  // reconciliation, just a second look at which known sentences are now worth the model's
  // time.
  function schedulePass() {
    // Decided in two stages, because the order matters. Freeing a slot restarts the
    // queue, so everything being withdrawn has to be gone before that happens — or the
    // queue starts the next off-screen sentence on its way past.
    const withdrawn = [];
    const schedule = [];

    for (const sentence of sentences) {
      // Not prose. A suggestion already on screen has to be withdrawn, not merely left
      // unrefreshed: the sentence's own text may be untouched, so nothing else drops it.
      if (isExcluded(sentence) || !HAS_LETTER.test(sentence.text) || CODE_FENCE.test(sentence.raw)) {
        store.remove(sentence.id);
        analyzed.delete(sentence.id);
        clearTimer(sentence.id);
        withdrawn.push(sentence.id);
        continue;
      }
      // Unfinished, or off screen. Two different reasons to stop, one behaviour: take
      // back the work and leave everything already known about the sentence alone. The
      // suggestion, the dismissal and the record of having decided all survive, which is
      // what makes scrolling back free.
      //
      // Taking back the work has to reach requests already submitted, not just debounces
      // that have not fired — every debounce in a window fires within milliseconds of the
      // others, so by the time anyone has scrolled, the queue is where the work is. A
      // queue nobody re-examines drains from the top of the note downwards regardless of
      // where the writer is looking. And a RUNNING request is the one most worth taking
      // back, because aborting it hands the model's single slot to the text on screen.
      if (!sentence.complete || !isVisible(sentence)) {
        clearTimer(sentence.id);
        withdrawn.push(sentence.id);
        continue;
      }
      if (analyzed.get(sentence.id) === sentence.text) continue; // already decided
      if (store.isDismissed(sentence.id, sentence.text)) continue;
      if (heldBack(sentence.id, sentence.text)) continue;        // spent its retries
      schedule.push(sentence);
    }

    coordinator.withdraw(withdrawn);
    for (const sentence of schedule) scheduleAnalysis(sentence);

    if (lastError && inFlight === 0 && timers.size === 0 && coordinator.pending === 0) lastError = null;
    onChange();
  }

  // A document edit happened in the editor and the full resync has not run yet. The
  // editor maps every offset through the transaction's ChangeSet so that anything read
  // in the gap — marks, the accept guard, visibility — addresses the characters where
  // they now are. Text content is deliberately NOT touched: a sentence whose own text
  // changed will fail accept's exact-text guard until the resync re-reads it, which is
  // the safe direction.
  function mapOffsets(mapPosition) {
    for (const sentence of rawSentences) {
      sentence.start = mapPosition(sentence.start, 1);
      sentence.end = mapPosition(sentence.end, -1);
    }
    for (const sentence of sentences) {
      sentence.start = mapPosition(sentence.start, 1);
      sentence.end = mapPosition(sentence.end, -1);
    }
  }

  // The viewport moved. Same text, different question about it.
  function refresh() {
    if (disposed) return;
    schedulePass();
  }

  // Absolute document ranges to underline, sorted, with the suggestion each belongs to.
  //
  // The diff is computed in prose coordinates and mapped back through the projection, so
  // a range that spans a delimiter arrives as two runs with the delimiter between them.
  // In Live Preview the delimiter renders as nothing and the two read as one underline;
  // in Source mode the asterisks are visibly left alone, which is also what should happen.
  //
  // The projection is taken from the CURRENT sentence rather than from the suggestion:
  // markup can be edited without the prose changing at all, and the offsets have to
  // follow the characters that are actually there.
  function marks() {
    const found = [];
    for (const suggestion of store.list()) {
      const sentence = sentences.find((candidate) => candidate.id === suggestion.id);
      if (!sentence || sentence.text !== suggestion.source) continue;
      for (const range of changedSourceRanges(suggestion.source, suggestion.replacement)) {
        for (const run of sourceRuns(sentence.projection, range.start, range.end)) {
          found.push({ id: suggestion.id, start: sentence.start + run.from, end: sentence.start + run.to });
        }
      }
    }
    return found.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function suggestionAt(position) {
    for (const mark of marks()) {
      if (position >= mark.start && position <= mark.end) {
        const suggestion = store.get(mark.id);
        if (suggestion) return { suggestion, mark };
      }
    }
    return null;
  }

  // The document edits that apply a suggestion, in absolute coordinates, along with the
  // raw text they assume so the caller can check the document has not moved underneath
  // them. Several edits rather than one: the replacement is prose, and the markup it is
  // threaded through has to survive it.
  //
  // The suggestion is retired and its own output recorded as decided here, BEFORE the
  // caller applies the edits, because applying them triggers a resync — and a resync that
  // still saw the suggestion would send the model's own sentence back for a second opinion.
  function accept(id) {
    const suggestion = store.get(id);
    const sentence = sentences.find((candidate) => candidate.id === id);
    if (!suggestion || !sentence || sentence.text !== suggestion.source) return null;
    const edits = sourceEdits(sentence.projection, suggestion.replacement).map((edit) => ({
      from: sentence.start + edit.from,
      to: sentence.start + edit.to,
      insert: edit.insert,
    }));
    if (edits.length === 0) return null;
    store.remove(id);
    // A model-stage accept is recorded as decided — that guard is what stops the model
    // being sent its own output for a second opinion. A mechanics- or grammar-tier
    // accept is NOT: the writer took the fast local card, and the corrected sentence
    // the model never saw may still deserve a clarity rewrite, so the resync schedules it.
    if (suggestion.stages?.model) analyzed.set(id, suggestion.replacement);
    // A request still in flight for the pre-accept text can only be refused when it
    // lands; withdrawing it hands the slot back now. Matters since the mechanical pass
    // began surfacing suggestions while the model call is still running.
    coordinator.invalidate(id);
    return { edits, from: sentence.start, to: sentence.end, raw: sentence.raw };
  }

  function dismiss(id) {
    const suggestion = store.get(id);
    if (!suggestion) return;
    store.dismiss(id, suggestion.source);
    onChange();
  }

  // The mechanics toggle changes what the pipeline would answer, so every previous
  // decision has to be thrown away rather than reused.
  function invalidateAll() {
    analyzed.clear();
    failures.clear();
    for (const suggestion of store.list()) store.remove(suggestion.id);
    for (const armed of timers.values()) clearTimeout(armed.timer);
    timers.clear();
    // Requests in flight were issued under the OLD settings. Left running, the resync's
    // re-submit joined them and committed a stale-settings answer as the decision.
    coordinator.withdraw(sentences.map((sentence) => sentence.id));
    sync(text);
  }

  return {
    sync,
    refresh,
    mapOffsets,
    marks,
    suggestionAt,
    accept,
    dismiss,
    invalidateAll,
    get store() { return store; },
    get status() {
      let held = 0;
      for (const entry of failures.values()) if (entry.attempts >= entry.max) held += 1;
      return {
        count: store.size,
        inFlight,
        rejected: rejectedCount,
        pending: coordinator.pending,
        waiting: timers.size,
        held,
        error: lastError,
      };
    },
    dispose() {
      disposed = true;
      for (const armed of timers.values()) clearTimeout(armed.timer);
      timers.clear();
      coordinator.dispose();
    },
  };
}
