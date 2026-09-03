// A real EditorView running the plugin's real extension, with a stub model.
//
// This exists because the viewport behaviour has no meaning outside a live CodeMirror:
// visibleRanges, viewportMoved and the queue draining against them cannot be reproduced
// with a fake view. Open index.html and drive it from the console or from Playwright:
//
//   window.asked    every analyze call, in order, with an `aborted` flag
//   window.probe()  the plugin's current window, CodeMirror's viewport, queue depth
//
// It caught a real bug: after scrolling to the far end of a note, every request the model
// ran was for text the reader had left, and none for what was on screen.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { clarityExtension } from "../underline.mjs";

// Every sentence is unique, so a recorded call can be traced to one position in the
// document. An earlier version of this harness repeated one paragraph 120 times, which
// made indexOf report the first copy for every call and manufactured evidence of work
// happening at the top of the note that was really happening wherever the reader was.
const paragraph = (i) => [
  `Paragraph ${i} notes that delivering dataset ${i} on the platform does not block delivery.`,
  `As reviewer ${i} said, if resources become available for task ${i}, this can proceed.`,
  `The flow from stage ${i} rightward is not blocked by pipeline ${i}.`,
  `Archive ${i} is copied on a weekly basis.`,
  `Tool ${i} has the ability to recover files.`,
].join(" ");
const paragraphs = Number(new URLSearchParams(location.search).get("paragraphs")) || 120;
const doc = Array.from({ length: paragraphs }, (_, i) => paragraph(i)).join("\n\n") + "\n";

// Roughly what the local 2B model costs per sentence, so the queue is still full when a
// scroll happens — which is the whole situation being measured.
const LATENCY_MS = 600;

const asked = [];
window.asked = asked;
window.docText = doc;

const clarity = clarityExtension({
  debounceMs: 20,
  analyze: async (sentence, { signal }) => {
    const call = { sentence, at: Date.now(), aborted: false };
    asked.push(call);
    // A real call takes time; a stub that resolves instantly would drain the queue
    // faster than any scroll could happen and hide the behaviour being measured.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, LATENCY_MS);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        call.aborted = true;
        reject(Object.assign(new Error("aborted"), { kind: "aborted" }));
      }, { once: true });
    });
    return { source: sentence, replacement: null, reason: "", stages: {}, rejection: null };
  },
  onStatus: (status) => { window.lastStatus = status; },
});

const host = document.getElementById("editor");
const unmeasured = new URLSearchParams(location.search).has("unmeasured");
if (unmeasured) host.style.display = "none";
const view = new EditorView({
  state: EditorState.create({ doc, extensions: [EditorView.lineWrapping, clarity.extension] }),
  parent: host,
});
window.rangeAtConstruction = view.plugin(clarity.extension[1])?.range;
if (unmeasured) setTimeout(() => { host.style.display = ""; view.requestMeasure(); }, 50);
window.view = view;
// What the plugin believes it should be analysing, read straight off the instance.
// Median wall-time of a synchronous view.dispatch — the number the user feels.
function medianDispatch(makeSpec, reps) {
  const times = [];
  for (let i = 0; i < reps; i += 1) {
    const spec = makeSpec(i);
    const started = performance.now();
    view.dispatch(spec);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}
window.benchTyping = () => medianDispatch(
  () => ({ changes: { from: view.state.doc.length - 1, insert: "x" } }), 20);
window.benchAccept = () => {
  const mid = Math.floor(view.state.doc.length / 2);
  return medianDispatch(
    (i) => ({ changes: { from: mid + i, to: mid + i + 20, insert: "shorter text" } }), 5);
};

window.probe = () => {
  const instance = view.plugin(clarity.extension[1]);
  window.lastInstance = instance;
  return {
    status: instance?.controller?.status,
    range: instance?.range,
    visible: view.visibleRanges.map((r) => ({ from: r.from, to: r.to })),
    viewport: { from: view.viewport.from, to: view.viewport.to },
    docLength: view.state.doc.length,
  };
};
