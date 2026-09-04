// Tolben for Obsidian.
//
// The engine, the pipeline and the whole safety layer are imported unchanged from
// ../src. Nothing is reimplemented here: this file only supplies the three things the
// browser demo got from server.mjs — the prompts, a transport to the model server, and
// somewhere to show status — and hands the rest to the CodeMirror layer.

import { Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { createEngine } from "../src/engine.mjs";
import { analyzeSentence } from "../src/pipeline.mjs";
import clarityPrompt from "../src/clarity-prompt.txt";
import verifierPrompt from "../src/verifier-prompt.txt";
import { nodeFetch } from "./node-fetch.mjs";
import { clarityExtension } from "./underline.mjs";
import { createOutcomeCache, outcomeKey } from "./outcome-cache.mjs";
import { RULES_SIGNATURE } from "../src/clarity-rules.mjs";
import { createLedger } from "./ledger.mjs";
import { createNetworkLog } from "./network-log.mjs";
import { renderSetup, renderProgress, renderLedger, renderNetwork, statusLine } from "./panes.mjs";
import { plan as planRuntime, provision, formatBytes } from "./runtime/provision.mjs";
import { modelById, MEASURED_MODEL } from "./runtime/manifest.mjs";
import { connectOllama, pullModel } from "./runtime/ollama.mjs";

const DEFAULTS = {
  // Empty until setup runs. A hard-coded 8080 made the plugin look broken to everyone who
  // had not already read the README and started a server themselves.
  baseUrl: "",
  mechanics: true,
  // "balanced": gate-cleared sentences are checked LAST instead of never — every
  // suggestion still arrives, likely ones first. "fast": cleared sentences skip the
  // model entirely (~40% less model time, but the suggestions on those sentences are
  // lost — measured as six of eight on a real page). "off": document-order within tiers.
  gate: "balanced",
  // Deterministic clarity rewrites (idioms with a context-free short form): fire in
  // microseconds and replace the model call for that sentence outright.
  rules: true,
  // How long after the last keystroke a finished sentence is sent. Below about 80ms the
  // model is asked about text the writer is still typing; above about 400ms the underline
  // feels detached from the sentence that caused it.
  debounceMs: 140,
  // Minutes of no typing before the managed server is unloaded and its 2 GB returned to
  // the machine. 0 keeps it resident.
  //
  // Coming back is automatic since 1.0.1 and costs about a minute on a 4-core CPU: the
  // files on disk are re-verified, the server restarted and both prompts read in again.
  // The KV slot is saved first, and measurement on 2026-09-03 says that buys almost
  // nothing (41.2 s to the first sentence with the restore against 41.4 s without),
  // because what dominates is reading the 1,587-token clarity prompt back in. The save is
  // kept because it is cheap and a future llama.cpp may make the prefix hit. Ten minutes
  // was the 1.0.0 default and made every coffee break cost that minute; sixty is the
  // measured trade (ROADMAP 5.2), and the setting says what the wait is.
  idleUnloadMinutes: 60,
  // Whether the server at baseUrl is one Tolben started. A managed server does not
  // outlive Obsidian, and the idle unload stops it on purpose, so on the way back the
  // plugin re-provisions it from the files on disk. A server the writer runs is theirs,
  // and is only ever connected to. Until 1.0.1 this was not recorded, and a managed server
  // was never started again: REPORT.md, 2026-09-04.
  managed: false,
  // "Never drop words": refuse any rewrite that loses a content word, instead of putting
  // the single-word cases to the 2B verifier. OFF by default, because on the labelled
  // corpora it stops 0 further meaning changes and costs 15 Grammarly rows plus 48
  // preserving rewrites -- every published number was measured under `verify`.
  neverDropWords: false,
  // Which pinned artefact the managed runtime should fetch.
  modelId: MEASURED_MODEL,
  // Set once setup has been through, so it is offered exactly once rather than at every
  // launch.
  setupDone: false,
};

// Bump when pipeline or safety SEMANTICS change in a way the fingerprint's other inputs
// cannot see (a new refusal class, a changed verifier policy): cached model answers were
// produced under the old semantics and must not outlive them.
const CACHE_EPOCH = 5;

// The outcome cache used to be written to analysis-cache.json inside the vault. It is
// held in memory now and nothing about that is a limitation to be fixed: the cache is a
// record of every sentence the writer finished and what a model said about each one, and
// a writing tool has no business leaving that in someone's notes. The cost is that a
// reopened note re-asks the model, at about a second a sentence, once per session.

export default class TolbenPlugin extends Plugin {
  async onload() {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.cache = null;
    // fingerprint -> serialized cache, so a settings round-trip within one session gets
    // its earlier answers back instead of losing them to the toggle. In memory only.
    this.cacheSnapshots = new Map();
    // The gate setting was briefly a boolean (true = what is now "fast"). Legacy true
    // maps to "balanced" deliberately: skip mode measurably silenced suggestions, so it
    // is opt-in from here on.
    if (typeof this.settings.gate === "boolean") {
      this.settings.gate = this.settings.gate ? "balanced" : "off";
    }
    this.engine = null;
    this.modelName = null;
    this.runtime = null;          // the managed server, when Tolben started one
    this.idleTimer = null;
    this.starting = null;         // the one connect() in flight, which every sentence awaits
    this.provisioning = null;     // the one re-provision in flight
    this.provisionImpl ??= provision;   // replaceable, so the lifecycle can be tested
    this.ledger = createLedger();
    this.network = createNetworkLog();
    // Every request the plugin makes goes through this one wrapper, which is what lets
    // the network pane count them.
    this.fetch = this.network.wrap(nodeFetch);

    this.statusEl = this.addStatusBarItem();
    this.setStatus(statusLine({ state: this.settings.setupDone ? "idle" : "setup" }));

    const clarity = clarityExtension({
      debounceMs: this.settings.debounceMs,
      analyze: (sentence, { signal, context }) => this.analyze(sentence, { signal, context }),
      // The deterministic pass alone: repairMechanics and the clarity rules plus every
      // showability guard, no model and no network, so something is underlined in
      // ~150ms. Whatever this offers is provisional: the model pass that follows
      // replaces the card it puts up.
      analyzeLocal: (sentence, context) => analyzeSentence(sentence, {
        engine: null,
        mechanics: this.settings.mechanics,
        rules: this.settings.rules,
        protectedTerms: context?.protectedTerms ?? [],
      }),
      onStatus: (status) => this.renderStatus(status),
      gateMode: () => this.settings.gate,
    });
    this.clarity = clarity;
    this.registerEditorExtension(clarity.extension);

    this.addCommand({
      id: "recheck",
      name: "Recheck open notes",
      callback: () => {
        this.clarity.invalidateAll();
        new Notice("Tolben: rechecking");
      },
    });

    this.addCommand({
      id: "ledger",
      name: "Show refusal ledger for this note",
      callback: () => this.showLedger(),
    });

    this.addCommand({
      id: "network",
      name: "Show what talks to the network",
      callback: () => this.showNetwork(),
    });

    this.addCommand({
      id: "setup",
      name: "Set up the model server",
      callback: () => this.openSetup(),
    });

    this.addSettingTab(new TolbenSettingTab(this.app, this));

    // First run: offer setup once rather than at every launch, and never block loading on
    // it. A writer who dismisses it gets the command and the settings tab.
    if (!this.settings.setupDone) {
      this.openSetup();
    } else {
      // Connecting is not allowed to fail loading: the writer should be able to start the
      // model server after Obsidian, and have the next sentence they finish just work.
      this.connect().catch(() => {});
    }
  }

  // ------------------------------------------------------------------------- setup

  /** The first-run pane. Shows the plan; downloads only if a person says so. */
  async openSetup() {
    const modal = new Modal(this.app);
    modal.open();
    const root = modal.contentEl;
    root.setText?.("");

    const draw = async () => {
      const proposed = await planRuntime({
        stateDir: this.stateDir(),
        modelId: this.settings.modelId,
        fetchImpl: this.fetch,
        readFile: (path, encoding) => this.readNodeFile(path, encoding),
        run: (command, args) => this.runCommand(command, args),
      });
      this.plan = proposed;
      renderSetup(root, proposed, {
        onRetry: () => draw(),
        onCancel: async () => { this.settings.setupDone = true; await this.save(); modal.close(); },
        onUseExisting: async () => {
          this.settings.baseUrl = proposed.running.llamaServer?.apiBase ?? proposed.running.ollama?.apiBase;
          this.settings.managed = false;
          this.settings.setupDone = true;
          await this.save();
          modal.close();
          this.connect().catch((error) => new Notice(`Tolben: ${error.message}`));
        },
        onConfirm: () => this.runSetup(proposed, root, modal),
      });
    };
    await draw();
  }

  async runSetup(proposed, root, modal) {
    try {
      if (proposed.action === "pull-ollama") {
        await pullModel({
          tag: proposed.ollamaTag,
          baseUrl: proposed.running.ollama.baseUrl,
          fetchImpl: this.fetch,
          onProgress: ({ status, received, total }) =>
            renderProgress(root, { label: status, received, total, note: proposed.ollamaTag }),
        });
        this.settings.baseUrl = proposed.running.ollama.apiBase;
        this.settings.managed = false;
      } else {
        const result = await provision({
          stateDir: this.stateDir(),
          modelId: this.settings.modelId,
          confirmed: true,
          fetchImpl: this.fetch,
          readFile: (path, encoding) => this.readNodeFile(path, encoding),
          run: (command, args) => this.runCommand(command, args),
          onEvent: (event) => {
            if (event.phase === "progress") {
              renderProgress(root, { label: event.item.name, received: event.received, total: event.total });
            } else if (event.phase === "spawn") {
              renderProgress(root, { label: "Starting the model server", received: 0, total: 0 });
            } else if (event.phase === "warmup") {
              renderProgress(root, { label: "Loading the weights", received: 0, total: 0, note: "a few seconds; longer the first time" });
            }
          },
        });
        this.runtime = result;
        this.settings.baseUrl = result.apiBase;
        this.apiKey = result.apiKey;
        this.settings.managed = Boolean(result.managed);
      }
      this.settings.setupDone = true;
      await this.save();
      // The prompts are read in here, where the pane can say so, rather than by the
      // writer's first sentence: about forty seconds on a 4-core CPU, once per server
      // process. In 1.0.0 that sentence met the 12 s timeout twice instead.
      renderProgress(root, { label: "Reading the prompts in", received: 0, total: 0, note: "about 40 seconds on a 4-core CPU, once per server start" });
      await this.connect();
      modal.close();
      new Notice("Tolben: ready");
    } catch (error) {
      root.replaceChildren();
      const title = root.ownerDocument.createElement("h2");
      title.textContent = error.advice?.title ?? "Setup failed";
      root.appendChild(title);
      const body = root.ownerDocument.createElement("pre");
      body.className = "tolben-advice";
      body.textContent = `${error.advice?.body ?? error.message}${error.advice?.fallback ? `\n\n${error.advice.fallback}` : ""}`;
      root.appendChild(body);
    }
  }

  // Where the managed runtime lives: outside the vault, deliberately. A 1.5 GB model
  // inside a synced vault is a bad afternoon for whoever is paying for the sync.
  stateDir() {
    const base = process.env.XDG_DATA_HOME
      ?? (process.platform === "win32" ? process.env.LOCALAPPDATA : null)
      ?? `${process.env.HOME ?? "."}/.local/share`;
    return `${base}/tolben`;
  }

  async readNodeFile(path, encoding) {
    const { readFile } = await import("node:fs/promises");
    return readFile(path, encoding);
  }

  async runCommand(command, args) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    return promisify(execFile)(command, args);
  }

  // ------------------------------------------------------------------------ the panes

  showLedger() {
    const path = this.app.workspace.getActiveFile()?.path ?? null;
    const modal = new Modal(this.app);
    modal.open();
    const rows = path ? this.ledger.forNote(path) : [];
    renderLedger(modal.contentEl, { path: path ?? "no note open", rows }, {
      onCopy: () => {
        navigator.clipboard?.writeText?.(this.ledger.asText(path));
        new Notice("Tolben: ledger copied");
      },
      onClear: () => { this.ledger.clear(path); modal.close(); },
    });
  }

  showNetwork() {
    const model = modelById(this.settings.modelId);
    const modal = new Modal(this.app);
    modal.open();
    renderNetwork(modal.contentEl, {
      network: this.network.report(),
      endpoint: this.settings.baseUrl || null,
      managed: Boolean(this.runtime?.managed),
      pid: this.runtime?.pid ?? null,
      model: this.modelName ?? model?.file ?? null,
      modelSha256: this.runtime?.managed ? model?.sha256 : null,
      measured: this.runtime?.managed ? model?.measured : undefined,
      cacheEntries: this.cache?.size ?? 0,
      ledger: this.ledger.stats(),
      vaultWrites: "settings only (data.json)",
    });
  }

  onunload() {
    this.engine = null;
    clearTimeout(this.idleTimer);
    // A model server Tolben started is Tolben's to stop. Obsidian cannot await onunload, so
    // this is fire-and-forget; the PID file is the backstop for a force quit that
    // outruns it, and the next launch reaps whatever is left.
    this.runtime?.stop?.().catch(() => {});
    this.runtime = null;
    // Nothing is written here. The cache and the ledger were only ever in memory, and
    // they go with the process.
    this.cache = null;
    this.ledger.clear();
  }

  // Everything that could change a model answer, folded into one string. A cache written
  // under a different fingerprint answers for a different configuration and is dropped
  // whole at load rather than trusted.
  cacheFingerprint() {
    return JSON.stringify([
      CACHE_EPOCH,
      this.manifest.version,
      this.modelName,
      outcomeKey(clarityPrompt, [verifierPrompt]),   // the same hash the keys use
      // The rule table edits answers deterministically before the model is consulted, so
      // its content is part of what produced every cached outcome.
      RULES_SIGNATURE,
      this.settings.mechanics, this.settings.rules, this.settings.gate === "fast",
      // The deletion policy decides whether a single lost word is put to the verifier or
      // refused outright, so an answer cached under one does not describe the other.
      this.deletionPolicy(),
    ]);
  }

  outcomeCache() {
    const fingerprint = this.cacheFingerprint();
    if (this.cache && this.cache.fingerprint === fingerprint) return this.cache;
    // A settings flip mid-session must not lose the old fingerprint's answers: stash the
    // outgoing cache in memory and prefer a stashed snapshot for the incoming
    // fingerprint. createOutcomeCache drops mismatched serializations, so handing it the
    // wrong blob is safe, just wasteful.
    if (this.cache) this.cacheSnapshots.set(this.cache.fingerprint, this.cache.serialize());
    const cache = createOutcomeCache({ fingerprint, serialized: this.cacheSnapshots.get(fingerprint) ?? null });
    cache.fingerprint = fingerprint;
    this.cache = cache;
    return cache;
  }

  deletionPolicy() {
    return this.settings.neverDropWords ? "refuse" : "verify";
  }

  // One connection at a time, and every sentence waits for it. While the prompts are
  // being read in, a sentence sent alongside would queue behind them on the single slot
  // and meet the 12 s timeout — which is exactly what the writer's first sentence did in
  // 1.0.0 (REPORT.md, 2026-09-04).
  connect() {
    if (!this.starting) {
      this.starting = this.connectNow().finally(() => { this.starting = null; });
      // Whoever awaits gets the rejection; this branch only keeps a connect nobody is
      // waiting on (the one at load) from surfacing as an unhandled rejection.
      this.starting.catch(() => {});
    }
    return this.starting;
  }

  // The connection a sentence needs, unless the writer moves past the sentence first.
  async awaitConnection({ signal } = {}) {
    const connecting = this.connect();
    if (!signal) return connecting;
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(Object.assign(new Error("Request superseded"), { kind: "aborted" }));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([connecting, aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  // A server Tolben started does not outlive Obsidian, and the idle unload stops it on
  // purpose; both times the way back is the provisioning the setup pane did, from the
  // files it left on disk. Never a download: provision() refuses one it has not been
  // confirmed for, and the refusal becomes the one instruction that helps.
  ensureRuntime() {
    if (this.runtime || !this.settings.managed) return Promise.resolve();
    if (!this.provisioning) {
      this.provisioning = (async () => {
        let result;
        try {
          result = await this.provisionImpl({
            stateDir: this.stateDir(),
            modelId: this.settings.modelId,
            confirmed: false,
            fetchImpl: this.fetch,
            readFile: (path, encoding) => this.readNodeFile(path, encoding),
            run: (command, args) => this.runCommand(command, args),
          });
        } catch (error) {
          if (error.kind === "unconfirmed") {
            throw Object.assign(
              new Error("the model files are not on disk — run \"Tolben: Set up the model server\""),
              { kind: "failed", cause: error },
            );
          }
          throw error;
        }
        this.runtime = result;
        this.settings.baseUrl = result.apiBase;
        this.apiKey = result.apiKey;
        this.settings.managed = Boolean(result.managed);
        await this.save();
      })().finally(() => { this.provisioning = null; });
    }
    return this.provisioning;
  }

  async connectNow() {
    this.setStatus(statusLine({ state: "starting", managed: Boolean(this.settings.managed) }));
    await this.ensureRuntime();
    if (!this.settings.baseUrl) throw new Error("no model server configured — run setup");
    const base = this.settings.baseUrl.replace(/\/$/u, "");
    const headers = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    const response = await this.fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`model server HTTP ${response.status}`);
    this.modelName = (await response.json())?.data?.[0]?.id ?? "local";

    // An Ollama endpoint needs its dialect probed: keep_alive and reasoning_effort are
    // extensions its /v1 is entitled to ignore, and both fail silently rather than
    // loudly. connectOllama picks /api/chat when they are dropped.
    let fetchImpl = this.fetch;
    let dialect = "openai";
    let useReasonStop = true;
    if (/:11434(?:\/|$)/u.test(base)) {
      const connection = await connectOllama({
        tag: this.modelName, baseUrl: base.replace(/\/v1$/u, ""), fetchImpl: this.fetch,
      });
      fetchImpl = connection.fetchImpl;
      dialect = connection.dialect;
      useReasonStop = connection.useReasonStop;
      this.ollamaFindings = connection.findings;
    }

    this.engine = createEngine({
      baseUrl: this.settings.baseUrl,
      model: this.modelName,
      prompt: clarityPrompt,
      verifierPrompt,
      fetchImpl,
      dialect,
      useReasonStop,
      apiKey: this.apiKey ?? null,
      timeoutMs: 12000,
    });
    // Read both prompts in now, under "starting the model", so the first sentence finds
    // its prefix cached. A server that cannot manage that is not connected.
    const warm = await this.engine.warmUp();
    if (!warm.ok) {
      this.engine = null;
      throw Object.assign(new Error(`the model did not answer while starting: ${warm.error}`), { kind: warm.kind ?? "transient" });
    }
    this.warmUp = warm;
    this.setStatus(statusLine({ state: "ready", managed: Boolean(this.runtime?.managed) }));
    return this.modelName;
  }

  async analyze(sentence, { signal, context }) {
    // A fired clarity rule no longer ends the matter here either. It repairs only the
    // wordiness it matched, so returning it meant a sentence carrying BOTH a wordy idiom
    // and a grammar fault was answered with the idiom fixed and the fault shipped — and
    // then marked decided, so nothing looked at it again. The rule's answer still
    // reaches the screen in ~150ms through the fast local pass (analyzeLocal, which runs
    // this same deterministic pipeline with no engine), including while llama-server is
    // down; what changed is that the model is now always asked as well, and supersedes
    // it.
    if (!this.engine || this.starting) await this.awaitConnection({ signal });
    // Paid-for answers are never paid for again. The cache holds only outcomes the MODEL
    // produced — mechanics, rules and the gate recompute in microseconds and would only
    // bloat the file.
    const cache = this.outcomeCache();
    const key = outcomeKey(sentence, context?.protectedTerms ?? []);
    const hit = cache.get(key);
    if (hit) {
      return { source: sentence, replacement: hit.replacement ?? null, reason: hit.reason ?? null,
        stages: hit.stages, rejection: hit.rejection ?? null, modelRejection: hit.modelRejection ?? null, cached: true };
    }
    this.armIdleUnload();
    const outcome = await analyzeSentence(sentence, {
      engine: this.engine,
      signal,
      mechanics: this.settings.mechanics,
      rules: this.settings.rules,
      deletionPolicy: this.deletionPolicy(),
      // Only "fast" skips the model; "balanced" expresses the gate through scheduling.
      gate: this.settings.gate === "fast",
      // Inline code and link text: prose to the model, immutable to the validator.
      protectedTerms: context?.protectedTerms ?? [],
    });
    // The pipeline reports an unreachable model inside an otherwise normal outcome.
    // Returning it as-is would tell the editor the sentence is clear, and the sentence
    // would never be looked at again.
    if (outcome.error) {
      // The kind travels: the controller gives "failed" (deterministic for this text) one
      // attempt and everything else two, so collapsing kinds here would either reopen the
      // retry loop or spend calls on garbage. A verifier that returned unparseable output
      // is deterministic garbage too — the pipeline reports that as verifier-unavailable
      // with cause "failed".
      const { kind: reported, cause } = outcome.error;
      const kind = reported === "aborted" ? "aborted"
        : reported === "failed" ? "failed"
        : reported === "verifier-unavailable" && cause === "failed" ? "failed"
        : "transient";
      throw Object.assign(new Error(outcome.error.message), { kind });
    }
    // A model call happened (a surfaced rewrite, a refusal, or a measured "keep"): worth
    // remembering. Deterministic-only outcomes are not.
    if (outcome.stages?.model || outcome.modelRejection || outcome.latencyMs > 0) {
      cache.set(key, {
        replacement: outcome.replacement, reason: outcome.reason,
        stages: outcome.stages, rejection: outcome.rejection, modelRejection: outcome.modelRejection,
      });
    }
    this.recordRefusal(outcome);
    return outcome;
  }

  // A rewrite the model produced and the gate stopped. Recorded per note so the writer
  // can see what was withheld — the product's argument, made checkable.
  recordRefusal(outcome) {
    const reason = outcome?.modelRejection ?? outcome?.rejection;
    if (!reason || !outcome.rejectedText) return;
    const path = this.app.workspace.getActiveFile?.()?.path;
    if (!path) return;
    this.ledger.record(path, {
      source: outcome.source,
      replacement: outcome.rejectedText,
      reason,
    });
  }

  // ------------------------------------------------------------------- idle unload

  /**
   * Give the machine its 2 GB back after a while.
   *
   * The next sentence brings the server back through ensureRuntime(): about a minute on
   * a 4-core CPU, under "starting the model". The KV slot is written before the server
   * stops; measured, that does not shorten the way back (REPORT.md, 2026-09-03), and it
   * is kept because it is cheap. Only a server Tolben started is ever stopped: one the
   * writer runs themselves is theirs.
   */
  armIdleUnload() {
    clearTimeout(this.idleTimer);
    const minutes = Number(this.settings.idleUnloadMinutes);
    if (!minutes || !this.runtime?.managed) return;
    this.idleTimer = setTimeout(() => this.unloadIdle().catch(() => {}), minutes * 60000);
  }

  async unloadIdle() {
    if (!this.runtime?.managed) return;
    const { saveSlot } = await import("./runtime/server.mjs");
    await saveSlot({ baseUrl: this.runtime.baseUrl, apiKey: this.runtime.apiKey, fetchImpl: this.fetch });
    await this.runtime.stop();
    this.engine = null;
    this.runtime = null;
    this.setStatus(statusLine({ state: "idle", managed: true }));
  }

  setStatus(text) {
    this.statusEl.setText(text);
  }

  renderStatus({ count, inFlight, held = 0, error }) {
    const path = this.app.workspace.getActiveFile?.()?.path;
    // Held sentences spent their retry budget against a failing model. Reporting "clear"
    // here told the writer their prose was checked when it never was.
    this.setStatus(statusLine({
      state: this.starting ? "starting" : error ? "error" : inFlight > 0 ? "checking" : this.settings.setupDone ? "ready" : "setup",
      count,
      refused: path ? this.ledger.countForNote(path) : 0,
      held,
      error,
      managed: Boolean(this.runtime?.managed),
    }));
  }

  async save() {
    await this.saveData(this.settings);
  }
}

class TolbenSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Set up the model server")
      .setDesc("Find a running Ollama or llama-server, or download a pinned one. Shows every URL and hash before anything is fetched.")
      .addButton((btn) => btn
        .setButtonText("Open setup")
        .setCta()
        .onClick(() => this.plugin.openSetup()));

    new Setting(containerEl)
      .setName("Model server")
      .setDesc("OpenAI-compatible endpoint on loopback. Nothing leaves this machine.")
      .addText((text) => text
        .setPlaceholder(DEFAULTS.baseUrl)
        .setValue(this.plugin.settings.baseUrl)
        .onChange(async (value) => {
          this.plugin.settings.baseUrl = value.trim() || DEFAULTS.baseUrl;
          this.plugin.engine = null;   // rebuilt against the new endpoint on next use
          await this.plugin.save();
          // Failures recorded against the old endpoint describe the old endpoint.
          this.plugin.clarity.invalidateAll();
        }));

    new Setting(containerEl)
      .setName("Mechanical fixes")
      .setDesc("Repair unambiguous spelling and spacing faults deterministically before the model sees the sentence.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.mechanics)
        .onChange(async (value) => {
          this.plugin.settings.mechanics = value;
          await this.plugin.save();
          // Previous decisions were made under the old setting and no longer apply.
          this.plugin.clarity.invalidateAll();
        }));

    new Setting(containerEl)
      .setName("Deterministic rewrites")
      .setDesc("Fix wordy idioms with a known short form (“in order to” → “to”) instantly, without asking the model.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.rules)
        .onChange(async (value) => {
          this.plugin.settings.rules = value;
          await this.plugin.save();
          this.plugin.clarity.invalidateAll();
        }));

    new Setting(containerEl)
      .setName("Suggestion gate")
      .setDesc("Balanced: sentences that look improvable (wordy phrases, passives…) are checked first, the rest last — every suggestion still arrives. Fast: the rest are skipped entirely, ~40% less model time but their suggestions are lost. Off: document order.")
      .addDropdown((dropdown) => dropdown
        .addOption("balanced", "Balanced — likely first, everything eventually")
        .addOption("fast", "Fast — skip unlikely sentences")
        .addOption("off", "Off")
        .setValue(this.plugin.settings.gate)
        .onChange(async (value) => {
          this.plugin.settings.gate = value;
          await this.plugin.save();
          // Previous decisions were made under the old setting and no longer apply.
          this.plugin.clarity.invalidateAll();
        }));

    new Setting(containerEl)
      .setName("Never drop words")
      .setDesc("Refuse any rewrite that loses a word, instead of asking the model whether the rest of the sentence still says it. "
        + "Off by default: on the labelled corpora this stops no further meaning changes and costs 15 of Grammarly's own rewrites "
        + "plus 48 preserving ones, and every published number was measured with it off. On is the right setting for text where a "
        + "lost qualifier is a problem whatever a model thinks.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.neverDropWords)
        .onChange(async (value) => {
          this.plugin.settings.neverDropWords = value;
          await this.plugin.save();
          // The policy is part of the cache fingerprint, so old answers are dropped, but
          // decided sentences also need looking at again under the new rule.
          this.plugin.clarity.invalidateAll();
        }));

    new Setting(containerEl)
      .setName("Typing delay")
      .setDesc("How long after your last keystroke a finished sentence is sent, in milliseconds. Below about 80 the model is asked "
        + "about text you are still typing; above about 400 the underline feels detached from the sentence that caused it.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULTS.debounceMs))
        .setValue(String(this.plugin.settings.debounceMs))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed)) return;
          this.plugin.settings.debounceMs = Math.min(2000, Math.max(40, parsed));
          await this.plugin.save();
        }));

    new Setting(containerEl)
      .setName("Unload the model when idle")
      .setDesc("Minutes of no typing before a model server Tolben started is stopped and its 2 GB returned, 0 to keep it loaded. "
        + "It comes back by itself when you finish a sentence, but slowly — about a minute on a 4-core CPU, while the status bar "
        + "says \"starting the model\": the files are re-verified, the server restarted and the prompts read in again. "
        + "Set this to 0 if you would rather keep the 2 GB and never wait. A server you started yourself is never stopped.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULTS.idleUnloadMinutes))
        .setValue(String(this.plugin.settings.idleUnloadMinutes))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < 0) return;
          this.plugin.settings.idleUnloadMinutes = parsed;
          await this.plugin.save();
          this.plugin.armIdleUnload();
        }));

    new Setting(containerEl)
      .setName("What talks to the network")
      .setDesc("Every request this plugin has made since it loaded, counted by host.")
      .addButton((btn) => btn
        .setButtonText("Show")
        .onClick(() => this.plugin.showNetwork()));

    new Setting(containerEl)
      .setName("Connection")
      .setDesc(this.plugin.modelName ? `Connected to ${this.plugin.modelName}` : "Not connected")
      .addButton((button) => button
        .setButtonText("Test")
        .onClick(async () => {
          try {
            const name = await this.plugin.connect();
            new Notice(`Tolben: connected to ${name}`);
          } catch (error) {
            new Notice(`Tolben: ${error.message}`);
          }
          this.display();
        }));
  }
}
