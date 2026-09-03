// What the gate refused, per note, held in memory.
//
// The refusal ledger is the product's argument made visible: a checker that says "I had a
// suggestion here and would not show it to you, and here is the rule that stopped it" is
// making a claim a reader can audit, which is the whole pitch. It is also the most useful
// bug report anyone can send.
//
// In memory, deliberately, and not as a limitation to be fixed later. Writing it would
// put every sentence a writer refused and rewrote into a file in their vault: a durable
// record of their drafting that they did not ask for. It lives for the session and goes
// when Obsidian closes.

const MAX_PER_NOTE = 200;

export function createLedger({ maxPerNote = MAX_PER_NOTE, now = () => Date.now() } = {}) {
  const notes = new Map();   // path -> Map(key -> entry)

  const keyOf = (source, replacement) => `${source} ${replacement ?? ""}`;

  return {
    /**
     * Record a refusal. Idempotent per (note, sentence, proposal): a note re-analysed
     * after a settings change must not report the same refusal five times.
     */
    record(path, { source, replacement, reason, stage = "gate" }) {
      if (!path || !source || !reason) return;
      const note = notes.get(path) ?? new Map();
      const key = keyOf(source, replacement);
      if (!note.has(key)) {
        note.set(key, { source, replacement: replacement ?? null, reason, stage, at: now() });
        // Oldest out first: a long session on one note must not grow without bound, and
        // the recent refusals are the ones anyone is looking for.
        if (note.size > maxPerNote) note.delete(note.keys().next().value);
      }
      notes.set(path, note);
    },
    /** Most recent first, because that is the one someone just watched not happen. */
    forNote(path) {
      return [...(notes.get(path)?.values() ?? [])].reverse();
    },
    countForNote(path) {
      return notes.get(path)?.size ?? 0;
    },
    /** Forget a note's refusals, on close or when the writer asks. */
    clear(path) {
      if (path) notes.delete(path);
      else notes.clear();
    },
    /** For the "what is in memory" line of the network pane. */
    stats() {
      let entries = 0;
      for (const note of notes.values()) entries += note.size;
      return { notes: notes.size, entries };
    },
    /**
     * The ledger as text, for a bug report. Deliberately plain: someone pasting this into
     * an issue should not have to strip formatting out of it.
     */
    asText(path) {
      const rows = this.forNote(path);
      if (rows.length === 0) return "Nothing was refused in this note.";
      return [
        `${rows.length} refusal${rows.length === 1 ? "" : "s"} in ${path}`,
        "",
        ...rows.flatMap((row) => [
          `refused: ${row.reason}`,
          `  from: ${row.source}`,
          `  to:   ${row.replacement ?? "(nothing)"}`,
          "",
        ]),
      ].join("\n");
    },
  };
}
