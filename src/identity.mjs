// Stable sentence identity across edits.
//
// The whole UX rests on this: a suggestion on sentence 1 must survive the user typing
// sentence 2. Identity therefore follows the sentence, not its index and not its offsets.

import { segmentSentences, trimSegment, isCompleteSentence } from "./segmenter.mjs";

let nextId = 1;
export function resetIds() { nextId = 1; }

// Matches new segments against previous ones by text, so that unchanged sentences keep
// their id even when text is inserted before or after them.
export function reconcileSentences(previous, text) {
  const current = segmentSentences(text).map((segment) => {
    const trimmed = trimSegment(segment);
    return { ...trimmed, complete: isCompleteSentence(trimmed.text) };
  });

  const used = new Set();      // previous ids already claimed
  const matched = new Map();   // index in `current` -> the previous sentence it matched
  const assigned = current.map((segment) => ({ ...segment, id: null, changed: true }));

  // Pass 1: identical text keeps its identity. Where several previous sentences share
  // that text, the nearest one by offset wins rather than simply the first, so editing
  // one of a pair of identical sentences does not hand its history to the other.
  //
  // Candidates are indexed by text up front. Scanning all of `previous` for every current
  // segment was O(n*m) — 1.8 s per keystroke at 8,000 sentences, the largest cost left
  // once segmentation stopped being quadratic. The index preserves every decision: within
  // one text the candidates keep document order, so the strict `<` tie-break still picks
  // the earliest of equally-distant candidates, exactly as the full scan did (pinned by
  // the reference fuzz in tests/identity-index.test.mjs). A run of thousands of
  // byte-identical sentences still degrades toward the old cost inside its own bucket;
  // no real document has been seen to do that.
  const byText = new Map();
  for (const candidate of previous) {
    const bucket = byText.get(candidate.text);
    if (bucket) bucket.push(candidate);
    else byText.set(candidate.text, [candidate]);
  }
  for (const [index, segment] of assigned.entries()) {
    const candidates = byText.get(segment.text);
    if (!candidates) continue;
    let best = null;
    for (const candidate of candidates) {
      if (used.has(candidate.id)) continue;
      const distance = Math.abs((candidate.start ?? 0) - (segment.start ?? 0));
      if (best === null || distance < best.distance) best = { candidate, distance };
    }
    if (best === null) continue;
    used.add(best.candidate.id);
    matched.set(index, best.candidate);
    assigned[index].id = best.candidate.id;
    assigned[index].changed = false;
  }

  // Pass 2: an unmatched segment inherits the unused id at its own position, so editing a
  // sentence in place is an edit rather than a delete plus an insert.
  for (const [index, segment] of assigned.entries()) {
    if (segment.id !== null) continue;
    const candidate = previous[index];
    if (candidate && !used.has(candidate.id)) {
      used.add(candidate.id);
      segment.id = candidate.id;
    }
  }

  // Identical sentences can only be told apart by how many of them there are. If one of a
  // set of duplicates has disappeared and no edit above accounts for it, there is no way
  // to know which one the writer deleted - so the survivors are given new identities
  // instead of inheriting a history (a mark, a dismissal) that may belong to the sentence
  // that is gone. Losing a mark costs one re-analysis; inheriting a dismissal silently
  // suppresses a suggestion the writer never dismissed.
  const duplicated = new Set();
  const orphaned = new Set();
  const seen = new Set();
  for (const candidate of previous) {
    if (seen.has(candidate.text)) duplicated.add(candidate.text);
    seen.add(candidate.text);
    if (!used.has(candidate.id)) orphaned.add(candidate.text);
  }
  for (const [index, candidate] of matched) {
    if (!duplicated.has(candidate.text) || !orphaned.has(candidate.text)) continue;
    used.delete(candidate.id);
    assigned[index].id = null;
    assigned[index].changed = true;
  }

  for (const segment of assigned) {
    if (segment.id === null) segment.id = `s${nextId++}`;
  }
  return assigned;
}
