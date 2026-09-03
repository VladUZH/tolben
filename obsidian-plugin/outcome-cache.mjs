// A model answer, once paid for, is never paid for again — across sessions.
//
// Reopening a note used to re-run the model over every sentence, including text that had
// not changed since yesterday. This cache remembers what the model said, keyed by the
// sentence and everything else that could change the answer: the fingerprint folds in
// the model name, both prompts, and the settings that alter outcomes, so a cache written
// under one configuration is dropped whole rather than answering for another.
//
// Only MODEL answers are worth remembering. Mechanics, rules and the gate recompute in
// microseconds; the caller is expected to cache outcomes where the model actually ran
// (stages.model, or a recorded model rejection) and skip the rest.
//
// Keys are FNV-1a hashes of the sentence plus its protected terms, not the text itself,
// so the majority of the file — clean sentences, whose outcome is "nothing" — stores no
// prose at all. Entries that carry a replacement necessarily carry derived text; the
// cache lives next to the vault, which is already the same prose in plaintext.

// FNV-1a, 32-bit, hex — not cryptographic, and does not need to be: a collision costs
// one wrong cached answer for one sentence until an edit invalidates it, and 32 bits
// over a vocabulary of tens of thousands of sentences keeps that vanishingly rare while
// staying dependency-free. Two rounds with different seeds widen it to 64 bits.
function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function outcomeKey(sentence, protectedTerms) {
  const material = JSON.stringify([sentence, protectedTerms]);
  return fnv1a(material, 0x811c9dc5) + fnv1a(material, 0x01000193);
}

export function createOutcomeCache({ fingerprint, max = 20000, now = () => Date.now(), serialized = null } = {}) {
  let entries = new Map(); // key -> { outcome, used }

  if (serialized) {
    try {
      const parsed = JSON.parse(serialized);
      if (parsed && parsed.fingerprint === fingerprint && Array.isArray(parsed.entries)) {
        for (const [key, outcome, used] of parsed.entries) {
          if (typeof key === "string" && outcome && typeof outcome === "object") {
            entries.set(key, { outcome, used: Number(used) || 0 });
          }
        }
      }
    } catch {
      // A corrupt file is a cold start, not a crash.
      entries = new Map();
    }
  }

  function prune() {
    if (entries.size <= max) return;
    const sorted = [...entries.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key] of sorted.slice(0, entries.size - max)) entries.delete(key);
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entry.used = now();
      return entry.outcome;
    },
    set(key, outcome) {
      entries.set(key, { outcome, used: now() });
      prune();
    },
    serialize() {
      return JSON.stringify({
        fingerprint,
        entries: [...entries.entries()].map(([key, { outcome, used }]) => [key, outcome, used]),
      });
    },
    get size() {
      return entries.size;
    },
  };
}
