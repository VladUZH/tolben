// Sends completed sentences to the model and refuses to commit anything stale.
//
// Three guarantees, in the order they matter:
//   1. A reply is committed only if the request that produced it is still the current
//      one for its sentence. Identity of the request object decides that, not its
//      revision number, so a caller that reuses a revision cannot let a stale reply
//      through. Revisions must still be strictly increasing per id; they are carried
//      through to onResult for the caller's own bookkeeping.
//   2. Asking the same question twice is one request. Re-submitting a sentence whose
//      text has not changed joins the request already in flight instead of aborting and
//      restarting it, which is what a typing debounce does on every pause.
//   3. At most `maxConcurrent` analyze calls run at once. The model server has a single
//      slot, so pasting a paragraph must not fire a request per sentence. The queue
//      delays the analyze CALL: an engine timeout budget only starts when analyze does.

export function createCoordinator({ analyze, onResult = () => {}, maxConcurrent = 2 } = {}) {
  const inFlight = new Map(); // id -> entry, queued or running
  const queue = [];           // entries waiting for a slot, oldest first
  let running = 0;
  let disposed = false;

  // The next entry is the lowest-priority one, first-submitted among equals — not the
  // oldest. Submission order is document order, so a FIFO queue drains a long note top
  // to bottom regardless of where the writer is looking; priority is how the caller says
  // "this one is on screen". Callers that never pass a priority get plain FIFO.
  function takeNext() {
    let bestIndex = -1;
    for (let index = 0; index < queue.length; index += 1) {
      const entry = queue[index];
      if (entry.cancelled) continue;
      if (bestIndex === -1 || entry.priority < queue[bestIndex].priority) bestIndex = index;
    }
    if (bestIndex === -1) {
      queue.length = 0;
      return null;
    }
    return queue.splice(bestIndex, 1)[0];
  }

  function pump() {
    if (disposed) return;
    while (running < maxConcurrent && queue.length > 0) {
      const entry = takeNext();
      if (!entry) break;
      entry.queued = false;
      running += 1;
      entry.start();
    }
  }

  // Frees the slot exactly once, whether the call ended, was aborted, or never began.
  // `resume` is false only while a batch is being withdrawn: restarting the queue there
  // would start the next entry on the list the caller is still working through.
  function release(entry, resume = true) {
    if (entry.released || entry.queued) return;
    entry.released = true;
    running -= 1;
    if (resume) pump();
  }

  function settle(entry, value) {
    if (entry.settled) return;
    entry.settled = true;
    entry.resolve(value);
  }

  function fail(entry, error) {
    if (entry.settled) return;
    entry.settled = true;
    entry.reject(error);
  }

  // An abandoned request answers nobody. Its slot is freed here rather than when analyze
  // finally settles, because an aborted call is under no obligation to settle at all.
  function cancel(entry, resume = true) {
    if (entry.cancelled) return;
    entry.cancelled = true;
    entry.controller.abort();
    if (entry.queued) {
      entry.queued = false;
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
    } else {
      release(entry, resume);
    }
    settle(entry, null);
  }

  function createEntry({ id, revision, text, context, priority }) {
    const entry = {
      id, revision, text, context, priority,
      controller: new AbortController(),
      queued: true, cancelled: false, released: false, settled: false,
    };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    entry.start = async () => {
      let outcome;
      try {
        outcome = await analyze(text, { signal: entry.controller.signal, context });
      } catch (error) {
        if (inFlight.get(id) === entry) inFlight.delete(id);
        release(entry);
        if (entry.cancelled || error?.kind === "aborted" || entry.controller.signal.aborted) {
          settle(entry, null);
        } else {
          fail(entry, error);
        }
        return;
      }
      // Stale: superseded, invalidated, or the whole coordinator is gone.
      if (disposed || entry.cancelled || inFlight.get(id) !== entry) {
        release(entry);
        settle(entry, null);
        return;
      }
      inFlight.delete(id);
      release(entry);
      const result = { id, revision, text, outcome };
      // start() is never awaited, so a throw from the caller's own handler has to be
      // handed back through the promise it is holding rather than left unhandled.
      try {
        onResult(result);
      } catch (error) {
        fail(entry, error);
        return;
      }
      settle(entry, result);
    };
    return entry;
  }

  function invalidate(id) {
    const entry = inFlight.get(id);
    if (!entry) return;
    inFlight.delete(id);
    cancel(entry);
  }

  // Cancels every listed request, queued or running, and restarts the queue once when the
  // whole batch is gone. Withdrawing one at a time is not the same thing: cancelling a
  // running request frees its slot, which starts the next queued one immediately — and for
  // a caller withdrawing a list, that is an entry it is about to withdraw anyway, already
  // begun. Batching is what makes "stop working on the text nobody is looking at" mean it.
  function withdraw(ids) {
    for (const id of ids) {
      const entry = inFlight.get(id);
      if (!entry) continue;
      inFlight.delete(id);
      cancel(entry, false);
    }
    pump();
  }

  function submit({ id, revision, text, context, priority = 0 }) {
    if (disposed) return Promise.resolve(null);
    const existing = inFlight.get(id);
    // The same sentence asked for twice is one question. Restarting it would abort a
    // request that is already asking exactly what the caller wants to know. `context` is
    // derived from the same text, so identical text carries identical context. Priority
    // is not: it is computed from the viewport at submit time, so the LATEST submit is
    // the current truth in both directions — a sentence scrolled on screen jumps the
    // queue, and one scrolled away yields it. Promote-only was measured serving a whole
    // stale screen before the text the reader had scrolled to. A running entry has no
    // rank left to change.
    // Joining also requires the same context: identical PROSE does not imply identical
    // protection — wrapping a word in backticks changes protectedTerms without changing
    // the projected text, and joining across that difference validated the reply
    // against stale terms.
    if (existing && existing.text === text
      && JSON.stringify(existing.context) === JSON.stringify(context)) {
      if (existing.queued) existing.priority = priority;
      return existing.promise;
    }
    // The replacement is queued BEFORE the superseded entry's slot is freed: cancelling
    // first let the freed slot go to whatever else was queued — under the plugin's
    // single slot, a margin sentence jumped ahead of the on-screen edit every time.
    const entry = createEntry({ id, revision, text, context, priority });
    inFlight.set(id, entry);
    queue.push(entry);
    if (existing) cancel(existing);
    pump();
    return entry.promise;
  }

  return {
    submit,
    invalidate,
    withdraw,
    get pending() { return inFlight.size; },   // queued and running
    get running() { return running; },
    dispose() {
      disposed = true;
      for (const entry of [...inFlight.values()]) cancel(entry);
      inFlight.clear();
      queue.length = 0;
    },
  };
}
