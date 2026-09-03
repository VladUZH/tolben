import { reconcileSentences } from "./identity.mjs";
import { createStore } from "./store.mjs";
import { createCoordinator } from "./coordinator.mjs";
import { changedSourceRanges, inlineDiffParts } from "./diff.mjs";

// The whole editor behaviour, with its document and transport injected so that the
// interaction matrix can be driven headlessly.
export function createApp({ document, window, fetchImpl = window.fetch.bind(window), debounceMs = 140 } = {}) {
  const editor = document.getElementById("editor");
  const overlay = document.getElementById("overlay");
  const card = document.getElementById("card");
  const cardDiff = document.getElementById("card-diff");
  const cardReason = document.getElementById("card-reason");
  const statusEl = document.getElementById("status");
  const countEl = document.getElementById("count");
  const rejectedEl = document.getElementById("rejected");
  const latencyEl = document.getElementById("last-latency");
  const modelEl = document.getElementById("model-name");
  const mechanicsToggle = document.getElementById("mechanics");

  const store = createStore();
  let sentences = [];
  const analyzed = new Map();   // id -> text already decided
  const timers = new Map();     // id -> debounce timer
  let revision = 0;
  let inFlight = 0;
  let rejectedCount = 0;
  let activeId = null;
  let lastError = null;

  async function requestRewrite(sentence, { signal }) {
    const response = await fetchImpl("/api/rewrite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({ sentence, mechanics: mechanicsToggle.checked }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw Object.assign(new Error(messageOf(detail.error) ?? `HTTP ${response.status}`), {
        kind: response.status >= 500 ? "transient" : "failed",
      });
    }
    const outcome = await response.json();
    // A backend that reports the model failure inside a 200 must not be mistaken for a
    // clean "nothing to change": that would mark the sentence decided for good.
    if (outcome?.error) {
      throw Object.assign(new Error(messageOf(outcome.error) ?? "analysis failed"), {
        kind: outcome.error.kind === "aborted" ? "aborted" : "transient",
      });
    }
    return outcome;
  }

  function messageOf(error) {
    if (typeof error === "string") return error;
    return typeof error?.message === "string" ? error.message : null;
  }

  const coordinator = createCoordinator({
    analyze: (text, { signal }) => requestRewrite(text, { signal }),
    onResult: ({ id, text, outcome }) => {
      analyzed.set(id, text);
      if (outcome.rejection) rejectedCount += 1;
      if (typeof outcome.totalMs === "number") latencyEl.textContent = `${outcome.totalMs} ms`;
      const sentence = sentences.find((candidate) => candidate.id === id);
      // Refuse to mark text that has moved on since the request was sent.
      if (!sentence || sentence.text !== text) return;
      if (store.isDismissed(id, text)) return;
      if (!outcome.replacement || outcome.replacement === text) {
        store.remove(id);
        render();
        return;
      }
      store.set({
        id,
        source: text,
        replacement: outcome.replacement,
        reason: outcome.reason ?? "",
        stages: outcome.stages,
        start: sentence.start,
        end: sentence.end,
      });
      render();
    },
  });

  function escapeHTML(value) {
    return value.replace(/[&<>]/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
  }

  function render() {
    const text = editor.value;
    const marks = [];
    for (const suggestion of store.list()) {
      for (const range of changedSourceRanges(suggestion.source, suggestion.replacement)) {
        marks.push({
          id: suggestion.id,
          start: suggestion.start + range.start,
          end: suggestion.start + range.end,
        });
      }
    }
    marks.sort((a, b) => a.start - b.start);

    let html = "";
    let cursor = 0;
    for (const mark of marks) {
      if (mark.start < cursor) continue;
      html += escapeHTML(text.slice(cursor, mark.start));
      html += `<mark data-id="${mark.id}">${escapeHTML(text.slice(mark.start, mark.end))}</mark>`;
      cursor = mark.end;
    }
    html += escapeHTML(text.slice(cursor));
    // A textarea renders the empty line after a trailing newline; a pre-wrap element
    // drops it. Without a sentinel the mirror is one line short, so its scrollHeight
    // clamps early and every mark in a scrolled document sits a line too high.
    if (text.endsWith("\n")) html += "\u200b";
    overlay.innerHTML = html;
    overlay.scrollTop = editor.scrollTop;

    countEl.textContent = String(store.size);
    rejectedEl.textContent = String(rejectedCount);
    if (lastError) setStatus(lastError, "error");
    else if (inFlight > 0) setStatus("Reviewing sentence…", "checking");
    else if (store.size > 0) setStatus(`${store.size} suggestion${store.size === 1 ? "" : "s"}`, "active");
    else setStatus("Looks clear", "idle");
  }

  function setStatus(text, state) {
    statusEl.textContent = text;
    statusEl.dataset.state = state;
  }

  function scheduleAnalysis(sentence) {
    clearTimeout(timers.get(sentence.id));
    const id = sentence.id;
    const armedText = sentence.text;
    timers.set(id, setTimeout(async () => {
      timers.delete(id);
      // Re-read at fire time: an edit or an accepted Replace may have changed the
      // sentence since the timer was armed, and submitting the captured text sent the
      // model text that was no longer in the document — then recorded its answer as
      // the decision for the text that is.
      const current = sentences.find((candidate) => candidate.id === id);
      if (!current || current.text !== armedText) return;
      // The decision this timer was armed for may have arrived while it waited: the
      // condition that put it here is checked when it schedules and again when it fires,
      // or the same sentence is asked about twice.
      if (analyzed.get(id) === current.text) return;
      if (store.isDismissed(id, current.text)) return;
      revision += 1;
      inFlight += 1;
      render();
      try {
        await coordinator.submit({ id, revision, text: current.text });
        lastError = null;
      } catch (error) {
        lastError = `Local model unavailable: ${error.message}`;
      } finally {
        inFlight -= 1;
        render();
      }
    }, debounceMs));
  }

  function syncFromEditor() {
    const known = new Set(sentences.map((sentence) => sentence.id));
    sentences = reconcileSentences(sentences, editor.value);
    store.reconcile(sentences);
    const live = new Set(sentences.map((sentence) => sentence.id));
    for (const id of [...analyzed.keys()]) if (!live.has(id)) analyzed.delete(id);
    // Text that was deleted outright, rather than merely left unfinished, still had a
    // pending timer and possibly a request in flight. Both are about text that no longer
    // exists, so neither may reach the model.
    for (const id of new Set([...known, ...timers.keys()])) {
      if (live.has(id)) continue;
      clearTimeout(timers.get(id));
      timers.delete(id);
      coordinator.invalidate(id);
    }

    for (const sentence of sentences) {
      if (!sentence.complete) {
        coordinator.invalidate(sentence.id);
        clearTimeout(timers.get(sentence.id));
        timers.delete(sentence.id);
        continue;
      }
      if (analyzed.get(sentence.id) === sentence.text) continue; // already decided
      if (store.isDismissed(sentence.id, sentence.text)) continue;
      scheduleAnalysis(sentence);
    }
    // A failure describes a request; once nothing is queued, running or waiting to be
    // retried, there is no request left for it to describe.
    if (lastError && inFlight === 0 && timers.size === 0 && coordinator.pending === 0) lastError = null;
    render();
  }

  function closeCard() {
    card.hidden = true;
    activeId = null;
  }

  function openCard(id, markElement) {
    const suggestion = store.get(id);
    if (!suggestion) return closeCard();
    activeId = id;
    const parts = inlineDiffParts(suggestion.source, suggestion.replacement);
    cardDiff.innerHTML = parts
      .map((part, index) => {
        const text = escapeHTML(part.text);
        const body = part.type === "delete" ? `<span class="del">${text}</span>`
          : part.type === "insert" ? `<span class="ins">${text}</span>`
          : text;
        // No space before punctuation that closes a word, none at the start, and none
        // after a hyphen or an opening mark, so "goods-in" stays one word.
        const previous = index > 0 ? parts[index - 1].text : "";
        const joined = index > 0 &&
          !/^[,.;:!?)\]}'’”\-/]/u.test(part.text) &&
          !/[-(\[{'‘“/]$/u.test(previous);
        return (joined ? " " : "") + body;
      })
      .join("");
    const attribution = suggestion.stages?.model ? "Local model"
      : suggestion.stages?.rule ? "Clarity rule"
      : "Mechanical fix";
    cardReason.textContent = `${suggestion.reason} · ${attribution}`;
    card.hidden = false;
    const rect = markElement.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 8;
    const left = Math.min(rect.left + window.scrollX, window.innerWidth - card.offsetWidth - 16);
    card.style.top = `${top}px`;
    card.style.left = `${Math.max(16, left)}px`;
  }

  function replaceActive() {
    const suggestion = store.get(activeId);
    if (!suggestion) return closeCard();
    const { start, end, replacement, source } = suggestion;
    // Guard: only replace if the text still reads exactly as it did when analysed.
    if (editor.value.slice(start, end) !== source) {
      store.remove(activeId);
      closeCard();
      render();
      return;
    }
    // execCommand fires `input` synchronously in a real browser, which re-enters
    // syncFromEditor before this function resumes. Every piece of state that decides
    // what that sync does has to be settled first, or the model's own output is sent
    // straight back for a second opinion.
    const id = activeId;
    store.remove(id);
    analyzed.set(id, replacement);
    closeCard();
    editor.focus();
    editor.setSelectionRange(start, end);
    // execCommand keeps this inside the browser's own undo stack, so one Cmd+Z reverts
    // the whole replacement. Hosts without it still get the edit through setRangeText,
    // which writes it in one call but is not itself part of the native undo stack.
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, replacement);
    } catch {
      inserted = false;
    }
    if (!inserted || editor.value.slice(start, start + replacement.length) !== replacement) {
      editor.setRangeText(replacement, start, end, "end");
    }
    syncFromEditor();
  }

  function dismissActive() {
    const suggestion = store.get(activeId);
    if (suggestion) store.dismiss(activeId, suggestion.source);
    closeCard();
    render();
  }

  // The caret position under a pointer, as { node, offset }. caretRangeFromPoint is
  // Blink and WebKit only; Gecko ships the standard caretPositionFromPoint.
  function caretAtPoint(clientX, clientY) {
    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(clientX, clientY);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(clientX, clientY);
      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    return null;
  }

  // The absolute text offset under a pointer, read from the overlay's own text nodes.
  function offsetAtPoint(clientX, clientY) {
    const caret = caretAtPoint(clientX, clientY);
    if (!caret) return null;
    let offset = 0;
    const walker = document.createTreeWalker(overlay, window.NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node === caret.node) return offset + caret.offset;
      offset += node.textContent.length;
      node = walker.nextNode();
    }
    return null;
  }

  // Clicking underlined text must still put the caret there.
  overlay.addEventListener("mousedown", (event) => {
    if (!event.target.closest("mark")) return;
    const offset = offsetAtPoint(event.clientX, event.clientY);
    if (offset === null) return;
    event.preventDefault();
    editor.focus();
    editor.setSelectionRange(offset, offset);
  });

  overlay.addEventListener("mouseover", (event) => {
    const mark = event.target.closest("mark");
    if (mark) openCard(mark.dataset.id, mark);
  });
  overlay.addEventListener("click", (event) => {
    const mark = event.target.closest("mark");
    if (mark) openCard(mark.dataset.id, mark);
  });
  document.addEventListener("mousedown", (event) => {
    if (!card.hidden && !card.contains(event.target) && !event.target.closest("mark")) closeCard();
  });
  document.getElementById("replace").addEventListener("click", replaceActive);
  document.getElementById("dismiss").addEventListener("click", dismissActive);
  editor.addEventListener("input", syncFromEditor);
  editor.addEventListener("scroll", () => { overlay.scrollTop = editor.scrollTop; });
  editor.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCard(); });
  mechanicsToggle.addEventListener("change", () => {
    analyzed.clear();          // the setting changed: previous decisions no longer apply
    for (const suggestion of store.list()) store.remove(suggestion.id);
    // Requests in flight were issued under the OLD setting; left running, the re-sync
    // joined them and committed their stale answer as the decision for the new one.
    coordinator.withdraw(sentences.map((sentence) => sentence.id));
    syncFromEditor();
  });

  const ready = fetchImpl("/api/status")
    .then((response) => response.json())
    .then((status) => {
      modelEl.textContent = status.ready ? status.model : "unavailable";
      if (!status.ready) lastError = `Model unavailable: ${status.error}`;
      render();   // never overwrite a failure the editor has already reported
    })
    .catch(() => { lastError = "Backend unavailable"; render(); });

  syncFromEditor();
  return { store, editor, overlay, card, coordinator, ready, syncFromEditor, render, openCard, closeCard, replaceActive, dismissActive };
}
