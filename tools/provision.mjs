// The provisioner, headless.
//
// Same code path the plugin's setup pane drives, with a terminal instead of a pane. It
// exists so CI can prove on macOS, Windows and Linux that the thing a stranger will run
// actually works there — a claim no amount of unit testing with fake child processes can
// make.
//
//   node tools/provision.mjs --plan                  # what it would do, and nothing else
//   node tools/provision.mjs --confirm               # do it, then stop the server
//   node tools/provision.mjs --confirm --keep        # do it and leave the server running
//   node tools/provision.mjs --confirm --model q4    # the smaller, unmeasured quantisation
//   node tools/provision.mjs --state <dir>           # where to keep the runtime
//
// Exit status is 0 only if a model server ended up answering.

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { plan, provision, describePlan, formatBytes } from "../obsidian-plugin/runtime/provision.mjs";
import { MEASURED_MODEL } from "../obsidian-plugin/runtime/manifest.mjs";

const run = promisify(execFile);
const argument = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const MODEL_ALIASES = { q6: MEASURED_MODEL, q4: "qwen3.5-2b-q4_k_m" };

function bar(received, total) {
  if (!total) return `${formatBytes(received)}`;
  const share = Math.min(1, received / total);
  const filled = Math.round(share * 24);
  return `[${"#".repeat(filled)}${" ".repeat(24 - filled)}] ${(share * 100).toFixed(0)}%  ${formatBytes(received)} / ${formatBytes(total)}`;
}

async function main() {
  const stateDir = argument("--state", join(homedir(), ".local", "share", "tolben"));
  const modelId = MODEL_ALIASES[argument("--model", "q6")] ?? argument("--model", MEASURED_MODEL);
  const options = { stateDir, modelId, readFile, run: (cmd, args) => run(cmd, args) };

  const proposed = await plan(options);
  process.stdout.write(`platform    ${proposed.platform}/${proposed.arch}`
    + `${proposed.features.length ? ` (${proposed.features.join(", ")})` : ""}\n`);
  if (proposed.sandbox) process.stdout.write(`sandbox     ${proposed.sandbox}\n`);
  process.stdout.write(`state       ${stateDir}\n`);
  process.stdout.write(`running     ollama=${proposed.running.ollama ? "yes" : "no"}`
    + ` llama-server=${proposed.running.llamaServer ? "yes" : "no"}\n`);
  process.stdout.write(`plan        ${describePlan(proposed)}\n`);
  if (proposed.runtimeUnavailable) {
    process.stdout.write(`\n${proposed.runtimeUnavailable.detail}\n`);
  }
  for (const item of proposed.items) {
    process.stdout.write(`\n  ${item.kind}: ${item.name}\n`
      + `    ${item.url}\n`
      + `    ${formatBytes(item.bytes)}  sha256 ${item.sha256}\n`);
  }
  if (!proposed.measured) {
    process.stdout.write("\n  NOTE: this is not the artefact REPORT.md's numbers were measured on.\n");
  }

  if (flag("--plan")) return;
  if (!flag("--confirm")) {
    process.stdout.write("\nNothing was downloaded. Pass --confirm to go ahead.\n");
    return;
  }

  process.stdout.write("\n");
  let lastLine = "";
  const result = await provision({
    ...options,
    confirmed: true,
    onEvent: (event) => {
      if (event.phase === "progress") {
        const line = `  ${event.item.name}  ${bar(event.received, event.total)}`;
        if (line !== lastLine) { process.stdout.write(`\r${line}`); lastLine = line; }
        return;
      }
      if (lastLine) { process.stdout.write("\n"); lastLine = ""; }
      if (event.phase === "downloaded") process.stdout.write(`  ${event.item.name} ${event.reused ? "already on disk and verified" : "verified"}\n`);
      else if (event.phase === "extracted") process.stdout.write(`  extracted, server at ${event.binary}\n`);
      else if (event.phase === "spawn") process.stdout.write(`  starting on port ${event.port}\n`);
      else if (event.phase === "warmup") process.stdout.write("  warming up\n");
      else if (event.phase === "ready") process.stdout.write(`  ready in ${event.ms} ms\n`);
      else if (event.phase === "reaped") process.stdout.write(`  killed an orphaned server from a previous run (pid ${event.pid})\n`);
    },
  });

  process.stdout.write(`\n${result.kind === "managed" ? "started" : "using"} ${result.server} at ${result.apiBase}\n`);
  if (result.managed && !flag("--keep")) {
    await result.stop();
    process.stdout.write("stopped it again (pass --keep to leave it running)\n");
  }
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  if (error.advice) {
    process.stderr.write(`\n${error.advice.title}\n${"-".repeat(error.advice.title.length)}\n${error.advice.body}\n`);
    if (error.advice.fallback) process.stderr.write(`\n${error.advice.fallback}\n`);
  }
  process.exitCode = 1;
});
