# Tolben for Obsidian

The engine inside a real editor: does the blue underline read as well over a note in
Obsidian as it does in the web demo? It does, and this is now the surface the project
is built around.

It works in **Source mode and Live Preview**, and it provisions its own model server:
enabling it opens a pane that says what it would download, with every URL, size and
sha256, and downloads nothing until someone says so. A `llama-server` or Ollama already
running on loopback is found and used instead.

**One thing is still missing before a stranger on any machine can install it.** The
llama.cpp binaries in `runtime/manifest.json` carry no recorded sha256 yet, because the
machine this was built on cannot reach the GitHub releases API. Until
`node tools/pin-runtime.mjs --write` has been run (CI does it), the managed runtime
reports itself unavailable and the plugin falls back to an Ollama or llama-server the
writer runs themselves. This is deliberate: an artefact with no pin is never fetched.

## What is actually new here

Almost nothing. `../src` is imported unchanged — engine, pipeline, safety, segmenter,
identity, store, coordinator, diff. This directory adds only:

| File | What it does |
|---|---|
| `main.mjs` | The Obsidian plugin: settings, status bar, engine wiring. Replaces `server.mjs`. |
| `controller.mjs` | The DOM-free half of `app-core.mjs` — which sentences get analysed, and what is currently suggested. |
| `markdown.mjs` | The prose projection and the offset map back: what the model is shown, and where its answer lands. |
| `styles.css` | The mark and the card. The card paints its own surface — see below. |
| `harness/` | A real `EditorView` running the real extension against a stub model. The viewport behaviour does not exist outside a live CodeMirror, so it cannot be tested anywhere else. |
| `underline.mjs` | The CodeMirror 6 layer: mark decorations, the hover card, and the syntax-tree exclusion of everything that is not prose. Replaces the demo's overlay mirror. |
| `node-fetch.mjs` | A `fetch`-shaped adapter over `node:http`, so the model call is not a cross-origin request from `app://`. |
| `rank.mjs` | Which sentence gets the model's single slot next: distance from the viewport, then document order. |
| `outcome-cache.mjs` | Analysed sentences remembered **in memory** for the session, so re-reading a note does not re-ask the model. Nothing is written to the vault. |
| `ledger.mjs` | What the gate refused, per note, in memory. The command "Show refusal ledger for this note" reads it. |
| `network-log.mjs` | A counter around the plugin's only request function, so "nothing leaves your machine" can be shown rather than asserted. |
| `panes.mjs` | The setup, ledger and network screens, and the status line. Plain DOM, so jsdom can test them. |
| `runtime/` | The provisioner: what to download, from where, verified how, and how to start and stop it. See below. |
| `build.mjs` | The esbuild bundle. `main.js` is its tracked output, and `tests/plugin-bundle.test.mjs` fails if the two drift apart. |

Two things the demo could not have, which come free from CodeMirror:

- **Replace lands in the native undo stack.** It is an ordinary transaction, so one
  Cmd+Z reverts it. The demo needed `execCommand` and could not always get it.
- **No overlay alignment.** Decorations sit on the real text, so the whole class of
  "the underline is one line too high in a scrolled document" bug does not exist.

## The runtime

`runtime/` is what makes the plugin installable rather than a developer's checkout. One
rule runs through all of it: **an artefact with no recorded sha256 is never fetched.** Not
fetched-and-checked — not fetched. A model server arriving from a URL nobody pinned is
exactly what this project tells people it does not do.

| File | What it does |
|---|---|
| `manifest.json` | Every byte that may be fetched, pinned. Q6_K is the artefact `REPORT.md`'s numbers describe; Q4_K_M is offered and labelled as not. |
| `manifest.mjs` | Which build this platform and CPU should run — and, when none may be, why, in words the setup pane shows verbatim. |
| `cpu.mjs` | AVX2 from `/proc/cpuinfo` and `sysctl`. Windows cannot be asked cheaply, so there the guess is optimistic and checked by running the binary: a build the CPU cannot execute is recognised by how it dies. |
| `detect.mjs` | Ollama on `:11434` and llama-server on `:8080`, in parallel, on a short timeout. |
| `download.mjs` | Resumable and verified. The hash is of the bytes on disk, not the stream; a server that ignores `Range` is not appended to; the file is `.part` until it matches. |
| `unpack.mjs` | A zip reader, so no `tar` or `unzip` need exist. `../`, absolute paths and symlinks are refused rather than sanitised. |
| `server.mjs` | Spawn on a random loopback port with a per-launch API key, the flags every published number was measured with, health, warm-up, slot save/restore, and a PID file that will not signal a reused PID. |
| `ollama.mjs` | The pull, and a probe of whether this Ollama's `/v1` honours `keep_alive` and suppresses reasoning. Where it does not, `/api/chat` is used instead. |
| `messages.mjs` | What to say when Gatekeeper, SmartScreen, an antivirus, Flatpak or Snap stops a downloaded binary. |
| `provision.mjs` | The order: reap an orphan, ask what is running, build a plan, stop. It will not download without `confirmed: true`. |

`node tools/provision.mjs --plan` runs the same code with a terminal instead of a pane.

## Install

### From a release

Download `main.js`, `manifest.json` and `styles.css` from a GitHub Release into
`<vault>/.obsidian/plugins/tolben/`, or point BRAT at this repository. Enable **Tolben** under
Settings → Community plugins, with Restricted Mode off.

### From this checkout

The plugin folder in the vault is a symlink to this directory, so an edit here plus a
rebuild is live in Obsidian after a reload.

```
npm run plugin:build          # or plugin:watch
ln -s "$PWD/obsidian-plugin" "<vault>/.obsidian/plugins/tolben"
```

Reload with Cmd+P → "Reload app without saving" after each rebuild.

## Use

1. Enable the plugin. The setup pane opens once, says what it would download, and waits.
2. Open any note. Source mode and Live Preview both work.
3. Finish a sentence. Changed words get a blue underline; hover one for the card.

The status bar reads `Tolben: ready · local · 3 suggestions · 2 refused`. Two commands are
worth knowing:

- **Show refusal ledger for this note** — every rewrite the model produced and the gate
  stopped, with the rule that stopped it. This is the most useful bug report you can send.
- **Show what talks to the network** — every request the plugin has made since it loaded,
  counted by host, with the model's hash and whether it is the measured artefact.

Settings → Tolben has the endpoint, the tier toggles, the gate mode, the typing delay, the
idle-unload timeout, and **Never drop words** — which refuses any rewrite that loses a
word rather than asking the model whether the rest of the sentence still says it. It is
off by default, and its description says what turning it on costs.

## What is written where

| | |
|---|---|
| Your vault | `data.json` in the plugin folder, holding the settings. Nothing else — `tests/plugin-vault.test.mjs` fails the build if any code that could write elsewhere appears. |
| Your OS data directory | The model and the llama.cpp binary, under `tolben/`. Outside the vault deliberately: 1.5 GB inside a synced vault is a bad afternoon for whoever pays for the sync. |
| Memory only | The outcome cache and the refusal ledger. Both go when Obsidian closes. |

## Markdown: the model sees prose

Formatted sentences used to get nothing. The model was shown raw markdown, answered in
prose, and the markup check refused the rewrite for losing the syntax — correctly, and
uselessly. So the sentence is now projected to the prose a reader actually sees, and the
answer is mapped back.

```
source       **The archive** is *copied on a weekly* basis.
prose        The archive is copied on a weekly basis.      <- what the model is asked about
underline               ^^^^                ^^^^^          <- mapped back, on rendered words
replace      **The archive** is *copied weekly*.
```

`markdown.mjs` holds the projection and both directions of the map:

- **Flatten.** Emphasis, strong, highlight and strikethrough delimiters, block markers,
  and link syntax are dropped; `[text](url)` and `[[target|alias]]` contribute their
  visible text; inline code contributes its contents; embeds and images contribute
  nothing. A delimiter that cannot be one is left alone — `3 * 4` and `api_key` are prose.
- **Protect.** Inline code and link text ride along as `protectedTerms`, which
  `validateRewrite` holds immutable, so a rewrite can rephrase around a command or a link
  but never inside one.
- **Map back.** A prose range becomes one source range per contiguous run, so markup
  falling inside it sits in the gaps and is never underlined. Replace is the same mapping
  applied as edits: the new text goes into the first run, the rest are emptied, every
  delimiter survives. It is one CodeMirror transaction however many edits that takes, so
  one Cmd+Z still reverts the whole thing.

Where a changed span crosses a delimiter, the emphasis keeps wrapping what is left of the
phrase: `The tool *has the ability* to recover files.` becomes `The tool *can* recover
files.` The alternative — refusing any edit that crosses a boundary — is silence on most
formatted sentences, which is the thing this exists to fix.

Three defences remain, and they are now backstops rather than the main event:

1. **`markupTokens` in `src/safety.mjs`** refuses a rewrite whose markdown tokens differ
   between the two sides. The projection means the model is never shown markup it could
   lose, so this fires only if one is invented. The web demo, which sends raw text, still
   relies on it directly.
2. **Non-prose regions never reach the model** — code, math, HTML and frontmatter, by
   node name from CodeMirror's syntax tree.
3. **A code fence in the raw text excludes the sentence** regardless of the syntax tree,
   which parses lazily and may not have reached it yet.

Observed against the local model, on a note holding all of the above: the two archive
sentences produce the same two marks whether or not they are formatted;
`- The tool *has the ability* to recover files.` becomes `- The tool *can* recover
files.`; ``The tool has the ability to run `npm test` first.`` keeps its code span; and
`**Teh and cat leak a table!**` is refused by the ordinary prose rule for turning `!`
into `.` rather than for anything to do with markup.

## Why the card paints its own surface

CodeMirror's base theme styles `.cm-tooltip` with a light background of its own, and it
does not put that class on the view a tooltip returns. A hover tooltip is wrapped:

```
div.cm-tooltip.cm-tooltip-hover > div.cm-tooltip-section > our card
```

so the painted element is the wrapper, not the card. Styling the card as though it were
the tooltip leaves CM's grey square container standing around it — at CM's width rather
than ours, which is why a long sentence ran the full width of the window.

The wrapper is therefore reset to nothing, and the card paints itself: the demo's fixed
palette rather than Obsidian's variables, so it reads the same in the browser and in the
vault whatever theme is set. The buttons state their properties too, because Obsidian
styles bare `button` app-wide.

That was established on a local scratch page, not shipped here, that reproduced the DOM,
CM's base rule and Obsidian's button styles on a dark ground. An earlier version of it
assumed the card *was* the tooltip element and passed a stylesheet that was broken in the
app; the lesson survives in `styles.css`, not in a file in this tree.

## Only what you can see

The document is segmented in full, but only sentences near the viewport are sent to the
model — the way Grammarly behaves, and for a stronger reason here: **CodeMirror renders
only the viewport, so a suggestion outside it has nowhere to appear.** Analysing the whole
note spent the model's single slot on marks that could not be drawn, ahead of the paragraph
the writer was looking at.

The window is what CodeMirror has drawn, widened by its own length on either side — the
drawn range is already a screenful plus CM's overscan, so this is roughly a screen either
way without any pixel arithmetic to get wrong, with a 2000-character floor for a short pane.

Scrolling does not re-read the document. `docChanged` runs the full `sync`; `viewportMoved`
runs `refresh`, which only takes a second look at which already-segmented sentences are now
worth asking about.

A sentence leaving the window has its work **withdrawn**, wherever that work has got to.
Dropping only the unfired debounce is not enough: every debounce in a window fires within
milliseconds of the others, so by the time anyone has scrolled, the queue is where the work
is — and a queue nobody re-examines drains from the top of the note downwards no matter
where the reader is. A running request is the one most worth withdrawing, because aborting
it hands the model's single slot straight back to the text on screen.

Withdrawal is batched through `coordinator.withdraw`, which cancels the whole list and
restarts the queue once at the end. Cancelling one at a time is not equivalent: freeing a
slot restarts the queue immediately, so the caller watches it start the next entry on the
list it is still working through.

Nothing decided is forgotten on scroll — suggestions, dismissals and the record of having
decided all survive — so scrolling back costs nothing.

Measured in `harness/`, with a stub model at 600 ms a call — roughly what the local 2B
costs, so the queue is still full when the scroll happens:

| Scrolling to the far end of a 120-paragraph note | requests for text left behind | requests for text on screen |
|---|---|---|
| without withdrawal | 18 | 0 |
| with withdrawal | 0 | 17 |

Without it, five seconds after scrolling, the model had analysed nothing the reader was
looking at and everything they had left.

And the first-open cost, measured with a stub controller:

| Note | Before | After | |
|---|---|---|---|
| 2,441 words | 200 calls | 72 | 64% fewer |
| 9,151 words | 750 calls | 72 | 90% fewer |
| 24,401 words | 2,000 calls | 72 | 96% fewer |

The point is not the percentage but the shape: the cost of opening a note no longer grows
with the note.

## Performance, after the diagnosis

The measured problems in docs/PERF-DIAGNOSIS.md are fixed:

| what the user feels | before | after |
|---|---|---|
| keystroke / Replace dispatch block, 600-paragraph note | 2,036 ms | 0.3-0.6 ms |
| same at 2,000 paragraphs (655k chars) | — | 0.5-0.9 ms |
| first model call after a mid-note jump | all above-screen for 6 s+ | on-screen from the first free slot |
| mechanical repair appears | after the model, 0.3-2 s | ~50 ms, live-measured |
| model calls during continuous typing | zero, then a burst | settled sentences analysed mid-typing |
| a persistently failing sentence | one wasted call per pause + scroll, forever | two attempts, then held until the model recovers |

Since then, the clarity gate (src/gate.mjs, three-mode setting) orders or limits model
work by whether a sentence carries one of the wordy surface constructions mined from the
harvested Grammarly corpus. **Balanced** (default): gate-cleared sentences are checked
LAST instead of never — every suggestion still arrives, likely ones first. **Fast**:
cleared sentences skip the model (~40% less model time, measured) — but the gate was
scored on Grammarly's CLARITY corpus, and the model also does grammar; on a real page
six of eight suggestions were grammar-shaped and fast mode silenced them all, which is
why it is opt-in. **Off**: document order within the position tiers.

How: the segmenter's abbreviation lookbehind is bounded (was quadratic — 92% of a 3.1 s
per-keystroke sync at 40k words), reconcile pass 1 is indexed by text (was O(n·m)), the
resync runs a tick after the dispatch with offsets mapped through the ChangeSet, the
projection is memoized by raw text, the coordinator queue is priority-aware (on-screen in
reading order, then below, then above — the margins are prefetch, not peers) with one slot
to match the server's -np 1, debounces hold their countdown while the text they watch is
unchanged, and the deterministic mechanical pass surfaces without waiting for the model.

## Known limits (deliberate, at this stage)

- **Reading view does nothing**, and cannot: it is not an editor, so there is no cursor
  to Replace into and nothing to assist.
- **Exclusion follows the parsed tree.** CodeMirror parses lazily, so in a very long note
  a region that has not been parsed yet is not yet known to be a code block. Fenced blocks
  are caught from the raw text as well; other constructs are not.
- **The projection is a reader, not a parser.** It handles the inline constructs a note
  actually uses. Tables, footnotes and HTML in the middle of a paragraph are not modelled.
  Block STRUCTURE, however, is now respected by the segmenter: blank lines, headings,
  list items, table rows, rules and quotes end a sentence, and a fenced code block is one
  atomic segment. Until 2026-08-30 it split on terminal punctuation alone, so any line
  without a full stop — a heading, a list item, a signature — was glued to the paragraph
  below it across the blank line. The model was then asked about a span that was not a
  sentence, answered about the prose half, and the safety layer refused the answer for
  losing the other half's names or markup: a correct suggestion, computed and silently
  discarded, with no underline to show for it. A vault note had 27 such spans. A single
  newline is still NOT a boundary, because prose wrapped across lines is one sentence, and
  a quote is one block for its whole `>` run — cutting per line handed the model a
  fragment of a wrapped sentence. Table rows and fenced blocks are atomic: scanning a row
  for sentences cut it at the full stop inside a cell, and accepting the rewrite then
  deleted the row's leading pipe. A segment carrying a fence is never projected either,
  since it can never be analysed — with an UNCLOSED fence that segment is the whole tail
  of the note, and re-flattening it on every keystroke cost 18.9 ms a resync against a
  ~15 ms budget (now 1.2 ms).
- **The deferred resync is still whole-document.** Segmentation and reconciliation are now
  linear and off the dispatch path (~15 ms at 8,000 sentences), so this stops mattering
  until notes get an order of magnitude longer; a change-mapped incremental resync is the
  next step if they do.
