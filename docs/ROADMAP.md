# Tolben: development plan from the current tree to the end

Written 2026-09-02 on `main` @ `ac60342`. This is the execution plan. The market
research and launch planning it was derived from are kept privately and are not part of
this repository. It assumes one engineer working five-day weeks with tool
assistance, which is how the tree was built. Every date is an estimate from the effort
figures in the release strategy; every effort figure is engineer-days. Where a later phase
depends on a number nobody has yet, the phase opens with the measurement and a go/no-go
threshold rather than a promise.

## 0. Decisions taken on 2026-09-02

| Decision | Choice | Why |
|---|---|---|
| Name | **Tolben** | A coined word, adopted 2026-09-02 in place of **Stet**. Stet was abandoned on a preliminary clearance assessment: at least five other active 2026 STET writing/AI products exist — one of them a local, offline, llama.cpp-backed autocorrect and rewriting tool, which is a description of this product too — and the proofreader's-mark sense that made "Stet" apt is also what makes it refusable as merely descriptive under §2(e)(1). A coined word is arbitrary as to the goods, so neither objection reaches it. Knockout screen, 2026-09-02: npm `tolben` and the `@tolben` scope 404; no match among the 7,205 plugins in `community-plugins.json`; nothing in Apple's software catalogue; `tolben.com` unregistered; no company or product found in search. google/stet is a Go encryption CLI, unrelated to either name. **Closed 2026-09-03:** after counsel's review the owner's decision is that the name stands as it is, and no further change is required before release. |
| Licence | **Apache-2.0** for code; **CC-BY-4.0** for author-written labels, corpora and the refusal ledger; the 118 Grammarly benchmark pairs excluded from both and kept under a third-party note | Category norm (Harper, Jan, Ollama); lets other tools embed the gate; no "what's the catch" comment. The owner keeps copyright, so a later packaged product can carry its own terms without relicensing. No CLA; DCO sign-off on outside contributions for provenance. |
| Git history | Keep as is until the repository goes public; scrub paths and decide squash-or-keep at that point | Owner's call, recorded here so the launch checklist does not forget it. |
| Deletion policy | **`verify` by default**, "Never drop words" as a visible toggle, off | `REPORT.md` "Decided": on the labelled corpora `refuse` stops 0 further meaning changes and costs 15 Grammarly rows plus 48 preserving rewrites; every published number was measured under `verify`. The legal edition (phase 6) defaults the toggle **on**, because its buyers pay for refusals, not recall. |
| Model | Qwen3.5-2B Q6_K, sha256-pinned, stays the reference artefact through phase 5 | Every number is tied to it. A larger model is offered only with its own measured row (phase 5). |
| Grammar tier | Deleted, not replaced | The GECToR weights are non-commercial. Harper is recommended alongside; a permissively licensed tagger is reconsidered only if users ask (phase 5 backlog). |

## 0b. Execution status

Updated as phase 1 is worked. Every "done" row names what can be re-run to check it.
Test counts in this table are the counts **on the date of that row**; the suite has grown
since, and the current figures are in §1.

| Item | State | Evidence |
|---|---|---|
| 1.1 Delete the GECToR tier | **done** (2026-09-02) | `npm test`: 696 tests, 687 pass, 0 fail, 6 skipped, 3 todo; no runtime dependencies; `models/MANIFEST.json` holds one Apache-2.0 artefact; oracle 88/118, precision 0 defects, unlock 0 of 186 all unchanged. `REPORT.md` §"the grammar tier removed" |
| 1.2 Licence, name and hygiene | **done** (2026-09-02) | `LICENSE` (Apache-2.0), `LICENSE-DATA` (CC-BY-4.0, scope enumerated), `NOTICE`; package `tolben`, `license: Apache-2.0`, `private` dropped; plugin id/name `tolben`/`Tolben`, author `VladUZH`; `obsidian-probe/` renamed `obsidian-plugin/`, `probe:*` scripts renamed `plugin:*`, DOM classes `clarity-*` renamed `tolben-*`; author paths scrubbed from eight `bench/results/` files. `npm test`: 696 tests, 687 pass |
| 1.3 Grammarly corpus provenance | **done** (2026-09-02) | `bench/corpus/THIRD-PARTY.md`; `grammarly-reference.json` and `grammarly-correctness-pairs.json` removed (nothing read them); `tools/grammarly-classes.mjs` derives the flag-rate table and `--check` guards it; "harvested" replaced by "collected". Oracle 88/118, precision 0 defects, unlock 0 of 186 all unchanged |
| 1.4 Seven gate fixes | **done** (2026-09-02) | `tests/gate-fixes.test.mjs`, 14 tests; the role-swap guard was widened to multi-word spans after a torture pair escaped it. Cost measured: oracle unchanged at 88/118, precision-check 0 newly accepted and 0 recall cost, unlock-check 0 newly accepted. The 10 refusals whose label changed are the (f) merge, re-baselined with a note |
| 2.1 Runtime provisioner | **done and installed** (2026-09-02) | `obsidian-plugin/runtime/` (9 modules), `tools/provision.mjs`, `tools/pin-runtime.mjs`; 99 tests. Archive shapes corrected 2026-09-02 against llama.cpp's own `release.yml`: macOS and Linux ship **tar.gz** under a `llama-<tag>/` prefix, Windows a root-level zip, and there is **no separate non-AVX2 build** — the CPU release dispatches instruction sets at runtime, so both `*-noavx` entries were removed and `linux-arm64` added. `unpack.mjs` grew a dependency-free tar.gz reader, and stopped refusing symlinks: a real `build/bin` is full of SONAME chains (`libllama.so` → `.so.0` → `.so.0.3.0`) that `llama-server` is linked against, so the blanket refusal would have thrown on every macOS and Linux archive. Link targets are now held to the same escape rule as entry names. Archive tests read committed GNU-tar fixtures rather than shelling out to the machine's `tar`, which is what made them fail on macOS and Windows. **Pinned to b10760** on all six platforms, resolved by the `pins` job and re-verified by `--check` on every push. Run end to end on a bare machine: 1.57 GB downloaded, verified, extracted, spawned, warmed (409 ms) and stopped in **36 s**, no pid file left; a second run reused everything in 16 s. The suite on the pinned release binary: **862 tests, 859 pass, 0 skipped** |
| 2.2 Ollama adapter | **done and verified live** (2026-09-02) | `obsidian-plugin/runtime/ollama.mjs`, `tools/ollama-check.mjs`; 23 tests. Ollama 0.33.2 was built from source in the container and answered: the run found two defects the fakes could not (a field order that broke the reason-stop on every sentence, and a `keep_alive` check contaminated by prior state). Both fixed, both with regression tests. Cold-start smoke: 10/10 analysed, p50 4.2 s |
| 2.3 Plugin launch UX | **done** (2026-09-02) | Setup pane, refusal ledger, network pane, diff-derived card title, four new settings; `tests/plugin-vault.test.mjs` proves at source level that nothing but `data.json` reaches the vault |
| 2.4 Three-OS CI | **done and green** (2026-09-02) | `test.yml` (suite on macOS, Windows, Ubuntu every push), `provisioner.yml` (full download and spawn on four runners, weekly and on demand), `live.yml` (llama-server and Ollama with real weights), `release.yml` (tag to GitHub Release). Verified green on all three platforms at `e499c44`; the Windows job found a real defect on its first run (`core.autocrlf` broke the byte-for-byte bundle check) and the provisioner's plan step printed `win32/x64 (avx2)` correctly there |
| 3.1 Gate playground | **done** (2026-09-03) | `playground/`, deployed by `.github/workflows/pages.yml`. The property that matters was tested rather than asserted: all 67 torture pairs driven through the real form in Chromium reach **the same verdict as Node** running `src/` — 67/67, including the two protected-token pairs, which needed a protected-terms field the page had no way to express until it was added. `node playground/build.mjs --check` proves the built bytes carry no external reference |
| 3.2 Re-measure on the pinned artefact | **done** (2026-09-03) | `bench/results/holdout{,-2,-3}-pinned.json` and three `-attr-oldtiers` attribution runs. 51/75 surfaced, 89/90 clean. Six of six runtime archives and the model sha256-verified by downloading them. `REPORT.md`, "phase 3.2" |
| 3.5 GATE.md, FAQ, README | **done** (2026-09-03) | `docs/GATE.md` (556 lines), `docs/FAQ.md`, a rewritten root `README.md`. Each was fact-checked against the tree by a second pass, which found and fixed seven claims — among them "no GPU was used for any published figure", which `REPORT.md`'s own M3 Max latency section contradicts |
| 3.7 Forbidden-phrase grep | **done** (2026-09-03) | `tools/forbidden-phrases.mjs`, `npm run lint:prose`, `tests/forbidden-phrases.test.mjs` (60 tests, one of which runs it over the real tree) |
| 1.5 Torture corpus in CI | **done** (2026-09-02) | `bench/corpus/torture.json`, 67 pairs across 24 classes — 52 that must refuse, 15 that must surface — run through the full pipeline policy with the most permissive verifier by `tests/torture.test.mjs`. `.github/workflows/test.yml` runs the suite, the three instruments and the behaviour-table check on every push |

## 1. Where the tree is today

| Component | State | Evidence |
|---|---|---|
| Deterministic core: segmenter, identity, mechanics, rules, gate (`safety.mjs`, 24 rejection reasons), diff, explain, coordinator, store | Shippable; every `src/*.mjs` imports no Node module, so they run in a browser — which is what `playground/` proves, by bundling them unchanged and reaching the same verdict as Node on all 67 torture pairs | `npm test`: **928 tests, 925 pass, 0 fail, 0 skipped** against a real llama-server; 6 skip without one |
| Model contract (`engine.mjs`) | Shippable; OpenAI-compatible `chat/completions`, JSON-schema constrained, temperature 0, stop at the reason field | Any OpenAI-compatible server works; only llama-server is measured |
| Web demo (`server.mjs`, `public/`) | Developer harness, not a product | Overlay-mirror textarea; not the launch surface |
| Obsidian plugin (`obsidian-plugin/`) | Shippable: CodeMirror decorations, hover card, markdown projection, native undo, an in-memory outcome cache, setup pane, refusal ledger and network pane. It provisions and runs its own `llama-server` — pinned to b10760 on six platforms — and also speaks Ollama or any OpenAI-compatible endpoint | `obsidian-plugin/runtime/`, 10 modules; `tests/plugin-vault.test.mjs` proves nothing but `data.json` reaches the vault, against the committed bundle as well as the source. The outcome cache is held in memory: a record of every sentence a writer finished has no business living in their notes |
| Bench (`bench/`) | Shippable and reproducible: oracle, precision-check, unlock-check, verifier-check, run, score; dev corpus, three adjudicated sealed holdouts, four unadjudicated and excluded — holdout 7 carries nine runs from prompt development and is burned as a holdout, not merely unlabelled | Re-run 2026-09-03 on the pinned artefact; `REPORT.md`, "phase 3.2" |
| Measurements | 27/36 surfaced and 0/24 false positives on the dev corpus. On the sealed holdouts, **on the artefact that ships**: 51/75 surfaced and 89/90 clean untouched, against 58/75 and 81/90 on the older model file. Warm latency p50 1.5 s clean and 2.4 s rewritten; **41–46 s for the first sentence of each server process**; 1.96 GB RSS. A live bench run is reproducible to about ±2 rows in 75, so differences smaller than that are not findings | `REPORT.md`, "phase 3.2" |
| Known gate gaps (verified 2026-09-02) | Closed the same day by phase 1.4, except `In the majority of cases` to `In most cases`, which is deliberate: it is the periphrastic-quantity trade `PERIPHRASTIC_QUANTITY` licenses and is on Grammarly's own list | `tests/gate-fixes.test.mjs` |
| Licence, name, packaging | Done 2026-09-02: Apache-2.0 + CC-BY-4.0 + NOTICE, package `tolben`, plugin id `tolben` — renamed from Stet on a preliminary clearance assessment, and screened free on npm, PyPI, RubyGems, Homebrew, nine TLDs, Apple's catalogue, the Obsidian directory, Open VSX and Docker Hub. Closed 2026-09-03: after counsel's review the name stands unchanged. The register itself was never searchable from this container, and that limit is recorded rather than papered over | `LICENSE`, `LICENSE-DATA`, `NOTICE`; REPORT.md, "Stet becomes Tolben" |

## 2. The end state, so the plan has an end

"The very end" here means the point at which Tolben is a finished product rather than a
project: it stops when all of the following are true, and after that it is maintained,
not developed.

1. **Three surfaces shipped and measured.** Obsidian (free), VS Code and other LSP editors
   (free), and Word and Outlook (paid), each with its own latency and recall rows on the
   pinned artefact.
2. **The gate is a product of its own.** `@tolben/gate` on npm, used by at least one
   third-party writing tool, with the torture corpus and the ledger as its test suite.
3. **A verifiable trust claim.** An independent audit confirming no outbound connections
   after setup, published with the method, and a trust page that answers the questions the
   organisations in regulated sectors ask.
4. **Revenue that funds maintenance.** The paid edition covers the author's maintenance time
   at its price points, or the decision has been taken, on numbers, that
   it will not, and the free surfaces are handed to maintainers under Apache-2.0.
5. **A written maintenance mode.** Which releases are cut, which issues are triaged, what a
   model upgrade requires (a full re-measurement), and what would cause the project to be
   archived.

Everything else in this document is a phase on the way to those five, with a gate between
phases that is a number, not a feeling.

## 3. Phases

### Phase 0: decisions and hygiene (2026-09-02 to 2026-09-04, 1.5 days)

| Item | Detail |
|---|---|
| Record the decisions above | This file. |
| Reddit and forum accounts | Use the existing account u/Ok_Explorer7384 (checked 2026-09-02: comments since 2024-11, 144 comments with a 244 comment score, 18 submissions, more replies than submissions). The age and karma conditions are met, so no new account and no 45-day wait. Two conditions remain: the account has no comment history in r/ObsidianMD, whose Rule 4 removes first-post promoters, so leave about ten genuine, link-free comments there before Day 4 and make the one non-promotional submission at T-14; and 11 of its 18 submissions were removed: r/LocalLLaMA and r/opensource, both in the launch sequence, each removed its July 2026 launch post by moderators, and six others (r/programming, three identical same-day posts to r/SideProject, r/MachineLearning, r/RepTime) were removed by Reddit's own spam filter, which is the pattern that flags an account. So: before Day 0, confirm the account is not spam-flagged by checking that the T-14 non-promotional r/ObsidianMD submission is visible when logged out; before Day 2 and Day 6, read the July removal reasons in r/LocalLLaMA and r/opensource modmail and fix that cause in the post; every launch post follows its sub's flair and disclosure rule exactly; nothing is ever cross-posted or reposted; and if a post is filtered, one modmail and no resubmission. The account's one strong sub is r/macapps (40 comments, a 22-point launch); it stays cut for the Obsidian launch and becomes the first venue if a macOS system-wide build ever ships. Warm the Obsidian forum account (read, like, reply, return on several days). |
| Scrub | The eight `bench/` files carrying the operator's home path. |
| Branch plan | `main` stays the measured tree; all of phase 1 and 2 land through PRs so the bench checks run on each. |

Exit: the four decisions are in the tree; the r/ObsidianMD comments have started.

### Phase 1: a releasable core (2026-09-04 to 2026-09-12, about 6 days)

Everything here is required before any artefact is public and none of it depends on the
plugin.

| # | Item | Days | Exit criterion |
|---|---|---|---|
| 1.1 | Delete the GECToR tier: `src/gector*.mjs`, `roberta-tokenizer.mjs`, `obsidian-plugin/gector-engine.mjs`, `tools/gector-goldens.mjs`, the gector tests and fixtures, the four manifest entries, `onnxruntime-node`, `docs/PHASE-2-GECTOR-PLAN.md`, the grammar toggle and strings | 1 | `npm install` on a clean clone with no postinstall network; `npm test` prints its new count (about 720) and every doc quotes that count |
| 1.2 | LICENSE, LICENSE-DATA, NOTICE; `license` field; drop `private`; rename package, manifest id, name and author to Tolben; remove "Grammarly" from the package description and every "probe" string; README's "1.7 GB" to the pinned byte count | 1.5 | `grep -ri "grammarly-style\|clarity-probe\|throwaway\|Blue_underline_exp"` is empty |
| 1.3 | Grammarly corpus: keep `grammarly-pairs.json` and `oracle-labels.json` under `bench/corpus/THIRD-PARTY.md`; move the verbatim harvest files out of the public tree; add per-class counts and `tools/grammarly-classes.mjs` to `docs/GRAMMARLY-BEHAVIOUR.md` | 1 | oracle, precision-check and unlock-check still print their numbers |
| 1.4 | Gate fixes with tests: (a) role-swap guard for common-noun subject/object exchange; (b) `more than`, `less than`, `fewer than`, `up to`, `no more than` in the quantifier groups; (c) before/when/while/once in the direction table; (d) unless, until, except, only, own on `NEVER_VERIFY`; (e) capitalised number words out of the name detector; (f) merge `content-dropped` and `dropped-content`; (g) a refusal-prose guard for model answers that decline instead of rewriting | 2 | Each guard measured free or with its cost recorded: 0 new oracle rows lost, 0 precision defects, 0 unlocks, or the cost stated in the commit |
| 1.5 | `bench/corpus/torture.json`: the review's 55 pairs plus the four verified today, run through the full pipeline policy (not `validateRewrite` alone) in CI | 0.5 | Every pair has an expected outcome and the test asserts it |

Exit: a clean clone installs offline, tests pass, licence and name are in place, the four
known gaps are closed or documented with cost, and the bench still prints the numbers the
docs quote.

**Phase 1 closed 2026-09-02.** All five items done. On the tree **as it stood at the
close**, `npm test` printed 862 tests with 853 passing, 0 failing, 6 skipped for want of a
model server and 3 todo — 859 passing and 0 skipped when one was running. Oracle 88/118,
precision-check 0 defects and 0 recall cost, unlock-check 0 of 186 unlocked — the same
three numbers the documents quoted before the phase began. (Phase 3 has since grown the
suite to 928 and the two ratchets to 281 accepted and 209 refusals, with the oracle
unmoved at 88/118; §1 carries the current figures.) The two items phase 1 left open have both since
closed: the name question was settled by renaming to Tolben and counsel's review
(2026-09-03), and the git history was squashed to a single root commit before
publication, which removed the withdrawn Grammarly files along with everything else the
tree had stopped carrying.

### Phase 2: the Obsidian plugin, version 1.0 (2026-09-12 to 2026-10-03, about 16 days)

The product form the release strategy chose. The provisioner is the critical path and the
item most likely to overrun; it is done first so the overrun is visible early.

| # | Item | Days | Exit criterion |
|---|---|---|---|
| 2.1 | **Runtime provisioner**: detect Ollama on `:11434` and llama-server on `:8080`; otherwise download a pinned llama.cpp release per OS and architecture (non-AVX2 fallback, CPU-feature check) and the pinned GGUF from a GitHub Releases mirror with huggingface.co as fallback; URLs, sizes and SHA-256 shown before the first byte; resumable verified downloads; spawn on a random loopback port with `--api-key`; health check; warm-up; kill on unload and quit with PID-file recovery; 10-minute idle unload with slot save and restore and reload on editor focus; Q4_K_M offered and labelled unmeasured; failure text for Gatekeeper, SmartScreen, antivirus, Flatpak and Snap | 8.5 | Headless provisioner run passes on macOS arm64, Windows x64 and Ubuntu x64 in CI. The second-person timed install was **dropped on 2026-09-03** by the owner's decision; the ten-minute figure now rests on CI and on arithmetic from the measured 36 s run, not on an independent observation, and nothing published claims otherwise |
| 2.2 | **Ollama adapter**: `/v1` with `response_format` json_schema, `reasoning_effort: none`, stop string, `keep_alive`; pull `hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K` after a size prompt; verify `keep_alive` is honoured on `/v1` and that no think tags leak, else use the native endpoint | 2 | A bench row through Ollama on the Xeon VM and a 10-row live smoke in CI |
| 2.3 | **Launch UX**: first-run setup pane; status bar `Tolben: ready · local · N suggestions · M refused`; commands "Show refusal ledger for this note" and "Show what talks to the network" (bound address, non-loopback socket count, model hash, RSS, PID); diff-derived card title; typing-delay and idle-timeout settings; "Never drop words" toggle, off; outcome cache and ledger in memory only, with a test that no write targets the vault except Obsidian's `data.json` | 3.5 | The three-file plugin folder plus `data.json` is all that exists in a test vault after a session |
| 2.4 | **CI** on macos-14, windows-latest, ubuntu-latest: provisioner headless, spawn, live smoke, the three no-model bench checks, `torture.json`, reproducible `main.js` | 2 | Green on all three before any release tag |

Exit: version 1.0.0 tagged as a GitHub Release carrying `main.js`, `manifest.json`,
`styles.css`, LICENSE and NOTICE; installable through BRAT.

**Phase 2 built 2026-09-02 and merged to `main` (3f6b76d, CI green). The tag is not
pushed, and cannot be from a Claude Code session:** `git push origin refs/tags/v1.0.0`
returns **HTTP 403** from GitHub on `git-receive-pack` — for any tag name, not just `v*`,
so it is a blanket "no tag creation" on this session's credentials rather than a rule
protecting release tags. The GitHub MCP surface has no create-tag or create-release tool
either. Branch pushes work; tags do not. It is the same class of denial as the
workflow-dispatch 403. So this one really does need a person, for a mechanical reason
rather than a judgement one:

```bash
git checkout main && git pull
git tag -a v1.0.0 -m "Tolben 1.0.0 — a local clarity editor that refuses to change your meaning"
git push origin v1.0.0     # release.yml does the rest, and refuses to publish on any mismatch
```

**Phase 2 built 2026-09-02; the tag is not pushed.** The manifest says 1.0.0,
`versions.json` exists, and `.github/workflows/release.yml` turns a `v1.0.0` tag into a
release carrying those five files plus `SHA256SUMS`, refusing to publish if the tag and
the manifest disagree or the suite fails. Pushing the tag is a person's decision and is
left to the owner. Three things should happen first, and none of them is code:

1. ~~**Pin the llama.cpp assets.**~~ **Done 2026-09-02**, no person needed. The `pins` job
   in `test.yml` runs on every push, which is how a machine that cannot reach the releases
   API — and whose token cannot dispatch a workflow — resolved them anyway. b10760 on all
   six platforms; `--check` re-verifies the transcription against the API on every push.
   The proxy turned out to allow release *downloads* even though it refuses the *API*, so
   the pin was checked against the real bytes rather than the API's digest field, the
   archive extracted with this project's own reader, and the binary run:
   `version: 0.3.0-dev (build 10760, commit 0f3a71be1)`.
2. ~~**Run `live.yml` once.**~~ Done locally on 2026-09-02, which is where the two Ollama
   defects came from — and repeated against the **pinned release binary** once the assets
   were pinned, rather than the one built from source here: **862 tests, 859 pass, 0
   skipped**, the six live-model tests included. Running `live.yml` in CI is still worth
   doing, to keep it true rather than to establish it.
3. **The name — settled by renaming, and now needing one opinion rather than a search.**
   The register itself could not be searched from here (`tmsearch.uspto.gov` is behind an
   AWS WAF challenge, TSDR wants an API key, the mirrors 403). An ordinary search found
   one conflict — **Stet Writer** by Almost Right Creative, LLC, on the US App Store since
   **15 March 2026** — and missed four more. A preliminary clearance assessment found
   them: a Mac dictation tool at stet.me, an AI-edit review editor at getstet.app whose
   beta opened 2026-09-01, an evals product at stet.sh, and — closest of all —
   `AmrZriek/Stet`, a local, offline, **embedded-llama.cpp** autocorrect and rewriting
   tool for Windows and macOS. Six independent developers reaching for the same word for
   the same job is also the strongest possible evidence that the word describes the goods,
   which is the §2(e)(1) problem: *stet* is the proofreader's mark for "let it stand", and
   that is this program's whole claim. The project renamed to **Tolben** on 2026-09-02
   rather than contest a crowded field for a word it could not own. Free today: npm
   `tolben`, the Obsidian plugin id `tolben` (no match among 7,205), Apple's software
   catalogue, and `tolben.com`. What remains is a single US clearance opinion on Tolben,
   before the tag. REPORT.md, "the name, as far as a search can settle it" and "why Stet
   became Tolben", has the detail.
4. ~~**The install-by-a-stranger measurement.**~~ **Dropped 2026-09-03** by the owner's
   decision. The criterion was "first underline in under ten minutes on 50 Mbps by someone
   other than the author". What supports it instead: the full first run works and takes
   **36 s** here, on a ~44 MB/s connection, and `provisioner.yml` exercises the whole
   download-verify-extract-spawn path on four runners. At 50 Mbps the 1.57 GB is about
   four minutes of transfer, so ten minutes is cleared by arithmetic rather than by
   observation. The honest consequence is recorded rather than hidden: no published
   document claims a measured install time, and none should until someone on a domestic
   line produces one.

### Phase 3: playground, measurement, materials, launch (2026-10-03 to 2026-10-27, about 11 days plus launch week)

| # | Item | Days | When |
|---|---|---|---|
| 3.1 | **Gate playground** on GitHub Pages — **done 2026-09-03**. `playground/`: four tabs (Write with the rules-tier underline badged "rule", Check a rewrite, Replay, Ledger), eight pre-loaded pairs and a ninth read live from the recorded runs because no torture pair reaches the verifier, "Add to Obsidian" on desktop and "desktop only" on a coarse pointer, no analytics. The local-server field was **removed**, not tested: three-browser testing was not possible here, and the roadmap's own wording made that the alternative. `build.mjs --check` fails the deploy if the built page carries a single external reference; `pages.yml` runs it before uploading. **The page is not live yet, and cannot be while the repository is private on a free plan**: `configure-pages` returned `HttpError: Not Found` on its first run because Pages had never been switched on, and `enablement: true` now asks for it — which GitHub grants for a public repository, or for a private one on a paid plan. Making the repository public turns the playground on | 3.5 | T-25 to T-22 |
| 3.2 | **Re-measure on the pinned artefact** — **done 2026-09-03** for everything reachable from here: holdouts 1 to 3 on the shipped tree against the genuine b10760 release binary (all six platform archives sha256-verified by download first), the idle-unload first sentence with and without slot restore, and the sealed-set table with holdouts 4 to 7 excluded. **Not done, and not claimed:** Ollama was measured 2026-09-02 and not re-run; a 2-core laptop, Apple-silicon Metal and Windows CPU have no hardware here | 2 | T-16 |
| 3.3 | **BRAT beta**: forum Developers post and Discord #plugin-dev; gate of 10 testers across three OSes with at least 8 first-try installs. *Copy drafted 2026-09-03 and delivered to the owner; posting and recruiting are a person's* | 0.5 | T-14 (2026-10-06) |
| 3.4 | **Directory submission**; confirm `obsidian://show-plugin?id=tolben` resolves. *Packet drafted 2026-09-03 with the `community-plugins.json` entry, the PR body, and every guideline checked against the tree. Three blockers it found are now fixed (root `manifest.json` and `versions.json`, the `tolben-` prefix on four command ids, a README that described the repository rather than the plugin); the rest need the repository public* | 0.5 | T-10 (2026-10-10) |
| 3.5 | **README, listing, `docs/GATE.md`, FAQ, canned answers**, the first comment and the reply bank from the release strategy, re-checked against the tree — **done 2026-09-03**. `docs/GATE.md` and `docs/FAQ.md` are in the tree; the README now opens with what the plugin is, what setup downloads and where it puts it. Launch copy is with the owner and deliberately not in the public repository | 3 | T-9 to T-5 |
| 3.6 | **Demo assets** recorded in real Obsidian on a no-GPU machine; regenerated `demo-hover.png`. *Not done: Obsidian is a desktop application and there is none here. `obsidian-plugin/harness/` renders the real CodeMirror extension in a browser and can stand in for stills, but a recording made there is not a recording made in Obsidian and must not be captioned as one* | 1 | T-4 |
| 3.7 | Forbidden-phrase grep — **done 2026-09-03**, `tools/forbidden-phrases.mjs` and `npm run lint:prose`, 60 tests, with waivers that must carry a reason and matching suppressed inside code spans. Playground checked at a 390×844 viewport in Chromium: no horizontal overflow, and the coarse-pointer swap to "desktop only" fires. *A real phone is still a real phone* | 0.5 | T-3 to T-2 |
| 3.8 | **Day 0: Show HN**, Tuesday 2026-10-20, 14:00 UTC, link to the playground; the two-hour playbook; 26 hours of presence | | Day 0 |
| 3.9 | **Reddit sequence**: r/LocalLLaMA Day 2, r/ObsidianMD Day 4 with forum and Discord showcase, r/opensource Day 6, second-chance email if needed Day 7, r/ollama Day 9 | | Days 2 to 9 |

Exit: 1.0.x in the directory; the HN and first three Reddit posts made; every install
failure from launch week either fixed in a point release or documented with a workaround.

**Go/no-go for phase 4, read at Day 30.** Directory downloads divided by (1 + point
releases) is the user proxy.

| Day-30 proxy | Reading | Phase 4 posture |
|---|---|---|
| Under 300 | The listing is not being found, or the install fails silently | Fix the funnel first: listing copy, install failures, a second r/ObsidianMD post at Day 45 with a new measurement. Do not start VS Code. |
| 300 to 2,000 | The organic band the analogues predict | Proceed with phase 4 as written. |
| Over 2,000 | A post landed | Proceed; hold releases weekly so the count stays comparable; pull the Word spike (phase 6) forward by a month. |

### Phase 4: stabilise, then the second free surface (2026-10-27 to 2026-12-19, about 22 days)

| # | Item | Days | Exit criterion |
|---|---|---|---|
| 4.1 | **Launch-week debt**: every "reported miss" and "wrong refusal" from the two issues triaged; guards shipped only when oracle, precision-check and unlock-check show them free; 1.0.x point releases; the "what launch day changed" changelog | 4 | Issue backlog under 10 open; ledger current |
| 4.2 | **`@tolben/gate` on npm**: `validateRewrite`, `explainEdit`, the diff, `REJECTION_REASONS`, the pipeline policy, `torture.json`, and a one-command CLI (`npx @tolben/gate check original.txt rewrite.txt`) | 2 | Published; the playground imports it rather than a copy; one external tool has opened an issue or PR |
| 4.3 | **`tolben-ls`, an LSP server**, and a **VS Code extension** on the Marketplace and Open VSX, reusing the provisioner and llama-server Q6_K so no re-measurement is needed; markdown, plain text, commit messages and PR descriptions by default; code excluded by grammar; `tolben doctor` prints the network diagnostic | 10 | Timed install on three OSes; Neovim and Zed configurations documented; the r/technicalwriting post made in the week it ships |
| 4.4 | **1.1 release**: the model upgrade path documented (what a swap requires: the full bench, a new pinned hash, new rows); the FAQ rewritten from launch-week questions | 1 | |
| 4.5 | **Second HN post**: `docs/GATE.md` as a technical write-up, Day 14 to 21 after launch, different title | 0.5 | |
| 4.6 | Press: itsfoss, XDA, MakeUseOf pitched with the VS Code release as the news hook; creator outreach with the 8-second clip | 1 | |

Exit: two free surfaces; the gate as a library; a Day-60 measurement of both directory and
Marketplace counts recorded in `REPORT.md`.

### Phase 5: platform depth and quality (2027-01-04 to 2027-03-12, about 40 days)

The work that turns "it runs" into "it runs well on the machine you have", and closes the
recall gap where it is cheap. Each item ships only with its own bench row.

| # | Item | Days | Exit criterion |
|---|---|---|---|
| 5.1 | **GPU builds in the provisioner**: Metal on Apple silicon, Vulkan on Windows and Linux, CUDA as an opt-in download; detection and fallback | 5 | p50 rows for each on named hardware; the CPU row stays the headline |
| 5.2 | **Latency**, and it now has a number and a deadline rather than a wish. Measured 2026-09-03: warm p50 1.5 s, but **41–46 s for the first sentence of every server process**, which the ten-minute idle unload makes a writer pay once per break. Saving and restoring the KV slot round-trips correctly and buys 0.5% of it, so the prompt read is the whole cost: trim the 1,587-token prompt where the bench shows no recall loss, and find out why a restored slot does not produce a prefix hit. `-np 2` for burst typing if the RAM budget allows | 5 | First sentence after an idle unload under 5 s, or the ten-minute default changed on the measured trade; warm p50 under 1 s without recall loss, or the reason it cannot be, measured |
| 5.3 | **Recall on the cheap tier**: extend `clarity-rules.mjs` from the Grammarly phrase list (§1 of `docs/GRAMMARLY-BEHAVIOUR.md`), measured against the oracle so no rule pre-empts a better model rewrite | 4 | Battery result above 7/12 with the same 0 false positives; the number published either way |
| 5.4 | **Wrong refusals**: the three battery rows the gate refuses (`due to the fact that` recasts, `a number of` to `several`, the stranded auxiliary); narrower guards, each measured | 4 | Refusal ceiling above 75% on the oracle without a precision defect |
| 5.5 | **Verifier**: a second measured prompt, or a rule-based replacement for the single-word-deletion question, scored on `verifier-labels.json` | 4 | Better than 4/9 caught at no more than 1/49 wrongly refused, or the verifier is removed and `refuse` becomes the default with its cost restated |
| 5.6 | **Registers and dialects**: an en-GB row; fiction and academic rows from `REGISTERS.md` re-run; a "register" setting only if a register needs different rules | 3 | Rows published; no claim without a row |
| 5.7 | **Larger model option**: Qwen 4B class through the same provisioner, offered as "more recall, more RAM", with its own full bench | 5 | Its row beside the 2B row; the 2B remains the default |
| 5.8 | **Harper side-by-side**: documented configuration, z-order and exclusion fixes so the two decorations do not fight in Obsidian and VS Code | 2 | A joint screenshot in both READMEs |
| 5.9 | **Maintenance tooling**: a release script that runs the full bench and refuses to tag if any published number moved without a doc change | 3 | Every release since carries a bench diff |
| 5.10 | Backlog, only if users ask: a permissively licensed grammar tagger; a browser extension after an in-browser bench row (WebGPU q4f16 exists but is unmeasured); system-wide macOS via the Accessibility API (`docs/systemwide-text-access-notes.md`) | 0 | Not scheduled |

Exit: version 1.5; three latency rows per surface; the recall and refusal numbers moved
in the published direction or the reasons are written down.

### Phase 6: the paid edition for people who cannot use Grammarly (2027-03-15 to 2027-07-30, about 60 days)

The market here is law firms, government, healthcare, regulated finance, and
universities with data-residency rules, who today pay
WordRake and BriefCatch for rule-based tools that keep text on the machine. It is also the
phase with the most unknowns, so it opens with a two-week spike and a go/no-go.

**6.0 Spike (10 days).** Word and Outlook add-ins come in two kinds and the choice decides
everything after it.

| Route | For | Against |
|---|---|---|
| Office.js add-in (task pane, cross-platform, store-distributed) | Runs on Windows and Mac Word; no installer beyond the manifest; sideloadable for pilots | The add-in is a sandboxed https webview: calling a plain-http loopback server is mixed content, so the local runtime needs a trusted local certificate or a native companion process; inline underlines are not available, so suggestions surface as a task-pane list plus tracked changes or comments |
| VSTO / COM add-in (Windows only, native) | Full local access, inline formatting, the form WordRake and BriefCatch ship | Windows-only; MSI installer, code signing, SmartScreen; .NET |

Spike deliverables: a working prototype of one route that shows a Tolben suggestion for a
sentence in a real Word document with the model on loopback; the install path timed; a
decision memo. Go/no-go: proceed only if a fresh install by a non-developer reaches a
suggestion in under 15 minutes on Windows.

| # | Item | Days | Exit criterion |
|---|---|---|---|
| 6.1 | **Tolben for Word and Outlook**, on the route the spike chose: sentence-complete trigger from the document's selection events, suggestions in a pane with Replace and Dismiss, refusals in the pane, the network diagnostic, "Never drop words" **on** by default | 25 | Timed install; a bench row on a Windows laptop; a 1.0 tag |
| 6.2 | **Team mode**: one llama-server on a LAN host that many clients use, with the same API-key discipline; a `tolben doctor` that proves nothing leaves the LAN; a deployment guide for IT | 8 | A two-machine test with packet capture in the guide |
| 6.3 | **Independent audit** of the no-outbound-connections claim on the plugin, the extension and the add-in, method published; a trust page answering the market analysis §3 questions (SOC 2 not applicable and why, HIPAA posture when nothing leaves the device, data residency by construction, training: none) | 5 plus the auditor's time | The report linked from every README |
| 6.4 | **Pricing and packaging**: free forever for Obsidian and VS Code; Word and Outlook individual one-time (anchor: Refine $38, WordRake $129 to $199 a year); teams per seat per year with the LAN server (anchor: WordRake $149 to $229, Sapling $15); enterprise from a floor (anchor: $3,500). The add-in's packaged build carries its own terms; its engine stays Apache-2.0 | 3 | A price page; a licence key mechanism that works offline |
| 6.5 | **Pilots**: three organisations from the market analysis's list of who bans cloud checkers (a law firm, a university IT department, a public body); free for the pilot, in exchange for a torture corpus from their documents and a timed install | 8 | Three written pilot reports; the torture corpus grown from them |
| 6.6 | **Sales surface**: a LawNext directory listing, one legal-tech write-up pitched with the audit as the hook, and the r/technicalwriting and legal-writing communities the market analysis names | 3 | Listing live; one article |

Exit: the paid edition on sale; three pilots complete; the trust page and audit public.

**Go/no-go for phase 7, read at 2027-09-30.** Paid revenue over the preceding quarter,
annualised, against the author's maintenance cost.

| Annualised revenue | Posture |
|---|---|
| Covers maintenance | Phase 7 and maintenance mode as written. |
| Half of maintenance | One more sales cycle (a second pilot round, the legal-tech conference season) before deciding; no new surfaces. |
| Under a quarter | Stop paid development. Free surfaces to maintenance mode under Apache-2.0; publish the numbers; seek maintainers or a home (Automattic took Harper; BriefCatch buys in this niche). |

### Phase 7: breadth, only where a measurement exists (2027-08 to 2027-12, about 30 days, optional)

| # | Item | Condition |
|---|---|---|
| 7.1 | Browser extension on an in-browser WebGPU model | Only after a full bench row on the q4f16 artefact; the launch numbers are not reused |
| 7.2 | System-wide macOS through the Accessibility API | Only if Word users ask for Mail and Slack; the notes in `docs/systemwide-text-access-notes.md` are the design |
| 7.3 | A second language | Only with a gate built for that language first: its negation, quantifier, tense and confusable tables, its own torture corpus, its own holdouts. The model is not the blocker; the gate is |
| 7.4 | Grammar tier | Only with permissively licensed weights and only if Harper side-by-side proves insufficient for paying users |

### Phase 8: maintenance mode (from 2027-12, indefinitely)

The end state's fifth condition, written now so it is not improvised later.

- **Releases**: quarterly, or on a security fix; each runs the full bench and the release
  script refuses to tag if a published number moved without a documented reason.
- **Model upgrades**: only as a new pinned artefact with a complete re-measurement (dev
  corpus, three holdouts, oracle, precision, unlock, torture, latency on the named machines).
  The previous artefact stays downloadable for a year.
- **Triage**: "reported miss" and "wrong refusal" issues answered within a week with the
  gate's verdict; guards shipped only when measured free.
- **Dependencies**: llama.cpp release pin reviewed quarterly; Obsidian and VS Code API
  breakage fixed within the quarter.
- **Handoff**: the repository, bench and documents are complete enough that a stranger can
  reproduce every number; `MAINTAINERS.md` names who can cut a release.
- **Archive criteria**: no release for four consecutive quarters, or a platform change that
  the author will not fund; on archive, the last bench and the reasons are published, and
  the paid edition's customers get a final build and their data guarantee restated.

## 4. Timeline at a glance

| Phase | Window | Days | Milestone |
|---|---|---|---|
| 0 Decisions | 2026-09-02 to 09-04 | 1.5 | This file; accounts started |
| 1 Releasable core | 09-04 to 09-12 | 6 | Clean install, licence, gate gaps closed |
| 2 Obsidian 1.0 | 09-12 to 10-03 | 16 | Release tag; BRAT-installable |
| 3 Launch | 10-03 to 10-27 | 11 + launch week | Show HN 2026-10-20; directory listing |
| 4 Stabilise, gate library, VS Code | 10-27 to 12-19 | 22 | `@tolben/gate`; `tolben-ls`; Day-60 numbers |
| 5 Depth and quality | 2027-01-04 to 03-12 | 40 | 1.5; GPU rows; recall and refusal numbers moved |
| 6 Paid edition | 03-15 to 07-30 | 60 | Word/Outlook on sale; audit; three pilots |
| 7 Breadth | 08 to 12 | 30, optional | Only with measurements |
| 8 Maintenance | from 2027-12 | | Quarterly releases; handoff-ready |

About 190 engineer-days over fifteen months for one person, of which the first 35 reach
the launch. A second person shortens phase 2 (the provisioner's three-OS matrix) and phase
6 (sales and pilots) the most; nothing else parallelises well because every change has to
go through the same bench.

## 5. Risks, with the mitigation already in the plan

| Risk | Where it bites | Mitigation |
|---|---|---|
| The provisioner overruns or fails on one OS | Phase 2 | Done first; three-OS CI; BRAT gate of 8/10 first-try installs; Ollama detection as the escape hatch |
| Launch day exposes a meaning change the gate accepts | Phase 3 | Torture corpus in CI; the four known gaps closed in phase 1; the ledger and a point release in-thread |
| Recall is too low for daily use and retention is poor | Phase 4 read at Day 30 | The 300 threshold; phase 5.3 and 5.4 are the recall work; the toggle for a larger model in 5.7 |
| Apple, Chrome or Microsoft ship on-device rewriting with a meaning check | Any phase | The gate and the ledger are the differentiator, not "local"; `@tolben/gate` makes the gate reusable even inside their ecosystems |
| Office add-in sandbox blocks the local runtime | Phase 6 spike | Two routes evaluated before any build; go/no-go on a timed install |
| Paid edition does not sell | Phase 6 read at 2027-09-30 | The revenue thresholds; the free surfaces survive under Apache-2.0 regardless |
| Model licence or availability changes | Phase 5, 8 | Pinned artefact mirrored on GitHub Releases with LICENSE and NOTICE beside it; upgrade path documented |
| Single-person bus factor | All | Everything reproducible from the tree; `MAINTAINERS.md` in phase 8; Apache-2.0 so it can be forked |

## 6. What to measure, and when

| When | Number | Where it goes |
|---|---|---|
| Every release | Dev corpus surfaced and false positives; oracle hard-refuse; precision defects; unlocks; torture outcomes; p50 and p95 on the named machines | `REPORT.md` table; the release script enforces it |
| Day 7, 30, 60, 90 after launch | Directory downloads divided by (1 + releases); GitHub traffic; Marketplace and Open VSX counts from phase 4 | This file's go/no-go tables |
| Quarterly from phase 6 | Paid seats, revenue, pilot reports, audit status | The phase 7 go/no-go |
| Always | Open "reported miss" and "wrong refusal" issues, and median time to a verdict | The ledger |
