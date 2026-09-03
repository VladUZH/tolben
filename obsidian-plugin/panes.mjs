// The three screens Tolben shows that are not a suggestion card.
//
// All three are built from the same principle: show the thing itself, not a summary of
// it. The setup pane lists every URL and hash before a byte moves. The ledger lists the
// sentences that were refused, in the writer's own words. The network pane lists the
// hosts that were actually contacted, counted by the wrapper around the plugin's only
// request function. None of them asks to be believed.
//
// The DOM is built by hand rather than through Obsidian's helpers so that the whole file
// is testable against jsdom, which is how tests/plugin-panes.test.mjs exercises it.

import { formatBytes } from "./runtime/provision.mjs";

// ---------------------------------------------------------------------------- helpers

function element(parent, tag, className, text) {
  const node = parent.ownerDocument.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

function button(parent, label, { primary = false, onClick } = {}) {
  const node = element(parent, "button", primary ? "tolben-primary" : null, label);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

// -------------------------------------------------------------------------- the setup

/**
 * Render the first-run pane into `root`.
 *
 * `plan` is what provision.plan() returned. `handlers` gets `onConfirm` (only reachable
 * when there is something to confirm), `onCancel`, and `onUseExisting`.
 *
 * The shape of this screen is the product's argument: the sizes and the hashes are above
 * the button, not behind a disclosure triangle, and the button says what it will do.
 */
export function renderSetup(root, plan, handlers = {}) {
  root.className = "tolben-pane tolben-setup";
  root.replaceChildren();

  element(root, "h2", "tolben-pane-title", "Tolben needs a model to run");
  element(root, "p", "tolben-pane-lede",
    "Everything runs on this machine. Nothing you write is sent anywhere, and there is no "
    + "account. What Tolben needs is a local model server; here is what it found.");

  const found = element(root, "div", "tolben-setup-found");
  if (plan.running.llamaServer) {
    element(found, "div", "tolben-good", `llama-server is already running on ${plan.running.llamaServer.baseUrl}.`);
  } else if (plan.running.ollama) {
    element(found, "div", "tolben-good", `Ollama is already running on ${plan.running.ollama.baseUrl}.`);
  } else {
    element(found, "div", "tolben-note", "Nothing is running on 127.0.0.1:8080 or 127.0.0.1:11434.");
  }

  if (plan.sandbox) {
    element(root, "div", "tolben-warn",
      `Obsidian is running inside ${plan.sandbox}, which cannot execute a downloaded model `
      + "server. Install Ollama on the host and Tolben will use it.");
  }

  if (plan.action === "use-llama-server" || plan.action === "use-ollama") {
    element(root, "p", null, "Nothing needs downloading.");
    const actions = element(root, "div", "tolben-pane-actions");
    button(actions, "Use it", { primary: true, onClick: handlers.onUseExisting });
    return root;
  }

  if (plan.action === "pull-ollama") {
    element(root, "p", null,
      `Ollama is running but does not have the model Tolben was measured on. It will pull `
      + `${plan.ollamaTag} (${formatBytes(plan.model.bytes)}). Ollama verifies it.`);
    const actions = element(root, "div", "tolben-pane-actions");
    button(actions, `Pull ${formatBytes(plan.model.bytes)}`, { primary: true, onClick: handlers.onConfirm });
    button(actions, "Not now", { onClick: handlers.onCancel });
    return root;
  }

  if (plan.action === "blocked") {
    element(root, "div", "tolben-warn", plan.runtimeUnavailable.detail);
    element(root, "p", null,
      "Install Ollama and run `ollama serve`, or start llama-server yourself on "
      + "127.0.0.1:8080, and Tolben will find it.");
    const actions = element(root, "div", "tolben-pane-actions");
    button(actions, "Look again", { primary: true, onClick: handlers.onRetry });
    button(actions, "Close", { onClick: handlers.onCancel });
    return root;
  }

  // The download case: every URL, size and hash, before the button.
  element(root, "h3", null, `Tolben will download ${formatBytes(plan.totalBytes)}`);
  const list = element(root, "ul", "tolben-setup-items");
  for (const item of plan.items) {
    const row = element(list, "li", "tolben-setup-item");
    element(row, "div", "tolben-item-name", `${item.name} — ${formatBytes(item.bytes)}`);
    element(row, "div", "tolben-item-url", item.url);
    element(row, "div", "tolben-item-hash", `sha256 ${item.sha256}`);
  }
  element(root, "p", "tolben-note",
    "Each file is checked against the hash above before it is used. A file that does not "
    + "match is discarded, not run.");
  if (!plan.measured) {
    element(root, "div", "tolben-warn",
      "This is not the model the published numbers were measured on. It is smaller and "
      + "faster; how much accuracy that costs has not been measured.");
  }

  const actions = element(root, "div", "tolben-pane-actions");
  button(actions, `Download ${formatBytes(plan.totalBytes)} and start`, { primary: true, onClick: handlers.onConfirm });
  button(actions, "Not now", { onClick: handlers.onCancel });
  return root;
}

/** Progress, rendered into the same pane once the download starts. */
export function renderProgress(root, { label, received, total, note }) {
  root.replaceChildren();
  root.className = "tolben-pane tolben-setup";
  element(root, "h2", "tolben-pane-title", "Setting up");
  element(root, "div", "tolben-progress-label", label);
  const track = element(root, "div", "tolben-progress");
  const fill = element(track, "div", "tolben-progress-fill");
  const share = total ? Math.min(1, received / total) : 0;
  fill.style.width = `${(share * 100).toFixed(1)}%`;
  element(root, "div", "tolben-progress-bytes",
    total ? `${formatBytes(received)} of ${formatBytes(total)}` : formatBytes(received));
  if (note) element(root, "div", "tolben-note", note);
  return root;
}

// --------------------------------------------------------------------------- the ledger

/**
 * What the gate refused in this note.
 *
 * The empty state is not an apology. "Nothing was refused" is a real answer and the
 * common one; a reader who opens this and finds it empty has learned something true.
 */
export function renderLedger(root, { path, rows }, handlers = {}) {
  root.className = "tolben-pane tolben-ledger";
  root.replaceChildren();

  element(root, "h2", "tolben-pane-title", "What Tolben refused to suggest");
  element(root, "div", "tolben-pane-lede", path);

  if (rows.length === 0) {
    element(root, "p", "tolben-empty",
      "Nothing was refused in this note. Either the model proposed nothing that changed "
      + "your meaning, or it proposed nothing at all.");
    return root;
  }

  element(root, "p", "tolben-pane-lede",
    `${rows.length} suggestion${rows.length === 1 ? "" : "s"} the model produced and the gate `
    + "stopped. Each names the rule that stopped it.");

  const list = element(root, "ul", "tolben-ledger-rows");
  for (const row of rows) {
    const item = element(list, "li", "tolben-ledger-row");
    element(item, "div", "tolben-ledger-reason", row.reason);
    element(item, "div", "tolben-ledger-source", row.source);
    element(item, "div", "tolben-ledger-proposed", row.replacement ?? "(nothing)");
  }

  const actions = element(root, "div", "tolben-pane-actions");
  button(actions, "Copy as text", { onClick: handlers.onCopy });
  button(actions, "Clear", { onClick: handlers.onClear });
  return root;
}

// -------------------------------------------------------------------------- the network

/**
 * Every host this plugin has contacted, and the running server's identity.
 *
 * The first line is the whole claim, and it is computed rather than written: if
 * `offMachine` is anything but zero, this pane says the claim is false.
 */
export function renderNetwork(root, report) {
  root.className = "tolben-pane tolben-network";
  root.replaceChildren();

  element(root, "h2", "tolben-pane-title", "What talks to the network");

  const verdict = element(root, "div", report.network.offMachine === 0 ? "tolben-good" : "tolben-warn");
  verdict.textContent = report.network.offMachine === 0
    ? `${report.network.requests} request${report.network.requests === 1 ? "" : "s"} since this plugin loaded, all to this machine.`
    : `${report.network.offMachine} of ${report.network.requests} requests went somewhere other than this machine.`;

  const hosts = element(root, "ul", "tolben-network-hosts");
  if (report.network.hosts.length === 0) {
    element(hosts, "li", "tolben-empty", "No requests yet.");
  }
  for (const host of report.network.hosts) {
    element(hosts, "li", host.loopback ? "tolben-host-local" : "tolben-host-remote",
      `${host.host} — ${host.requests} request${host.requests === 1 ? "" : "s"}${host.loopback ? "" : "  (NOT this machine)"}`);
  }

  const facts = element(root, "dl", "tolben-network-facts");
  const fact = (term, value) => {
    element(facts, "dt", null, term);
    element(facts, "dd", null, value);
  };
  fact("Model endpoint", report.endpoint ?? "not connected");
  fact("Server", report.managed
    ? `started by Tolben, pid ${report.pid ?? "?"}${report.rssBytes ? `, ${formatBytes(report.rssBytes)} resident` : ""}`
    : "started by you; Tolben did not spawn it");
  fact("Model", report.model ?? "unknown");
  fact("Model sha256", report.modelSha256 ?? "not a pinned artefact — Tolben did not fetch it");
  fact("Measured artefact", report.measured === undefined ? "unknown"
    : report.measured ? "yes — this is what REPORT.md's numbers describe"
    : "no — the published numbers do not describe this model");
  fact("Held in memory", `${report.cacheEntries ?? 0} cached answers, `
    + `${report.ledger?.entries ?? 0} refusals across ${report.ledger?.notes ?? 0} note(s)`);
  fact("Written to your vault", report.vaultWrites ?? "settings only (data.json)");

  element(root, "p", "tolben-note",
    "The request count comes from a wrapper around the only function this plugin has for "
    + "making a request. It is not a packet capture, and it is not asking to be believed: "
    + "the model server binds 127.0.0.1 on a random port with a key, so you can watch it "
    + "yourself.");
  return root;
}

/** The status bar line. Short, and honest about what has been refused. */
export function statusLine({ state, count = 0, refused = 0, held = 0, error = null, managed = false }) {
  if (error) return `Tolben: ${error}`;
  if (state === "setup") return "Tolben: needs setup";
  if (state === "starting") return "Tolben: starting the model";
  if (state === "checking") return "Tolben: checking…";
  const parts = [state === "ready" ? "ready" : state, managed ? "local" : "local"];
  if (count > 0) parts.push(`${count} suggestion${count === 1 ? "" : "s"}`);
  if (refused > 0) parts.push(`${refused} refused`);
  if (held > 0) parts.push(`${held} unchecked`);
  return `Tolben: ${parts.join(" · ")}`;
}
