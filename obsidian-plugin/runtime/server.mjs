// The llama-server process: starting it, knowing it is ready, keeping it out of the way
// when nobody is typing, and — the part that is easy to skip and rude to get wrong —
// making sure it is not still running after Obsidian quits.
//
// Four decisions worth stating, because each is a place a local-first tool can quietly
// become something else:
//
//   Loopback and a random port. The server binds 127.0.0.1 on a port the OS assigns, so
//   nothing on the network can reach it and two vaults cannot collide on 8080.
//
//   An API key even so. Any process on the machine can reach loopback, and a browser tab
//   can POST to 127.0.0.1 without asking anyone. A random key per launch means a page
//   that guesses the port still cannot use the model.
//
//   A PID file. A crashed or force-quit Obsidian leaves a 2 GB process behind, and the
//   next launch has no handle on it. The PID file plus the port and a start time is
//   enough to recognise our own orphan and kill it, and not enough to kill something
//   else that happens to have inherited the number.
//
//   Idle unload with slot save. Ten minutes of not typing should not cost 2 GB of RAM,
//   but the reload afterwards is not free either. llama.cpp can write its KV slot to disk
//   and restore it, and it does — 200 and a 40 MB file, measured on b10760 — but the
//   restore does NOT make the next sentence cheap: 41.2 s with it, 41.4 s without. The
//   prompt is read back in either way. Keep the save (it costs a file write and may start
//   paying off), and do not describe it to the writer as a saving. REPORT.md, 2026-09-03.

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { isIllegalInstruction } from "./cpu.mjs";

export class ServerError extends Error {
  constructor(message, { kind = "failed", cause } = {}) {
    super(message, { cause });
    this.name = "ServerError";
    this.kind = kind; // "spawn" | "illegal-instruction" | "health" | "timeout" | "failed"
  }
}

export const IDLE_UNLOAD_MS = 10 * 60 * 1000;

// The flags every measurement in REPORT.md was taken with, plus the ones this process
// needs to be a good citizen. `-c 4096 -np 1 --jinja --reasoning off` are load-bearing:
// changing any of them makes the published numbers describe a different configuration.
export function serverArgs({ modelPath, port, apiKey, slotDir, contextSize = 4096 }) {
  return [
    "-m", modelPath,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--api-key", apiKey,
    "-c", String(contextSize),
    "-np", "1",
    "--jinja",
    "--reasoning", "off",
    ...(slotDir ? ["--slot-save-path", slotDir] : []),
  ];
}

export function newApiKey() {
  return randomBytes(24).toString("base64url");
}

// A port the OS has just told us is free. There is an unavoidable race between closing
// the probe and the server binding; losing it means one failed start and a retry, which
// is better than a fixed port two vaults can fight over.
export async function freePort({ net } = {}) {
  const module = net ?? await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = module.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// --------------------------------------------------------------------------- pid file

export function pidFilePath(stateDir) {
  return join(stateDir, "llama-server.pid.json");
}

export async function writePidFile(stateDir, record) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(pidFilePath(stateDir), JSON.stringify(record, null, 1));
}

export async function readPidFile(stateDir) {
  try {
    return JSON.parse(await readFile(pidFilePath(stateDir), "utf8"));
  } catch {
    return null;
  }
}

export async function clearPidFile(stateDir) {
  await rm(pidFilePath(stateDir), { force: true });
}

/**
 * Kill a server left behind by a previous session, if the PID still belongs to it.
 *
 * The identity check matters more than the kill: PIDs are reused, and killing whatever
 * now holds the number would be a bug that destroys someone else's work. The recorded
 * command is compared against the live process's before any signal is sent, and when the
 * platform cannot be asked, nothing is killed and the caller is told so.
 */
export async function reapOrphan(stateDir, {
  processes = defaultProcessProbe,
  kill = (pid, signal) => process.kill(pid, signal),
} = {}) {
  const record = await readPidFile(stateDir);
  if (!record?.pid) return { reaped: false, reason: "no-pid-file" };
  let alive;
  try {
    alive = await processes(record.pid);
  } catch {
    return { reaped: false, reason: "cannot-inspect" };
  }
  if (!alive) {
    await clearPidFile(stateDir);
    return { reaped: false, reason: "already-gone" };
  }
  // The recorded binary path must still be the one running under that PID.
  if (!alive.includes(record.binary)) {
    await clearPidFile(stateDir);
    return { reaped: false, reason: "pid-reused" };
  }
  try {
    kill(record.pid, "SIGTERM");
  } catch (error) {
    return { reaped: false, reason: `kill-failed: ${error.message}` };
  }
  await clearPidFile(stateDir);
  return { reaped: true, pid: record.pid };
}

// The command line of a live process, or null. Written per platform because there is no
// portable way to ask, and a wrong answer here means either an orphan that never dies or
// a signal sent to a stranger.
async function defaultProcessProbe(pid) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  if (process.platform === "win32") {
    const { stdout } = await run("wmic", ["process", "where", `ProcessId=${pid}`, "get", "ExecutablePath"]);
    return stdout.trim().split("\n").slice(1).join("\n").trim() || null;
  }
  try {
    const { stdout } = await run("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim() || null;
  } catch {
    // ps exits non-zero when the pid is gone, which is an answer, not a failure.
    return null;
  }
}

// ------------------------------------------------------------------------ the process

/**
 * Start llama-server and wait until it answers.
 *
 * Resolves with a handle carrying the base URL, the API key and a `stop()`. Rejects with
 * a ServerError whose `kind` says what to do about it: "illegal-instruction" means try
 * the next CPU-feature build, "health" means the process started but never became ready.
 */
export async function startServer({
  binary,
  modelPath,
  stateDir,
  port,
  apiKey = newApiKey(),
  slotDir = null,
  contextSize = 4096,
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  readyTimeoutMs = 120000,
  pollMs = 250,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const args = serverArgs({ modelPath, port, apiKey, slotDir, contextSize });
  const child = spawnImpl(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  let stderr = "";
  child.stderr?.on?.("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.stdout?.on?.("data", () => {});

  let exit = null;
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => { exit = { code, signal }; resolve(exit); });
    child.once("error", (error) => { exit = { code: null, signal: null, error }; resolve(exit); });
  });

  await writePidFile(stateDir, {
    pid: child.pid, port, binary, model: modelPath, startedAt: new Date(now()).toISOString(),
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = now() + readyTimeoutMs;
  for (;;) {
    if (exit) {
      await clearPidFile(stateDir);
      if (isIllegalInstruction(exit)) {
        throw new ServerError(
          `${binary} died with an illegal instruction: this build needs CPU features this machine does not have.`,
          { kind: "illegal-instruction" },
        );
      }
      throw new ServerError(
        `${binary} exited before it was ready (code ${exit.code}, signal ${exit.signal}).\n${stderr}`.trim(),
        { kind: "spawn", cause: exit.error },
      );
    }
    if (now() > deadline) {
      child.kill("SIGTERM");
      await clearPidFile(stateDir);
      throw new ServerError(`${binary} did not answer within ${Math.round(readyTimeoutMs / 1000)}s.\n${stderr}`.trim(), { kind: "timeout" });
    }
    if (await isHealthy({ baseUrl, apiKey, fetchImpl })) break;
    await sleep(pollMs);
  }

  return {
    baseUrl,
    apiBase: `${baseUrl}/v1`,
    apiKey,
    port,
    pid: child.pid,
    process: child,
    exited,
    async stop({ timeoutMs = 5000 } = {}) {
      if (exit) { await clearPidFile(stateDir); return; }
      child.kill("SIGTERM");
      const settled = await Promise.race([exited, sleep(timeoutMs).then(() => "timeout")]);
      if (settled === "timeout") child.kill("SIGKILL");
      await clearPidFile(stateDir);
    },
  };
}

export async function isHealthy({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    if (typeof response.text === "function") await response.text().catch(() => "");
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One throwaway completion, so the server has loaded 1.5 GB of weights and generated a
 * token before it is handed over: 2-3 s on the 2026-09-03 machine, 0.4 s of it here.
 * This is NOT the prompt read: the 1,587-token clarity prompt is read in by the engine's
 * own warmUp() once the plugin has built it, about forty seconds on a 4-core CPU, and
 * until 2026-09-04 nothing did that at all.
 */
export async function warmUp({ apiBase, apiKey, model = "local", fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      signal: controller.signal,
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
    });
    if (typeof response.text === "function") await response.text().catch(() => "");
    return { ok: response.ok, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------- slot save/restore

// The KV cache of the single slot, written to `slotDir` on an idle unload. It round-trips
// (200 both ways, ~40 MB on disk) but does not currently shorten the next sentence — see
// the note at the top of this file before quoting it as a saving.
export async function saveSlot({ baseUrl, apiKey, filename = "tolben-slot.bin", fetchImpl = globalThis.fetch } = {}) {
  return slotAction({ baseUrl, apiKey, action: "save", filename, fetchImpl });
}

export async function restoreSlot({ baseUrl, apiKey, filename = "tolben-slot.bin", fetchImpl = globalThis.fetch } = {}) {
  return slotAction({ baseUrl, apiKey, action: "restore", filename, fetchImpl });
}

// `/slots` is a llama-server endpoint, not an OpenAI-compatible one, and it lives at the
// server ROOT — measured on b10760: POST /slots/0?action=save returns 200 and writes the
// KV file, POST /v1/slots/0?action=save returns 404.
//
// The plugin passes `runtime.baseUrl`, which is already the root, so the shipped path is
// the working one. The normalisation is here because this module hands callers TWO urls a
// line apart — `baseUrl` and `apiBase`, the second being the first plus "/v1" — and the
// engine speaks to the second, so reaching for the wrong one is a natural mistake that a
// mocked fetch cannot catch. It answers whatever URL it is handed. The test below passes
// the "/v1" form deliberately for that reason.
export function slotEndpoint(baseUrl, action) {
  const root = String(baseUrl).replace(/\/+$/u, "").replace(/\/v\d+$/u, "");
  return `${root}/slots/0?action=${action}`;
}

async function slotAction({ baseUrl, apiKey, action, filename, fetchImpl }) {
  try {
    const response = await fetchImpl(slotEndpoint(baseUrl, action), {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ filename }),
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    // A server built without slot save is not a failure worth surfacing: the writer pays
    // a slower reload and nothing else.
    return { ok: false, error: error.message };
  }
}
