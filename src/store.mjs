// Suggestion state. Holds at most one suggestion per sentence and remembers dismissals
// until the sentence itself changes.

export function createStore() {
  const suggestions = new Map(); // id -> suggestion
  const dismissed = new Map();   // id -> the exact source text dismissed

  return {
    set(suggestion) {
      suggestions.set(suggestion.id, suggestion);
    },
    get(id) {
      return suggestions.get(id) ?? null;
    },
    remove(id) {
      suggestions.delete(id);
    },
    list() {
      return [...suggestions.values()].sort((a, b) => a.start - b.start);
    },
    dismiss(id, sourceText) {
      dismissed.set(id, sourceText);
      suggestions.delete(id);
    },
    isDismissed(id, sourceText) {
      return dismissed.get(id) === sourceText;
    },
    // Drops anything whose sentence has changed or disappeared, and re-anchors the rest
    // to their current offsets. Suggestions on untouched sentences survive untouched.
    reconcile(sentences) {
      const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
      for (const [id, suggestion] of [...suggestions]) {
        const sentence = byId.get(id);
        if (!sentence || sentence.text !== suggestion.source) {
          suggestions.delete(id);
          continue;
        }
        suggestions.set(id, { ...suggestion, start: sentence.start, end: sentence.end });
      }
      for (const [id, text] of [...dismissed]) {
        const sentence = byId.get(id);
        if (!sentence || sentence.text !== text) dismissed.delete(id);
      }
    },
    get size() {
      return suggestions.size;
    },
  };
}
