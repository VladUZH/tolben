var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// obsidian-plugin/runtime/cpu.mjs
async function cpuFeatures({
  platform = process.platform,
  arch = process.arch,
  readFile: readFile3,
  run
} = {}) {
  if (arch !== "x64") return [];
  if (platform === "linux") {
    try {
      const info = await readFile3("/proc/cpuinfo", "utf8");
      const flags = /^flags\s*:(.*)$/mu.exec(info)?.[1] ?? "";
      return AVX2_FLAG.test(flags) ? ["avx2"] : [];
    } catch {
      return ["avx2"];
    }
  }
  if (platform === "darwin") {
    try {
      const { stdout } = await run("sysctl", ["-n", "machdep.cpu.leaf7_features"]);
      return AVX2_FLAG.test(stdout) ? ["avx2"] : [];
    } catch {
      return ["avx2"];
    }
  }
  return ["avx2"];
}
function isIllegalInstruction({ signal, code } = {}) {
  if (signal === "SIGILL") return true;
  if (code === WINDOWS_ILLEGAL_INSTRUCTION) return true;
  if (code === WINDOWS_ILLEGAL_INSTRUCTION - 4294967296) return true;
  return false;
}
var AVX2_FLAG, WINDOWS_ILLEGAL_INSTRUCTION;
var init_cpu = __esm({
  "obsidian-plugin/runtime/cpu.mjs"() {
    AVX2_FLAG = /(?:^|\s)avx2(?:\s|$)/iu;
    WINDOWS_ILLEGAL_INSTRUCTION = 3221225501;
  }
});

// obsidian-plugin/runtime/server.mjs
var server_exports = {};
__export(server_exports, {
  IDLE_UNLOAD_MS: () => IDLE_UNLOAD_MS,
  ServerError: () => ServerError,
  clearPidFile: () => clearPidFile,
  freePort: () => freePort,
  isHealthy: () => isHealthy,
  newApiKey: () => newApiKey,
  pidFilePath: () => pidFilePath,
  readPidFile: () => readPidFile,
  reapOrphan: () => reapOrphan,
  restoreSlot: () => restoreSlot,
  saveSlot: () => saveSlot,
  serverArgs: () => serverArgs,
  startServer: () => startServer,
  warmUp: () => warmUp,
  writePidFile: () => writePidFile
});
function serverArgs({ modelPath, port, apiKey, slotDir, contextSize = 4096 }) {
  return [
    "-m",
    modelPath,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--api-key",
    apiKey,
    "-c",
    String(contextSize),
    "-np",
    "1",
    "--jinja",
    "--reasoning",
    "off",
    ...slotDir ? ["--slot-save-path", slotDir] : []
  ];
}
function newApiKey() {
  return (0, import_node_crypto2.randomBytes)(24).toString("base64url");
}
async function freePort({ net } = {}) {
  const module2 = net ?? await import("node:net");
  return new Promise((resolve, reject2) => {
    const probe = module2.createServer();
    probe.on("error", reject2);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
function pidFilePath(stateDir) {
  return (0, import_node_path3.join)(stateDir, "llama-server.pid.json");
}
async function writePidFile(stateDir, record) {
  await (0, import_promises4.mkdir)(stateDir, { recursive: true });
  await (0, import_promises4.writeFile)(pidFilePath(stateDir), JSON.stringify(record, null, 1));
}
async function readPidFile(stateDir) {
  try {
    return JSON.parse(await (0, import_promises4.readFile)(pidFilePath(stateDir), "utf8"));
  } catch {
    return null;
  }
}
async function clearPidFile(stateDir) {
  await (0, import_promises4.rm)(pidFilePath(stateDir), { force: true });
}
async function reapOrphan(stateDir, {
  processes = defaultProcessProbe,
  kill = (pid, signal) => process.kill(pid, signal)
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
async function defaultProcessProbe(pid) {
  const { execFile } = await import("node:child_process");
  const { promisify: promisify2 } = await import("node:util");
  const run = promisify2(execFile);
  if (process.platform === "win32") {
    const { stdout } = await run("wmic", ["process", "where", `ProcessId=${pid}`, "get", "ExecutablePath"]);
    return stdout.trim().split("\n").slice(1).join("\n").trim() || null;
  }
  try {
    const { stdout } = await run("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
async function startServer({
  binary,
  modelPath,
  stateDir,
  port,
  apiKey = newApiKey(),
  slotDir = null,
  contextSize = 4096,
  spawnImpl = import_node_child_process.spawn,
  fetchImpl = globalThis.fetch,
  readyTimeoutMs = 12e4,
  pollMs = 250,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const args = serverArgs({ modelPath, port, apiKey, slotDir, contextSize });
  const child = spawnImpl(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr?.on?.("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4e3);
  });
  child.stdout?.on?.("data", () => {
  });
  let exit = null;
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
    child.once("error", (error) => {
      exit = { code: null, signal: null, error };
      resolve(exit);
    });
  });
  await writePidFile(stateDir, {
    pid: child.pid,
    port,
    binary,
    model: modelPath,
    startedAt: new Date(now()).toISOString()
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = now() + readyTimeoutMs;
  for (; ; ) {
    if (exit) {
      await clearPidFile(stateDir);
      if (isIllegalInstruction(exit)) {
        throw new ServerError(
          `${binary} died with an illegal instruction: this build needs CPU features this machine does not have.`,
          { kind: "illegal-instruction" }
        );
      }
      throw new ServerError(
        `${binary} exited before it was ready (code ${exit.code}, signal ${exit.signal}).
${stderr}`.trim(),
        { kind: "spawn", cause: exit.error }
      );
    }
    if (now() > deadline) {
      child.kill("SIGTERM");
      await clearPidFile(stateDir);
      throw new ServerError(`${binary} did not answer within ${Math.round(readyTimeoutMs / 1e3)}s.
${stderr}`.trim(), { kind: "timeout" });
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
    async stop({ timeoutMs = 5e3 } = {}) {
      if (exit) {
        await clearPidFile(stateDir);
        return;
      }
      child.kill("SIGTERM");
      const settled = await Promise.race([exited, sleep(timeoutMs).then(() => "timeout")]);
      if (settled === "timeout") child.kill("SIGKILL");
      await clearPidFile(stateDir);
    }
  };
}
async function isHealthy({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function warmUp({ apiBase, apiKey, model = "local", fetchImpl = globalThis.fetch, timeoutMs = 12e4 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...apiKey ? { authorization: `Bearer ${apiKey}` } : {} },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }]
      })
    });
    return { ok: response.ok, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}
async function saveSlot({ baseUrl, apiKey, filename = "tolben-slot.bin", fetchImpl = globalThis.fetch } = {}) {
  return slotAction({ baseUrl, apiKey, action: "save", filename, fetchImpl });
}
async function restoreSlot({ baseUrl, apiKey, filename = "tolben-slot.bin", fetchImpl = globalThis.fetch } = {}) {
  return slotAction({ baseUrl, apiKey, action: "restore", filename, fetchImpl });
}
async function slotAction({ baseUrl, apiKey, action, filename, fetchImpl }) {
  try {
    const response = await fetchImpl(`${baseUrl}/slots/0?action=${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...apiKey ? { authorization: `Bearer ${apiKey}` } : {} },
      body: JSON.stringify({ filename })
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
var import_node_child_process, import_promises4, import_node_crypto2, import_node_path3, ServerError, IDLE_UNLOAD_MS;
var init_server = __esm({
  "obsidian-plugin/runtime/server.mjs"() {
    import_node_child_process = require("node:child_process");
    import_promises4 = require("node:fs/promises");
    import_node_crypto2 = require("node:crypto");
    import_node_path3 = require("node:path");
    init_cpu();
    ServerError = class extends Error {
      constructor(message, { kind = "failed", cause } = {}) {
        super(message, { cause });
        this.name = "ServerError";
        this.kind = kind;
      }
    };
    IDLE_UNLOAD_MS = 10 * 60 * 1e3;
  }
});

// obsidian-plugin/main.mjs
var main_exports = {};
__export(main_exports, {
  default: () => TolbenPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/contract.mjs
var DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["keep", "rewrite"] },
    replacement: { type: "string" },
    reason: { type: "string" }
  },
  required: ["action", "replacement", "reason"],
  additionalProperties: false
};
function parseDecision(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new TypeError("Model returned no content");
  }
  const body = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new TypeError(`Model returned invalid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Model returned a non-object decision");
  }
  const { action, replacement, reason } = parsed;
  if (action !== "keep" && action !== "rewrite") {
    throw new TypeError(`Model returned an unknown action: ${String(action)}`);
  }
  if (typeof replacement !== "string") throw new TypeError("Model omitted replacement");
  if (typeof reason !== "string") throw new TypeError("Model omitted reason");
  if (action === "rewrite" && !replacement.trim()) {
    throw new TypeError("Model chose rewrite without a replacement");
  }
  return { action, replacement: replacement.trim(), reason: reason.trim() };
}

// src/engine.mjs
var RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "clarity_decision", strict: true, schema: DECISION_SCHEMA }
};
var VERDICT_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string" },
    verdict: { type: "string", enum: ["show", "hide"] }
  },
  required: ["reason", "verdict"],
  additionalProperties: false
};
var VERDICT_FORMAT = {
  type: "json_schema",
  json_schema: { name: "edit_verdict", strict: true, schema: VERDICT_SCHEMA }
};
var REASON_STOP = ',"reason"';
function completeTruncatedJSON(content) {
  const text = String(content ?? "").trimEnd();
  if (!text.trim()) return "";
  if (text.endsWith("}")) return text;
  const head = text.replace(/,\s*"reason".*$/su, "").replace(/[,\s]*$/u, "");
  return `${head},"reason":""}`;
}
var EngineError = class extends Error {
  constructor(message, { kind = "failed", cause } = {}) {
    super(message, { cause });
    this.name = "EngineError";
    this.kind = kind;
  }
};
var DIALECTS = {
  openai: {},
  ollama: { keep_alive: "30m", reasoning_effort: "none" }
};
var THINK_BLOCK = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>\s*/giu;
var OPEN_THINK = /<(?:think|thinking|reasoning)>[\s\S]*$/iu;
function stripThinking(content) {
  const text = String(content ?? "");
  const closed = text.replace(THINK_BLOCK, "");
  const opened = closed.replace(OPEN_THINK, (match) => /[{}]/u.test(match) ? match : "");
  return opened.trim();
}
function createEngine({
  baseUrl = "http://127.0.0.1:8080/v1",
  model = "local",
  prompt,
  verifierPrompt = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8e3,
  maxTokens = 160,
  apiKey = null,
  dialect = "openai",
  useReasonStop = true
} = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("Engine needs a prompt");
  const endpoint = `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
  const extra = DIALECTS[dialect] ?? {};
  const headers = {
    "content-type": "application/json",
    ...apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  };
  async function decide(sentence, { signal } = {}) {
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(new Error("timeout")), timeoutMs);
    const composed = typeof AbortSignal.any === "function" && signal ? AbortSignal.any([signal, timer.signal]) : signal ?? timer.signal;
    const started = Date.now();
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        signal: composed,
        body: JSON.stringify({
          ...extra,
          model,
          temperature: 0,
          top_p: 1,
          max_tokens: maxTokens,
          response_format: RESPONSE_FORMAT,
          ...useReasonStop ? { stop: [REASON_STOP] } : {},
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: sentence }
          ]
        })
      });
      if (!response.ok) {
        const kind = response.status >= 500 || response.status === 429 ? "transient" : "failed";
        throw new EngineError(`Local model server returned HTTP ${response.status}`, { kind });
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const decision = parseDecision(completeTruncatedJSON(stripThinking(content)));
      return { ...decision, latencyMs: Date.now() - started };
    } catch (error) {
      if (error instanceof EngineError) throw error;
      if (signal?.aborted) throw new EngineError("Request superseded", { kind: "aborted", cause: error });
      if (timer.signal.aborted) throw new EngineError(`Local model exceeded ${timeoutMs} ms`, { kind: "timeout", cause: error });
      if (error instanceof SyntaxError) {
        throw new EngineError(`Local model returned an unparseable response: ${error.message}`, { kind: "failed", cause: error });
      }
      if (error instanceof TypeError && /JSON|decision|replacement|action|reason|content/iu.test(error.message)) {
        throw new EngineError(error.message, { kind: "failed", cause: error });
      }
      throw new EngineError(error.message || String(error), { kind: "transient", cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
  async function rewrite(sentence, { signal, retries = 1 } = {}) {
    try {
      return await decide(sentence, { signal });
    } catch (error) {
      if (retries > 0 && error.kind === "transient" && !signal?.aborted) {
        return rewrite(sentence, { signal, retries: retries - 1 });
      }
      throw error;
    }
  }
  async function verify(source, replacement, { signal, lost = [] } = {}) {
    if (!verifierPrompt) return { verdict: "show", reason: "no verifier configured" };
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(new Error("timeout")), timeoutMs);
    const composed = typeof AbortSignal.any === "function" && signal ? AbortSignal.any([signal, timer.signal]) : signal ?? timer.signal;
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        signal: composed,
        body: JSON.stringify({
          ...extra,
          model,
          temperature: 0,
          top_p: 1,
          max_tokens: 96,
          response_format: VERDICT_FORMAT,
          messages: [
            { role: "system", content: verifierPrompt },
            {
              role: "user",
              content: lost.length ? `ORIGINAL: ${source}
PROPOSED: ${replacement}
REMOVED WORDS: ${lost.join(", ")}` : `ORIGINAL: ${source}
PROPOSED: ${replacement}`
            }
          ]
        })
      });
      if (!response.ok) throw new EngineError(`Verifier returned HTTP ${response.status}`, { kind: "transient" });
      const payload = await response.json();
      const parsed = JSON.parse(stripThinking(payload?.choices?.[0]?.message?.content) || "{}");
      if (parsed.verdict !== "show" && parsed.verdict !== "hide") {
        throw new EngineError("Verifier returned an unknown verdict");
      }
      return { verdict: parsed.verdict, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
    } catch (error) {
      const kind = signal?.aborted ? "aborted" : timer.signal.aborted ? "timeout" : error.kind ?? (error instanceof SyntaxError ? "failed" : "transient");
      return { verdict: "unavailable", kind, reason: `verifier unavailable: ${error.message}` };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { rewrite, decide, verify, endpoint, dialect, model, useReasonStop };
}

// src/diff.mjs
function tokenize(text) {
  const tokens = [];
  const pattern = /(\s+)|([\p{L}\p{N}]+(?:['’][\p{L}]+)*)|([^\s\p{L}\p{N}]+)/gu;
  for (const match of text.matchAll(pattern)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      space: Boolean(match[1])
    });
  }
  return tokens;
}
function lcsTable(left, right) {
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i].key === right[j].key ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}
function keyed(tokens) {
  return tokens.map((token) => ({ ...token, key: token.text.toLowerCase() }));
}
function diffWords(source, target) {
  const left = keyed(tokenize(source).filter((token) => !token.space));
  const right = keyed(tokenize(target).filter((token) => !token.space));
  const table = lcsTable(left, right);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i].key === right[j].key) {
      ops.push({ type: "equal", source: left[i], target: right[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "delete", source: left[i] });
      i += 1;
    } else {
      ops.push({ type: "insert", target: right[j] });
      j += 1;
    }
  }
  while (i < left.length) ops.push({ type: "delete", source: left[i++] });
  while (j < right.length) ops.push({ type: "insert", target: right[j++] });
  return ops;
}
function changedSourceRanges(source, target) {
  const ops = diffWords(source, target);
  const ranges = [];
  const push = (start, end) => {
    const last = ranges[ranges.length - 1];
    if (last && source.slice(last.end, start).trim() === "") {
      last.end = Math.max(last.end, end);
      return;
    }
    ranges.push({ start, end });
  };
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (op.type === "equal") {
      if (op.source.text !== op.target.text) push(op.source.start, op.source.end);
      continue;
    }
    if (op.type === "delete") {
      push(op.source.start, op.source.end);
      continue;
    }
    if (op.type !== "insert") continue;
    const previous = ops.slice(0, index).reverse().find((candidate) => candidate.source);
    const next = ops.slice(index + 1).find((candidate) => candidate.source);
    const anchor = previous?.source ?? next?.source;
    if (anchor) push(anchor.start, anchor.end);
  }
  return ranges.filter((range) => range.end > range.start);
}
function inlineDiffParts(source, target) {
  const parts = [];
  for (const op of diffWords(source, target)) {
    if (op.type === "equal" && op.source.text !== op.target.text) {
      parts.push({ type: "delete", text: op.source.text });
      parts.push({ type: "insert", text: op.target.text });
      continue;
    }
    parts.push({ type: op.type, text: (op.type === "insert" ? op.target : op.source).text });
  }
  return parts;
}

// src/segmenter.mjs
var ABBREVIATIONS = /* @__PURE__ */ new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "mt",
  "rev",
  "hon",
  "inc",
  "ltd",
  "co",
  "corp",
  "dept",
  "est",
  "fig",
  "no",
  "vol",
  "ed",
  "eds",
  "al",
  "etc",
  "vs",
  "approx",
  "min",
  "max",
  "ca",
  "cf",
  "ibid",
  "op",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "mon",
  "tue",
  "tues",
  "wed",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sun",
  "a.m",
  "p.m",
  "e.g",
  "i.e",
  "u.s",
  "u.k",
  "ph.d",
  "d.c"
]);
var TERMINATORS = /[.!?…]/u;
var CLOSERS = /["'’”)\]}]/u;
var EMPHASIS = /[*~`_]/u;
var WORD_CHARACTER = /[\p{L}\p{N}]/u;
function isInsideToken(text, index) {
  const before = text[index - 1];
  const after = text[index + 1];
  if (!before || !after) return false;
  if (/\d/u.test(before) && /\d/u.test(after)) return true;
  if (/[\w/\\-]/u.test(before) && /[\p{L}\p{N}/\\-]/u.test(after)) return true;
  if (after === "_" && /[\w/\\-]/u.test(before)) {
    const close = text.indexOf("_", index + 2);
    if (close === -1 || close - index > 40) return true;
  }
  return false;
}
var ABBREVIATION_LOOKBEHIND = 12;
var LIST_INDENT_MAX = 32;
var LIST_DIGITS_MAX = 12;
var LIST_MARKER_LOOKBEHIND = 1 + LIST_INDENT_MAX + LIST_DIGITS_MAX;
function isOrderedListMarker(text, index) {
  if (text[index] !== ".") return false;
  const from = Math.max(0, index - LIST_MARKER_LOOKBEHIND);
  const head = text.slice(from, index);
  const match = head.match(/(?:^|\n)[ \t]*\d+$/u);
  if (!match) return false;
  return match[0].startsWith("\n") || from === 0;
}
function isAbbreviation(text, index) {
  if (text[index] !== ".") return false;
  const head = text.slice(Math.max(0, index - ABBREVIATION_LOOKBEHIND), index);
  const word = head.match(/[\p{L}.]+$/u)?.[0];
  if (!word) return false;
  if (word.length === ABBREVIATION_LOOKBEHIND) return false;
  if (ABBREVIATIONS.has(word.toLowerCase())) return true;
  return /^\p{Lu}$/u.test(word);
}
var SELF_CONTAINED_LINE = /^[ \t]{0,3}(?:#{1,6}[ \t]|\||(?:[-*_][ \t]*){3,}$|={3,}[ \t]*$)/u;
var FENCE_LINE = /^[ \t]*(`{3,}|~{3,})(.*)$/u;
var LIST_ITEM_LINE = new RegExp(`^[ \\t]{0,${LIST_INDENT_MAX}}(?:[-*+][ \\t]|\\d{1,${LIST_DIGITS_MAX}}[.)][ \\t])`, "u");
var QUOTE_LINE = /^[ \t]*>/u;
function blockBoundaries(text) {
  const bounds = /* @__PURE__ */ new Set([0, text.length]);
  const atomic = /* @__PURE__ */ new Set();
  let lineStart = 0;
  let fence = null;
  let quoting = false;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const afterLine = newline === -1 ? text.length : newline + 1;
    const rawEnd = lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    const line = text.slice(lineStart, rawEnd);
    const fenceMatch = line.match(FENCE_LINE);
    const fenceMark = fenceMatch?.[1];
    if (fence) {
      const closes = fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length && fenceMatch[2].trim() === "";
      if (closes) {
        fence = null;
        bounds.add(afterLine);
      }
      quoting = false;
    } else if (fenceMark) {
      fence = fenceMark;
      bounds.add(lineStart);
      atomic.add(lineStart);
      quoting = false;
    } else if (line.trim() === "" || SELF_CONTAINED_LINE.test(line)) {
      bounds.add(lineStart);
      bounds.add(afterLine);
      if (line.trim() !== "") atomic.add(lineStart);
      quoting = false;
    } else if (QUOTE_LINE.test(line)) {
      if (!quoting) bounds.add(lineStart);
      quoting = true;
    } else if (LIST_ITEM_LINE.test(line)) {
      bounds.add(lineStart);
      quoting = false;
    } else {
    }
    if (newline === -1) break;
    lineStart = afterLine;
  }
  return { bounds: [...bounds].sort((left, right) => left - right), atomic };
}
function segmentBlock(text, from, to, out) {
  let start = from;
  for (let index = from; index < to; index += 1) {
    const char = text[index];
    if (!TERMINATORS.test(char)) continue;
    if (isInsideToken(text, index) || isAbbreviation(text, index) || isOrderedListMarker(text, index)) continue;
    let end = index + 1;
    while (end < to && TERMINATORS.test(text[end])) end += 1;
    while (end < to && CLOSERS.test(text[end])) end += 1;
    let withEmphasis = end;
    while (withEmphasis < to && EMPHASIS.test(text[withEmphasis])) withEmphasis += 1;
    const afterEmphasis = withEmphasis < to ? String.fromCodePoint(text.codePointAt(withEmphasis)) : "";
    if (withEmphasis > end && !(afterEmphasis && WORD_CHARACTER.test(afterEmphasis))) {
      end = withEmphasis;
    }
    while (end < to && CLOSERS.test(text[end])) end += 1;
    while (end < to && /[ \t]/u.test(text[end])) end += 1;
    if (end < to && text[end] === "\r") end += 1;
    if (end < to && text[end] === "\n") end += 1;
    out.push({ text: text.slice(start, end), start, end });
    start = end;
    index = end - 1;
  }
  if (start < to) out.push({ text: text.slice(start, to), start, end: to });
}
function segmentSentences(text) {
  const segments = [];
  const { bounds, atomic } = blockBoundaries(text);
  for (let block = 0; block < bounds.length - 1; block += 1) {
    const from = bounds[block];
    const to = bounds[block + 1];
    if (atomic.has(from)) segments.push({ text: text.slice(from, to), start: from, end: to });
    else segmentBlock(text, from, to, segments);
  }
  return segments.filter((segment) => segment.text.trim().length > 0);
}
function isCompleteSentence(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const withoutClosers = trimmed.replace(/["'’”)\]}*~`_]+$/u, "");
  const last = withoutClosers[withoutClosers.length - 1];
  if (!last || !TERMINATORS.test(last)) return false;
  return !isAbbreviation(withoutClosers, withoutClosers.length - 1);
}
function trimSegment(segment) {
  const leading = segment.text.length - segment.text.trimStart().length;
  const trailing = segment.text.length - segment.text.trimEnd().length;
  return {
    text: segment.text.slice(leading, segment.text.length - trailing),
    start: segment.start + leading,
    end: segment.end - trailing
  };
}

// src/safety.mjs
var KEEP_REASON = /\b(?:already (?:clear|correct|concise|direct)|is clear and (?:direct|correct)|no (?:change|issue|problem)s? (?:is |are )?(?:needed|found))\b/iu;
var INSTRUCTION_OUTPUT = /^(?:certainly|okay|sure|here(?:'s| is)|rewritten|revised|improved|suggestion|output)\b[^:]{0,40}:/iu;
var REFUSAL_PROSE = /^\s*(?:i(?:'m| am)? ?(?:'m)? ?sorry\b|sorry[,.]|i (?:will not|won'?t|cannot|can'?t|do not|don'?t|am unable to|am not able to)\b|as an ai\b|unfortunately[,.]? i\b)|\b(?:violates?|against|contrary to) (?:my|our|the) (?:guidelines?|policy|policies|rules?|content policy)\b|\bi (?:cannot|can'?t|will not|won'?t) (?:help|assist|comply|do that|provide)\b/iu;
function refusesInsteadOfRewriting(source, candidate) {
  if (!REFUSAL_PROSE.test(candidate)) return false;
  const content = (text) => new Set(tokenize(text).filter((token) => !token.space && isContentWord(token)).map((token) => token.text.toLowerCase()));
  const before = content(source);
  if (before.size === 0) return false;
  return [...content(candidate)].every((word) => !before.has(word));
}
var SENTENCE_ADVERBS = [
  "accordingly",
  "additionally",
  "admittedly",
  "apparently",
  "arguably",
  "basically",
  "briefly",
  "broadly",
  "certainly",
  "clearly",
  "consequently",
  "conversely",
  "effectively",
  "essentially",
  "evidently",
  "fortunately",
  "frankly",
  "frequently",
  "furthermore",
  "historically",
  "honestly",
  "hopefully",
  "ideally",
  "importantly",
  "interestingly",
  "naturally",
  "nevertheless",
  "nonetheless",
  "normally",
  "notably",
  "obviously",
  "occasionally",
  "ordinarily",
  "particularly",
  "presumably",
  "rarely",
  "realistically",
  "roughly",
  "strictly",
  "surely",
  "technically",
  "ultimately",
  "undoubtedly"
];
var SENTENCE_STARTERS = /* @__PURE__ */ new Set([
  ...SENTENCE_ADVERBS,
  "a",
  "about",
  "above",
  "according",
  "across",
  "after",
  "again",
  "against",
  "all",
  "almost",
  "along",
  "already",
  "also",
  "although",
  "always",
  "among",
  "an",
  "and",
  "another",
  "any",
  "anyone",
  "approximately",
  "are",
  "around",
  "as",
  "at",
  "avoid",
  "based",
  "be",
  "because",
  "become",
  "been",
  "before",
  "behind",
  "being",
  "below",
  "beside",
  "besides",
  "between",
  "beyond",
  "both",
  "but",
  "by",
  "can",
  "cannot",
  "check",
  "collect",
  "come",
  "compared",
  "concerning",
  "consider",
  "consult",
  "contact",
  "could",
  "create",
  "currently",
  "data",
  "despite",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "down",
  "due",
  "during",
  "each",
  "earlier",
  "either",
  "else",
  "engineers",
  "enough",
  "even",
  "eventually",
  "ever",
  "every",
  "everyone",
  "everything",
  "except",
  "expect",
  "few",
  "finally",
  "first",
  "following",
  "for",
  "from",
  "further",
  "fewer",
  "generally",
  "give",
  "given",
  "go",
  "had",
  "half",
  "has",
  "have",
  "having",
  "he",
  "help",
  "her",
  "here",
  "hers",
  "high",
  "him",
  "his",
  "how",
  "however",
  "i",
  "if",
  "in",
  "include",
  "including",
  "initially",
  "inside",
  "instead",
  "into",
  "is",
  "it",
  "its",
  "just",
  "keep",
  "last",
  "later",
  "least",
  "leave",
  "less",
  "let",
  "like",
  "likely",
  "little",
  "long",
  "look",
  "make",
  "many",
  "may",
  "maybe",
  "me",
  "meanwhile",
  "might",
  "more",
  "moreover",
  "most",
  "much",
  "must",
  "my",
  "near",
  "nearly",
  "need",
  "neither",
  "never",
  "new",
  "next",
  "no",
  "none",
  "nor",
  "not",
  "note",
  "nothing",
  "notice",
  "now",
  "of",
  "off",
  "often",
  "on",
  "once",
  "one",
  "only",
  "open",
  "or",
  "originally",
  "other",
  "others",
  "otherwise",
  "our",
  "ours",
  "out",
  "outside",
  "over",
  "overall",
  "owing",
  "past",
  "per",
  "perhaps",
  "please",
  "plus",
  "possibly",
  "practically",
  "previously",
  "prior",
  "probably",
  "provide",
  "put",
  "rather",
  "read",
  "recently",
  "regarding",
  "remember",
  "remove",
  "results",
  "review",
  "run",
  "same",
  "see",
  "send",
  "several",
  "she",
  "short",
  "should",
  "similarly",
  "since",
  "so",
  "some",
  "someone",
  "something",
  "sometimes",
  "soon",
  "specifically",
  "start",
  "still",
  "stop",
  "subsequently",
  "such",
  "sure",
  "take",
  "team",
  "teams",
  "than",
  "thanks",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "there",
  "therefore",
  "these",
  "they",
  "this",
  "those",
  "though",
  "through",
  "throughout",
  "thus",
  "to",
  "today",
  "together",
  "tomorrow",
  "too",
  "toward",
  "towards",
  "try",
  "typically",
  "under",
  "unfortunately",
  "unless",
  "until",
  "up",
  "upon",
  "us",
  "use",
  "used",
  "users",
  "using",
  "usually",
  "very",
  "via",
  "virtually",
  "was",
  "we",
  "well",
  "were",
  "what",
  "when",
  "whenever",
  "where",
  "whether",
  "which",
  "while",
  "who",
  "whose",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "yes",
  "yesterday",
  "yet",
  "you",
  "your",
  "yours"
]);
var CERTAINTY_GROUPS = [
  // Epistemic modals: how likely the writer says the claim is. Split from the degree
  // adverbs below, which used to share this group. Conflating them made a stack of two
  // hedges indistinguishable from two unrelated ones, so "could possibly time out" ->
  // "could time out" (same modality, one redundant hedge) could not be told apart from
  // "It could be argued that X is somewhat fragile." -> "X is somewhat fragile." (the
  // claim's own modal gone, a degree word left standing in its place).
  // "chance" and "risk" sit beside "possibility", which was already here: all three are
  // the noun form of the same hedge, and without them "There is a chance that X" -> "X"
  // dropped the writer's whole qualification with nothing to notice it.
  // "arguably" and its siblings sit beside "apparently", which was already here: all of
  // them mark the claim as reported or entertained rather than asserted. Without them
  // "Arguably, the results are encouraging." -> "The results are encouraging." dropped
  // the writer's whole qualification, while the sibling edit "It could be argued that X"
  // -> "X" was refused — the same strengthening, judged two different ways.
  [
    "may",
    "might",
    "could",
    "perhaps",
    "possibly",
    "possible",
    "possibility",
    "chance",
    "risk",
    "likely",
    "unlikely",
    "probably",
    "probable",
    "apparently",
    "seems",
    "seem",
    "appears",
    "appear",
    "tendency",
    "tend",
    "tends",
    "arguably",
    "presumably",
    "supposedly",
    "reportedly",
    "allegedly",
    "conceivably",
    "ostensibly"
  ],
  // Degree and approximation: how much, not how likely.
  [
    "generally",
    "typically",
    "basically",
    "essentially",
    "roughly",
    "mostly",
    "largely",
    "broadly",
    "fairly",
    "somewhat",
    "relatively"
  ],
  // "needed" and the bare "suggest"/"advise" were missing while their other inflections
  // were present, so the group emptied on a rewrite that had in fact kept the word:
  // "will be required" -> "is needed" read as a dropped obligation because "needed" was
  // in no group at all. An inflection gap is not a policy.
  [
    "must",
    "shall",
    "required",
    "requires",
    "require",
    "requirement",
    "need",
    "needs",
    "needed",
    "necessary",
    "necessity",
    "mandatory",
    "obligation",
    "obliged"
  ],
  [
    "should",
    "ought",
    "recommend",
    "recommends",
    "recommended",
    "recommendation",
    "advise",
    "advises",
    "advised",
    "advice",
    "suggest",
    "suggests",
    "suggested",
    "suggestion"
  ],
  [
    "will",
    "would",
    "promise",
    "promises",
    "promised",
    "commit",
    "commits",
    "committed",
    "commitment",
    "guarantee",
    "guarantees",
    "guaranteed"
  ],
  ["can", "cannot", "able", "ability", "unable", "capable", "capability"],
  // Hedges that guard a universal: "nearly every test passed" is not "every test passed".
  ["nearly", "almost", "virtually", "practically"]
];
var QUANTIFIER_GROUPS = [
  ["all", "every", "each", "any", "both", "either", "neither", "none", "no"],
  ["some", "several", "many", "few", "most", "much", "number", "lot", "lots", "plenty", "majority"],
  ["only", "just", "solely", "exclusively", "merely"],
  ["exactly", "approximately", "about", "around", "roughly", "least", "most"],
  ["always", "never", "sometimes", "often", "rarely", "usually"]
];
var APPROXIMATORS = /* @__PURE__ */ new Set(["about", "around"]);
var QUANTITY_NEIGHBOUR = "(?:[$\u20AC\xA3\xA5\u20B9]\\s?\\d[\\d.,]*|\\d[\\d.,]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand|million|billion|half|dozen)";
var BOUND_PHRASES = [
  "no more than",
  "no fewer than",
  "no less than",
  "more than",
  "fewer than",
  "less than",
  "up to"
];
function boundCounts(text) {
  const lowered = text.toLowerCase();
  return BOUND_PHRASES.map((phrase) => [...lowered.matchAll(new RegExp(`\\b${phrase}\\s+${QUANTITY_NEIGHBOUR}`, "gu"))].length);
}
function boundsPreserved(source, candidate) {
  const before = boundCounts(source);
  const after = boundCounts(candidate);
  return before.every((count, index) => count === after[index]);
}
var PAST_IRREGULAR = /* @__PURE__ */ new Set([
  "became",
  "began",
  "broke",
  "brought",
  "built",
  "came",
  "chose",
  "did",
  "drew",
  "drove",
  "fell",
  "felt",
  "found",
  "gave",
  "grew",
  "had",
  "held",
  "kept",
  "knew",
  "led",
  "left",
  "lost",
  "made",
  "met",
  "paid",
  "ran",
  "read",
  "said",
  "saw",
  "sent",
  "set",
  "spoke",
  "stood",
  "took",
  "told",
  "was",
  "went",
  "were",
  "won",
  "wrote"
]);
var PROTECTED_PATTERNS = [
  // Money: the symbol is the unit, so "$40" -> "€40" is a change of quantity, not of style.
  /[$€£¥₹]\s?\d[\d.,]*/gu,
  // currency before the amount
  /\d[\d.,]*\s?[$€£¥₹]/gu,
  // currency after the amount
  /https?:\/\/[^\s<>{}[\]]+/giu,
  // URLs
  // Quantifiers bounded to the RFC limits (64-char local part, 63-char labels), which
  // is what keeps the scan linear: an unbounded local part re-walked the whole tail of
  // a long dotted non-email token from every start position — measured seconds of
  // backtracking on a pasted 30KB run.
  /\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})*\.[A-Za-z]{2,24}\b/gu,
  // email
  // A path is recognised by what precedes the slash, not by a space in front of it: the
  // old "(?:^|\s)" missed every path in brackets, so "(which lives in /etc/app/x.yaml)"
  // -> "(/etc/app/x.yaml)" reported the path as changed when only the words around it
  // had gone. The lookbehind still excludes "and/or" and the inside of a URL.
  /(?<![\w.@+:/-])(?:\/[\w.@+-]+)+/gu,
  // posix paths
  /\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+/gu,
  // windows paths
  /\b[\w-]+\.(?:csv|json|log|md|txt|ya?ml|pdf|js|py|sql|xml|html)\b/giu,
  // file names
  /\b(?:[A-Z]{2,}[A-Z0-9_-]*|[A-Za-z]+_[A-Za-z0-9_]+)\b/gu,
  // identifiers, API_V2, snake_case
  /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/gu,
  // versions and labels, v2, Q3, phase2b
  /\b\d{1,2}:\d{2}\b/gu,
  // clock times
  /\[\d+\]/gu,
  // citations
  /\b\d+(?:[.,]\d+)?\s*(?:(?:ms|s|min|h|hz|khz|mhz|ghz|kb|mb|gb|tb|kib|mib|gib|mm|cm|m|km|kg|g|v|w|kw|volts?|°c|°f|utc)\b|%)/giu
];
function reject(reason) {
  return { accepted: false, reason };
}
function sequence(values) {
  return values.map((value) => value.toLowerCase().trim());
}
function same(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function numbers(text) {
  return sequence(
    [...text.matchAll(/(?:(?<![\p{L}\p{N}])[-−](?:[$€£¥₹]\s?)?)?\b\d+(?:[.,:]\d+)*(?:st|nd|rd|th)?\b%?/gu)].map((m) => m[0].replace(/−/gu, "-"))
  );
}
function protectedTokenList(text) {
  return PROTECTED_PATTERNS.flatMap(
    (pattern) => [...text.matchAll(pattern)].map((match) => match[0].trim())
  );
}
var MARKUP_PATTERN = new RegExp([
  "`[^`\\n]*`",
  // inline code, contents included
  // Math only where the delimiters could BE math delimiters: an opener followed by a
  // space is prose, an opener preceded by a digit is postfix currency ("40$"), and
  // "Pay $40 to vendor and $50 to client." must not become one giant markup token
  // that refuses every edit between the amounts. A digit-leading span still counts as
  // math when its content holds no whitespace ("$3x+2$", "$2n$") — real inline TeX
  // very often opens with a digit, and losing its token let a sign flip inside the
  // math through both validator tiers.
  "\\$\\$[^$\\n]+\\$\\$",
  // display math
  "(?<!\\d)\\$(?![\\s\\d$])[^$\\n]*?(?<!\\s)\\$",
  // inline math
  "(?<!\\d)\\$\\d[^\\s$\\n]*\\$",
  // digit-leading inline math, no spaces
  "\\|",
  // table cell separator
  "!?\\[\\[[^\\]\\n]*\\]\\]",
  // wikilinks and embeds
  "!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)",
  // links and images
  "^\\s{0,3}#{1,6}(?=\\s)",
  // heading marker
  "^\\s{0,3}(?:[-*+]|\\d+[.)])(?=\\s)",
  // list marker
  "^\\s{0,3}>+(?=\\s|$)",
  // blockquote marker
  // Emphasis delimiters only where they can BE delimiters. " 3 * 4 " is multiplication
  // and `api_key` is an identifier; demanding either survive a rewrite would refuse
  // every edit to the sentence around it.
  "(?<!\\s)(?:\\*{1,2}|~~|==)|(?:\\*{1,2}|~~|==)(?!\\s)",
  "(?<![\\p{L}\\p{N}])_{1,2}|_{1,2}(?![\\p{L}\\p{N}])"
].join("|"), "gmu");
function markupTokens(text) {
  return [...text.matchAll(MARKUP_PATTERN)].map((match) => match[0].trim()).filter(Boolean);
}
function occurrenceCount(text, term) {
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + 1);
  }
  return count;
}
var WORD_EDGE = /[\p{L}\p{N}_]/u;
function protectedTokens(text, extraTerms = []) {
  const values = protectedTokenList(text);
  for (const term of extraTerms) {
    if (!term) continue;
    if (WORD_EDGE.test(term[0]) && WORD_EDGE.test(term[term.length - 1])) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      values.push(...[...text.matchAll(new RegExp(`\\b${escaped}\\b`, "gu"))].map((m) => m[0]));
    } else {
      for (let count = occurrenceCount(text, term); count > 0; count -= 1) values.push(term);
    }
  }
  return values.map((value) => value.trim());
}
var AUX_CONTRACTIONS = /* @__PURE__ */ new Map([
  ["don't", "do not"],
  ["doesn't", "does not"],
  ["didn't", "did not"],
  ["isn't", "is not"],
  ["aren't", "are not"],
  ["ain't", "is not"],
  ["wasn't", "was not"],
  ["weren't", "were not"],
  ["hasn't", "has not"],
  ["haven't", "have not"],
  ["hadn't", "had not"],
  ["won't", "will not"],
  ["can't", "can not"],
  ["cannot", "can not"],
  ["couldn't", "could not"],
  ["shouldn't", "should not"],
  ["wouldn't", "would not"],
  ["mustn't", "must not"],
  ["shan't", "shall not"],
  ["mightn't", "might not"],
  ["needn't", "need not"]
]);
function auxiliaryBase(word) {
  const lowered = word.toLowerCase().replace(/[’]/gu, "'");
  const expansion = AUX_CONTRACTIONS.get(lowered);
  if (expansion) return expansion.split(" ")[0];
  return lowered.replace(/['’](?:re|s|ve|ll|d|m|t)$/u, "").replace(/n['’]$/u, "");
}
function expandAuxiliaries(text) {
  return text.replace(/\b[\p{L}]+(?:['’][\p{L}]+)?\b/gu, (word) => {
    const expansion = AUX_CONTRACTIONS.get(word.toLowerCase().replace(/[’]/gu, "'"));
    return expansion ?? word;
  });
}
var NUMBER_WORDS = /* @__PURE__ */ new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "billion",
  "trillion",
  "half",
  "dozen",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth"
]);
function properNouns(text) {
  const opensSentence = (index) => /^[^\p{L}\p{N}]*$/u.test(text.slice(0, index));
  return [...text.matchAll(/\b\p{Lu}[\p{L}’']*\b/gu)].filter((match) => !(opensSentence(match.index) && SENTENCE_STARTERS.has(auxiliaryBase(match[0])))).map((match) => match[0].toLowerCase()).filter((word) => !NUMBER_WORDS.has(word));
}
function nameSequence(text, vocabulary) {
  return [...text.matchAll(/\b[\p{L}][\p{L}’']*\b/gu)].map((match) => match[0].toLowerCase()).filter((word) => vocabulary.has(word));
}
function namesPreserved(source, candidate) {
  const vocabulary = /* @__PURE__ */ new Set([...properNouns(source), ...properNouns(candidate)]);
  if (vocabulary.size === 0) return true;
  return same(nameSequence(source, vocabulary), nameSequence(candidate, vocabulary));
}
var PRONOUN_FAMILIES = [
  ["i", "me", "my", "mine", "myself"],
  ["we", "us", "our", "ours", "ourselves"],
  ["you", "your", "yours", "yourself", "yourselves"],
  ["he", "him", "his", "himself"],
  ["she", "her", "hers", "herself"],
  ["they", "them", "their", "theirs", "themselves"],
  ["it", "its", "itself"]
];
function pronounFamilies(text) {
  const present = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/\b[\p{L}]+(?:['’][\p{L}]+)*\b/gu)) {
    const base = match[0].toLowerCase().replace(/['’](?:re|s|ve|ll|d|m)$/u, "");
    const index = PRONOUN_FAMILIES.findIndex((family) => family.includes(base));
    if (index >= 0) present.add(index);
  }
  return present;
}
var IT_FAMILY = PRONOUN_FAMILIES.length - 1;
function referentsPreserved(source, candidate) {
  const left = pronounFamilies(source);
  return [...pronounFamilies(candidate)].every((family) => left.has(family) || family === IT_FAMILY);
}
function countWords(text, words) {
  const lowered = text.toLowerCase();
  return words.reduce((total, word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return total + (lowered.match(new RegExp(`\\b${escaped}\\b`, "gu"))?.length ?? 0);
  }, 0);
}
function distinctMembers(text, groups) {
  const expanded = expandAuxiliaries(text).toLowerCase();
  return groups.map((group) => group.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "u").test(expanded);
  }).length);
}
var SOFTENER_WOULD = /\bwould\b(?=\s+(?:just\s+)?(?:like|love|prefer|say|argue|appreciate)\b|\s+it\s+be\b|\s+you\s+(?:please|mind|be)\b)/giu;
var EVIDENTIAL_RAISING = /\b(?:(?:would|could|might|may)\s+)?(?:seems?|appears?)\s+to\s+(?=(?:suggests?|indicates?|imply|implies|shows?|points?)\b)/giu;
function hedgeNormalised(text) {
  return text.replace(EVIDENTIAL_RAISING, "").replace(SOFTENER_WOULD, "");
}
var EPISTEMIC_GROUPS = [0, 3];
function epistemicStackReduced(source, candidate) {
  const src = expandAuxiliaries(hedgeNormalised(source)).toLowerCase();
  const cand = expandAuxiliaries(hedgeNormalised(candidate)).toLowerCase();
  let survivor = Infinity;
  const dropped = [];
  for (const index of EPISTEMIC_GROUPS) {
    for (const word of CERTAINTY_GROUPS[index]) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "u");
      const at = src.search(pattern);
      if (at < 0) continue;
      if (pattern.test(cand)) survivor = Math.min(survivor, at);
      else dropped.push(at);
    }
  }
  if (survivor === Infinity || dropped.length === 0) return false;
  return dropped.every((at) => at > survivor);
}
var ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth"
];
function ordinals(text) {
  return ORDINALS.map((word) => countWords(text, [word]));
}
var SOFTENER_JUST = /^\s*just\b(?=\s+(?:to\s+\p{L}|\p{L}+ing\b))|\bjust\b(?=\s+like\s+to\b)/giu;
var NARROWED_SENSE = /* @__PURE__ */ new Map([
  ["0:no", /\bno\b(?!\s+longer\b)/u],
  ["3:most", /\bat\s+most\b/u],
  ["3:least", /\bat\s+least\b/u]
]);
function quantifierPresent(lowered, word, groupIndex) {
  const narrowed = NARROWED_SENSE.get(`${groupIndex}:${word}`);
  if (narrowed) return narrowed.test(lowered);
  if (!APPROXIMATORS.has(word)) return new RegExp(`\\b${word}\\b`, "u").test(lowered);
  return new RegExp(`\\b${word}\\s+${QUANTITY_NEIGHBOUR}\\b|\\b${QUANTITY_NEIGHBOUR}\\s+${word}\\b`, "u").test(lowered);
}
function quantifierSets(text) {
  const lowered = text.toLowerCase().replace(SOFTENER_JUST, "");
  return QUANTIFIER_GROUPS.map((group, index) => new Set(group.filter((word) => quantifierPresent(lowered, word, index))));
}
var VAGUE_AMOUNT_GROUP = 1;
var PERIPHRASTIC_QUANTITY = /* @__PURE__ */ new Set(["number", "lot", "lots", "plenty", "majority"]);
var VAGUE_QUANTIFIERS = /* @__PURE__ */ new Set(["some", "several", "many", "few", "most", "much"]);
function periphrasisTrade(removedWord, addedWord) {
  return PERIPHRASTIC_QUANTITY.has(removedWord.toLowerCase()) && VAGUE_QUANTIFIERS.has(addedWord.toLowerCase());
}
function quantifiersPreserved(source, candidate) {
  const left = quantifierSets(source);
  const right = quantifierSets(candidate);
  return left.every((sourceSet, index) => {
    const candidateSet = right[index];
    if (sourceSet.size > 0 && candidateSet.size === 0) return false;
    return [...candidateSet].every((word) => {
      if (sourceSet.has(word)) return true;
      if (index !== VAGUE_AMOUNT_GROUP) return false;
      return [...sourceSet].some((sourceWord) => periphrasisTrade(sourceWord, word) && !candidateSet.has(sourceWord));
    });
  });
}
var NOT_AS_SPELLING = [
  /\bwhether\s+or\s+not\b/giu,
  /\b(?:do|does|did|to)?\s*not\s+(?:forget|forgets|forgot|neglect|neglects|neglected|omit|omits|omitted|hesitate|hesitates|hesitated)\s+to\b/giu
];
function negations(text) {
  let counted = text;
  for (const pattern of NOT_AS_SPELLING) counted = counted.replace(pattern, " ");
  return (counted.match(
    /\b(?:no\s+one|nobody|nothing|nowhere|no|not|never|neither|nor|without|cannot|none)\b|n['’]t\b/giu
  ) ?? []).length;
}
var NOT_PAST_ED = /* @__PURE__ */ new Set([
  "need",
  "needs",
  "indeed",
  "seed",
  "feed",
  "speed",
  "deed",
  "creed",
  "breed",
  "greed",
  "exceed",
  "proceed",
  "succeed",
  "embed",
  "shed",
  "sled",
  "bed",
  "red",
  "wed"
]);
var AUXILIARIES = /* @__PURE__ */ new Set(["was", "were", "is", "are", "am", "did", "do", "does", "has", "have", "had"]);
var IRREGULAR_ENDINGS = [
  "took",
  "went",
  "came",
  "gave",
  "saw",
  "made",
  "said",
  "paid",
  "held",
  "led",
  "ran",
  "stood",
  "wrote",
  "drew",
  "knew",
  "grew",
  "threw",
  "brought",
  "bought",
  "caught",
  "taught",
  "thought",
  "found",
  "built",
  "sent",
  "spent",
  "lost",
  "left",
  "felt",
  "kept"
];
var VERB_PREFIXES = /* @__PURE__ */ new Set(["", "un", "re", "over", "under", "with", "fore", "mis", "out", "up"]);
var endsIrregular = (word) => IRREGULAR_ENDINGS.some((ending) => word.length >= ending.length && word.endsWith(ending) && VERB_PREFIXES.has(word.slice(0, word.length - ending.length)));
var PAST_PARTICIPLES = /* @__PURE__ */ new Set([
  "gone",
  "taken",
  "written",
  "known",
  "seen",
  "done",
  "been",
  "begun",
  "given",
  "chosen",
  "spoken",
  "broken",
  "driven",
  "eaten",
  "fallen",
  "forgotten",
  "hidden",
  "ridden",
  "risen",
  "shaken",
  "stolen",
  "thrown",
  "worn",
  "torn",
  "flown",
  "grown",
  "drawn",
  "blown",
  "shown",
  "sung",
  "held",
  "kept",
  "met",
  "run",
  "come",
  "become",
  "left",
  "lost",
  "sent",
  "built"
]);
var PERFECT_AUXILIARIES = /* @__PURE__ */ new Set(["has", "have", "had"]);
var PAST_EVIDENCE = /\b(?:yesterday|ago|last\s+(?:night|week|month|year|quarter|friday|monday|tuesday|wednesday|thursday|saturday|sunday))\b/iu;
function tense(text) {
  const trimmed = expandAuxiliaries(text.trim().replace(/[.!?…]+["'’”)\]}]*$/u, ""));
  const all = [...trimmed.matchAll(/\b[\p{L}’']+\b/gu)].map((match) => match[0].toLowerCase());
  const words = all.filter((word, index) => !(AUXILIARIES.has(word) && index === all.length - 1));
  const presentAuxiliaries = /* @__PURE__ */ new Set(["am", "are", "is", "be", "been", "being"]);
  const participle = (word) => /(?:ed|en)$/u.test(word) || PAST_IRREGULAR.has(word) || PAST_PARTICIPLES.has(word);
  const adverbial = (word) => word !== void 0 && !presentAuxiliaries.has(word) && (/ly$/u.test(word) || INTENSIFIERS.has(word) || word === "not" || word === "never");
  const governing = (index) => {
    let at = index - 1;
    while (at >= 0 && adverbial(words[at])) at -= 1;
    return words[at];
  };
  const underPresentBe = (index) => presentAuxiliaries.has(governing(index));
  return {
    past: words.some((word, index) => (PAST_IRREGULAR.has(word) || endsIrregular(word)) && !underPresentBe(index) || // An irregular participle is a past only under "have"/"has"/"had": "the work is
    // done" is a present state, "we have done the work" is not.
    PAST_PARTICIPLES.has(word) && PERFECT_AUXILIARIES.has(governing(index)) || /ed$/u.test(word) && !NOT_PAST_ED.has(word) && !underPresentBe(index)),
    future: words.some((word) => word === "will" || word === "shall"),
    perfect: words.some((word, index) => index > 0 && PERFECT_AUXILIARIES.has(governing(index)) && participle(word))
  };
}
var INVARIANT_PAST = /* @__PURE__ */ new Set([
  "put",
  "set",
  "cut",
  "hit",
  "let",
  "cost",
  "hurt",
  "shut",
  "split",
  "spread",
  "cast",
  "burst",
  "read",
  "bet",
  "quit",
  "bid",
  "thrust",
  "upset",
  "broadcast",
  "forecast"
]);
var carriesInvariantPast = (text) => [...text.toLowerCase().matchAll(/\b[\p{L}’']+\b/gu)].some((match) => INVARIANT_PAST.has(match[0]));
function tenseRepairedToMatchEvidence(source, left, right) {
  return left.past === false && right.past === true && left.future === right.future && left.perfect === right.perfect && (PAST_EVIDENCE.test(source) || carriesInvariantPast(source));
}
var DISCOURSE_GROUPS = [
  ["although", "but", "despite", "however", "though", "whereas", "yet", "nevertheless"],
  ["if", "unless"],
  ["because", "since", "therefore", "so", "thus"]
];
var DISCOURSE_WORDS = new Set(DISCOURSE_GROUPS.flat());
var DIRECTION_GROUPS = [
  // Temporal subordinators. "before" and "after" reverse each other outright; "when",
  // "while" and "once" place the event differently again — "Run the migration before the
  // deploy starts." and "... when the deploy starts." schedule two different things, and
  // swapping one for another moves no content word, no number and no name, so nothing
  // else in this file notices. They share one group because any exchange among them
  // changes the relation, not only the before/after pair.
  ["before", "after", "when", "while", "once"],
  ["and", "or"],
  ["until", "since"],
  ["on", "off"],
  ["up", "down"],
  ["above", "below"],
  ["over", "under"],
  ["more", "less"]
];
var DIRECTION_NARROWED = /* @__PURE__ */ new Map([
  ["once", /(?<!\b(?:at|just|only|every|for)\s)\bonce\b(?!\s+(?:a|an|per|every|more|again|or\s+twice)\b)/u],
  ["while", /(?<!\b(?:a|the|short|long|little|good)\s)\bwhile\b/u]
]);
var PHRASAL_HOSTS = /\b(?:base|based|basing|sign|signs|signed|signing|log|logs|logged|logging)\s+$/iu;
function directionsPreserved(source, candidate) {
  const lowered = candidate.toLowerCase();
  const original = source.toLowerCase();
  const outsidePhrasal = (word) => [...lowered.matchAll(new RegExp(`\\b${word}\\b`, "gu"))].some((match) => !PHRASAL_HOSTS.test(lowered.slice(0, match.index)));
  const present = (text, word) => (DIRECTION_NARROWED.get(word) ?? new RegExp(`\\b${word}\\b`, "u")).test(text);
  return DIRECTION_GROUPS.every((group) => {
    const phrasal = group.includes("on");
    const introduced = group.filter((word) => (phrasal ? outsidePhrasal(word) : present(lowered, word)) && !present(original, word));
    return introduced.every((word) => !group.some((other) => other !== word && present(original, other)));
  });
}
var DEADLINE_PREPOSITIONS = ["before", "by", "after", "until", "till", "from", "on"];
var TIME_COMPLEMENT = /^(?:\d[\d:.]*|noon|midnight|midday|dawn|dusk|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/iu;
function deadlines(text) {
  const found = /* @__PURE__ */ new Map();
  const pattern = new RegExp(`\\b(${DEADLINE_PREPOSITIONS.join("|")})\\s+([\\p{L}\\p{N}][\\p{L}\\p{N}:]*(?:\\.\\d+)?)`, "giu");
  for (const match of text.matchAll(pattern)) {
    if (TIME_COMPLEMENT.test(match[2])) found.set(match[2].toLowerCase(), match[1].toLowerCase());
  }
  return found;
}
function deadlineNarrowed(source, candidate, lost) {
  if (!lost.length) return false;
  const phrases = (text) => {
    const words = [...text.toLowerCase().matchAll(/[\p{L}\p{N}]+(?:[:.]\d+)*/gu)].map((m) => m[0]);
    const found = [];
    words.forEach((word, index) => {
      if (!DEADLINE_PREPOSITIONS.includes(word)) return;
      for (let at = index + 1; at <= Math.min(index + 5, words.length - 1); at += 1) {
        if (!TIME_COMPLEMENT.test(words[at])) continue;
        found.push(words.slice(index + 1, at + 1));
        return;
      }
    });
    return found;
  };
  const inSource = phrases(source);
  if (!inSource.length) return false;
  const inCandidate = phrases(candidate);
  return lost.some((word) => inSource.some((phrase) => {
    if (!phrase.includes(word.toLowerCase())) return false;
    const time = phrase[phrase.length - 1];
    return inCandidate.some((other) => other[other.length - 1] === time && other.length < phrase.length);
  }));
}
function deadlineMoved(source, candidate) {
  const before = deadlines(source);
  for (const [complement, preposition] of deadlines(candidate)) {
    const was = before.get(complement);
    if (was && was !== preposition) return true;
  }
  return false;
}
var FAILURE_WORDS = /* @__PURE__ */ new Set(["fail", "fails", "failed", "failing", "failure", "failures"]);
function failures(text) {
  return countWords(text, [...FAILURE_WORDS]);
}
function terminal(text) {
  return text.trim().match(/[.!?…]+(?=["'’”)\]}]*$)/u)?.[0] ?? "";
}
function editRatio(source, candidate) {
  const left = tokenize(source).filter((token) => !token.space);
  const right = tokenize(candidate).filter((token) => !token.space);
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i].text.toLowerCase() === right[j].text.toLowerCase() ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const common = table[0][0];
  return (left.length + right.length - 2 * common) / Math.max(1, left.length + right.length);
}
var CONFUSABLES = [
  ["affect", "effect"],
  ["affects", "effects"],
  ["affected", "effected"],
  ["then", "than"],
  ["its", "it's"],
  ["your", "you're"],
  ["their", "there"],
  ["there", "they're"],
  ["lead", "led"],
  ["to", "too"],
  ["loose", "lose"],
  ["principal", "principle"],
  ["complement", "compliment"],
  ["ensure", "insure"],
  ["accept", "except"],
  ["advice", "advise"],
  ["farther", "further"]
];
var SUFFIXES = ["ation", "ison", "sion", "tion", "ance", "ence", "ment", "ing", "ion", "ed", "es", "al", "s", "e"];
var MIN_STEM = 3;
function stem(word) {
  let current = word;
  for (let round = 0; round < 2; round += 1) {
    const suffix = SUFFIXES.find((ending) => current.endsWith(ending) && current.length - ending.length >= MIN_STEM);
    if (!suffix) break;
    current = current.slice(0, current.length - suffix.length);
  }
  return current;
}
function commonPrefix(a, b) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}
function sharedStem(a, b) {
  const left = stem(a);
  const right = stem(b);
  if (left === right) return true;
  const shared = commonPrefix(left, right);
  return shared >= 4 && left.length - shared <= 2 && right.length - shared <= 2;
}
var LEMMAS = new Map(Object.entries({
  meet: ["meet", "meets", "meeting", "meetings", "met"],
  go: ["go", "goes", "going", "went", "gone"],
  take: ["take", "takes", "taking", "took", "taken"],
  write: ["write", "writes", "writing", "wrote", "written"],
  see: ["see", "sees", "seeing", "saw", "seen"],
  agree: ["agree", "agrees", "agreed", "agreeing", "agreement", "agreements"],
  hold: ["hold", "holds", "holding", "held"],
  give: ["give", "gives", "giving", "gave", "given"],
  speak: ["speak", "speaks", "speaking", "spoke", "spoken"],
  choose: ["choose", "chooses", "choosing", "chose", "chosen", "choice", "choices"],
  begin: ["begin", "begins", "beginning", "began", "begun"],
  send: ["send", "sends", "sending", "sent"],
  build: ["build", "builds", "building", "built"],
  buy: ["buy", "buys", "buying", "bought"],
  bring: ["bring", "brings", "bringing", "brought"],
  think: ["think", "thinks", "thinking", "thought", "thoughts"],
  lose: ["lose", "loses", "losing", "lost", "loss", "losses"],
  find: ["find", "finds", "finding", "found"],
  know: ["know", "knows", "knowing", "knew", "known", "knowledge"],
  pay: ["pay", "pays", "paying", "paid", "payment", "payments"]
}));
var LEMMA_OF = new Map(
  [...LEMMAS].flatMap(([lemma, forms]) => forms.map((form) => [form, lemma]))
);
var INFLECTION_TAILS = /* @__PURE__ */ new Set([
  "s",
  "es",
  "ed",
  "d",
  "ing",
  "ly",
  "er",
  "ers",
  "est",
  "or",
  "ors",
  "ion",
  "ions",
  "ment",
  "ments",
  "ance",
  "ence",
  "ally",
  "ness"
]);
function inflectionOf(shorter, longer) {
  const residue = longer.slice(shorter.length);
  if (shorter.length >= 2 && (residue === "s" || residue === "es")) return true;
  if (shorter.length >= MIN_STEM && INFLECTION_TAILS.has(residue)) {
    if (residue === "d" && !shorter.endsWith("e")) return false;
    if (residue === "ness" && shorter.length < 4) return false;
    return true;
  }
  const last = shorter[shorter.length - 1];
  return shorter.length >= MIN_STEM && residue.length > 1 && residue[0] === last && INFLECTION_TAILS.has(residue.slice(1));
}
function related(left, right) {
  const a = left.toLowerCase().replace(/['’]/gu, "");
  const b = right.toLowerCase().replace(/['’]/gu, "");
  if (a === b) return true;
  if (CONFUSABLES.some(([x, y]) => a === x && b === y || a === y && b === x)) return true;
  if (LEMMA_OF.has(a) && LEMMA_OF.get(a) === LEMMA_OF.get(b)) return true;
  if (a.startsWith(b) || b.startsWith(a)) {
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (inflectionOf(shorter, longer)) return true;
  }
  return sharedStem(a, b);
}
var FUNCTION_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "nor",
  "but",
  "so",
  "yet",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "into",
  "onto",
  "over",
  "under",
  "above",
  "below",
  "between",
  "through",
  "during",
  "before",
  "after",
  "since",
  "until",
  "while",
  "about",
  "against",
  "among",
  "across",
  "behind",
  "beside",
  "beyond",
  "within",
  "without",
  "upon",
  "per",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "has",
  "have",
  "had",
  "having",
  "do",
  "does",
  "did",
  "done",
  "doing",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "this",
  "that",
  "these",
  "those",
  "who",
  "whom",
  "whose",
  "which",
  "what",
  "when",
  "where",
  "why",
  "how",
  "there",
  "here",
  "not",
  "no",
  "if",
  "then",
  "than",
  "as",
  "such",
  "very",
  "too",
  "also",
  "just",
  "only",
  "each",
  "every",
  "all",
  "any",
  "some",
  "both",
  "either",
  "neither",
  "one",
  "more",
  "most",
  "less",
  "least",
  "other",
  "another",
  "same",
  "own",
  "up",
  "down",
  "out",
  "off"
]);
var isContentWord = (token) => /[\p{L}]/u.test(token.text) && !FUNCTION_WORDS.has(auxiliaryBase(token.text));
var REDUCTION_LEXICON = /* @__PURE__ */ new Set([
  "soon",
  "later",
  "now",
  "today",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "annually",
  "near",
  "nearby",
  "because",
  "although",
  "though",
  "whether",
  "if",
  "unless",
  // "first" is deliberately absent: it is an ordinal, and licensing it as a reduction let
  // "the second attempt" become "the first attempt" free of charge.
  "while",
  "since",
  "after",
  "before",
  "during",
  "tends",
  "tend",
  "ensure",
  "ensures",
  "can",
  "cannot",
  "must",
  "may",
  "might",
  "should",
  "will",
  "would",
  "believes",
  "believe",
  "believed",
  "thinks",
  "think",
  "expects",
  "expect"
]);
function vocabularyHasAntecedent(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = 0;
  let prose = source;
  for (const token of protectedTokenList(source)) prose = prose.split(token).join(" ");
  const sourceContent = tokenize(prose).filter((token) => !token.space && isContentWord(token)).map((token) => token.text);
  while (index < ops.length) {
    if (ops[index].type === "equal") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source).filter(isContentWord);
    const added = run.filter((op) => op.type === "insert").map((op) => op.target).filter(isContentWord);
    for (const token of added) {
      const word = token.text.toLowerCase();
      if (REDUCTION_LEXICON.has(word)) continue;
      if (removed.some((token2) => periphrasisTrade(token2.text, word))) continue;
      if (removed.some((candidateToken) => related(candidateToken.text, word))) continue;
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu").test(prose)) continue;
      if (sourceContent.some((sourceWord) => related(sourceWord, word))) continue;
      return false;
    }
    index = end;
  }
  return true;
}
var INTENSIFIERS = /* @__PURE__ */ new Set([
  "very",
  "completely",
  "totally",
  "absolutely",
  "entirely",
  "utterly",
  "really",
  "quite",
  "extremely",
  "highly",
  "fully",
  "truly",
  "simply",
  "wholly",
  "altogether",
  "thoroughly",
  "together",
  "definitely",
  "certainly",
  "particularly",
  "especially",
  "rather",
  "somewhat"
]);
var STOCK_PHRASE_NOUNS = /* @__PURE__ */ new Set([
  "point",
  "time",
  "basis",
  "proximity",
  "receipt",
  "order",
  "regard",
  "respect",
  "fact",
  "event",
  "purpose",
  "means",
  "terms",
  "nature"
]);
var REDUNDANT_MODIFIERS = /* @__PURE__ */ new Set([
  "brand",
  "end",
  "exactly",
  "ahead",
  "back",
  "again",
  "future",
  "past",
  "added",
  "mutual",
  "advance",
  "basic",
  "unexpected",
  "final",
  "close",
  "joined",
  "free",
  "personal",
  "true",
  "actual",
  "general",
  "overall",
  "total",
  "sum",
  "new",
  "own",
  "different",
  "various",
  "separate",
  "individual",
  "current",
  "still"
]);
var REPETITION_MODIFIERS = /* @__PURE__ */ new Set(["back", "again"]);
var REPETITION_CARRIER = /^(?:repeat(?:s|ed|edly|ing)?|repetition|return(?:s|ed|ing)?|revert(?:s|ed|ing)?|resend|resent|resubmit(?:s|ted|ting)?|restart(?:s|ed|ing)?|reissue[ds]?|retry|retries|retried|recur(?:s|red|ring)?|twice|still|re)$/iu;
var REDUCTION_CARRIERS = new Map(Object.entries({
  because: ["fact", "account", "reason", "due", "owing", "light"],
  although: ["spite", "fact"],
  though: ["spite", "fact"],
  soon: ["near", "future", "shortly"],
  now: ["present", "moment", "current", "currently", "time", "point"],
  later: ["subsequent", "subsequently", "stage", "point", "time"],
  today: ["day"],
  daily: ["day", "days", "basis"],
  weekly: ["week", "weeks", "basis"],
  monthly: ["month", "months", "basis"],
  quarterly: ["quarter", "quarters", "basis"],
  yearly: ["year", "years", "basis"],
  annually: ["year", "years", "basis"],
  // "located"/"situated" are filler in place expressions: "is located near" IS "is near".
  near: ["close", "proximity", "vicinity", "located", "situated", "positioned"],
  nearby: ["close", "proximity", "vicinity", "located", "situated", "positioned"],
  can: ["able", "ability", "capability", "capacity"],
  cannot: ["unable", "inability", "ability", "capability", "capacity"],
  must: ["necessary", "necessity", "mandatory", "obliged", "obligation"],
  may: ["possible", "possibility", "chance", "perhaps", "likely"],
  might: ["possible", "possibility", "chance", "perhaps", "likely"],
  should: ["recommended", "recommendation", "advisable", "advised"],
  will: ["going", "committed", "commitment"],
  would: ["going"],
  tends: ["tendency"],
  tend: ["tendency"],
  if: ["event", "case", "condition"],
  unless: ["event", "case", "condition"],
  whether: ["question"],
  // The rest of REDUCTION_LEXICON: every licensed reduction needs its carriers, or the
  // canonical compression into it reports a loss — "make sure that" -> "ensure" was
  // refused outright as information-dropped for want of these entries.
  ensure: ["sure", "certain", "make", "makes", "made"],
  ensures: ["sure", "certain", "make", "makes", "made"],
  before: ["prior", "advance", "ahead"],
  after: ["subsequent", "subsequently", "following"],
  during: ["course", "duration", "middle", "midst"],
  while: ["time", "period"],
  since: ["time", "point"],
  believes: ["opinion", "view", "belief", "impression"],
  believe: ["opinion", "view", "belief", "impression"],
  believed: ["opinion", "view", "belief", "impression"],
  thinks: ["opinion", "view", "belief", "impression"],
  think: ["opinion", "view", "belief", "impression"],
  expects: ["expectation", "expectations", "anticipation"],
  expect: ["expectation", "expectations", "anticipation"],
  // The quantity periphrases the quantifier guard already licenses as a one-way trade:
  // "a number of open questions" -> "several open questions". Without the matching
  // carriers the validator accepted the trade and the deletion policy then billed the
  // writer for the "number" it had just approved swapping out.
  several: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  many: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  most: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  much: ["number", "lot", "lots", "plenty", "amount", "quantity", "majority"],
  some: ["number", "lot", "lots", "plenty", "amount", "quantity"],
  few: ["number", "lot", "lots", "plenty", "amount", "quantity", "minority"],
  // "with regard to", "in terms of", "regarding" -> "about", all on Grammarly's list.
  about: ["regard", "regards", "regarding", "concerning", "respect", "terms", "relation", "reference"],
  // "the present study" -> "this study", "at the present moment" -> "now".
  this: ["present", "current"]
}));
var LIGHT_VERBS = /* @__PURE__ */ new Set([
  "make",
  "makes",
  "made",
  "take",
  "takes",
  "took",
  "give",
  "gives",
  "gave",
  "put",
  "puts",
  "perform",
  "performs",
  "performed",
  "conduct",
  "conducts",
  "conducted",
  "carry",
  "carries",
  "carried",
  "undertake",
  "undertakes",
  "undertook",
  "provide",
  "provides",
  "provided",
  "hold",
  "holds",
  "held",
  "reach",
  "reaches",
  "reached"
]);
var PRO_FORMS = /* @__PURE__ */ new Set(["one", "ones", "it", "them", "this", "that", "these", "those", "some"]);
var LIGHT_PARTICLES = /* @__PURE__ */ new Set(["forward", "out", "into"]);
var NOMINALIZING_TAIL = /(?:ion|ment|ance|ence|ure|ity|al)$/u;
var NOMINAL_COMPLEMENT = /* @__PURE__ */ new Set(["of", "into", "regarding", "concerning"]);
var wordAfter = (text, token) => text.slice(token.end).match(/^[^\p{L}]*([\p{L}’']+)/u)?.[1]?.toLowerCase() ?? "";
var FILLER_SPANS = [
  /\bin\s+place\b(?!\s+of)/giu,
  // "process" used to sit in STOCK_PHRASE_NOUNS, which made it free to delete anywhere:
  // "the alpha process is fast and the beta process is slow" -> "and the beta is slow"
  // lost a real noun for nothing. Only this frame is padding.
  /\bin\s+the\s+process\s+of\b/giu,
  // "time" is on the stock-phrase list and "present" is not, so deleting the phrase
  // outright was billed for half of itself. Found by running the development corpus
  // against a live model: the model dropped the phrase instead of compressing it to
  // "now", which is the shape the clarity rule handles.
  /\bat\s+the\s+present\s+(?:time|moment)\b/giu,
  /\bin\s+question\b/giu,
  /\bat\s+hand\b/giu,
  /\bin\s+nature\b/giu,
  /\bas\s+such\b/giu
];
var POLITENESS_SPANS = [
  /\bwould\s+(?:just\s+)?(?:like|love)\s+to\b/giu,
  /\bdo\s+not\s+hesitate\s+to\b/giu,
  /\bplease\s+feel\s+free\s+to\b/giu
];
function spanCover(text, patterns) {
  const covered = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) covered.push([match.index, match.index + match[0].length]);
  }
  return covered;
}
var withinSpan = (covered, token) => covered.some(([from, to]) => token.start >= from && token.end <= to);
function epistemicSurvives(text) {
  const expanded = expandAuxiliaries(hedgeNormalised(text)).toLowerCase();
  return EPISTEMIC_GROUPS.some((index) => CERTAINTY_GROUPS[index].some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "u").test(expanded);
  }));
}
var EPISTEMIC_WORDS = new Set(EPISTEMIC_GROUPS.flatMap((index) => CERTAINTY_GROUPS[index]));
var FIXED_PAIRS = /\b(?:first\s+and\s+foremost|null\s+and\s+void|each\s+and\s+every|one\s+and\s+only|aches\s+and\s+pains|law\s+and\s+order)\b/iu;
function dropsConjunct(source, candidate, lost) {
  if (!lost.length || FIXED_PAIRS.test(source)) return false;
  const coordinators = (text) => (text.match(/\b(?:and|or)\b/giu) ?? []).length;
  if (coordinators(candidate) >= coordinators(source)) return false;
  return lost.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\b(?:and|or)\\s+(?:\\S+\\s+){0,2}${escaped}\\b|\\b${escaped}\\s+(?:\\S+\\s+){0,2}(?:and|or)\\b`, "iu").test(source);
  });
}
function dropsRepeatedWord(source, candidate, lost) {
  if (!lost.length) return false;
  const content = (text) => tokenize(text).filter((token) => !token.space && isContentWord(token)).map((token) => token.text.toLowerCase());
  const sourceWords = content(source);
  const candidateWords = content(candidate);
  const occurrences = (words, word) => words.filter((other) => other === word).length;
  return lost.some((word) => {
    const lowered = word.toLowerCase();
    const before = occurrences(sourceWords, lowered);
    return before > 1 && occurrences(candidateWords, lowered) < before;
  });
}
function lostContentWords(source, candidate) {
  const proposition = attentionProposition(source);
  if (proposition && !ATTENTION_FRAME.test(candidate)) {
    return lostContentWords(proposition, candidate);
  }
  const ops = diffWords(source, candidate);
  const survivors = new Set(
    ops.filter((op) => op.type !== "delete").map((op) => op.target ?? op.source).filter((token) => isContentWord(token)).map((token) => token.text.toLowerCase())
  );
  const contentWords = (text) => tokenize(text).filter((token) => !token.space && isContentWord(token)).map((token) => token.text.toLowerCase());
  const sourceWords = contentWords(source);
  const candidateWords = contentWords(candidate);
  const carriedCount = (words, word) => words.filter((other) => related(other, word)).length;
  const stillCarried = (word) => DISCOURSE_WORDS.has(word) || carriedCount(candidateWords, word) >= carriedCount(sourceWords, word);
  const repetitionSurvives = [...survivors].some((word) => REPETITION_CARRIER.test(word));
  const hedgeSurvives = epistemicSurvives(candidate);
  const failureWords = (words) => words.filter((word) => FAILURE_WORDS.has(word)).length;
  const failurePreserved = failureWords(candidateWords) >= failureWords(sourceWords);
  const filler = spanCover(source, FILLER_SPANS);
  const politeness = spanCover(source, POLITENESS_SPANS);
  const lost = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const carried = new Set(run.filter((op) => op.type === "insert").flatMap((op) => REDUCTION_CARRIERS.get(op.target.text.toLowerCase()) ?? []));
    const insertsProForm = run.some((op) => op.type === "insert" && PRO_FORMS.has(op.target.text.toLowerCase()));
    const unpacked = run.some((op) => op.type === "insert" && isContentWord(op.target) && run.some((other) => other.type === "delete" && isContentWord(other.source) && related(other.source.text, op.target.text) && (NOMINALIZING_TAIL.test(other.source.text.toLowerCase()) || NOMINAL_COMPLEMENT.has(wordAfter(source, other.source)))));
    const inverts = run.some((op) => op.type === "delete" && FAILURE_WORDS.has(op.source.text.toLowerCase())) && !failurePreserved;
    for (const op of run) {
      if (op.type !== "delete" || !isContentWord(op.source)) continue;
      const word = op.source.text.toLowerCase();
      if (inverts) {
        lost.push(op.source.text);
        continue;
      }
      if (INTENSIFIERS.has(word)) continue;
      if (STOCK_PHRASE_NOUNS.has(word)) continue;
      if (withinSpan(filler, op.source) || withinSpan(politeness, op.source)) continue;
      if (unpacked && (LIGHT_VERBS.has(word) || LIGHT_PARTICLES.has(word))) continue;
      if (hedgeSurvives && EPISTEMIC_WORDS.has(word)) continue;
      if (REPETITION_MODIFIERS.has(word)) {
        if (repetitionSurvives) continue;
        lost.push(op.source.text);
        continue;
      }
      if (REDUNDANT_MODIFIERS.has(word)) continue;
      if (carried.has(word)) continue;
      const antecedentStands = [...survivors].some((survivor) => related(survivor, word));
      if (antecedentStands && stillCarried(word)) continue;
      if (antecedentStands && insertsProForm) continue;
      lost.push(op.source.text);
    }
    index = end;
  }
  return lost;
}
var TRIVIAL_DELETIONS = /* @__PURE__ */ new Set(["a", "an", "the"]);
var RESPELLINGS = new Map([
  ...[...AUX_CONTRACTIONS].filter(([word]) => word !== "ain't"),
  ["it's", "it is"],
  ["that's", "that is"],
  ["there's", "there is"],
  ["here's", "here is"],
  ["he's", "he is"],
  ["she's", "she is"],
  ["what's", "what is"],
  ["who's", "who is"],
  ["let's", "let us"],
  ["i'm", "i am"],
  ["you're", "you are"],
  ["we're", "we are"],
  ["they're", "they are"],
  ["i've", "i have"],
  ["you've", "you have"],
  ["we've", "we have"],
  ["they've", "they have"],
  ["i'll", "i will"],
  ["you'll", "you will"],
  ["he'll", "he will"],
  ["she'll", "she will"],
  ["we'll", "we will"],
  ["they'll", "they will"],
  ["it'll", "it will"],
  ["i'd", "i would"],
  ["you'd", "you would"],
  ["he'd", "he would"],
  ["she'd", "she would"],
  ["we'd", "we would"],
  ["they'd", "they would"]
]);
function respelled(words) {
  return words.map((word) => RESPELLINGS.get(word.toLowerCase().replace(/[’]/gu, "'")) ?? word.toLowerCase()).join(" ").replace(/\s+/gu, " ").trim();
}
function runValue(run, all) {
  for (const op of run) {
    if (op.type !== "delete") continue;
    const at = all.indexOf(op);
    const word = op.source.text.toLowerCase();
    const same2 = (other) => (other?.source ?? other?.target)?.text.toLowerCase() === word;
    if (same2(all[at - 1]) || same2(all[at + 1])) return "substantive";
  }
  const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text);
  const added = run.filter((op) => op.type === "insert").map((op) => op.target.text);
  if (added.length === 0) {
    return removed.every((word) => TRIVIAL_DELETIONS.has(word.toLowerCase())) ? "article" : "substantive";
  }
  if (removed.length === 0) return "substantive";
  if (respelled(removed) !== respelled(added)) return "substantive";
  return added.join(" ").length >= removed.join(" ").length ? "respelling" : "substantive";
}
function runsOf(source, candidate) {
  const all = diffWords(source, candidate);
  const runs = [];
  for (let index = 0; index < all.length; index += 1) {
    if (all[index].type === "equal") continue;
    const start = index;
    while (index < all.length && all[index].type !== "equal") index += 1;
    runs.push(runValue(all.slice(start, index), all));
  }
  return runs;
}
function isTrivialEdit(source, candidate) {
  const runs = runsOf(source, candidate);
  if (runs.length === 0) return false;
  if (runs.length === 1 && runs[0] === "article") return true;
  if (runs.some((kind) => kind === "substantive")) return false;
  return runs.includes("respelling");
}
function isPurePermutation(source, candidate) {
  const all = (text) => tokenize(text).filter((token) => !token.space && /[\p{L}\p{N}]/u.test(token.text)).map((token) => token.text.toLowerCase());
  const articles = (words) => words.filter((word) => TRIVIAL_DELETIONS.has(word)).length;
  const leftAll = all(source);
  const rightAll = all(candidate);
  if (articles(rightAll) > articles(leftAll)) return false;
  const left = leftAll.filter((word) => !TRIVIAL_DELETIONS.has(word));
  const right = rightAll.filter((word) => !TRIVIAL_DELETIONS.has(word));
  if (left.length !== right.length || left.length === 0) return false;
  if (same(left, right)) return false;
  return same([...left].sort(), [...right].sort());
}
var SUBORDINATORS = [
  "if",
  "unless",
  "because",
  "since",
  "while",
  "although",
  "though",
  "when",
  "after",
  "before",
  "as"
];
function subordinatorReattached(source, candidate) {
  const commaBefore = (text, word) => {
    const match = new RegExp(`(,\\s*)?\\b${word}\\b`, "iu").exec(text);
    return match ? Boolean(match[1]) : null;
  };
  const occurrences = (text, word) => (text.match(new RegExp(`\\b${word}\\b`, "giu")) ?? []).length;
  const commas = (text) => (text.match(/,/gu) ?? []).length;
  return SUBORDINATORS.some((word) => {
    if (occurrences(source, word) !== 1 || occurrences(candidate, word) !== 1) return false;
    return commaBefore(source, word) === true && commaBefore(candidate, word) === false && commas(candidate) >= commas(source);
  });
}
var OBJECT_ADJUNCT_PREPOSITIONS = /* @__PURE__ */ new Set([
  "in",
  "on",
  "at",
  "within",
  "inside",
  "during",
  "under",
  "beneath",
  "behind",
  "beside",
  "near",
  "throughout"
]);
var NOUN_DETERMINERS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "its",
  "their",
  "his",
  "her",
  "our",
  "my",
  "your",
  "each",
  "every",
  "any",
  "some"
]);
function objectAdjunctCompounded(source, candidate) {
  const wordsOf = (text) => tokenize(text).filter((token) => !token.space && /[\p{L}\p{N}]/u.test(token.text)).map((token) => token.text.toLowerCase());
  const content = (word) => /\p{L}/u.test(word) && !FUNCTION_WORDS.has(word);
  const left = wordsOf(source);
  const right = wordsOf(candidate);
  for (let index = 1; index + 2 < left.length; index += 1) {
    const head = left[index];
    const preposition = left[index + 1];
    if (!content(head) || !OBJECT_ADJUNCT_PREPOSITIONS.has(preposition)) continue;
    let governor = index - 1;
    while (governor >= 0 && NOUN_DETERMINERS.has(left[governor])) governor -= 1;
    if (governor < 0 || governor === index - 1 || !content(left[governor])) continue;
    let after = index + 2;
    while (after < left.length && NOUN_DETERMINERS.has(left[after])) after += 1;
    const modifier = [];
    while (after < left.length && content(left[after])) {
      modifier.push(left[after]);
      after += 1;
    }
    if (modifier.length === 0) continue;
    if (right.some((word, at) => word === head && right[at + 1] === preposition)) continue;
    for (let at = 0; at + modifier.length < right.length; at += 1) {
      if (modifier.every((word, offset) => right[at + offset] === word) && right[at + modifier.length] === head) {
        return true;
      }
    }
  }
  return false;
}
var DURATION_AFTER_BY = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|\\d+)\\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?)\\b";
var PASSIVE_SKELETON = new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(?:\\w+(?:ed|en|wn|ne|lt|ung|eld|ade|aid|ept|ent|old|uilt|ead|one))\\s+by\\s+(?!(?:noon|midnight|midday|dawn|dusk|dark|then|now|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|next|early|late|end|the\\s+end|\\d)\\b|${DURATION_AFTER_BY})`, "iu");
var EXPLETIVE_PASSIVE = /^\s*it\s+(?:\w+\s+){1,3}by\b[^.]*\bthat\b/iu;
function rolesFlipped(source, candidate) {
  if (PASSIVE_SKELETON.test(source) === PASSIVE_SKELETON.test(candidate)) return false;
  if (EXPLETIVE_PASSIVE.test(source)) return false;
  const content = (text) => tokenize(text).filter((token) => !token.space && isContentWord(token)).map((token) => token.text.toLowerCase());
  const left = content(source);
  const right = content(candidate);
  const shared = left.filter((word) => right.includes(word));
  const sharedRight = right.filter((word) => left.includes(word));
  if (shared.length < 2) return false;
  return same(shared, sharedRight);
}
function commonNounRolesSwapped(source, candidate) {
  const ops = diffWords(source, candidate).filter((op) => op.type !== "equal");
  const runs = [];
  for (const op of ops) {
    const token = op.source ?? op.target;
    if (!isContentWord(token)) return false;
    const last = runs[runs.length - 1];
    if (last && last.type === op.type) last.tokens.push(token);
    else runs.push({ type: op.type, tokens: [token] });
  }
  if (runs.length !== 4) return false;
  const stem2 = (run) => run.tokens.map((token) => token.text.toLowerCase().replace(/['’]s$/u, "")).join(" ");
  const removed = runs.filter((run) => run.type === "delete").map(stem2);
  const added = runs.filter((run) => run.type === "insert").map(stem2);
  if (removed.length !== 2 || added.length !== 2) return false;
  if (removed[0] === removed[1]) return false;
  return removed[0] === added[1] && removed[1] === added[0];
}
function isConfusableRepair(source, candidate) {
  const ops = diffWords(source, candidate).filter((op) => op.type !== "equal");
  if (ops.length !== 2) return false;
  const removed = ops.find((op) => op.type === "delete")?.source.text.toLowerCase();
  const added = ops.find((op) => op.type === "insert")?.target.text.toLowerCase();
  if (!removed || !added) return false;
  return CONFUSABLES.some(([x, y]) => removed === x && added === y || removed === y && added === x);
}
var ATTENTION_FRAME = /^(?:it should be noted that|it is worth noting that|it is worth mentioning that|it is important to note that|it must be noted that|it bears mentioning that|please note that)\s+/iu;
function attentionProposition(text) {
  const frame = ATTENTION_FRAME.exec(text);
  if (!frame) return null;
  const rest = text.slice(frame[0].length).trim();
  if (!rest) return null;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
var NUMBER_NEUTRAL_DETERMINERS = /* @__PURE__ */ new Set([
  "the",
  "my",
  "our",
  "your",
  "his",
  "her",
  "its",
  "their",
  "no",
  "any",
  "some"
]);
var DERIVATIONAL_TAILS = /* @__PURE__ */ new Set([
  "ion",
  "ions",
  "ment",
  "ments",
  "ance",
  "ence",
  "ness",
  "ing",
  "al",
  "ure",
  "ity",
  "er",
  "ers",
  "or",
  "ors"
]);
function isLoneDerivationSwap(source, candidate) {
  const changed = diffWords(source, candidate).filter((op) => op.type !== "equal");
  if (changed.length !== 2) return false;
  const removed = changed.find((op) => op.type === "delete")?.source.text.toLowerCase();
  const added = changed.find((op) => op.type === "insert")?.target.text.toLowerCase();
  if (!removed || !added || removed === added) return false;
  if (CONFUSABLES.some(([x, y]) => removed === x && added === y || removed === y && added === x)) {
    return false;
  }
  const [shorter, longer] = removed.length <= added.length ? [removed, added] : [added, removed];
  if (!longer.startsWith(shorter)) return false;
  const tail = longer.slice(shorter.length);
  if (tail === "ing" && new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+${longer}\\b`, "iu").test(`${source} ${candidate}`)) {
    return false;
  }
  return DERIVATIONAL_TAILS.has(tail);
}
var TOPIC_PREPOSITIONS = /* @__PURE__ */ new Set(["regarding", "concerning", "about", "on"]);
var RULING_VERBS = /* @__PURE__ */ new Set([
  "determine",
  "determines",
  "determined",
  "decide",
  "decides",
  "decided",
  "rule",
  "rules",
  "ruled",
  "settle",
  "settles",
  "settled",
  "judge",
  "judges",
  "judged",
  "resolve",
  "resolves",
  "resolved"
]);
function topicComplementObjectified(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text.toLowerCase());
    const added = run.filter((op) => op.type === "insert").map((op) => op.target.text.toLowerCase());
    const topicDropped = removed.some((word) => TOPIC_PREPOSITIONS.has(word)) && !added.some((word) => TOPIC_PREPOSITIONS.has(word));
    const ruling = added.some((verb) => RULING_VERBS.has(verb) && removed.some((noun) => noun !== verb && NOMINALIZING_TAIL.test(noun) && related(noun, verb)));
    if (topicDropped && ruling) return true;
    index = end;
  }
  return false;
}
var CONFUSABLE_PARTNERS = /* @__PURE__ */ new Map();
for (const [x, y] of CONFUSABLES) {
  if (FUNCTION_WORDS.has(x) || FUNCTION_WORDS.has(y)) continue;
  CONFUSABLE_PARTNERS.set(x, [...CONFUSABLE_PARTNERS.get(x) ?? [], y]);
  CONFUSABLE_PARTNERS.set(y, [...CONFUSABLE_PARTNERS.get(y) ?? [], x]);
}
function confusableResolvedByDerivation(source, candidate) {
  const ops = diffWords(source, candidate);
  const survivors = tokenize(candidate).filter((token) => !token.space && isContentWord(token)).map((token) => token.text.toLowerCase());
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text.toLowerCase());
    const added = run.filter((op) => op.type === "insert").map((op) => op.target.text.toLowerCase());
    for (const word of removed) {
      const partners = CONFUSABLE_PARTNERS.get(word);
      if (!partners) continue;
      if (survivors.some((other) => related(other, word))) continue;
      if (survivors.some((other) => partners.some((partner) => related(other, partner)))) continue;
      if (added.some((other) => other.length > word.length && other.startsWith(word))) return true;
    }
    index = end;
  }
  return false;
}
var BE_FORMS = /* @__PURE__ */ new Set(["be", "been", "being", "is", "are", "was", "were", "am"]);
function passiveIntroduced(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    const run = ops.slice(index, end);
    const inserted = run.filter((op) => op.type === "insert").map((op) => op.target.text.toLowerCase());
    const removed = run.filter((op) => op.type === "delete").map((op) => op.source.text.toLowerCase());
    for (let at = 0; at < inserted.length - 1; at += 1) {
      if (!BE_FORMS.has(inserted[at])) continue;
      const participle = inserted[at + 1];
      if (!/(?:ed|en)$/u.test(participle)) continue;
      if (removed.some((word) => !BE_FORMS.has(word) && related(word, participle))) return true;
    }
    index = end;
  }
  return false;
}
function isUntriggeredNumberChange(source, candidate) {
  const ops = diffWords(source, candidate);
  const changed = ops.filter((op) => op.type !== "equal");
  if (changed.length !== 2) return false;
  const removed = changed.find((op) => op.type === "delete")?.source;
  const added = changed.find((op) => op.type === "insert")?.target;
  if (!removed || !added) return false;
  const before = removed.text.toLowerCase();
  const after = added.text.toLowerCase();
  const inflects = (one, other) => `${one}s` === other || `${one}es` === other || one.endsWith("y") && `${one.slice(0, -1)}ies` === other || /fe?$/u.test(one) && `${one.replace(/fe?$/u, "ves")}` === other;
  if (!inflects(before, after) && !inflects(after, before)) return false;
  const index = ops.indexOf(changed.find((op) => op.type === "delete"));
  const previous = ops.slice(0, index).reverse().find((op) => op.type !== "insert" && /[\p{L}]/u.test(op.source.text));
  const determiner = previous?.source.text.toLowerCase();
  return Boolean(determiner) && NUMBER_NEUTRAL_DETERMINERS.has(determiner);
}
function deletesTrailingPhrase(source, candidate) {
  const ops = diffWords(source, candidate);
  let index = ops.length - 1;
  while (index >= 0) {
    const op = ops[index];
    const token = op.target ?? op.source;
    if (op.type === "insert") {
      index -= 1;
      continue;
    }
    if (op.type === "equal" && !/[\p{L}\p{N}]/u.test(token.text)) {
      index -= 1;
      continue;
    }
    break;
  }
  let carriesContent = false;
  while (index >= 0 && ops[index].type === "delete") {
    if (isContentWord(ops[index].source)) carriesContent = true;
    index -= 1;
  }
  return carriesContent;
}
var SCOPE_WORDS = ["unless", "until", "except", "only", "own"];
function dropsScopeWord(source, candidate) {
  const count = (text, word) => (text.toLowerCase().match(new RegExp(`\\b${word}\\b`, "gu")) ?? []).length;
  return SCOPE_WORDS.some((word) => count(candidate, word) < count(source, word));
}
function validateRewrite(source, decision, { maxEditRatio = 0.58, protectedTerms = [] } = {}) {
  if (decision?.action !== "rewrite") return reject("action-mismatch");
  const original = source.trim();
  const candidate = typeof decision.replacement === "string" ? decision.replacement.trim() : "";
  if (!candidate) return reject("empty");
  if (candidate === original) return reject("unchanged");
  if (INSTRUCTION_OUTPUT.test(candidate)) return reject("instruction-output");
  if (refusesInsteadOfRewriting(original, candidate)) return reject("instruction-output");
  if (typeof decision.reason === "string" && KEEP_REASON.test(decision.reason)) {
    return reject("reason-contradicts-action");
  }
  const complete = segmentSentences(candidate).filter((segment) => isCompleteSentence(segment.text));
  if (complete.length > 1) return reject("multiple-sentences");
  const proposition = attentionProposition(original);
  if (proposition) {
    const normalise = (text) => text.replace(/\s+/gu, " ").trim().toLowerCase();
    if (normalise(proposition) === normalise(candidate)) {
      return { accepted: true, reason: "accepted", replacement: candidate };
    }
    return validateRewrite(proposition, decision, { maxEditRatio, protectedTerms });
  }
  if (!same(numbers(original), numbers(candidate))) return reject("numbers-changed");
  if (!same(protectedTokens(original, protectedTerms), protectedTokens(candidate, protectedTerms))) {
    return reject("protected-token-changed");
  }
  if (!same(markupTokens(original), markupTokens(candidate))) {
    return reject("markup-changed");
  }
  if (isConfusableRepair(original, candidate)) {
    return { accepted: true, reason: "accepted", replacement: candidate };
  }
  if (!namesPreserved(original, candidate)) return reject("name-changed");
  const sourceCertainty = distinctMembers(hedgeNormalised(original), CERTAINTY_GROUPS);
  const candidateCertainty = distinctMembers(hedgeNormalised(candidate), CERTAINTY_GROUPS);
  const stacked = epistemicStackReduced(original, candidate);
  if (sourceCertainty.some((count, index) => candidateCertainty[index] > count || count > 0 && candidateCertainty[index] === 0 && !(stacked && EPISTEMIC_GROUPS.includes(index)) || count === 0 && candidateCertainty[index] > 0)) {
    return reject("certainty-changed");
  }
  if (!quantifiersPreserved(original, candidate)) return reject("quantifier-changed");
  if (!boundsPreserved(original, candidate)) return reject("quantifier-changed");
  if (!same(ordinals(original).map(String), ordinals(candidate).map(String))) {
    return reject("quantifier-changed");
  }
  if (negations(original) !== negations(candidate)) return reject("negation-changed");
  const ops = diffWords(original, candidate);
  const lost = ops.filter((op) => op.type === "delete" && isContentWord(op.source)).length;
  const gained = ops.filter((op) => op.type === "insert" && isContentWord(op.target)).length;
  const sourceContent = tokenize(original).filter((token) => !token.space && isContentWord(token)).length;
  if (lost - gained > 3 || lost - gained >= 3 && lost - gained >= sourceContent * 0.5) {
    return reject("content-dropped");
  }
  const sourceDiscourse = distinctMembers(original, DISCOURSE_GROUPS);
  if (distinctMembers(candidate, DISCOURSE_GROUPS).some((count, index) => count < sourceDiscourse[index])) {
    return reject("content-dropped");
  }
  if (!directionsPreserved(original, candidate)) return reject("direction-changed");
  if (deadlineMoved(original, candidate)) return reject("direction-changed");
  const sourceTense = tense(original);
  const candidateTense = tense(candidate);
  if (JSON.stringify(sourceTense) !== JSON.stringify(candidateTense) && !tenseRepairedToMatchEvidence(original, sourceTense, candidateTense)) {
    return reject("tense-changed");
  }
  const sourceTerminal = terminal(original);
  const candidateTerminal = terminal(candidate);
  if (sourceTerminal.includes("?") !== candidateTerminal.includes("?")) return reject("question-changed");
  if (sourceTerminal && sourceTerminal !== candidateTerminal) return reject("terminal-punctuation-changed");
  if (isPurePermutation(original, candidate)) return reject("order-changed");
  if (subordinatorReattached(original, candidate)) return reject("order-changed");
  if (objectAdjunctCompounded(original, candidate)) return reject("order-changed");
  if (rolesFlipped(original, candidate)) return reject("order-changed");
  if (commonNounRolesSwapped(original, candidate)) return reject("order-changed");
  if (isTrivialEdit(original, candidate)) return reject("trivial-edit");
  if (editRatio(original, candidate) > maxEditRatio) return reject("excessive-edit");
  if (!vocabularyHasAntecedent(original, candidate)) return reject("word-substituted");
  if (isUntriggeredNumberChange(original, candidate)) return reject("word-substituted");
  if (isLoneDerivationSwap(original, candidate)) return reject("word-substituted");
  if (topicComplementObjectified(original, candidate)) return reject("word-substituted");
  if (confusableResolvedByDerivation(original, candidate)) return reject("word-substituted");
  if (passiveIntroduced(original, candidate)) return reject("order-changed");
  if (!referentsPreserved(original, candidate)) return reject("pronoun-changed");
  if (failures(original) !== failures(candidate)) return reject("negation-changed");
  return { accepted: true, reason: "accepted", replacement: candidate };
}

// src/mechanics.mjs
var WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
var MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];
var DATE_CONTEXT = /\b(?:on|in|by|since|until|before|after|during|from)\s+$/iu;
var UNTOUCHABLE = [
  /https?:\/\/\S+/giu,
  // URLs
  // Bounded like the safety pattern: an unbounded local part backtracks quadratically.
  /\b[\w.+-]{1,64}@[\w.-]{1,255}\.[A-Za-z]{2,24}\S*/gu,
  // email
  // A path counts wherever a delimiter precedes it — "(/srv/data,backup)" is as much a
  // path as " /srv/data,backup"; only a word character or another slash rules it out.
  /(?<![\w~/])~?(?:\/[^\s/]+)+\/?/gu,
  // posix paths
  /\b[A-Za-z]:\\\S+/gu,
  // windows paths
  /\b[\w-]+\.(?:csv|json|log|md|txt|ya?ml|pdf|js|py|sql|xml|html)\S*/giu,
  // file names
  /`[^`\n]*`/gu,
  // inline code spans
  // The atoms safety.mjs holds immutable are untouchable here too: a comma inside
  // $f(a,b)$ is math, and a day name inside [[wednesday log]] is a link target. The
  // math shapes mirror safety.mjs exactly — a looser pair pattern read the prose
  // between "$5" and "$10" as one phantom span and silently disabled repairs there.
  /\$\$[^$\n]+\$\$|(?<!\d)\$(?![\s\d$])[^$\n]*?(?<!\s)\$|(?<!\d)\$\d[^\s$\n]*\$/gu,
  // math spans
  /!?\[\[[^\]\n]*\]\]/gu,
  // wikilinks and embeds
  /!?\[[^\]\n]*\]\([^)\n]*\)/gu
  // links and images
];
function untouchableSpans(text) {
  const spans = [];
  for (const pattern of UNTOUCHABLE) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
}
var touches = (spans, start, end) => spans.some((span) => span.start < end && start < span.end);
var IDENTIFIER_OPENER = /[./\\@_]|^[\p{L}]+\d/u;
var opensWithIdentifier = (text) => IDENTIFIER_OPENER.test((text.trim().split(/\s/u)[0] ?? "").replace(/[.!?…]+$/u, ""));
var FIXES = [
  {
    id: "non-breaking-space",
    label: "Replaces a non-breaking space with an ordinary space.",
    // Only between two visible characters, where a no-break space pasted in from another
    // document is doing a plain word separator's job. Nothing downstream can mark such a
    // space, so leaving it to the model produced a suggestion with no underline behind it.
    // Runs first: every later fix then sees ordinary spaces.
    //
    // The whole horizontal run goes, not just the no-break characters in it. Matching only
    // a no-break space with a visible neighbour on each side is not idempotent: in
    // "x\u00A0 ,y" the ordinary space shields it on this pass, the punctuation rules then
    // close the gap, and the next pass finds a repair the first one missed.
    apply: (text, spans) => text.replace(/(\S)[ \t\u00A0\u202F]*[\u00A0\u202F][ \t\u00A0\u202F]*(?=\S)/gu, (match, first, offset) => touches(spans, offset + 1, offset + match.length) ? match : `${first} `)
  },
  {
    id: "space-before-punctuation",
    label: "Removes a space before punctuation.",
    // A "." that opens the next token is that token's first character — "./build.sh",
    // ".gitignore", ".5" — not a stray sentence mark, so it is left alone. The other
    // marks stay unconditional: " ,word" is the glued-comma fault this fix repairs.
    apply: (text, spans) => text.replace(/[ \t]+([,;:!?]|\.(?![\w/\\]))/gu, (match, mark, offset) => touches(spans, offset, offset + match.length) ? match : mark)
  },
  {
    id: "space-after-punctuation",
    label: "Adds the missing space after punctuation.",
    // The space lands between the mark and the character after it, so both count as
    // touched: a comma inside a URL keeps its neighbour.
    apply: (text, spans) => text.replace(/([,;:])(?=[\p{L}])|(?<!\d)([,;:])(?=\d)/gu, (match, _a, _b, offset) => touches(spans, offset, offset + match.length + 1) ? match : `${match} `)
  },
  {
    id: "repeated-space",
    label: "Removes a repeated space.",
    // The lookahead leaves the following character unconsumed, so alternating runs
    // ("Section  A  is  ready.") are all collapsed rather than every other one.
    apply: (text, spans) => text.replace(/(\S)[ \t]{2,}(?=\S)/gu, (match, first, offset) => touches(spans, offset + 1, offset + match.length) ? match : `${first} `)
  },
  {
    id: "sentence-capitalisation",
    label: "Capitalizes the first word.",
    // A first word with an interior capital ("eBay", "iPhone") is cased on purpose and
    // is skipped; so is an opener whose uppercase form is more than one character (the
    // ligature "ﬁ" upcases to "FI"), because a two-letter expansion is never the one
    // correct answer this pass is limited to.
    apply: (text) => opensWithIdentifier(text) ? text : text.replace(/^(\s*)(\p{Ll})(?![\p{L}]*\p{Lu})/u, (match, space, letter) => {
      const upper = letter.toUpperCase();
      return upper.length === 1 ? space + upper : match;
    })
  },
  {
    id: "proper-noun-capitalisation",
    label: "Capitalizes a day or month name.",
    apply: (text, spans) => text.replace(/\b(\p{Ll}[\p{Ll}]+)\b/gu, (word, lower, offset, whole) => {
      if (!WEEKDAYS.includes(lower) && !MONTHS.includes(lower)) return word;
      if (touches(spans, offset, offset + word.length)) return word;
      const ambiguous = lower === "may" || lower === "march" || lower === "august";
      if (ambiguous && !DATE_CONTEXT.test(whole.slice(0, offset))) return word;
      return lower[0].toUpperCase() + lower.slice(1);
    })
  }
];
function guardTokens(text) {
  const spans = untouchableSpans(text).map((span) => text.slice(span.start, span.end).trim());
  return [...spans, ...protectedTokenList(text)].sort();
}
var sameTokens = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
function repairMechanics(sentence) {
  let replacement = sentence;
  const reasons = [];
  const ids = [];
  for (const fix of FIXES) {
    const next = fix.apply(replacement, untouchableSpans(replacement));
    if (next !== replacement) {
      replacement = next;
      reasons.push(fix.label);
      ids.push(fix.id);
    }
  }
  if (replacement === sentence) return null;
  if (!sameTokens(guardTokens(sentence), guardTokens(replacement))) return null;
  return { replacement, reason: reasons.join(" "), ids };
}

// src/gate.mjs
var FAMILIES = [
  { family: "wordy-phrase", patterns: [
    ["for the purpose of", /\bfor the purpose of\b/i],
    ["in the majority of", /\bin the majority of\b/i],
    ["on account of the fact", /\bon account of the fact\b/i],
    ["with the exception of", /\bwith the exception of\b/i],
    ["the fact that", /\bthe fact that\b/i],
    ["for a period of", /\bfor a period of\b/i],
    ["in accordance with", /\bin accordance with\b/i],
    ["during the course of", /\bduring the course of\b/i],
    ["in the vicinity of", /\bin the vicinity of\b/i],
    ["in order to/for", /\bin order (to|for)\b/i],
    ["at this point in time", /\bat (this point in time|the present moment)\b/i],
    ["prior to", /\bprior to\b/i],
    ["subsequent to", /\bsubsequent to\b/i],
    ["with regard/respect to", /\b(with regard to|in regards to|with respect to)\b/i],
    ["in the event of/that", /\bin the event (of|that)\b/i],
    ["in close proximity", /\bin close proximity\b/i],
    ["a large/significant number of", /\ba (large|significant|considerable) number of\b/i],
    ["has the ability/capability", /\b(ha(s|ve|d) the (ability|capability|capacity)|the capability of)\b/i],
    ["is able to", /\b(is|are|was|were|be) able to\b/i],
    ["makes use of", /\bmake(s)? use of\b/i],
    ["whether or not", /\bwhether or not\b/i],
    ["each and every", /\beach and every\b/i],
    ["as to whether", /\bas to whether\b/i],
    ["in terms of", /\bin terms of\b/i],
    ["on a daily/weekly basis", /\bon a \w+ basis\b/i],
    ["due to the ... nature of", /\bdue to the \w+ nature of\b/i],
    ["it should be noted", /\bit should be noted\b/i],
    ["it is worth noting", /\bit is worth not(ing|ed)\b/i],
    ["it is important to note", /\bit is important to note\b/i],
    ["give consideration to", /\bg(i|a)ve(s|n)? consideration to\b/i],
    ["the reason being", /\bthe reason being\b/i],
    ["the reason why", /\bthe reason why\b/i],
    ["in the process of", /\bin the process of\b/i],
    ["at the end of the day", /\bat the end of the day\b/i],
    ["going forward", /\bgoing forward\b/i],
    ["in a general sense", /\bin a general sense\b/i],
    ["in light of", /\bin light of\b/i],
    ["in the near future", /\bin the near future\b/i],
    ["make changes to", /\bmak(e|es|ing) changes to\b/i],
    ["with the aim of", /\bwith the aim of\b/i],
    ["in spite of the fact", /\bin spite of the fact\b/i],
    ["owing to the fact", /\bowing to the fact\b/i]
  ] },
  { family: "expletive", patterns: [
    ["there is a need for", /\bthere (is|was) a need for\b/i],
    ["there is no doubt that", /\bthere (is|was) no doubt that\b/i],
    ["there be X that/who", /\bthere (is|are|was|were)\s+(a|an|no|many|several|three|four|five|numerous|some)?\s*\w+(\s\w+){0,2}\s+(that|who|which)\b/i],
    ["it is ADJ that", /\bit (is|was) (necessary|essential|important|vital|crucial|clear|evident|apparent|likely|unlikely|possible|probable) that\b/i],
    ["it was VERBed that/by", /\bit (was|has been|had been) (decided|agreed|determined|demonstrated|noted|shown|suggested|reported|observed) (that|by)\b/i],
    ["it is our N that", /\bit (is|was) (our|my|their) \w+ that\b/i],
    ["it has come to our attention", /\bit has come to (our|my) attention\b/i],
    ["it seems (to me) that", /\bit (seems|appears|seemed|appeared) (to (me|us) )?that\b/i],
    ["it could be argued", /\bit (could|can|might) be argued\b/i],
    ["there is a chance that", /\bthere (is|was) a (chance|possibility) that\b/i],
    ["there was agreement that", /\bthere (is|was) (general )?(agreement|consensus) that\b/i]
  ] },
  { family: "passive-by-agent", patterns: [
    ["be PP by AGENT", /\b(is|are|was|were|be|been|being)\s+(all\s+|\w+ly\s+)?\w+(ed|wn|en|ne|lt|ung|eld|ade|aid|ept|ent|old|uilt|ead|one)\s+by\s+(the|a|an|our|their|its|my)\b/i]
  ] },
  { family: "nominalisation", patterns: [
    ["light-verb + deverbal noun", /\b(make|makes|made|making|perform|performs|performed|performing|conduct|conducts|conducted|carry|carries|carried|undertake|undertakes|undertook|give|gives|gave|given|provide|provides|provided|reach|reaches|reached|put|puts|take|takes|took)\b(\s+\w+){0,2}?\s+(a|an|the)?\s*\w*(tion|sion|ment|ance|ence|ysis|proposal|review|comparison|approval|mention|warning)s?\b/i],
    ["is/are in agreement", /\b(is|are|was|were) in (agreement|alignment|compliance)\b/i]
  ] },
  { family: "hedge-stack", patterns: [
    ["it seems to me", /\bit seems to (me|us)\b/i],
    ["I would just like to", /\bi would just like to\b/i],
    ["perhaps it might", /\bperhaps (it|we) (might|may|could)\b/i],
    ["could possibly", /\b(could|might|may) possibly\b/i],
    ["may want to consider", /\b(may|might) want to consider\b/i],
    ["arguably (sentence-initial)", /^arguably,/i]
  ] },
  { family: "redundant-pair", patterns: [
    ["revert back", /\brevert(s|ed|ing)? back\b/i],
    ["advance warning", /\badvance (warning|planning|notice)\b/i],
    ["consensus of opinion", /\bconsensus of opinion\b/i],
    ["cooperate together", /\b(cooperat|collaborat|join|merg)\w* together\b/i],
    ["brand new", /\bbrand new\b/i],
    ["end result", /\bend result\b/i],
    ["final outcome", /\bfinal outcome\b/i],
    ["exact same", /\bexact same\b/i],
    ["repeat ... again", /\brepeat\b[^.?!]{0,25}\bagain\b/i],
    ["plan ahead", /\bplan(s|ned|ning)? ahead\b/i],
    ["complete(ly) and total(ly)", /\bcomplete(ly)? and total(ly)?\b/i],
    ["basic fundamentals", /\bbasic fundamentals\b/i],
    ["past history / future plans", /\b(past history|future plans|added bonus|unexpected surprise)\b/i]
  ] },
  { family: "relative-bloat", patterns: [
    ["which/that/who + be", /\b(which|that|who) (is|are|was|were)\b/i]
  ] },
  { family: "run-on-coordination", patterns: [
    ["chained pronoun clauses", /\b(and|but|or)\s+(then\s+)?(we|it|they|i)\b[^.?!]{0,160}\b(and|but|or)\s+(then\s+|after that\s+)?(we|it|they|i)\b/i],
    ["repeated subordinator", /\b(because|if|after|although|when)\b[^,.;]{3,60}\band\s+(because|if|after|although|when)\b/i]
  ] },
  { family: "parallelism-fault", patterns: [
    ["mixed gerund/infinitive/that list", /,\s*(to\s+\w+|that\s+\w+|\w+ing\b|\w+\s+of\s+the\b)[^.?!]{0,160},\s*and\s+(then\s+)?(to\s+\w+|that\s+\w+|\w+ing\b|it\s|\w+\s+must\b)/i]
  ] },
  { family: "wordy-phrase-2", patterns: [
    ["a number of", /\b(a number of|there remains? )\b/i],
    ["the present study", /\bthe present (study|paper|report|work)\b/i],
    ["seeks to investigate", /\b(seeks?|aims?) to (investigate|examine|explore|determine|assess)\b/i],
    ["would seem to", /\bwould (seem|appear) to\b/i],
    ["results obtained from", /\b(results|data|findings) obtained\b/i],
    ["methodology employed", /\b(methodology|method|approach) (employed|utilised|utilized)\b/i],
    ["enable us to", /\benable(s|d)? (us|you|them|me) to\b/i],
    ["circle back / touch base", /\b(circle back|touch base|reach out)\b/i],
    ["do not hesitate to", /\bdo not hesitate to\b/i],
    ["has not been VERBed", /\b(has|have|had) not been \w+(ed|en|wn)\b/i],
    [", having VERBed,", /,\s*having \w+(ed|en|wn)\b/i],
    ["parenthetical (which ...)", /\(\s*(which|that|who)\b/i],
    ["chained modal pronoun", /\b(we|they|i|it) (could|can|should|would|will) \w+[^.?!]{0,160}\b(or|and)\s+(we|they|i|it)\s+(could|can|should|would|will)\b/i]
  ] },
  { family: "parallelism-2", patterns: [
    // The gerund is boundary-anchored and bounded: a bare \w+ing made every position
    // inside one long pasted token (a hash, a base64 blob) a candidate start, which
    // was quadratic all over again.
    ["gerund list + and to VERB", /\b\w{1,40}ing\b[^.?!]{0,160},\s*and\s+to\s+\w+/i],
    ["wh-clause inside list", /,\s*(what|how|who|when)\s+\w+[^,]{0,160},\s*and\b/i]
  ] },
  { family: "question-bloat", patterns: [
    ["would it be possible for you", /\bwould it be possible for (you|us|me)\b/i],
    ["do you happen to know", /\bdo you happen to know\b/i],
    ["let me know what X is", /\blet me know what\b[^.?!]{0,160}\bis\?/i],
    ["do not forget to", /\bdo not forget to\b/i],
    ["provide us with", /\bprovide (us|me|them|you) with\b/i],
    ["wanted to reach out", /\bwanted to reach out\b/i],
    ["just to give", /^just to\b/i],
    ["the question of who/what", /\bthe question of (who|what|whether|how)\b/i]
  ] }
];
var PATTERNS = FAMILIES.flatMap(
  (entry) => entry.patterns.map(([name, pattern]) => ({ family: entry.family, name, pattern }))
);
function checkGate(sentence) {
  for (const { family, name, pattern } of PATTERNS) {
    if (pattern.test(sentence)) return { family, name };
  }
  return null;
}

// src/clarity-rules.mjs
var DETERMINER = "(?:the|a|an|this|that|these|those|our|your|their|his|her|its|my)";
var OF_KEEPERS = new RegExp(`^\\s+(?:${DETERMINER.slice(3, -1)}|us|them|you|it|both|each)\\b`, "iu");
var OPENER_FOLLOWERS = "(?:the|a|an|this|these|those|that|our|your|their|his|her|its|my|we|i|it|they|he|she|you|there|no|every|each|all|some|most|many|one)";
var IN_ORDER_PREDICATE = /(?:\b(?:is|are|was|were|am|be|been|being|seem|seems|seemed|look|looks|looked|appear|appears|appeared|remain|remains|remained)\s+$)|(?:\b(?:put|puts|putting|keep|keeps|keeping|set|sets|setting|get|gets|getting|got)\b[^,.;:]*$)/iu;
var RULES = [
  // The Limatum rules that survived the review, verbatim.
  { id: "due-to-the-fact-that", phrase: "due to the fact that", replacement: "because", reason: "\u201CDue to the fact that\u201D is a long way of saying \u201Cbecause\u201D." },
  { id: "in-spite-of-the-fact-that", phrase: "in spite of the fact that", replacement: "although", reason: "\u201CIn spite of the fact that\u201D is a long way of saying \u201Calthough\u201D." },
  { id: "at-this-point-in-time", phrase: "at this point in time", replacement: "now", reason: "\u201CAt this point in time\u201D is a long way of saying \u201Cnow\u201D." },
  { id: "in-order-to", phrase: "in order to", replacement: "to", blockedBefore: IN_ORDER_PREDICATE, reason: "\u201CIn order to\u201D says no more than \u201Cto\u201D." },
  { id: "in-order-for", phrase: "in order for", replacement: "for", blockedBefore: IN_ORDER_PREDICATE, reason: "\u201CIn order for\u201D says no more than \u201Cfor\u201D." },
  { id: "has-the-ability-to", phrase: "has the ability to", replacement: "can", reason: "\u201CHas the ability to\u201D is a long way of saying \u201Ccan\u201D." },
  { id: "have-the-ability-to", phrase: "have the ability to", replacement: "can", reason: "\u201CHave the ability to\u201D is a long way of saying \u201Ccan\u201D." },
  { id: "for-the-purpose-of", phrase: "for the purpose of", replacement: "for", reason: "\u201CFor the purpose of\u201D says no more than \u201Cfor\u201D." },
  // "the near future of X" is the literal noun: "interested in the near future of AI"
  // must not become "interested soon of AI".
  { id: "in-the-near-future", phrase: "in the near future", lookahead: "(?!\\s+of\\b)", replacement: "soon", reason: "\u201CIn the near future\u201D is a long way of saying \u201Csoon\u201D." },
  { id: "revert-back", phrase: "revert back", replacement: "revert", reason: "To revert is already to go back." },
  { id: "based-off-of", phrase: "based off of", replacement: "based on", reason: "The usual form is \u201Cbased on\u201D." },
  { id: "very-unique", phrase: "very unique", replacement: "unique", reason: "Unique is not a matter of degree." },
  { id: "completely-identical", phrase: "completely identical", replacement: "identical", reason: "Identical is already complete." },
  { id: "absolutely-essential", phrase: "absolutely essential", replacement: "essential", reason: "Essential is already absolute." },
  // Quantity phrases keep the "of" when object position demands it.
  { id: "a-large-number-of", phrase: "a large number of", replacement: (after) => OF_KEEPERS.test(after) ? "many of" : "many", reason: "\u201CA large number of\u201D is a long way of saying \u201Cmany\u201D." },
  { id: "the-majority-of", phrase: "the majority of", replacement: (after) => OF_KEEPERS.test(after) ? "most of" : "most", reason: "\u201CThe majority of\u201D is a long way of saying \u201Cmost\u201D." },
  // Mined from the harvested Grammarly corpus.
  { id: "on-account-of-the-fact-that", phrase: "on account of the fact that", replacement: "because", reason: "\u201COn account of the fact that\u201D is a long way of saying \u201Cbecause\u201D." },
  { id: "in-light-of-the-fact-that", phrase: "in light of the fact that", replacement: "because", reason: "\u201CIn light of the fact that\u201D is a long way of saying \u201Cbecause\u201D." },
  // After deal/end/start/begin the string is verb + "with" + the literal noun
  // "exception": "dealt with the exception of type ValueError" is about an exception.
  { id: "with-the-exception-of", phrase: "with the exception of", blockedBefore: /\b(?:deal|deals|dealt|dealing|cope|copes|coped|coping|end|ends|ended|ending|start|starts|started|starting|begin|begins|began|beginning)\s+$/iu, replacement: "except for", reason: "\u201CWith the exception of\u201D is a long way of saying \u201Cexcept for\u201D." },
  { id: "in-the-vicinity-of", phrase: "in the vicinity of", replacement: "near", reason: "\u201CIn the vicinity of\u201D is a long way of saying \u201Cnear\u201D." },
  { id: "for-a-period-of", phrase: "for a period of", lookahead: "(?!\\s+time\\b)", replacement: "for", reason: "\u201CFor a period of\u201D says no more than \u201Cfor\u201D." },
  { id: "makes-mention-of", phrase: "makes mention of", replacement: "mentions", reason: "\u201CMakes mention of\u201D is a long way of saying \u201Cmentions\u201D." },
  { id: "make-mention-of", phrase: "make mention of", replacement: "mention", reason: "\u201CMake mention of\u201D is a long way of saying \u201Cmention\u201D." },
  { id: "made-mention-of", phrase: "made mention of", replacement: "mentioned", reason: "\u201CMade mention of\u201D is a long way of saying \u201Cmentioned\u201D." },
  { id: "gives-approval-to", phrase: "gives approval to", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "approves", reason: "\u201CGives approval to\u201D is a long way of saying \u201Capproves\u201D." },
  { id: "give-approval-to", phrase: "give approval to", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "approve", reason: "\u201CGive approval to\u201D is a long way of saying \u201Capprove\u201D." },
  { id: "gave-approval-to", phrase: "gave approval to", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "approved", reason: "\u201CGave approval to\u201D is a long way of saying \u201Capproved\u201D." },
  { id: "gives-consideration-to", phrase: "gives consideration to", replacement: "considers", reason: "\u201CGives consideration to\u201D is a long way of saying \u201Cconsiders\u201D." },
  { id: "give-consideration-to", phrase: "give consideration to", replacement: "consider", reason: "\u201CGive consideration to\u201D is a long way of saying \u201Cconsider\u201D." },
  { id: "gave-consideration-to", phrase: "gave consideration to", replacement: "considered", reason: "\u201CGave consideration to\u201D is a long way of saying \u201Cconsidered\u201D." },
  { id: "makes-use-of", phrase: "makes use of", replacement: "uses", reason: "\u201CMakes use of\u201D is a long way of saying \u201Cuses\u201D." },
  { id: "make-use-of", phrase: "make use of", replacement: "use", reason: "\u201CMake use of\u201D is a long way of saying \u201Cuse\u201D." },
  { id: "made-use-of", phrase: "made use of", replacement: "used", reason: "\u201CMade use of\u201D is a long way of saying \u201Cused\u201D." },
  { id: "provides-a-description-of", phrase: "provides a description of", replacement: "describes", reason: "\u201CProvides a description of\u201D is a long way of saying \u201Cdescribes\u201D." },
  { id: "provide-a-description-of", phrase: "provide a description of", replacement: "describe", reason: "\u201CProvide a description of\u201D is a long way of saying \u201Cdescribe\u201D." },
  { id: "provided-a-description-of", phrase: "provided a description of", replacement: "described", reason: "\u201CProvided a description of\u201D is a long way of saying \u201Cdescribed\u201D." },
  { id: "carries-out-a-review-of", phrase: "carries out a review of", replacement: "reviews", reason: "\u201CCarries out a review of\u201D is a long way of saying \u201Creviews\u201D." },
  { id: "carry-out-a-review-of", phrase: "carry out a review of", replacement: "review", reason: "\u201CCarry out a review of\u201D is a long way of saying \u201Creview\u201D." },
  { id: "carried-out-a-review-of", phrase: "carried out a review of", replacement: "reviewed", reason: "\u201CCarried out a review of\u201D is a long way of saying \u201Creviewed\u201D." },
  // "puts" is unambiguously third-person present; bare "put" is base, past and
  // participle at once, and is deliberately absent — "will proposed" is not a fix.
  { id: "puts-forward-a-proposal-for", phrase: "puts forward a proposal for", replacement: "proposes", reason: "\u201CPuts forward a proposal for\u201D is a long way of saying \u201Cproposes\u201D." },
  { id: "is-able-to", phrase: "is able to", replacement: "can", reason: "\u201CIs able to\u201D is a long way of saying \u201Ccan\u201D." },
  { id: "are-able-to", phrase: "are able to", replacement: "can", reason: "\u201CAre able to\u201D is a long way of saying \u201Ccan\u201D." },
  { id: "has-the-capability-to", phrase: "has the capability to", replacement: "can", reason: "\u201CHas the capability to\u201D is a long way of saying \u201Ccan\u201D." },
  { id: "have-the-capability-to", phrase: "have the capability to", replacement: "can", reason: "\u201CHave the capability to\u201D is a long way of saying \u201Ccan\u201D." },
  // Second pass over the phrase list in docs/GRAMMARLY-BEHAVIOUR.md §1, held to the same
  // bar. What that list contains and this file still does not is recorded at the bottom.
  { id: "prior-to", phrase: "prior to", replacement: "before", reason: "\u201CPrior to\u201D is a long way of saying \u201Cbefore\u201D." },
  { id: "in-close-proximity-to", phrase: "in close proximity to", replacement: "near", reason: "\u201CIn close proximity to\u201D is a long way of saying \u201Cnear\u201D." },
  { id: "each-and-every", phrase: "each and every", replacement: "every", reason: "\u201CEach and every\u201D says no more than \u201Cevery\u201D." },
  { id: "as-to-whether", phrase: "as to whether", replacement: "whether", reason: "\u201CAs to whether\u201D says no more than \u201Cwhether\u201D." },
  { id: "all-in-all", phrase: "all in all", replacement: "overall", reason: "\u201CAll in all\u201D is a long way of saying \u201Coverall\u201D." },
  // "the present moment of impact" is the literal noun, as "the near future of AI" is.
  { id: "at-the-present-moment", phrase: "at the present moment", lookahead: "(?!\\s+of\\b)", replacement: "now", reason: "\u201CAt the present moment\u201D is a long way of saying \u201Cnow\u201D." },
  { id: "at-the-present-time", phrase: "at the present time", lookahead: "(?!\\s+of\\b)", replacement: "now", reason: "\u201CAt the present time\u201D is a long way of saying \u201Cnow\u201D." },
  // A determiner has to follow, or "the course" is a course: "during the course of
  // Chemistry 101" is about a course, "during the course of the year" is about a year.
  { id: "during-the-course-of", phrase: "during the course of", lookahead: `(?=\\s+${DETERMINER}\\b)`, replacement: "during", reason: "\u201CDuring the course of\u201D says no more than \u201Cduring\u201D." },
  { id: "on-a-daily-basis", phrase: "on a daily basis", replacement: "daily", reason: "\u201COn a daily basis\u201D is a long way of saying \u201Cdaily\u201D." },
  { id: "on-a-weekly-basis", phrase: "on a weekly basis", replacement: "weekly", reason: "\u201COn a weekly basis\u201D is a long way of saying \u201Cweekly\u201D." },
  { id: "on-a-monthly-basis", phrase: "on a monthly basis", replacement: "monthly", reason: "\u201COn a monthly basis\u201D is a long way of saying \u201Cmonthly\u201D." },
  { id: "on-a-quarterly-basis", phrase: "on a quarterly basis", replacement: "quarterly", reason: "\u201COn a quarterly basis\u201D is a long way of saying \u201Cquarterly\u201D." },
  { id: "on-a-yearly-basis", phrase: "on a yearly basis", replacement: "yearly", reason: "\u201COn a yearly basis\u201D is a long way of saying \u201Cyearly\u201D." },
  { id: "on-an-annual-basis", phrase: "on an annual basis", replacement: "annually", reason: "\u201COn an annual basis\u201D is a long way of saying \u201Cannually\u201D." },
  { id: "on-a-regular-basis", phrase: "on a regular basis", replacement: "regularly", reason: "\u201COn a regular basis\u201D is a long way of saying \u201Cregularly\u201D." },
  // The gerund is what makes the deletion safe: "is in the process of migrating" -> "is
  // migrating" keeps the aspect the auxiliary already carried.
  { id: "is-in-the-process-of", phrase: "is in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "is", reason: "\u201CIs in the process of\u201D says no more than the verb it introduces." },
  { id: "are-in-the-process-of", phrase: "are in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "are", reason: "\u201CAre in the process of\u201D says no more than the verb it introduces." },
  { id: "was-in-the-process-of", phrase: "was in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "was", reason: "\u201CWas in the process of\u201D says no more than the verb it introduces." },
  { id: "were-in-the-process-of", phrase: "were in the process of", lookahead: "(?=\\s+\\w+ing\\b)", replacement: "were", reason: "\u201CWere in the process of\u201D says no more than the verb it introduces." },
  // The rest of the light-verb family already represented above by "carries out a review
  // of" and "makes use of". Each keeps its three tensed forms, because the short form has
  // to carry the tense the light verb was carrying.
  { id: "conducts-an-investigation-into", phrase: "conducts an investigation into", replacement: "investigates", reason: "\u201CConducts an investigation into\u201D is a long way of saying \u201Cinvestigates\u201D." },
  { id: "conduct-an-investigation-into", phrase: "conduct an investigation into", replacement: "investigate", reason: "\u201CConduct an investigation into\u201D is a long way of saying \u201Cinvestigate\u201D." },
  { id: "conducted-an-investigation-into", phrase: "conducted an investigation into", replacement: "investigated", reason: "\u201CConducted an investigation into\u201D is a long way of saying \u201Cinvestigated\u201D." },
  { id: "makes-an-assessment-of", phrase: "makes an assessment of", replacement: "assesses", reason: "\u201CMakes an assessment of\u201D is a long way of saying \u201Cassesses\u201D." },
  { id: "make-an-assessment-of", phrase: "make an assessment of", replacement: "assess", reason: "\u201CMake an assessment of\u201D is a long way of saying \u201Cassess\u201D." },
  { id: "made-an-assessment-of", phrase: "made an assessment of", replacement: "assessed", reason: "\u201CMade an assessment of\u201D is a long way of saying \u201Cassessed\u201D." },
  { id: "undertakes-a-comparison-of", phrase: "undertakes a comparison of", replacement: "compares", reason: "\u201CUndertakes a comparison of\u201D is a long way of saying \u201Ccompares\u201D." },
  { id: "undertake-a-comparison-of", phrase: "undertake a comparison of", replacement: "compare", reason: "\u201CUndertake a comparison of\u201D is a long way of saying \u201Ccompare\u201D." },
  { id: "undertook-a-comparison-of", phrase: "undertook a comparison of", replacement: "compared", reason: "\u201CUndertook a comparison of\u201D is a long way of saying \u201Ccompared\u201D." },
  { id: "performs-the-validation-of", phrase: "performs the validation of", replacement: "validates", reason: "\u201CPerforms the validation of\u201D is a long way of saying \u201Cvalidates\u201D." },
  { id: "perform-the-validation-of", phrase: "perform the validation of", replacement: "validate", reason: "\u201CPerform the validation of\u201D is a long way of saying \u201Cvalidate\u201D." },
  { id: "performed-the-validation-of", phrase: "performed the validation of", replacement: "validated", reason: "\u201CPerformed the validation of\u201D is a long way of saying \u201Cvalidated\u201D." },
  { id: "results-in-the-reduction-of", phrase: "results in the reduction of", replacement: "reduces", reason: "\u201CResults in the reduction of\u201D is a long way of saying \u201Creduces\u201D." },
  { id: "result-in-the-reduction-of", phrase: "result in the reduction of", replacement: "reduce", reason: "\u201CResult in the reduction of\u201D is a long way of saying \u201Creduce\u201D." },
  { id: "resulted-in-the-reduction-of", phrase: "resulted in the reduction of", replacement: "reduced", reason: "\u201CResulted in the reduction of\u201D is a long way of saying \u201Creduced\u201D." }
];
var OPENERS = [
  { id: "it-should-be-noted-that", pattern: new RegExp(`^it should be noted that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "\u201CIt should be noted that\u201D delays the point without adding to it." },
  { id: "it-is-worth-noting-that", pattern: new RegExp(`^it is worth noting that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "\u201CIt is worth noting that\u201D delays the point without adding to it." },
  { id: "it-is-important-to-note-that", pattern: new RegExp(`^it is important to note that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "\u201CIt is important to note that\u201D delays the point without adding to it." },
  { id: "it-is-worth-mentioning-that", pattern: new RegExp(`^it is worth mentioning that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "\u201CIt is worth mentioning that\u201D delays the point without adding to it." },
  { id: "it-must-be-noted-that", pattern: new RegExp(`^it must be noted that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "\u201CIt must be noted that\u201D delays the point without adding to it." },
  { id: "please-note-that", pattern: new RegExp(`^please note that\\s+(?=${OPENER_FOLLOWERS}\\b)`, "iu"), reason: "\u201CPlease note that\u201D delays the point without adding to it." }
];
var escape = (phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
var compiled = RULES.map((rule) => ({
  ...rule,
  // \p{Pd}, not "-": editors substitute Unicode hyphens (U+2010, U+2011) into
  // compounds, and those glued the phrase into "revert back‑end" all the same.
  pattern: new RegExp(`(?<!\\p{Pd})\\b${escape(rule.phrase)}\\b(?!\\p{Pd})${rule.lookahead ?? ""}`, "giu")
}));
function matchCase(matched, replacement) {
  return /^\p{Lu}/u.test(matched) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}
function applyClarityRules(sentence) {
  let replacement = sentence;
  let reason = null;
  for (const opener of OPENERS) {
    const applied = replacement.replace(opener.pattern, "");
    if (applied === replacement) continue;
    replacement = applied.charAt(0).toUpperCase() + applied.slice(1);
    if (!reason) reason = opener.reason;
  }
  for (const rule of compiled) {
    const applied = replacement.replace(rule.pattern, (matched, ...rest) => {
      const offset = rest[rest.length - 2];
      const full = rest[rest.length - 1];
      const before = full.slice(0, offset);
      const clauseStart = Math.max(
        before.lastIndexOf(","),
        before.lastIndexOf("."),
        before.lastIndexOf(";"),
        before.lastIndexOf(":")
      );
      if (rule.blockedBefore && rule.blockedBefore.test(before.slice(clauseStart + 1))) {
        return matched;
      }
      const target = typeof rule.replacement === "function" ? rule.replacement(full.slice(offset + matched.length)) : rule.replacement;
      return matchCase(matched, target);
    });
    if (applied === replacement) continue;
    replacement = applied;
    if (!reason) reason = rule.reason;
  }
  if (!reason || replacement === sentence) return null;
  return { replacement, reason };
}
function fnv(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}
var RULES_SIGNATURE = fnv(JSON.stringify([
  RULES.map((rule) => [rule.id, rule.phrase, String(rule.replacement), rule.lookahead ?? "", String(rule.blockedBefore ?? "")]),
  OPENERS.map((opener) => [opener.id, String(opener.pattern)]),
  // Behaviour-bearing constants a function replacement only names: a change to these
  // changes answers, so a cache written under other values must not survive it.
  [String(OF_KEEPERS), DETERMINER, OPENER_FOLLOWERS]
]));

// src/explain.mjs
var ARTICLES = /* @__PURE__ */ new Set(["a", "an", "the"]);
var AGREEMENT_FORMS = /* @__PURE__ */ new Set([
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "does",
  "do",
  "did",
  "needs",
  "need",
  "requires",
  "require",
  "works",
  "work",
  "sign",
  "signs"
]);
var quote = (text) => `\u201C${text}\u201D`;
function isConfusablePair(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return CONFUSABLES.some(([x, y]) => a === x && b === y || a === y && b === x);
}
function sameStem(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a !== b && (a.startsWith(b) || b.startsWith(a) || a.slice(0, 4) === b.slice(0, 4));
}
function editGroups(source, replacement) {
  const ops = diffWords(source, replacement);
  const runs = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].type !== "equal") end += 1;
    runs.push({ start: index, end });
    index = end;
  }
  const groups = [];
  for (const run of runs) {
    const previous = groups[groups.length - 1];
    if (previous && run.start - previous.end <= 1) previous.end = run.end;
    else groups.push({ ...run });
  }
  return groups.map((group) => {
    const span = ops.slice(group.start, group.end);
    const removed = span.filter((op) => op.type === "delete").map((op) => op.source.text);
    const added = span.filter((op) => op.type === "insert").map((op) => op.target.text);
    const sourceTokens = span.filter((op) => op.source).map((op) => op.source);
    const targetTokens = span.filter((op) => op.target).map((op) => op.target);
    const slice = (text, tokens) => tokens.length ? text.slice(tokens[0].start, tokens[tokens.length - 1].end) : "";
    const neighbour = (op) => op && op.type === "equal" ? op.source.text : "";
    return {
      removed,
      added,
      merged: group.end - group.start > span.filter((op) => op.type !== "equal").length,
      sourceSpan: slice(source, sourceTokens),
      targetSpan: slice(replacement, targetTokens),
      beforeWord: neighbour(ops[group.start - 1]),
      afterWord: neighbour(ops[group.end])
    };
  });
}
var capitals = (word) => (word.match(/\p{Lu}/gu) ?? []).length;
function capitalisationChanges(source, replacement) {
  const raised = [];
  const lowered = [];
  for (const op of diffWords(source, replacement)) {
    if (op.type !== "equal") continue;
    const before = op.source.text;
    const after = op.target.text;
    if (before !== after && before.toLowerCase() === after.toLowerCase()) {
      (capitals(after) >= capitals(before) ? raised : lowered).push(after);
    }
  }
  return { raised, lowered };
}
function describeRun({ removed, added, merged, sourceSpan, targetSpan, beforeWord, afterWord }) {
  if (merged) {
    if (!targetSpan) return `removes ${quote(sourceSpan)}`;
    if (targetSpan.length < sourceSpan.length) return `shortens ${quote(sourceSpan)} to ${quote(targetSpan)}`;
    return `changes ${quote(sourceSpan)} to ${quote(targetSpan)}`;
  }
  if (removed.length && !added.length) {
    const doubled = removed.every((word) => INTENSIFIERS.has(word.toLowerCase())) && [beforeWord, afterWord].some((word) => INTENSIFIERS.has(word.toLowerCase()));
    if (doubled) {
      return `removes ${quote(sourceSpan)}, which repeats the word beside it`;
    }
    return `removes ${quote(sourceSpan)}`;
  }
  if (added.length && !removed.length) {
    if (added.length === 1 && /^[^\p{L}\p{N}]+$/u.test(added[0])) {
      return added[0] === "," ? "adds a comma" : `adds ${quote(targetSpan)}`;
    }
    if (added.length === 1 && ARTICLES.has(added[0].toLowerCase())) {
      return `adds the missing article ${quote(targetSpan)}`;
    }
    return `adds ${quote(targetSpan)}`;
  }
  if (removed.length === 1 && added.length === 1) {
    const [from] = removed;
    const [to] = added;
    if (from.toLowerCase() === to.toLowerCase()) {
      return capitals(to) >= capitals(from) ? `capitalizes ${quote(targetSpan)}` : `lowercases ${quote(targetSpan)}`;
    }
    if (isConfusablePair(from, to)) return `corrects ${quote(sourceSpan)} to ${quote(targetSpan)}`;
    if (AGREEMENT_FORMS.has(from.toLowerCase()) && AGREEMENT_FORMS.has(to.toLowerCase())) {
      return `changes ${quote(sourceSpan)} to ${quote(targetSpan)} to match the subject`;
    }
    if (sameStem(from, to)) return `changes ${quote(sourceSpan)} to ${quote(targetSpan)}`;
    return `replaces ${quote(sourceSpan)} with ${quote(targetSpan)}`;
  }
  if (removed.length > added.length && targetSpan.length < sourceSpan.length) {
    return `shortens ${quote(sourceSpan)} to ${quote(targetSpan)}`;
  }
  return `replaces ${quote(sourceSpan)} with ${quote(targetSpan)}`;
}
function explainEdit(source, replacement) {
  const groups = editGroups(source, replacement);
  const parts = groups.slice(0, 3).map(describeRun);
  const { raised, lowered } = capitalisationChanges(source, replacement);
  const names = (words) => {
    const quoted = words.map(quote);
    return quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  };
  if (raised.length) parts.push(`capitalizes ${names(raised)}`);
  if (lowered.length) parts.push(`lowercases ${names(lowered)}`);
  if (!parts.length) return "";
  if (groups.length > 3) parts.push(`makes ${groups.length - 3} further small changes`);
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

// src/pipeline.mjs
function describe(source, replacement, mechanical) {
  const derived = explainEdit(source, replacement);
  if (derived) return derived;
  return mechanical?.reason ?? "";
}
function ruleRewriteSafe(source, replacement, protectedTerms) {
  const before = markupTokens(source);
  const after = markupTokens(replacement);
  if (before.length !== after.length || before.some((token, index) => token !== after[index])) return false;
  const protectedBefore = protectedTokens(source, protectedTerms);
  const protectedAfter = protectedTokens(replacement, protectedTerms);
  return protectedBefore.length === protectedAfter.length && protectedBefore.every((token, index) => token === protectedAfter[index]);
}
var NEVER_VERIFY = /* @__PURE__ */ new Set(["twice", "once", "thrice", "repeatedly", "rarely", "frequently", "again"]);
async function analyzeSentence(sentence, { engine, signal, mechanics = true, verify = true, deletionPolicy = "verify", protectedTerms = [], gate = false, rules = false } = {}) {
  const mechanical = mechanics ? repairMechanics(sentence) : null;
  const base = mechanical?.replacement ?? sentence;
  let ruleFix = null;
  const result = {
    source: sentence,
    replacement: null,
    reason: null,
    // derived from the diff, shown to the writer
    modelReason: null,
    // what the model said it did, kept for diagnostics only
    stages: { mechanics: Boolean(mechanical), rule: false, model: false },
    gated: false,
    // the gate cleared the sentence, so the model was never asked
    rejection: null,
    // why this sentence got nothing; null whenever something surfaced
    modelRejection: null,
    // why the model's own rewrite was refused, whatever else surfaced
    rejectedText: null,
    latencyMs: 0,
    error: null
  };
  function unshowable(replacement) {
    if (replacement.trim() === sentence.trim()) return "unchanged";
    if (changedSourceRanges(sentence, replacement).length === 0) return "invisible-edit";
    return null;
  }
  function fallback() {
    if (ruleFix) {
      result.replacement = ruleFix.replacement;
      result.reason = ruleFix.reason;
      result.stages.rule = true;
      return result;
    }
    if (!mechanical || unshowable(base)) return result;
    result.replacement = base;
    result.reason = describe(sentence, base, mechanical);
    return result;
  }
  function refuse(reason, rejectedText) {
    result.modelRejection = reason;
    result.rejectedText = rejectedText;
    fallback();
    if (!result.replacement) result.rejection = reason;
    return result;
  }
  if (rules) {
    const ruled = applyClarityRules(base);
    if (ruled && ruleRewriteSafe(base, ruled.replacement, protectedTerms) && !unshowable(ruled.replacement)) {
      ruleFix = ruled;
    }
  }
  if (!engine) return fallback();
  if (gate && !checkGate(base)) {
    result.gated = true;
    return fallback();
  }
  let decision;
  try {
    decision = await engine.rewrite(base, { signal });
    result.latencyMs = decision.latencyMs ?? 0;
  } catch (error) {
    if (error?.kind === "aborted" || signal?.aborted) throw error;
    result.error = { kind: error.kind ?? "failed", message: error.message };
    return fallback();
  }
  if (decision.action === "rewrite") {
    const validation = validateRewrite(base, decision, { protectedTerms });
    const lost = validation.accepted ? lostContentWords(base, validation.replacement) : [];
    const countLost = lost.some((word) => NEVER_VERIFY.has(word.toLowerCase()));
    const conjunctLost = dropsConjunct(base, validation.replacement, lost);
    const repeatLost = dropsRepeatedWord(base, validation.replacement, lost);
    const deadlineLost = deadlineNarrowed(base, validation.replacement, lost);
    const scopeLost = validation.accepted && dropsScopeWord(base, validation.replacement);
    const refuseOutright = countLost || conjunctLost || repeatLost || deadlineLost || scopeLost || (deletionPolicy === "refuse" ? lost.length > 0 : lost.length > 1 || lost.length === 1 && deletesTrailingPhrase(base, validation.replacement));
    if (validation.accepted && refuseOutright) {
      result.lostWords = lost;
      return refuse("information-dropped", validation.replacement);
    }
    if (validation.accepted && verify && engine.verify && lost.length > 0) {
      let verdict;
      try {
        verdict = await engine.verify(base, validation.replacement, { signal, lost });
      } catch (error) {
        if (error?.kind === "aborted" || signal?.aborted) throw error;
        verdict = { verdict: "unavailable", reason: error.message };
      }
      result.lostWords = lost;
      if (verdict.verdict === "unavailable") {
        if (verdict.kind === "aborted" || signal?.aborted) {
          throw Object.assign(new Error(verdict.reason || "Request superseded"), { kind: "aborted" });
        }
        result.error = { kind: "verifier-unavailable", cause: verdict.kind ?? "transient", message: verdict.reason };
        result.verifierReason = verdict.reason;
        return refuse("verifier-unavailable", validation.replacement);
      }
      if (verdict.verdict === "hide") {
        result.verifierReason = verdict.reason;
        return refuse("verifier-hidden", validation.replacement);
      }
    }
    if (validation.accepted) {
      const hidden = unshowable(validation.replacement);
      if (hidden) return refuse(hidden, validation.replacement);
      result.replacement = validation.replacement;
      result.modelReason = decision.reason;
      result.reason = describe(sentence, validation.replacement, mechanical);
      result.stages.model = true;
      return result;
    }
    return refuse(validation.reason, decision.replacement);
  }
  return fallback();
}

// src/clarity-prompt.txt
var clarity_prompt_default = `You are the decision engine for blue-underline clarity suggestions in an English text editor. Evaluate exactly one completed sentence. Return a rewrite when the sentence has a specific, objective clarity or correctness problem; return keep when it is already clear. Correct grammar does not make wording clear: a sentence can be perfectly grammatical and still be redundant, inflated, or needlessly indirect.

Run every check before deciding keep:

1. DIRECT VERB. A weak verb (make, give, provide, perform, conduct, carry out, reach, raise, offer, undertake, hold) followed by an abstract noun is almost always a hidden verb. Use the ordinary verb when the meaning is unchanged: reached a conclusion -> concluded; conducted an analysis -> analyzed; gave an explanation -> explained; provided an explanation of -> explained; gave an indication that -> indicated; made a recommendation -> recommended; performed an inspection -> inspected; raised the question whether -> asked whether; offered a suggestion -> suggested.
2. INFLATED PHRASE. Shorten conventional wordy phrases: is able to -> can; has a tendency to -> tends to; on a weekly basis -> weekly; at a later point in time -> later; in close proximity to -> near; due to the fact that -> because; in the event that -> if; for the purpose of -> to; there are several reasons why X cannot Y -> X cannot Y for several reasons. When the phrase carries a hedge, shorten the phrase but keep the hedge: "has a tendency to fail" becomes "tends to fail", never "fails".
3. REDUNDANCY. Two words that carry the same meaning are redundant even when the phrase sounds completely normal and idiomatic, and familiarity is not a reason to keep one. Test each word: read the sentence without it, and if nothing at all is lost, it was redundant. Remove a word only when another word already carries its meaning: each and every -> each; first and foremost -> first; end result -> result; basic fundamentals -> fundamentals; unexpected surprise -> surprise; future plans -> plans (a plan is already about the future); past history -> history; advance warning -> warning; at the present time -> now; joined together -> joined; completely eliminated -> eliminated. Two intensifiers doing one job are redundant even when they sit apart in the sentence ("entirely removed it altogether"): keep the one that best preserves the original emphasis and drop the other.
4. INDIRECTNESS. Repair an empty opening (there is, there are, it is the case that), a buried subject, an awkward construction, an imprecise or confused word, or a locally repairable ambiguity, using a small conventional edit.
5. AGREEMENT. Find the real subject and check the verb against it, ignoring any words between them. A set, list, group, collection, bundle, series, batch, or number is singular even when followed by a plural noun: "The set of keys IS stored", "A bundle of forms IS missing". "Neither", "either", "each", "every one", and "none" normally take a singular verb: "Neither of the dates WORKS". Repair the verb alone; do not recast the sentence around it. Also check singular/plural consistency between a noun and the words that depend on it.
6. WORD CHOICE AND AGREEMENT ERRORS. Check that articles are present and correct, that a series is punctuated consistently, and that confused words are right (your/you're, its/it's, affect/effect, then/than, lead/led, to/too). Spacing and capitalization are repaired before you see the sentence, so do not comment on them.

Work through checks 1 to 6 against the actual words in front of you before you answer. Choose rewrite if a check finds a concrete problem with a small safe repair, and name the check that found it in the reason. Choose keep only after all six checks come back clean; when you choose keep, the reason must say which possibility you considered and ruled out. Never answer that a sentence is clear without having read it against every check. Do choose keep when the only available change would swap synonyms, reflect personal style, or need context you do not have.

Restraint and safety:

- Make the smallest useful edit. Preserve every word the problem does not touch.
- If you choose rewrite, the replacement must actually differ from the input. If you cannot write a different and better sentence, choose keep instead.
- Do not delete a time, cause, condition, contrast, purpose, or any other meaningful clause merely to shorten the sentence.
- Fix a punctuation, capitalization, or agreement error without recasting the rest of the sentence.
- Do not change voice, contractions, or word order unless doing so fixes the named problem.
- Do not replace an already precise word with a synonym. Do not rewrite a clear question, command, heading, or technical statement merely because another phrasing exists.
- Return one complete replacement sentence carrying the same terminal punctuation.
- Preserve every fact, name, number, date, unit, URL, citation, path, identifier, and technical term exactly.
- Preserve certainty, negation, tense, commitments, tone, and whether the input is a question.
- Never answer the input, add information, add a preamble, or put commentary in the replacement.

Examples:

Input: The coordinator made an assessment of the draft.
Output: {"action":"rewrite","replacement":"The coordinator assessed the draft.","reason":"Replaces a nominalization with a direct verb."}

Input: The archive is copied on a weekly basis.
Output: {"action":"rewrite","replacement":"The archive is copied weekly.","reason":"Shortens an inflated frequency phrase."}

Input: The final outcome was an unexpected surprise.
Output: {"action":"rewrite","replacement":"The outcome was a surprise.","reason":"Removes redundant wording."}

Input: A collection of signed forms are missing.
Output: {"action":"rewrite","replacement":"A collection of signed forms is missing.","reason":"Corrects subject-verb agreement."}

Input: There is a risk that the seal will fail.
Output: {"action":"rewrite","replacement":"The seal may fail.","reason":"Removes an empty opening construction."}

Input: your scheduled to inspect the valve on monday.
Output: {"action":"rewrite","replacement":"You're scheduled to inspect the valve on Monday.","reason":"Corrects a confused word and capitalization."}

Input: The test was brief , but it was complete.
Output: {"action":"rewrite","replacement":"The test was brief, but it was complete.","reason":"Removes the space before the comma."}

Input: Nora checked the seal twice before opening it.
Output: {"action":"keep","replacement":"","reason":"The temporal clause carries meaning and the sentence is clear."}

Input: Could the backup finish before noon?
Output: {"action":"keep","replacement":"","reason":"The question is already clear and direct."}

Input: The sensor records temperature every minute.
Output: {"action":"keep","replacement":"","reason":"The sentence is clear and direct."}

Input: Lina may deploy API_V2 at 14:30 UTC.
Output: {"action":"keep","replacement":"","reason":"The sentence is clear and preserves a qualified commitment."}

Output only one JSON object with exactly these fields: action ("keep" or "rewrite"), replacement (empty string for keep), and a short reason.
`;

// src/verifier-prompt.txt
var verifier_prompt_default = `An editing assistant proposed a change to one sentence, and that change REMOVES one or more words. You decide whether the writer loses anything by accepting it.

You are given the ORIGINAL sentence, the PROPOSED replacement, and the list of REMOVED WORDS. Consider only those removed words.

For each removed word, ask one question: does the rest of the proposed sentence still tell the reader what that word told them?

- If the word was already implied by another word that is still there, nothing is lost. "Each and every form" keeps its meaning as "each form". "Assembled together" keeps its meaning as "assembled". "Completely identical" keeps its meaning as "identical".
- If the word carried its own information, something is lost. A shape, a time, a place, a manner, a degree of hedging, a count, a repetition marker, a named thing, or any noun that named something real cannot be dropped. "During the launch phase" tells the reader when. "Pie-shaped" tells the reader the shape. "End of day" tells the reader how late. "Again" tells the reader this has happened before. "Twice" tells the reader how many times it happened. "Basically" tells the reader the claim is hedged.

Answer "hide" if any removed word carried its own information.
Answer "show" only if every removed word was already covered by a word that survives in the proposed sentence.

Examples:

ORIGINAL: The results of the test were completely and totally inconclusive.
PROPOSED: The results of the test were inconclusive.
REMOVED WORDS: completely, totally
{"verdict":"show","reason":"Both were intensifiers of the same idea."}

ORIGINAL: TDRS telemetry during the launch phase was transmitted by electrical cable.
PROPOSED: TDRS telemetry was transmitted by electrical cable.
REMOVED WORDS: launch, phase
{"verdict":"hide","reason":"Loses when the telemetry was transmitted."}

ORIGINAL: The crew reached a mutual agreement about the rota.
PROPOSED: The crew reached an agreement about the rota.
REMOVED WORDS: mutual
{"verdict":"show","reason":"An agreement is already mutual."}

ORIGINAL: The mockups won't be ready until end of day tomorrow.
PROPOSED: The mockups won't be ready until tomorrow.
REMOVED WORDS: end, day
{"verdict":"hide","reason":"Loses the time of day."}

ORIGINAL: We discussed our future plans for the archive.
PROPOSED: We discussed our plans for the archive.
REMOVED WORDS: future
{"verdict":"show","reason":"Plans are already about the future."}

ORIGINAL: Following up again on the budget approval from last week.
PROPOSED: Following up on the budget approval from last week.
REMOVED WORDS: again
{"verdict":"hide","reason":"Loses that this is a repeated request."}

ORIGINAL: He counted the coins twice and then pushed them across the table.
PROPOSED: He counted the coins and then pushed them across the table.
REMOVED WORDS: twice
{"verdict":"hide","reason":"Loses how many times he counted them."}

Output only one JSON object with exactly these fields: verdict ("show" or "hide") and a short reason.
`;

// obsidian-plugin/node-fetch.mjs
var import_node_http = __toESM(require("node:http"), 1);
var import_node_https = __toESM(require("node:https"), 1);
function nodeFetch(url, { method = "GET", headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject2) => {
    const abortReason = () => signal?.reason instanceof Error ? signal.reason : new Error("Request superseded");
    if (signal?.aborted) {
      reject2(abortReason());
      return;
    }
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject2(error);
      return;
    }
    const client = target.protocol === "https:" ? import_node_https.default : import_node_http.default;
    const request = client.request(
      {
        protocol: target.protocol,
        // WHATWG URL keeps an IPv6 literal bracketed; Node's http stack wants it bare,
        // and the bracketed form resolves as a DNS name ("getaddrinfo ENOTFOUND [::1]").
        hostname: target.hostname.replace(/^\[|\]$/gu, ""),
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: body ? { ...headers, "content-length": Buffer.byteLength(body) } : headers
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject2);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            text: async () => text,
            // Left to throw its own SyntaxError: engine.mjs distinguishes an unparseable
            // body from a broken connection, and flattening it here would lose that.
            json: async () => JSON.parse(text)
          });
        });
      }
    );
    const abort = () => {
      const reason = abortReason();
      request.destroy(reason);
      reject2(reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    request.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject2(error);
    });
    request.on("close", () => signal?.removeEventListener("abort", abort));
    if (body) request.write(body);
    request.end();
  });
}

// obsidian-plugin/underline.mjs
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");
var import_language = require("@codemirror/language");

// src/identity.mjs
var nextId = 1;
function reconcileSentences(previous, text) {
  const current = segmentSentences(text).map((segment) => {
    const trimmed = trimSegment(segment);
    return { ...trimmed, complete: isCompleteSentence(trimmed.text) };
  });
  const used = /* @__PURE__ */ new Set();
  const matched = /* @__PURE__ */ new Map();
  const assigned = current.map((segment) => ({ ...segment, id: null, changed: true }));
  const byText = /* @__PURE__ */ new Map();
  for (const candidate of previous) {
    const bucket = byText.get(candidate.text);
    if (bucket) bucket.push(candidate);
    else byText.set(candidate.text, [candidate]);
  }
  for (const [index, segment] of assigned.entries()) {
    const candidates = byText.get(segment.text);
    if (!candidates) continue;
    let best = null;
    for (const candidate of candidates) {
      if (used.has(candidate.id)) continue;
      const distance = Math.abs((candidate.start ?? 0) - (segment.start ?? 0));
      if (best === null || distance < best.distance) best = { candidate, distance };
    }
    if (best === null) continue;
    used.add(best.candidate.id);
    matched.set(index, best.candidate);
    assigned[index].id = best.candidate.id;
    assigned[index].changed = false;
  }
  for (const [index, segment] of assigned.entries()) {
    if (segment.id !== null) continue;
    const candidate = previous[index];
    if (candidate && !used.has(candidate.id)) {
      used.add(candidate.id);
      segment.id = candidate.id;
    }
  }
  const duplicated = /* @__PURE__ */ new Set();
  const orphaned = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of previous) {
    if (seen.has(candidate.text)) duplicated.add(candidate.text);
    seen.add(candidate.text);
    if (!used.has(candidate.id)) orphaned.add(candidate.text);
  }
  for (const [index, candidate] of matched) {
    if (!duplicated.has(candidate.text) || !orphaned.has(candidate.text)) continue;
    used.delete(candidate.id);
    assigned[index].id = null;
    assigned[index].changed = true;
  }
  for (const segment of assigned) {
    if (segment.id === null) segment.id = `s${nextId++}`;
  }
  return assigned;
}

// src/store.mjs
function createStore() {
  const suggestions = /* @__PURE__ */ new Map();
  const dismissed = /* @__PURE__ */ new Map();
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
    }
  };
}

// src/coordinator.mjs
function createCoordinator({ analyze, onResult = () => {
}, maxConcurrent = 2 } = {}) {
  const inFlight = /* @__PURE__ */ new Map();
  const queue = [];
  let running = 0;
  let disposed = false;
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
      id,
      revision,
      text,
      context,
      priority,
      controller: new AbortController(),
      queued: true,
      cancelled: false,
      released: false,
      settled: false
    };
    entry.promise = new Promise((resolve, reject2) => {
      entry.resolve = resolve;
      entry.reject = reject2;
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
      if (disposed || entry.cancelled || inFlight.get(id) !== entry) {
        release(entry);
        settle(entry, null);
        return;
      }
      inFlight.delete(id);
      release(entry);
      const result = { id, revision, text, outcome };
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
    if (existing && existing.text === text && JSON.stringify(existing.context) === JSON.stringify(context)) {
      if (existing.queued) existing.priority = priority;
      return existing.promise;
    }
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
    get pending() {
      return inFlight.size;
    },
    // queued and running
    get running() {
      return running;
    },
    dispose() {
      disposed = true;
      for (const entry of [...inFlight.values()]) cancel(entry);
      inFlight.clear();
      queue.length = 0;
    }
  };
}

// obsidian-plugin/markdown.mjs
var BLOCK_MARKER = /^(?:\s{0,3}(?:>+[ \t]*|\|[ \t]*|(?:#{1,6}|[-*+]|\d+[.)])[ \t]+)(?:\[[ xX]\][ \t]+)?)+/u;
var ESCAPE = /^\\([\\`*_{}[\]()#+\-.!~=|>])/u;
var EMBED_WIKI = /^!\[\[[^\]\n]*\]\]/u;
var EMBED_IMAGE = /^!\[[^\]\n]*\]\([^)\n]*\)/u;
var WIKILINK = /^\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/u;
var LINK = /^\[([^\]\n]*)\]\([^)\n]*\)/u;
var DELIMITER = /^(\*\*|__|\*|_|==|~~)/u;
var isSpace = (char) => char === void 0 || /\s/u.test(char);
var isAlphanumeric = (char) => char !== void 0 && /[\p{L}\p{N}]/u.test(char);
function isDelimiter(source, index, delimiter) {
  const before = source[index - 1];
  const after = source[index + delimiter.length];
  if (delimiter === "_" || delimiter === "__") {
    return !(isAlphanumeric(before) && isAlphanumeric(after));
  }
  return !(isSpace(before) && isSpace(after));
}
function inlineCodeSpan(rest) {
  const open = rest.match(/^`+/u)?.[0];
  if (!open) return null;
  let search = open.length;
  while (true) {
    const at = rest.indexOf(open, search);
    if (at === -1) return null;
    const run = rest.slice(at).match(/^`+/u)[0];
    if (run.length === open.length) {
      return { content: rest.slice(open.length, at), opener: open.length, length: at + open.length };
    }
    search = at + run.length;
  }
}
function flattenMarkdown(source) {
  const characters = [];
  const offsets = [];
  const protectedTerms = [];
  const escaped = /* @__PURE__ */ new Set();
  const openDelimiters = /* @__PURE__ */ new Map();
  const emit = (text, at) => {
    for (let index = 0; index < text.length; index += 1) {
      characters.push(text[index]);
      offsets.push(at + index);
    }
  };
  let cursor = source.match(BLOCK_MARKER)?.[0]?.length ?? 0;
  if (cursor >= source.length) cursor = 0;
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    if (cursor > 0 && source[cursor - 1] === "\n") {
      const marker = rest.match(BLOCK_MARKER)?.[0]?.length ?? 0;
      if (marker > 0) {
        cursor += marker;
        continue;
      }
    }
    const escapedChar = ESCAPE.exec(rest);
    if (escapedChar) {
      emit(escapedChar[1], cursor + 1);
      escaped.add(cursor + 1);
      cursor += escapedChar[0].length;
      continue;
    }
    const code = inlineCodeSpan(rest);
    if (code) {
      emit(code.content, cursor + code.opener);
      if (code.content.trim()) protectedTerms.push(code.content);
      cursor += code.length;
      continue;
    }
    const embed = EMBED_WIKI.exec(rest) ?? EMBED_IMAGE.exec(rest);
    if (embed) {
      cursor += embed[0].length;
      continue;
    }
    const wikilink = WIKILINK.exec(rest);
    if (wikilink) {
      const shownIndex = wikilink[2] === void 0 ? 1 : 2;
      const shown = wikilink[shownIndex];
      emit(shown, cursor + wikilink[0].indexOf(shown, shownIndex === 2 ? wikilink[0].indexOf("|") : 2));
      if (shown.trim()) protectedTerms.push(shown);
      cursor += wikilink[0].length;
      continue;
    }
    const link = LINK.exec(rest);
    if (link) {
      emit(link[1], cursor + 1);
      if (link[1].trim()) protectedTerms.push(link[1]);
      cursor += link[0].length;
      continue;
    }
    const delimiter = DELIMITER.exec(rest);
    if (delimiter && isDelimiter(source, cursor, delimiter[1])) {
      const mark = delimiter[1];
      const open = openDelimiters.get(mark) ?? 0;
      if (open > 0) {
        openDelimiters.set(mark, open - 1);
        cursor += mark.length;
        continue;
      }
      if (rest.indexOf(mark, mark.length) !== -1) {
        openDelimiters.set(mark, open + 1);
        cursor += mark.length;
        continue;
      }
      emit(mark, cursor);
      cursor += mark.length;
      continue;
    }
    emit(source[cursor], cursor);
    cursor += 1;
  }
  return { text: characters.join(""), offsets, escaped, protectedTerms, source };
}
function sourcePosition(projection, plainIndex) {
  if (projection.offsets.length === 0) return 0;
  if (plainIndex >= projection.offsets.length) {
    return projection.offsets[projection.offsets.length - 1] + 1;
  }
  return projection.offsets[Math.max(0, plainIndex)];
}
function sourceRuns(projection, from, to) {
  if (to <= from) {
    const at = sourcePosition(projection, from);
    return [{ from: at, to: at }];
  }
  const runs = [];
  for (let index = from; index < to && index < projection.offsets.length; index += 1) {
    const at = projection.offsets[index];
    const start = projection.escaped?.has(at) ? at - 1 : at;
    const last = runs[runs.length - 1];
    if (last && last.to >= start) last.to = at + 1;
    else runs.push({ from: start, to: at + 1 });
  }
  return runs;
}
function sourceEdits(projection, replacement) {
  const prose = projection.text;
  if (prose === replacement) return [];
  const edits = [];
  const push = (from, to, insert) => {
    if (from !== to || insert !== "") edits.push({ from, to, insert });
  };
  const MARKER_GAP = /^(?:[ \t]*>[ \t]*)+$/u;
  const replaceSpan = (start, end, insert) => {
    const runs = [];
    for (const run of sourceRuns(projection, start, end)) {
      const last = runs[runs.length - 1];
      const gap = last && projection.source ? projection.source.slice(last.to, run.from) : null;
      if (gap !== null && gap !== "" && MARKER_GAP.test(gap)) last.to = run.to;
      else runs.push({ ...run });
    }
    runs.forEach((run, index) => push(run.from, run.to, index === 0 ? insert : ""));
  };
  const kept = diffWords(prose, replacement).filter((op) => op.type === "equal");
  let prosePos = 0;
  let replacementPos = 0;
  for (const op of kept) {
    const proseGap = prose.slice(prosePos, op.source.start);
    const replacementGap = replacement.slice(replacementPos, op.target.start);
    if (proseGap !== replacementGap) replaceSpan(prosePos, op.source.start, replacementGap);
    if (op.source.text !== op.target.text) {
      replaceSpan(op.source.start, op.source.end, op.target.text);
    }
    prosePos = op.source.end;
    replacementPos = op.target.end;
  }
  if (prose.slice(prosePos) !== replacement.slice(replacementPos)) {
    replaceSpan(prosePos, prose.length, replacement.slice(replacementPos));
  }
  return edits;
}

// obsidian-plugin/controller.mjs
var HAS_LETTER = /\p{L}/u;
var CODE_FENCE = /^\s{0,3}(?:```|~~~)/mu;
function computeProjection(rawText) {
  if (CODE_FENCE.test(rawText)) {
    return { text: rawText, projection: { text: rawText, offsets: [], protectedTerms: [] }, complete: false };
  }
  const projection = flattenMarkdown(rawText);
  return { text: projection.text, projection, complete: isCompleteSentence(projection.text) };
}
function createController({
  analyze,
  onChange = () => {
  },
  debounceMs = 140,
  // Asked of every sentence on every sync. The editor owns this decision because only it
  // has the syntax tree; the controller only has to honour it, and has to re-ask rather
  // than cache, because wrapping a paragraph in a code fence excludes text that has not
  // itself changed.
  isExcluded = () => false,
  // Asked of every sentence before it is scheduled. CodeMirror draws no decorations
  // outside the viewport, so a sentence off screen buys a suggestion that cannot be
  // shown — and on a single-slot model server it buys it ahead of one that can.
  // Unlike exclusion this is not a judgement about the text: nothing already decided is
  // forgotten when it scrolls away, so coming back costs nothing.
  isVisible = () => true,
  // Priority for the coordinator's queue, lower first; null means document order. The
  // editor supplies one that puts on-screen sentences before the margins, because the
  // model has one slot and it should serve the reader's eyes.
  rank = null,
  // Injectable for tests; the failure cooldown is the only consumer.
  clock = () => Date.now(),
  // The deterministic pass, no model in it. Runs the moment a sentence's debounce fires,
  // so a mechanical repair is on screen in ~150ms while the model decision follows in
  // ~0.3-2s. The pipeline runs mechanics again inside the model pass, so the later
  // outcome already contains this repair — the provisional card is replaced, not stacked.
  analyzeLocal = null
} = {}) {
  const store = createStore();
  let rawSentences = [];
  let sentences = [];
  let projectionCache = /* @__PURE__ */ new Map();
  const failures2 = /* @__PURE__ */ new Map();
  const MAX_ATTEMPTS = 2;
  const BASE_HOLD_MS = 6e4;
  const MAX_HOLD_MS = 10 * 6e4;
  const COUNTED = /* @__PURE__ */ Symbol("failure-counted");
  function recordFailure(id, text2, kind, error) {
    if (error) {
      if (error[COUNTED]) return;
      error[COUNTED] = true;
    }
    let entry = failures2.get(id);
    if (!entry || entry.text !== text2) {
      entry = { text: text2, attempts: 0, max: MAX_ATTEMPTS, rounds: 0, heldUntil: 0 };
      failures2.set(id, entry);
    }
    if (kind === "failed") entry.max = Math.min(entry.max, entry.attempts + 1);
    entry.attempts += 1;
    if (entry.attempts >= entry.max) {
      entry.rounds += 1;
      entry.heldUntil = clock() + Math.min(BASE_HOLD_MS * 2 ** (entry.rounds - 1), MAX_HOLD_MS);
    }
  }
  function heldBack(id, text2) {
    const entry = failures2.get(id);
    if (!entry || entry.text !== text2 || entry.attempts < entry.max) return false;
    if (clock() >= entry.heldUntil) {
      entry.attempts = entry.max - 1;
      return false;
    }
    return true;
  }
  const analyzed = /* @__PURE__ */ new Map();
  const timers = /* @__PURE__ */ new Map();
  let text = "";
  let revision = 0;
  let inFlight = 0;
  let rejectedCount = 0;
  let lastError = null;
  let disposed = false;
  const coordinator = createCoordinator({
    analyze,
    // One, deliberately: the llama server has a single slot (-np 1), so a second
    // concurrent request only queues server-side while its own timeout burns, and a
    // request the coordinator still holds client-side can be withdrawn or re-ranked.
    maxConcurrent: 1,
    onResult: ({ id, text: requested, outcome }) => {
      failures2.delete(id);
      if (outcome.rejection) rejectedCount += 1;
      const sentence = sentences.find((candidate) => candidate.id === id);
      if (!sentence || sentence.text !== requested) return;
      analyzed.set(id, requested);
      if (store.isDismissed(id, requested)) return;
      if (!outcome.replacement || outcome.replacement === requested) {
        store.remove(id);
        onChange();
        return;
      }
      store.set({
        id,
        source: requested,
        replacement: outcome.replacement,
        reason: outcome.reason ?? "",
        stages: outcome.stages,
        start: sentence.start,
        end: sentence.end
      });
      onChange();
    }
  });
  function clearTimer(id) {
    const armed = timers.get(id);
    if (!armed) return;
    clearTimeout(armed.timer);
    timers.delete(id);
  }
  function scheduleAnalysis(sentence) {
    const armed = timers.get(sentence.id);
    if (armed && armed.text === sentence.text) return;
    if (armed) clearTimeout(armed.timer);
    const id = sentence.id;
    const armedText = sentence.text;
    const timer = setTimeout(async () => {
      timers.delete(id);
      if (disposed) return;
      const current = sentences.find((candidate) => candidate.id === id);
      if (!current || current.text !== armedText) return;
      if (analyzed.get(id) === current.text) return;
      if (store.isDismissed(id, current.text)) return;
      if (!isVisible(current)) return;
      if (heldBack(id, current.text)) return;
      if (analyzeLocal && !store.get(id)) {
        try {
          const local = await analyzeLocal(current.text, { protectedTerms: current.projection.protectedTerms });
          const fresh = sentences.find((candidate) => candidate.id === id);
          if (local?.replacement && local.replacement !== current.text && fresh && fresh.text === current.text && !store.isDismissed(id, current.text) && analyzed.get(id) !== current.text && !store.get(id)?.stages?.model) {
            store.set({
              id,
              source: current.text,
              replacement: local.replacement,
              reason: local.reason ?? "",
              stages: local.stages ?? { mechanics: true, model: false },
              start: fresh.start,
              end: fresh.end
            });
            onChange();
          }
        } catch {
        }
        if (disposed) return;
        const now = sentences.find((candidate) => candidate.id === id);
        if (!now || now.text !== armedText) return;
        if (analyzed.get(id) === now.text) return;
        if (store.isDismissed(id, now.text)) return;
        if (!isVisible(now)) return;
        if (heldBack(id, now.text)) return;
      }
      revision += 1;
      inFlight += 1;
      onChange();
      try {
        await coordinator.submit({
          id,
          revision,
          text: current.text,
          context: { protectedTerms: current.projection.protectedTerms },
          // Ranked at fire time, not arm time: the reader may have scrolled meanwhile.
          priority: rank ? rank(current) : 0
        });
        lastError = null;
      } catch (error) {
        lastError = `Local model unavailable: ${error.message}`;
        recordFailure(id, armedText, error.kind, error);
      } finally {
        inFlight -= 1;
        onChange();
      }
    }, debounceMs);
    timers.set(id, { timer, text: armedText });
  }
  function sync(nextText) {
    if (disposed) return;
    text = nextText;
    const known = new Set(sentences.map((sentence) => sentence.id));
    rawSentences = reconcileSentences(rawSentences, text);
    const nextCache = /* @__PURE__ */ new Map();
    sentences = rawSentences.map((raw) => {
      let cached = nextCache.get(raw.text) ?? projectionCache.get(raw.text);
      if (!cached) cached = computeProjection(raw.text);
      nextCache.set(raw.text, cached);
      return { ...raw, raw: raw.text, text: cached.text, projection: cached.projection, complete: cached.complete };
    });
    projectionCache = nextCache;
    store.reconcile(sentences);
    const live = new Set(sentences.map((sentence) => sentence.id));
    for (const id of [...analyzed.keys()]) if (!live.has(id)) analyzed.delete(id);
    for (const id of [...failures2.keys()]) if (!live.has(id)) failures2.delete(id);
    const dead = [];
    for (const id of /* @__PURE__ */ new Set([...known, ...timers.keys()])) {
      if (live.has(id)) continue;
      clearTimer(id);
      dead.push(id);
    }
    coordinator.withdraw(dead);
    schedulePass();
  }
  function schedulePass() {
    const withdrawn = [];
    const schedule = [];
    for (const sentence of sentences) {
      if (isExcluded(sentence) || !HAS_LETTER.test(sentence.text) || CODE_FENCE.test(sentence.raw)) {
        store.remove(sentence.id);
        analyzed.delete(sentence.id);
        clearTimer(sentence.id);
        withdrawn.push(sentence.id);
        continue;
      }
      if (!sentence.complete || !isVisible(sentence)) {
        clearTimer(sentence.id);
        withdrawn.push(sentence.id);
        continue;
      }
      if (analyzed.get(sentence.id) === sentence.text) continue;
      if (store.isDismissed(sentence.id, sentence.text)) continue;
      if (heldBack(sentence.id, sentence.text)) continue;
      schedule.push(sentence);
    }
    coordinator.withdraw(withdrawn);
    for (const sentence of schedule) scheduleAnalysis(sentence);
    if (lastError && inFlight === 0 && timers.size === 0 && coordinator.pending === 0) lastError = null;
    onChange();
  }
  function mapOffsets(mapPosition) {
    for (const sentence of rawSentences) {
      sentence.start = mapPosition(sentence.start, 1);
      sentence.end = mapPosition(sentence.end, -1);
    }
    for (const sentence of sentences) {
      sentence.start = mapPosition(sentence.start, 1);
      sentence.end = mapPosition(sentence.end, -1);
    }
  }
  function refresh() {
    if (disposed) return;
    schedulePass();
  }
  function marks() {
    const found = [];
    for (const suggestion of store.list()) {
      const sentence = sentences.find((candidate) => candidate.id === suggestion.id);
      if (!sentence || sentence.text !== suggestion.source) continue;
      for (const range of changedSourceRanges(suggestion.source, suggestion.replacement)) {
        for (const run of sourceRuns(sentence.projection, range.start, range.end)) {
          found.push({ id: suggestion.id, start: sentence.start + run.from, end: sentence.start + run.to });
        }
      }
    }
    return found.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function suggestionAt(position) {
    for (const mark of marks()) {
      if (position >= mark.start && position <= mark.end) {
        const suggestion = store.get(mark.id);
        if (suggestion) return { suggestion, mark };
      }
    }
    return null;
  }
  function accept(id) {
    const suggestion = store.get(id);
    const sentence = sentences.find((candidate) => candidate.id === id);
    if (!suggestion || !sentence || sentence.text !== suggestion.source) return null;
    const edits = sourceEdits(sentence.projection, suggestion.replacement).map((edit) => ({
      from: sentence.start + edit.from,
      to: sentence.start + edit.to,
      insert: edit.insert
    }));
    if (edits.length === 0) return null;
    store.remove(id);
    if (suggestion.stages?.model) analyzed.set(id, suggestion.replacement);
    coordinator.invalidate(id);
    return { edits, from: sentence.start, to: sentence.end, raw: sentence.raw };
  }
  function dismiss(id) {
    const suggestion = store.get(id);
    if (!suggestion) return;
    store.dismiss(id, suggestion.source);
    onChange();
  }
  function invalidateAll() {
    analyzed.clear();
    failures2.clear();
    for (const suggestion of store.list()) store.remove(suggestion.id);
    for (const armed of timers.values()) clearTimeout(armed.timer);
    timers.clear();
    coordinator.withdraw(sentences.map((sentence) => sentence.id));
    sync(text);
  }
  return {
    sync,
    refresh,
    mapOffsets,
    marks,
    suggestionAt,
    accept,
    dismiss,
    invalidateAll,
    get store() {
      return store;
    },
    get status() {
      let held = 0;
      for (const entry of failures2.values()) if (entry.attempts >= entry.max) held += 1;
      return {
        count: store.size,
        inFlight,
        rejected: rejectedCount,
        pending: coordinator.pending,
        waiting: timers.size,
        held,
        error: lastError
      };
    },
    dispose() {
      disposed = true;
      for (const armed of timers.values()) clearTimeout(armed.timer);
      timers.clear();
      coordinator.dispose();
    }
  };
}

// obsidian-plugin/rank.mjs
var POSITION_TIER = 1e9;
var GATED_DEMOTION = POSITION_TIER / 2;
function sentenceRank(sentence, visible, gateAware) {
  const demotion = gateAware && checkGate(sentence.text) === null ? GATED_DEMOTION : 0;
  if (sentence.start < visible.to && sentence.end > visible.from) {
    return demotion + sentence.start;
  }
  if (sentence.start >= visible.to) {
    return POSITION_TIER + demotion + (sentence.start - visible.to);
  }
  return 2 * POSITION_TIER + demotion + (visible.from - sentence.end);
}

// obsidian-plugin/underline.mjs
var setMarks = import_state.StateEffect.define();
var NOT_PROSE = /code|comment|html|math|formula|frontmatter|yaml/iu;
var MIN_MARGIN = 2e3;
function drawnRange(view) {
  const ranges = view.visibleRanges;
  if (ranges.length === 0) return { from: 0, to: 0 };
  return { from: ranges[0].from, to: ranges[ranges.length - 1].to };
}
function analysisRange(view) {
  const { from, to } = drawnRange(view);
  const margin = Math.max(to - from, MIN_MARGIN);
  return { from: Math.max(0, from - margin), to: Math.min(view.state.doc.length, to + margin) };
}
function excludedRanges(state) {
  const ranges = [];
  (0, import_language.syntaxTree)(state).iterate({
    enter: (node) => {
      if (!NOT_PROSE.test(node.name)) return true;
      ranges.push({ from: node.from, to: node.to });
      return false;
    }
  });
  return ranges;
}
var underline = import_view.Decoration.mark({ class: "tolben-underline" });
function decorationsFor(marks, docLength) {
  const ranges = [];
  let cursor = 0;
  for (const mark of marks) {
    const from = Math.max(cursor, Math.min(mark.start, docLength));
    const to = Math.min(mark.end, docLength);
    if (to <= from) continue;
    ranges.push(underline.range(from, to));
    cursor = to;
  }
  return import_view.Decoration.set(ranges);
}
var marksField = import_state.StateField.define({
  create: () => import_view.Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setMarks)) next = decorationsFor(effect.value, transaction.state.doc.length);
    }
    return next;
  },
  provide: (field) => import_view.EditorView.decorations.from(field)
});
function renderDiff(container, source, replacement) {
  const parts = inlineDiffParts(source, replacement);
  container.textContent = "";
  parts.forEach((part, index) => {
    const previous = index > 0 ? parts[index - 1].text : "";
    const joined = index > 0 && !/^[,.;:!?)\]}'’”\-/]/u.test(part.text) && !/[-(\[{'‘“/]$/u.test(previous);
    if (joined) container.appendChild(document.createTextNode(" "));
    if (part.type === "equal") {
      container.appendChild(document.createTextNode(part.text));
      return;
    }
    const span = document.createElement("span");
    span.className = part.type === "delete" ? "tolben-del" : "tolben-ins";
    span.textContent = part.text;
    container.appendChild(span);
  });
}
function clarityExtension({
  analyze,
  analyzeLocal = null,
  debounceMs = 140,
  onStatus = () => {
  },
  // "fast" | "balanced" | "off", read per call so a settings change applies live.
  gateMode = () => "balanced"
}) {
  const instances = /* @__PURE__ */ new Set();
  const plugin = import_view.ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.pending = null;
        this.controller = createController({
          analyze,
          analyzeLocal,
          debounceMs,
          onChange: () => this.schedule(),
          isExcluded: (sentence) => this.excluded.some(
            (range) => range.from < sentence.end && range.to > sentence.start
          ),
          isVisible: (sentence) => sentence.start < this.range.to && sentence.end > this.range.from,
          // The window admits a screen of margin either side, but the single model slot
          // serves it in this order: on screen, then below (readers scroll down), then
          // above — and within each, gate-firing sentences before gate-cleared ones,
          // unless the gate is off. See rank.mjs.
          rank: (sentence) => sentenceRank(sentence, this.visible, gateMode() !== "off")
        });
        this.excluded = [];
        this.range = { from: 0, to: 0 };
        this.visible = { from: 0, to: 0 };
        this.pendingSync = null;
        instances.add(this);
        this.deferSync();
      }
      // Live Preview needs nothing special: it is the same document at the same offsets,
      // with Obsidian's own decorations hiding the syntax characters. What it does need
      // is that the model never sees anything but prose — there, a suggestion on a code
      // fence would underline text the writer is looking at as rendered output.
      sync(state) {
        this.range = analysisRange(this.view);
        this.visible = drawnRange(this.view);
        this.excluded = excludedRanges(state);
        this.controller.sync(state.doc.toString());
      }
      // The resync never runs inside the dispatch that caused it. CodeMirror runs the
      // whole update cycle synchronously inside view.dispatch, so anything done here is
      // paid between a keystroke and its glyph appearing, or between a Replace click and
      // the edit painting — the measured 2-second freeze on a long note. One timer,
      // trailing edge: a burst of keystrokes buys one resync.
      deferSync() {
        if (this.pendingSync) return;
        this.pendingSync = setTimeout(() => {
          this.pendingSync = null;
          if (this.view) this.sync(this.view.state);
        }, 0);
      }
      update(update) {
        if (update.docChanged) {
          this.controller.mapOffsets((position, assoc) => update.changes.mapPos(position, assoc));
          this.deferSync();
          return;
        }
        if (update.viewportMoved ?? update.viewportChanged) {
          if (this.pendingSync) return;
          this.range = analysisRange(update.view);
          this.visible = drawnRange(update.view);
          const controller = this.controller;
          setTimeout(() => {
            if (!this.view) return;
            this.excluded = excludedRanges(this.view.state);
            controller.refresh();
          }, 0);
        }
      }
      // CodeMirror forbids dispatching from inside an update, and every caller here is
      // either in one or in an async callback, so the dispatch is always deferred.
      schedule() {
        if (this.pending) return;
        this.pending = setTimeout(() => {
          this.pending = null;
          if (!this.view) return;
          this.view.dispatch({ effects: setMarks.of(this.controller.marks()) });
          onStatus(this.controller.status);
        }, 0);
      }
      replace(id) {
        const applied = this.controller.accept(id);
        if (!applied) return;
        if (this.view.state.doc.sliceString(applied.from, applied.to) !== applied.raw) return;
        this.view.dispatch({ changes: applied.edits });
      }
      dismiss(id) {
        this.controller.dismiss(id);
      }
      destroy() {
        instances.delete(this);
        clearTimeout(this.pendingSync);
        clearTimeout(this.pending);
        this.controller.dispose();
        this.view = null;
      }
    }
  );
  const tooltip = (0, import_view.hoverTooltip)(
    (view, position) => {
      const instance = view.plugin(plugin);
      if (!instance) return null;
      const hit = instance.controller.suggestionAt(position);
      if (!hit) return null;
      const { suggestion, mark } = hit;
      return {
        pos: mark.start,
        end: mark.end,
        above: false,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "tolben-card";
          const title = document.createElement("div");
          title.className = "tolben-card-title";
          title.textContent = suggestion.reason || "Suggests a change";
          dom.appendChild(title);
          const diff = document.createElement("div");
          diff.className = "tolben-card-diff";
          renderDiff(diff, suggestion.source, suggestion.replacement);
          dom.appendChild(diff);
          const reason = document.createElement("div");
          reason.className = "tolben-card-reason";
          reason.textContent = suggestion.stages?.model ? "Local model" : suggestion.stages?.rule ? "Clarity rule" : "Mechanical fix";
          dom.appendChild(reason);
          const actions = document.createElement("div");
          actions.className = "tolben-card-actions";
          const replace = document.createElement("button");
          replace.className = "tolben-primary";
          replace.textContent = "Replace";
          replace.addEventListener("click", () => instance.replace(suggestion.id));
          const dismiss = document.createElement("button");
          dismiss.textContent = "Dismiss";
          dismiss.addEventListener("click", () => instance.dismiss(suggestion.id));
          actions.append(replace, dismiss);
          dom.appendChild(actions);
          return { dom };
        }
      };
    },
    { hoverTime: 80, hideOn: (transaction) => transaction.docChanged }
  );
  return {
    extension: [marksField, plugin, tooltip],
    invalidateAll() {
      for (const instance of instances) instance.controller.invalidateAll();
    }
  };
}

// obsidian-plugin/outcome-cache.mjs
function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function outcomeKey(sentence, protectedTerms) {
  const material = JSON.stringify([sentence, protectedTerms]);
  return fnv1a(material, 2166136261) + fnv1a(material, 16777619);
}
function createOutcomeCache({ fingerprint, max = 2e4, now = () => Date.now(), serialized = null } = {}) {
  let entries = /* @__PURE__ */ new Map();
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
      entries = /* @__PURE__ */ new Map();
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
      if (!entry) return void 0;
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
        entries: [...entries.entries()].map(([key, { outcome, used }]) => [key, outcome, used])
      });
    },
    get size() {
      return entries.size;
    }
  };
}

// obsidian-plugin/ledger.mjs
var MAX_PER_NOTE = 200;
function createLedger({ maxPerNote = MAX_PER_NOTE, now = () => Date.now() } = {}) {
  const notes = /* @__PURE__ */ new Map();
  const keyOf = (source, replacement) => `${source} ${replacement ?? ""}`;
  return {
    /**
     * Record a refusal. Idempotent per (note, sentence, proposal): a note re-analysed
     * after a settings change must not report the same refusal five times.
     */
    record(path, { source, replacement, reason, stage = "gate" }) {
      if (!path || !source || !reason) return;
      const note = notes.get(path) ?? /* @__PURE__ */ new Map();
      const key = keyOf(source, replacement);
      if (!note.has(key)) {
        note.set(key, { source, replacement: replacement ?? null, reason, stage, at: now() });
        if (note.size > maxPerNote) note.delete(note.keys().next().value);
      }
      notes.set(path, note);
    },
    /** Most recent first, because that is the one someone just watched not happen. */
    forNote(path) {
      return [...notes.get(path)?.values() ?? []].reverse();
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
          ""
        ])
      ].join("\n");
    }
  };
}

// obsidian-plugin/network-log.mjs
var LOOPBACK_NAME = /^(?:localhost|::1)$/iu;
function isLoopback(host) {
  if (!host) return false;
  const bare = String(host).replace(/^\[|\]$/gu, "").toLowerCase();
  if (LOOPBACK_NAME.test(bare)) return true;
  const octets = bare.split(".");
  if (octets[0] !== "127" || octets.length > 4) return false;
  return octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}
function createNetworkLog({ now = () => Date.now() } = {}) {
  const hosts = /* @__PURE__ */ new Map();
  let requests = 0;
  let offMachine = 0;
  let failures2 = 0;
  function record(url) {
    requests += 1;
    let host = "(unparseable)";
    let loopback = false;
    try {
      const parsed = new URL(url);
      host = parsed.host;
      loopback = isLoopback(parsed.hostname);
    } catch {
    }
    if (!loopback) offMachine += 1;
    const entry = hosts.get(host) ?? { requests: 0, loopback, lastAt: null };
    entry.requests += 1;
    entry.loopback = loopback;
    entry.lastAt = now();
    hosts.set(host, entry);
    return loopback;
  }
  return {
    /** Wrap a fetch so every call through it is counted. */
    wrap(fetchImpl) {
      return async (url, init) => {
        record(url);
        try {
          return await fetchImpl(url, init);
        } catch (error) {
          failures2 += 1;
          throw error;
        }
      };
    },
    report() {
      return {
        requests,
        offMachine,
        failures: failures2,
        hosts: [...hosts.entries()].map(([host, entry]) => ({ host, ...entry })).sort((left, right) => right.requests - left.requests)
      };
    },
    reset() {
      hosts.clear();
      requests = 0;
      offMachine = 0;
      failures2 = 0;
    }
  };
}

// obsidian-plugin/runtime/provision.mjs
var import_node_path4 = require("node:path");
var import_promises5 = require("node:fs/promises");

// obsidian-plugin/runtime/download.mjs
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_stream = require("node:stream");
var import_promises2 = require("node:stream/promises");
var DownloadError = class extends Error {
  constructor(message, { kind = "failed", cause } = {}) {
    super(message, { cause });
    this.name = "DownloadError";
    this.kind = kind;
  }
};
async function sizeOf(path) {
  try {
    return (await (0, import_promises.stat)(path)).size;
  } catch {
    return 0;
  }
}
async function hashOf(path, { hash = (0, import_node_crypto.createHash)("sha256") } = {}) {
  await (0, import_promises2.pipeline)((0, import_node_fs.createReadStream)(path), hash);
  return hash.digest("hex");
}
async function resumeHash(path, bytes) {
  const hash = (0, import_node_crypto.createHash)("sha256");
  if (bytes === 0) return hash;
  await (0, import_promises2.pipeline)((0, import_node_fs.createReadStream)(path, { start: 0, end: bytes - 1 }), hash, { end: false });
  return hash;
}
async function downloadVerified({
  url,
  destination,
  sha256,
  bytes = null,
  fetchImpl = globalThis.fetch,
  onProgress = () => {
  },
  signal,
  retries = 2
} = {}) {
  if (!/^[0-9a-f]{64}$/u.test(String(sha256))) {
    throw new DownloadError(`Refusing to download ${url}: no pinned sha256`, { kind: "failed" });
  }
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(destination), { recursive: true });
  if (await sizeOf(destination) > 0) {
    const existing = await hashOf(destination);
    if (existing === sha256) return { path: destination, bytes: await sizeOf(destination), reused: true };
    await (0, import_promises.rm)(destination, { force: true });
  }
  const partial = `${destination}.part`;
  let attempt = 0;
  for (; ; ) {
    attempt += 1;
    try {
      return await attemptDownload({ url, destination, partial, sha256, bytes, fetchImpl, onProgress, signal });
    } catch (error) {
      if (error.kind === "aborted" || signal?.aborted) throw error;
      if (error.kind === "hash") await (0, import_promises.rm)(partial, { force: true });
      if (attempt > retries) throw error;
    }
  }
}
async function attemptDownload({ url, destination, partial, sha256, bytes, fetchImpl, onProgress, signal }) {
  let have = await sizeOf(partial);
  if (bytes && have >= bytes) {
    await (0, import_promises.rm)(partial, { force: true });
    have = 0;
  }
  const headers = have > 0 ? { range: `bytes=${have}-` } : {};
  let response;
  try {
    response = await fetchImpl(url, { headers, signal });
  } catch (error) {
    if (signal?.aborted) throw new DownloadError("Download cancelled", { kind: "aborted", cause: error });
    throw new DownloadError(`${url}: ${error.message}`, { kind: "network", cause: error });
  }
  if (have > 0 && response.status !== 206) {
    await (0, import_promises.rm)(partial, { force: true });
    have = 0;
  }
  if (!response.ok && response.status !== 206) {
    throw new DownloadError(`${url}: HTTP ${response.status}`, {
      kind: response.status >= 500 || response.status === 429 ? "network" : "failed"
    });
  }
  const hash = await resumeHash(partial, have);
  const advertised = Number(response.headers?.get?.("content-length") ?? 0);
  const total = bytes ?? (advertised > 0 ? have + advertised : null);
  let received = have;
  onProgress({ received, total });
  const body = response.body && typeof response.body.getReader === "function" ? import_node_stream.Readable.fromWeb(response.body) : response.body;
  if (!body) throw new DownloadError(`${url}: response carried no body`, { kind: "network" });
  const sink = (0, import_node_fs.createWriteStream)(partial, { flags: have > 0 ? "a" : "w" });
  body.on?.("data", (chunk) => {
    hash.update(chunk);
    received += chunk.length;
    onProgress({ received, total });
  });
  try {
    await (0, import_promises2.pipeline)(body, sink, { signal });
  } catch (error) {
    if (signal?.aborted) throw new DownloadError("Download cancelled", { kind: "aborted", cause: error });
    throw new DownloadError(`${url}: ${error.message}`, { kind: "network", cause: error });
  }
  const digest = hash.digest("hex");
  if (digest !== sha256) {
    throw new DownloadError(
      `${url} does not match its pin.
  pinned ${sha256}
  gotten ${digest}`,
      { kind: "hash" }
    );
  }
  if (bytes && received !== bytes) {
    throw new DownloadError(`${url}: expected ${bytes} bytes, wrote ${received}`, { kind: "hash" });
  }
  await (0, import_promises.rename)(partial, destination);
  return { path: destination, bytes: received, reused: false };
}

// obsidian-plugin/runtime/unpack.mjs
var import_promises3 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var import_node_zlib = require("node:zlib");
var import_node_util = require("node:util");
var inflate = (0, import_node_util.promisify)(import_node_zlib.inflateRaw);
var END_OF_CENTRAL_DIRECTORY = 101010256;
var CENTRAL_FILE_HEADER = 33639248;
var ZIP64_END_LOCATOR = 117853008;
var ZIP64_END_RECORD = 101075792;
var ArchiveError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchiveError";
  }
};
function findEndRecord(buffer) {
  const floor = Math.max(0, buffer.length - 65536 - 22);
  for (let at = buffer.length - 22; at >= floor; at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw new ArchiveError("not a zip archive: no end-of-central-directory record");
}
function centralDirectory(buffer, endAt) {
  let entries = buffer.readUInt16LE(endAt + 10);
  let size = buffer.readUInt32LE(endAt + 12);
  let offset = buffer.readUInt32LE(endAt + 16);
  if (offset === 4294967295 || size === 4294967295 || entries === 65535) {
    const locatorAt = endAt - 20;
    if (locatorAt < 0 || buffer.readUInt32LE(locatorAt) !== ZIP64_END_LOCATOR) {
      throw new ArchiveError("zip claims 64-bit offsets but carries no zip64 locator");
    }
    const recordAt = Number(buffer.readBigUInt64LE(locatorAt + 8));
    if (buffer.readUInt32LE(recordAt) !== ZIP64_END_RECORD) {
      throw new ArchiveError("zip64 locator does not point at a zip64 record");
    }
    entries = Number(buffer.readBigUInt64LE(recordAt + 32));
    size = Number(buffer.readBigUInt64LE(recordAt + 40));
    offset = Number(buffer.readBigUInt64LE(recordAt + 48));
  }
  return { entries, size, offset };
}
function zip64Extra(extra, { size, compressedSize, offset }) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 1) {
      let cursor = at + 4;
      const take = () => {
        const value = Number(extra.readBigUInt64LE(cursor));
        cursor += 8;
        return value;
      };
      if (size === 4294967295) size = take();
      if (compressedSize === 4294967295) compressedSize = take();
      if (offset === 4294967295) offset = take();
      break;
    }
    at += 4 + length;
  }
  return { size, compressedSize, offset };
}
function listEntries(buffer) {
  const end = findEndRecord(buffer);
  const { entries, offset } = centralDirectory(buffer, end);
  const list = [];
  let at = offset;
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
      throw new ArchiveError(`central directory entry ${index} has a bad signature`);
    }
    const method = buffer.readUInt16LE(at + 10);
    const externalAttributes = buffer.readUInt32LE(at + 38);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const extra = buffer.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    const sizes = zip64Extra(extra, {
      size: buffer.readUInt32LE(at + 24),
      compressedSize: buffer.readUInt32LE(at + 20),
      offset: buffer.readUInt32LE(at + 42)
    });
    const unixMode = externalAttributes >>> 16 & 65535;
    list.push({
      name,
      method,
      ...sizes,
      mode: unixMode & 4095,
      symlink: (unixMode & 61440) === 40960,
      directory: name.endsWith("/")
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return list;
}
function safeJoin(destination, name) {
  if (name.includes("\0")) throw new ArchiveError(`archive entry has a NUL in its name: ${JSON.stringify(name)}`);
  if (/^([a-zA-Z]:)?[\\/]/u.test(name)) throw new ArchiveError(`archive entry is an absolute path: ${name}`);
  const target = (0, import_node_path2.join)(destination, name);
  const root = (0, import_node_path2.normalize)(destination.endsWith(import_node_path2.sep) ? destination : destination + import_node_path2.sep);
  if (!(0, import_node_path2.normalize)(target).startsWith(root)) throw new ArchiveError(`archive entry escapes its directory: ${name}`);
  return target;
}
function safeLinkTarget(destination, name, target) {
  if (!target) throw new ArchiveError(`archive entry is a link with no target: ${name}`);
  if (target.includes("\0")) throw new ArchiveError(`link target has a NUL in it: ${name}`);
  if (/^([a-zA-Z]:)?[\\/]/u.test(target)) {
    throw new ArchiveError(`archive entry links to an absolute path: ${name} -> ${target}`);
  }
  safeJoin(destination, (0, import_node_path2.join)((0, import_node_path2.dirname)(name), target));
  return target;
}
async function materialiseLinks(destination, links) {
  let pending = links;
  const made = [];
  while (pending.length > 0) {
    const deferred = [];
    for (const link of pending) {
      const path = (0, import_node_path2.join)(destination, link.name);
      await (0, import_promises3.mkdir)((0, import_node_path2.dirname)(path), { recursive: true });
      try {
        await (0, import_promises3.symlink)(link.target, path);
        made.push(link.name);
        continue;
      } catch (error) {
        if (!["EPERM", "EACCES", "ENOSYS", "UNKNOWN"].includes(error.code)) throw error;
      }
      const source = (0, import_node_path2.join)((0, import_node_path2.dirname)(path), link.target);
      if (await (0, import_promises3.stat)(source).then(() => true, () => false)) {
        await (0, import_promises3.copyFile)(source, path);
        const mode = await (0, import_promises3.stat)(source).then((info) => info.mode & 511, () => 420);
        if (mode & 73) await (0, import_promises3.chmod)(path, 493);
        made.push(link.name);
      } else {
        deferred.push(link);
      }
    }
    if (deferred.length === pending.length) {
      const [first] = deferred;
      throw new ArchiveError(`could not create ${first.name} -> ${first.target}: this platform refused a symlink and the target is not in the archive`);
    }
    pending = deferred;
  }
  return made;
}
async function readEntry(buffer, entry) {
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const from = entry.offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(from, from + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflate(raw);
  throw new ArchiveError(`archive entry ${entry.name} uses compression method ${entry.method}`);
}
async function extractZip(archivePath, destination, { filter = () => true } = {}) {
  const buffer = await (0, import_promises3.readFile)(archivePath);
  const written = [];
  const links = [];
  for (const entry of listEntries(buffer)) {
    if (entry.directory) continue;
    if (!filter(entry)) continue;
    if (entry.symlink) {
      const target2 = (await readEntry(buffer, entry)).toString("utf8");
      links.push({ name: entry.name, target: safeLinkTarget(destination, entry.name, target2) });
      continue;
    }
    const target = safeJoin(destination, entry.name);
    const data = await readEntry(buffer, entry);
    if (data.length !== entry.size) {
      throw new ArchiveError(`archive entry ${entry.name}: expected ${entry.size} bytes, inflated ${data.length}`);
    }
    await (0, import_promises3.mkdir)((0, import_node_path2.dirname)(target), { recursive: true });
    await (0, import_promises3.writeFile)(target, data);
    if (entry.mode & 73) await (0, import_promises3.chmod)(target, 493);
    written.push(entry.name);
  }
  return [...written, ...await materialiseLinks(destination, links)];
}
var BLOCK = 512;
function tarNumber(block, at, length) {
  if (block[at] & 128) {
    let value = 0n;
    for (let index = at + 1; index < at + length; index += 1) value = value << 8n | BigInt(block[index]);
    return Number(value);
  }
  const text = block.toString("ascii", at, at + length).replace(/\0.*$/su, "").trim();
  return text ? Number.parseInt(text, 8) : 0;
}
function tarString(block, at, length) {
  return block.toString("utf8", at, at + length).replace(/\0.*$/su, "");
}
function listTarEntries(buffer) {
  const entries = [];
  let at = 0;
  let longName = null;
  let longLink = null;
  while (at + BLOCK <= buffer.length) {
    const header = buffer.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = tarNumber(header, 124, 12);
    const type = String.fromCharCode(header[156]) || "0";
    const prefix = tarString(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${tarString(header, 0, 100)}` : tarString(header, 0, 100));
    const from = at + BLOCK;
    at = from + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "L") {
      longName = buffer.toString("utf8", from, from + size).replace(/\0.*$/su, "");
      continue;
    }
    if (type === "K") {
      longLink = buffer.toString("utf8", from, from + size).replace(/\0.*$/su, "");
      continue;
    }
    longName = null;
    entries.push({
      name,
      size,
      offset: from,
      mode: tarNumber(header, 100, 8) & 4095,
      directory: type === "5" || name.endsWith("/"),
      symlink: type === "1" || type === "2",
      linkTarget: longLink ?? tarString(header, 157, 100)
    });
    longLink = null;
  }
  return entries;
}
async function extractTarGz(archivePath, destination, { filter = () => true, strip = 0 } = {}) {
  const gunzip = (0, import_node_util.promisify)((await import("node:zlib")).gunzip);
  const buffer = await gunzip(await (0, import_promises3.readFile)(archivePath));
  const written = [];
  const links = [];
  for (const entry of listTarEntries(buffer)) {
    if (entry.directory) continue;
    if (!filter(entry)) continue;
    const stripped = entry.name.split("/").slice(strip).join("/");
    if (!stripped) continue;
    if (entry.symlink) {
      links.push({ name: stripped, target: safeLinkTarget(destination, stripped, entry.linkTarget) });
      continue;
    }
    const target = safeJoin(destination, stripped);
    await (0, import_promises3.mkdir)((0, import_node_path2.dirname)(target), { recursive: true });
    await (0, import_promises3.writeFile)(target, buffer.subarray(entry.offset, entry.offset + entry.size));
    if (entry.mode & 73) await (0, import_promises3.chmod)(target, 493);
    written.push(stripped);
  }
  return [...written, ...await materialiseLinks(destination, links)];
}
async function extract(archivePath, destination, options = {}) {
  if (/\.t(?:ar\.)?gz$/iu.test(archivePath)) return extractTarGz(archivePath, destination, options);
  if (/\.zip$/iu.test(archivePath)) return extractZip(archivePath, destination, options);
  throw new ArchiveError(`no reader for ${archivePath}: expected .zip or .tar.gz`);
}

// obsidian-plugin/runtime/provision.mjs
init_cpu();

// obsidian-plugin/runtime/detect.mjs
var DEFAULT_TIMEOUT_MS = 1500;
var OLLAMA_DEFAULT = "http://127.0.0.1:11434";
var LLAMA_SERVER_DEFAULT = "http://127.0.0.1:8080";
async function ask(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function detectOllama({
  fetchImpl = globalThis.fetch,
  baseUrl = OLLAMA_DEFAULT,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const payload = await ask(fetchImpl, `${baseUrl}/api/tags`, timeoutMs);
  if (!payload || !Array.isArray(payload.models)) return null;
  return {
    kind: "ollama",
    baseUrl,
    apiBase: `${baseUrl}/v1`,
    models: payload.models.map((model) => model.name).filter(Boolean)
  };
}
async function detectLlamaServer({
  fetchImpl = globalThis.fetch,
  baseUrl = LLAMA_SERVER_DEFAULT,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const payload = await ask(fetchImpl, `${baseUrl}/v1/models`, timeoutMs);
  const id = payload?.data?.[0]?.id;
  if (!id) return null;
  return { kind: "llama-server", baseUrl, apiBase: `${baseUrl}/v1`, models: [id] };
}
function hasPinnedModel(names, ollamaTag) {
  if (!ollamaTag) return false;
  const wanted = ollamaTag.toLowerCase();
  return names.some((name) => {
    const seen = String(name).toLowerCase().replace(/:latest$/u, "");
    return seen === wanted || seen === wanted.replace(/:latest$/u, "");
  });
}
async function detectRunning(options = {}) {
  const [ollama, llama] = await Promise.all([
    detectOllama(options),
    detectLlamaServer(options)
  ]);
  return { ollama, llamaServer: llama, preferred: llama ?? ollama ?? null };
}

// obsidian-plugin/runtime/manifest.json
var manifest_default = {
  description: "Every byte the plugin will fetch and run, pinned by sha256. Nothing here is downloaded unless its sha256 is recorded below and the bytes on disk match it: an artefact whose `sha256` is null is not offered to the writer at all, and the setup pane says why. This is the same rule models/MANIFEST.json applies to the bench, applied to a runtime a stranger installs.",
  pinned: "2026-09-02",
  models: [
    {
      id: "qwen3.5-2b-q6_k",
      role: "the measured artefact: every number in REPORT.md was produced on these bytes",
      file: "Qwen3.5-2B-Q6_K.gguf",
      bytes: 1556390368,
      sha256: "49e219c54fe4e936b078a994cdb10254a6ae24fc022834989d81240172a520f8",
      licence: "Apache-2.0",
      measured: true,
      sources: [
        "https://huggingface.co/lmstudio-community/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q6_K.gguf"
      ],
      ollama: "hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K"
    },
    {
      id: "qwen3.5-2b-q4_k_m",
      role: "smaller and faster, and NOT the artefact any published number was measured on",
      file: "Qwen3.5-2B-Q4_K_M.gguf",
      bytes: 1270808032,
      sha256: "0bfe35afc9f05b7fac3fa04925e051ac7939a42a8a17ea11afc99701bea826cc",
      licence: "Apache-2.0",
      measured: false,
      sources: [
        "https://huggingface.co/lmstudio-community/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf"
      ],
      ollama: "hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q4_K_M"
    }
  ],
  runtimeRepo: "ggml-org/llama.cpp",
  runtimeTag: "b10760",
  runtimeNote: "llama.cpp release assets are pinned by `node tools/pin-runtime.mjs --write`, which reads the GitHub releases API and records the tag, asset name, size and sha256 for each platform below. The values here were resolved by the `pins` job in .github/workflows/test.yml and transcribed from its `--json` output, because the machine this was authored on cannot reach that API; the same job's `--check` re-verifies the transcription against the API on every push, which is what makes transcribing safe. Until an entry is pinned the provisioner will not download it -- it falls back to an Ollama or llama-server the writer already runs, and the setup pane says the managed runtime is unavailable on that platform. Naming and archive format come from llama.cpp's own .github/workflows/release.yml: macOS and Linux ship tar.gz packed from build/bin with everything flat under a `llama-<tag>/` directory (hence strip 1), and full of SONAME symlink chains that llama-server is linked against; Windows ships a zip whose entries are at the root. llama.cpp marks every b#### build a prerelease, so /releases/latest is the wrong endpoint -- the tool takes the newest release carrying all six assets.",
  runtimes: [
    {
      id: "macos-arm64",
      platform: "darwin",
      arch: "arm64",
      requires: [],
      assetShape: "llama-{tag}-bin-macos-arm64.tar.gz",
      asset: "llama-b10760-bin-macos-arm64.tar.gz",
      bytes: 11072707,
      sha256: "4451e74e6f6d76838b6a10be8c0224d74f0fe2b2c9c23e9a4ff46c33855dd782",
      binary: "llama-server",
      strip: 1
    },
    {
      id: "macos-x64",
      platform: "darwin",
      arch: "x64",
      requires: [],
      assetShape: "llama-{tag}-bin-macos-x64.tar.gz",
      asset: "llama-b10760-bin-macos-x64.tar.gz",
      bytes: 11135791,
      sha256: "909188c4feef3519a4f5e95001b41dd35f07319b81ee4965fcbb524e7bc8e3a9",
      binary: "llama-server",
      strip: 1
    },
    {
      id: "linux-x64",
      platform: "linux",
      arch: "x64",
      requires: [],
      assetShape: "llama-{tag}-bin-ubuntu-x64.tar.gz",
      asset: "llama-b10760-bin-ubuntu-x64.tar.gz",
      bytes: 16715049,
      sha256: "00cfac8189ebec8d5576c2a5acfcd7bff230ec2aa4b8454a8f2fa77548b4cc15",
      binary: "llama-server",
      strip: 1
    },
    {
      id: "linux-arm64",
      platform: "linux",
      arch: "arm64",
      requires: [],
      assetShape: "llama-{tag}-bin-ubuntu-arm64.tar.gz",
      asset: "llama-b10760-bin-ubuntu-arm64.tar.gz",
      bytes: 13347844,
      sha256: "ea26ba267c3a81e014bc1342fb3310cfeaab29e96c831b211bde9770078e666f",
      binary: "llama-server",
      strip: 1
    },
    {
      id: "windows-x64",
      platform: "win32",
      arch: "x64",
      requires: [],
      assetShape: "llama-{tag}-bin-win-cpu-x64.zip",
      asset: "llama-b10760-bin-win-cpu-x64.zip",
      bytes: 18373088,
      sha256: "ed409470580a35501b48396b0b6a6d75f7835fa9741b39af668fc94952c37e98",
      binary: "llama-server.exe",
      strip: 0
    },
    {
      id: "windows-arm64",
      platform: "win32",
      arch: "arm64",
      requires: [],
      assetShape: "llama-{tag}-bin-win-cpu-arm64.zip",
      asset: "llama-b10760-bin-win-cpu-arm64.zip",
      bytes: 11939646,
      sha256: "297905bb7792a0091959af4a53d4bec5437aa37d1484a3e24d1193e8a6ae785a",
      binary: "llama-server.exe",
      strip: 0
    }
  ]
};

// obsidian-plugin/runtime/manifest.mjs
var MEASURED_MODEL = "qwen3.5-2b-q6_k";
function modelById(id) {
  return manifest_default.models.find((model) => model.id === id) ?? null;
}
function runtimeCandidates({ platform, arch, features = [], runtimes = manifest_default.runtimes } = {}) {
  const supported = new Set(features);
  return runtimes.filter((runtime) => runtime.platform === platform && runtime.arch === arch).filter((runtime) => runtime.requires.every((feature) => supported.has(feature))).sort((left, right) => right.requires.length - left.requires.length);
}
function selectRuntime({ platform, arch, features = [], runtimes = manifest_default.runtimes } = {}) {
  const forPlatform = runtimes.filter((r) => r.platform === platform && r.arch === arch);
  if (forPlatform.length === 0) {
    return { runtime: null, reason: "unsupported-platform", detail: `No pinned llama.cpp build for ${platform}/${arch}.` };
  }
  const candidates = runtimeCandidates({ platform, arch, features, runtimes });
  if (candidates.length === 0) {
    const missing = [...new Set(forPlatform.flatMap((r) => r.requires))].join(", ");
    return {
      runtime: null,
      reason: "cpu-unsupported",
      detail: `Every pinned build for ${platform}/${arch} needs ${missing}, which this CPU does not report.`
    };
  }
  const pinned = candidates.find(isPinned);
  if (!pinned) {
    return {
      runtime: null,
      reason: "unpinned",
      detail: `The llama.cpp build for ${candidates[0].id} has no recorded sha256, so it will not be downloaded. Run \`node tools/pin-runtime.mjs --write\` from a machine that can reach the GitHub releases API, or point Tolben at an Ollama or llama-server you already run.`
    };
  }
  return { runtime: pinned, reason: null, detail: null };
}
function isPinned(artifact) {
  return Boolean(artifact && typeof artifact.sha256 === "string" && /^[0-9a-f]{64}$/u.test(artifact.sha256) && Number.isInteger(artifact.bytes) && artifact.bytes > 0);
}
function runtimeUrl(runtime, { tag = manifest_default.runtimeTag, repo = manifest_default.runtimeRepo } = {}) {
  if (!tag || !runtime?.asset) return null;
  return `https://github.com/${repo}/releases/download/${tag}/${runtime.asset}`;
}
function downloadPlan({ platform, arch, features = [], modelId = MEASURED_MODEL, runtimes } = {}) {
  const model = modelById(modelId);
  const { runtime, reason, detail } = selectRuntime({ platform, arch, features, runtimes });
  const items = [];
  if (runtime) {
    items.push({
      kind: "runtime",
      id: runtime.id,
      name: runtime.asset,
      url: runtimeUrl(runtime),
      bytes: runtime.bytes,
      sha256: runtime.sha256
    });
  }
  if (model) {
    items.push({
      kind: "model",
      id: model.id,
      name: model.file,
      url: model.sources[0],
      bytes: model.bytes,
      sha256: model.sha256,
      measured: model.measured
    });
  }
  return {
    items,
    totalBytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
    runtimeUnavailable: runtime ? null : { reason, detail }
  };
}

// obsidian-plugin/runtime/messages.mjs
var OLLAMA_FALLBACK = "If you would rather not fight this: install Ollama, run `ollama serve`, and Tolben will find it on 127.0.0.1:11434 and use it instead. Settings \u2192 Tolben \u2192 Model server.";
function detectSandbox(env = process.env) {
  if (env.FLATPAK_ID || env.FLATPAK_SANDBOX_DIR) return "flatpak";
  if (env.SNAP && env.SNAP_NAME) return "snap";
  return null;
}
var SANDBOX_MESSAGES = {
  flatpak: {
    title: "Obsidian is running inside Flatpak, which will not run a downloaded model server",
    body: [
      "Flatpak mounts the vault without permission to execute anything in it, so the",
      "llama-server binary Tolben downloads cannot be started. This is the sandbox working",
      "as designed, not a fault in the download.",
      "",
      "Two ways forward:",
      "  \u2022 Install Ollama on the host (outside Flatpak) and run `ollama serve`.",
      "  \u2022 Or grant Obsidian access to a directory it may execute from:",
      "      flatpak override --user --filesystem=~/.local/share/tolben md.obsidian.Obsidian",
      "    then restart Obsidian and run setup again."
    ].join("\n")
  },
  snap: {
    title: "Obsidian is running inside Snap, which will not run a downloaded model server",
    body: [
      "Snap confinement blocks executing binaries from outside the snap, so the",
      "llama-server binary Tolben downloads cannot be started.",
      "",
      "Install Ollama on the host and run `ollama serve`; Tolben will find it on",
      "127.0.0.1:11434. A snap-confined Obsidian cannot manage a runtime of its own."
    ].join("\n")
  }
};
function classify(platform, error) {
  const text = `${error?.code ?? ""} ${error?.signal ?? ""} ${error?.message ?? error ?? ""}`;
  if (platform === "darwin") {
    if (/SIGKILL/u.test(text) || /not opened because|cannot be opened because|malicious software/iu.test(text)) {
      return "gatekeeper";
    }
  }
  if (platform === "win32") {
    if (/EPERM|EACCES|access is denied|operation did not complete successfully because the file contains a virus/iu.test(text)) {
      return "smartscreen";
    }
  }
  if (/EACCES|permission denied/iu.test(text)) return "permissions";
  if (/ENOENT/u.test(text)) return "missing";
  return "unknown";
}
var MESSAGES = {
  gatekeeper: (binary) => ({
    title: "macOS blocked the model server because it was downloaded",
    body: [
      "Gatekeeper quarantines executables that arrive over the network and did not come",
      "from the App Store. It kills them silently, which is why there is no error to read.",
      "",
      "To clear the quarantine flag on this one file:",
      `    xattr -d com.apple.quarantine "${binary}"`,
      "",
      "Or open System Settings \u2192 Privacy & Security, where a button offering to run",
      "llama-server anyway appears for about an hour after the first attempt."
    ].join("\n")
  }),
  smartscreen: (binary) => ({
    title: "Windows blocked the model server",
    body: [
      "SmartScreen or your antivirus stopped llama-server from running. Antivirus software",
      "reliably flags newly downloaded, unsigned executables that allocate a great deal of",
      "memory, which is a fair description of a model server.",
      "",
      "The file to allow is:",
      `    ${binary}`,
      "",
      "Add that path to your antivirus exclusions, or right-click the file \u2192 Properties \u2192",
      "Unblock. Its sha256 is pinned in the plugin's manifest.json, so you can check what",
      "you are allowing before you allow it."
    ].join("\n")
  }),
  permissions: (binary) => ({
    title: "The model server is not executable",
    body: [
      `The file is there but the operating system will not run it:`,
      `    ${binary}`,
      "",
      "Usually this is a vault on a drive mounted `noexec` \u2014 an external disk, a network",
      "share, or an encrypted volume. Moving the vault to internal storage fixes it."
    ].join("\n")
  }),
  missing: (binary) => ({
    title: "The model server is not where it should be",
    body: [
      `Tolben expected to find it at:`,
      `    ${binary}`,
      "",
      "Something removed it after it was downloaded and verified \u2014 most often an antivirus",
      "quarantining the file. Run setup again to re-download it, and if it disappears a",
      "second time, add the folder to your antivirus exclusions."
    ].join("\n")
  }),
  unknown: (binary, error) => ({
    title: "The model server would not start",
    body: [
      `Tolben tried to run:`,
      `    ${binary}`,
      "",
      "and the operating system said:",
      `    ${error?.message ?? String(error)}`
    ].join("\n")
  })
};
function explainSpawnFailure({ platform = process.platform, binary, error, env = process.env } = {}) {
  const sandbox = detectSandbox(env);
  if (sandbox) return { kind: sandbox, ...SANDBOX_MESSAGES[sandbox], fallback: OLLAMA_FALLBACK };
  const kind = classify(platform, error);
  return { kind, ...MESSAGES[kind](binary, error), fallback: OLLAMA_FALLBACK };
}

// obsidian-plugin/runtime/provision.mjs
init_server();
var ProvisionError = class extends Error {
  constructor(message, { kind = "failed", advice = null, cause } = {}) {
    super(message, { cause });
    this.name = "ProvisionError";
    this.kind = kind;
    this.advice = advice;
  }
};
var RUNTIME_DIR = "runtime";
var MODEL_DIR = "models";
async function plan({
  platform = process.platform,
  arch = process.arch,
  modelId = MEASURED_MODEL,
  stateDir,
  fetchImpl = globalThis.fetch,
  readFile: readFile3,
  run,
  env = process.env,
  // The manifest's own table unless a caller replaces it; tests use this to reach the
  // refusals a fully pinned manifest can no longer produce.
  runtimes
} = {}) {
  const features = await cpuFeatures({ platform, arch, readFile: readFile3, run });
  const running = await detectRunning({ fetchImpl });
  const model = modelById(modelId);
  const download = downloadPlan({ platform, arch, features, modelId, runtimes });
  const ollamaReady = running.ollama && hasPinnedModel(running.ollama.models, model?.ollama);
  return {
    platform,
    arch,
    features,
    sandbox: detectSandbox(env),
    running,
    model,
    measured: model?.measured ?? false,
    ollamaNeedsPull: Boolean(running.ollama) && !ollamaReady,
    ollamaTag: model?.ollama ?? null,
    items: download.items,
    totalBytes: download.totalBytes,
    runtimeUnavailable: download.runtimeUnavailable,
    // What will actually happen, in one word, so a caller does not have to re-derive it.
    action: running.llamaServer ? "use-llama-server" : ollamaReady ? "use-ollama" : running.ollama ? "pull-ollama" : download.runtimeUnavailable ? "blocked" : "download-and-spawn",
    stateDir
  };
}
async function provision({
  platform = process.platform,
  arch = process.arch,
  modelId = MEASURED_MODEL,
  stateDir,
  confirmed = false,
  fetchImpl = globalThis.fetch,
  spawnImpl,
  onEvent = () => {
  },
  signal,
  readFile: readFile3,
  run,
  env = process.env,
  startImpl = startServer,
  warmUpImpl = warmUp,
  reapImpl = reapOrphan,
  portImpl = freePort,
  runtimes
} = {}) {
  if (!stateDir) throw new ProvisionError("provision() needs a stateDir to keep its runtime in");
  onEvent({ phase: "reap" });
  const reaped = await reapImpl(stateDir);
  if (reaped.reaped) onEvent({ phase: "reaped", pid: reaped.pid });
  onEvent({ phase: "detect" });
  const decided = await plan({ platform, arch, modelId, stateDir, fetchImpl, readFile: readFile3, run, env, runtimes });
  onEvent({ phase: "planned", plan: decided });
  if (decided.action === "use-llama-server") {
    const found = decided.running.llamaServer;
    return {
      kind: "existing",
      server: "llama-server",
      apiBase: found.apiBase,
      baseUrl: found.baseUrl,
      apiKey: null,
      model: found.models[0] ?? "local",
      managed: false,
      stop: async () => {
      }
    };
  }
  if (decided.action === "use-ollama") {
    const found = decided.running.ollama;
    return {
      kind: "existing",
      server: "ollama",
      apiBase: found.apiBase,
      baseUrl: found.baseUrl,
      apiKey: null,
      model: decided.ollamaTag,
      managed: false,
      stop: async () => {
      }
    };
  }
  if (decided.action === "pull-ollama") {
    throw new ProvisionError(
      `Ollama is running but does not have ${decided.ollamaTag}.`,
      { kind: "ollama-pull-required", advice: { title: "Ollama needs the model", body: `Pull it with:
    ollama pull ${decided.ollamaTag}`, fallback: null } }
    );
  }
  if (decided.action === "blocked") {
    const { reason, detail } = decided.runtimeUnavailable;
    throw new ProvisionError(detail, {
      kind: reason,
      advice: {
        title: "Tolben cannot manage a model server on this machine",
        body: detail,
        fallback: "Install Ollama and run `ollama serve`, or start llama-server yourself on 127.0.0.1:8080."
      }
    });
  }
  if (!confirmed) {
    throw new ProvisionError(
      `Provisioning would download ${decided.items.length} file(s), ${formatBytes(decided.totalBytes)}. Nothing was fetched: call provision({ confirmed: true }) once a person has seen the plan.`,
      { kind: "unconfirmed" }
    );
  }
  const runtimeDir = (0, import_node_path4.join)(stateDir, RUNTIME_DIR);
  const modelDir = (0, import_node_path4.join)(stateDir, MODEL_DIR);
  await (0, import_promises5.mkdir)(runtimeDir, { recursive: true });
  await (0, import_promises5.mkdir)(modelDir, { recursive: true });
  let binary = null;
  let modelPath = null;
  for (const item of decided.items) {
    const destination = item.kind === "runtime" ? (0, import_node_path4.join)(runtimeDir, item.name) : (0, import_node_path4.join)(modelDir, item.name);
    onEvent({ phase: "download", item, destination });
    const result = await downloadVerified({
      url: item.url,
      destination,
      sha256: item.sha256,
      bytes: item.bytes,
      fetchImpl,
      signal,
      onProgress: (progress) => onEvent({ phase: "progress", item, ...progress })
    });
    onEvent({ phase: "downloaded", item, reused: result.reused });
    if (item.kind === "model") {
      modelPath = destination;
      continue;
    }
    onEvent({ phase: "extract", item });
    const runtime = runtimeForItem(item);
    const unpacked = (0, import_node_path4.join)(runtimeDir, item.id);
    await (0, import_promises5.rm)(unpacked, { recursive: true, force: true });
    await extract(destination, unpacked, {
      strip: runtime.strip ?? 0,
      filter: (entry) => /llama-server(\.exe)?$/u.test(entry.name) || /\.(so|dylib|dll)(\.\d+)*$/u.test(entry.name)
    });
    binary = (0, import_node_path4.join)(unpacked, runtime.binary);
    onEvent({ phase: "extracted", item, binary });
  }
  const port = await portImpl();
  const apiKey = newApiKey();
  const slotDir = (0, import_node_path4.join)(stateDir, "slots");
  await (0, import_promises5.mkdir)(slotDir, { recursive: true });
  onEvent({ phase: "spawn", binary, port });
  let handle;
  try {
    handle = await startImpl({
      binary,
      modelPath,
      stateDir,
      port,
      apiKey,
      slotDir,
      spawnImpl,
      fetchImpl
    });
  } catch (error) {
    const advice = explainSpawnFailure({ platform, binary, error, env });
    throw new ProvisionError(error.message, {
      kind: error instanceof ServerError ? error.kind : "spawn",
      advice,
      cause: error
    });
  }
  onEvent({ phase: "warmup" });
  const warm = await warmUpImpl({ apiBase: handle.apiBase, apiKey: handle.apiKey, fetchImpl });
  onEvent({ phase: "ready", ms: warm.ms, ok: warm.ok });
  return {
    kind: "managed",
    server: "llama-server",
    apiBase: handle.apiBase,
    baseUrl: handle.baseUrl,
    apiKey: handle.apiKey,
    model: decided.model.id,
    measured: decided.model.measured,
    managed: true,
    pid: handle.pid,
    warmUpMs: warm.ms,
    binary,
    modelPath,
    slotDir,
    stop: (options) => handle.stop(options),
    handle
  };
}
function runtimeForItem(item) {
  return manifest_default.runtimes.find((runtime) => runtime.id === item.id);
}
function formatBytes(bytes) {
  if (!bytes) return "0 bytes";
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} kB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

// obsidian-plugin/panes.mjs
function element(parent, tag, className, text) {
  const node = parent.ownerDocument.createElement(tag);
  if (className) node.className = className;
  if (text !== void 0) node.textContent = text;
  parent.appendChild(node);
  return node;
}
function button(parent, label, { primary = false, onClick } = {}) {
  const node = element(parent, "button", primary ? "tolben-primary" : null, label);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}
function renderSetup(root, plan2, handlers = {}) {
  root.className = "tolben-pane tolben-setup";
  root.replaceChildren();
  element(root, "h2", "tolben-pane-title", "Tolben needs a model to run");
  element(
    root,
    "p",
    "tolben-pane-lede",
    "Everything runs on this machine. Nothing you write is sent anywhere, and there is no account. What Tolben needs is a local model server; here is what it found."
  );
  const found = element(root, "div", "tolben-setup-found");
  if (plan2.running.llamaServer) {
    element(found, "div", "tolben-good", `llama-server is already running on ${plan2.running.llamaServer.baseUrl}.`);
  } else if (plan2.running.ollama) {
    element(found, "div", "tolben-good", `Ollama is already running on ${plan2.running.ollama.baseUrl}.`);
  } else {
    element(found, "div", "tolben-note", "Nothing is running on 127.0.0.1:8080 or 127.0.0.1:11434.");
  }
  if (plan2.sandbox) {
    element(
      root,
      "div",
      "tolben-warn",
      `Obsidian is running inside ${plan2.sandbox}, which cannot execute a downloaded model server. Install Ollama on the host and Tolben will use it.`
    );
  }
  if (plan2.action === "use-llama-server" || plan2.action === "use-ollama") {
    element(root, "p", null, "Nothing needs downloading.");
    const actions2 = element(root, "div", "tolben-pane-actions");
    button(actions2, "Use it", { primary: true, onClick: handlers.onUseExisting });
    return root;
  }
  if (plan2.action === "pull-ollama") {
    element(
      root,
      "p",
      null,
      `Ollama is running but does not have the model Tolben was measured on. It will pull ${plan2.ollamaTag} (${formatBytes(plan2.model.bytes)}). Ollama verifies it.`
    );
    const actions2 = element(root, "div", "tolben-pane-actions");
    button(actions2, `Pull ${formatBytes(plan2.model.bytes)}`, { primary: true, onClick: handlers.onConfirm });
    button(actions2, "Not now", { onClick: handlers.onCancel });
    return root;
  }
  if (plan2.action === "blocked") {
    element(root, "div", "tolben-warn", plan2.runtimeUnavailable.detail);
    element(
      root,
      "p",
      null,
      "Install Ollama and run `ollama serve`, or start llama-server yourself on 127.0.0.1:8080, and Tolben will find it."
    );
    const actions2 = element(root, "div", "tolben-pane-actions");
    button(actions2, "Look again", { primary: true, onClick: handlers.onRetry });
    button(actions2, "Close", { onClick: handlers.onCancel });
    return root;
  }
  element(root, "h3", null, `Tolben will download ${formatBytes(plan2.totalBytes)}`);
  const list = element(root, "ul", "tolben-setup-items");
  for (const item of plan2.items) {
    const row = element(list, "li", "tolben-setup-item");
    element(row, "div", "tolben-item-name", `${item.name} \u2014 ${formatBytes(item.bytes)}`);
    element(row, "div", "tolben-item-url", item.url);
    element(row, "div", "tolben-item-hash", `sha256 ${item.sha256}`);
  }
  element(
    root,
    "p",
    "tolben-note",
    "Each file is checked against the hash above before it is used. A file that does not match is discarded, not run."
  );
  if (!plan2.measured) {
    element(
      root,
      "div",
      "tolben-warn",
      "This is not the model the published numbers were measured on. It is smaller and faster; how much accuracy that costs has not been measured."
    );
  }
  const actions = element(root, "div", "tolben-pane-actions");
  button(actions, `Download ${formatBytes(plan2.totalBytes)} and start`, { primary: true, onClick: handlers.onConfirm });
  button(actions, "Not now", { onClick: handlers.onCancel });
  return root;
}
function renderProgress(root, { label, received, total, note }) {
  root.replaceChildren();
  root.className = "tolben-pane tolben-setup";
  element(root, "h2", "tolben-pane-title", "Setting up");
  element(root, "div", "tolben-progress-label", label);
  const track = element(root, "div", "tolben-progress");
  const fill = element(track, "div", "tolben-progress-fill");
  const share = total ? Math.min(1, received / total) : 0;
  fill.style.width = `${(share * 100).toFixed(1)}%`;
  element(
    root,
    "div",
    "tolben-progress-bytes",
    total ? `${formatBytes(received)} of ${formatBytes(total)}` : formatBytes(received)
  );
  if (note) element(root, "div", "tolben-note", note);
  return root;
}
function renderLedger(root, { path, rows }, handlers = {}) {
  root.className = "tolben-pane tolben-ledger";
  root.replaceChildren();
  element(root, "h2", "tolben-pane-title", "What Tolben refused to suggest");
  element(root, "div", "tolben-pane-lede", path);
  if (rows.length === 0) {
    element(
      root,
      "p",
      "tolben-empty",
      "Nothing was refused in this note. Either the model proposed nothing that changed your meaning, or it proposed nothing at all."
    );
    return root;
  }
  element(
    root,
    "p",
    "tolben-pane-lede",
    `${rows.length} suggestion${rows.length === 1 ? "" : "s"} the model produced and the gate stopped. Each names the rule that stopped it.`
  );
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
function renderNetwork(root, report) {
  root.className = "tolben-pane tolben-network";
  root.replaceChildren();
  element(root, "h2", "tolben-pane-title", "What talks to the network");
  const verdict = element(root, "div", report.network.offMachine === 0 ? "tolben-good" : "tolben-warn");
  verdict.textContent = report.network.offMachine === 0 ? `${report.network.requests} request${report.network.requests === 1 ? "" : "s"} since this plugin loaded, all to this machine.` : `${report.network.offMachine} of ${report.network.requests} requests went somewhere other than this machine.`;
  const hosts = element(root, "ul", "tolben-network-hosts");
  if (report.network.hosts.length === 0) {
    element(hosts, "li", "tolben-empty", "No requests yet.");
  }
  for (const host of report.network.hosts) {
    element(
      hosts,
      "li",
      host.loopback ? "tolben-host-local" : "tolben-host-remote",
      `${host.host} \u2014 ${host.requests} request${host.requests === 1 ? "" : "s"}${host.loopback ? "" : "  (NOT this machine)"}`
    );
  }
  const facts = element(root, "dl", "tolben-network-facts");
  const fact = (term, value) => {
    element(facts, "dt", null, term);
    element(facts, "dd", null, value);
  };
  fact("Model endpoint", report.endpoint ?? "not connected");
  fact("Server", report.managed ? `started by Tolben, pid ${report.pid ?? "?"}${report.rssBytes ? `, ${formatBytes(report.rssBytes)} resident` : ""}` : "started by you; Tolben did not spawn it");
  fact("Model", report.model ?? "unknown");
  fact("Model sha256", report.modelSha256 ?? "not a pinned artefact \u2014 Tolben did not fetch it");
  fact("Measured artefact", report.measured === void 0 ? "unknown" : report.measured ? "yes \u2014 this is what REPORT.md's numbers describe" : "no \u2014 the published numbers do not describe this model");
  fact("Held in memory", `${report.cacheEntries ?? 0} cached answers, ${report.ledger?.entries ?? 0} refusals across ${report.ledger?.notes ?? 0} note(s)`);
  fact("Written to your vault", report.vaultWrites ?? "settings only (data.json)");
  element(
    root,
    "p",
    "tolben-note",
    "The request count comes from a wrapper around the only function this plugin has for making a request. It is not a packet capture, and it is not asking to be believed: the model server binds 127.0.0.1 on a random port with a key, so you can watch it yourself."
  );
  return root;
}
function statusLine({ state, count = 0, refused = 0, held = 0, error = null, managed = false }) {
  if (error) return `Tolben: ${error}`;
  if (state === "setup") return "Tolben: needs setup";
  if (state === "starting") return "Tolben: starting the model";
  if (state === "checking") return "Tolben: checking\u2026";
  const parts = [state === "ready" ? "ready" : state, managed ? "local" : "local"];
  if (count > 0) parts.push(`${count} suggestion${count === 1 ? "" : "s"}`);
  if (refused > 0) parts.push(`${refused} refused`);
  if (held > 0) parts.push(`${held} unchecked`);
  return `Tolben: ${parts.join(" \xB7 ")}`;
}

// obsidian-plugin/runtime/ollama.mjs
var OLLAMA_DEFAULT2 = "http://127.0.0.1:11434";
var OllamaError = class extends Error {
  constructor(message, { kind = "failed", cause } = {}) {
    super(message, { cause });
    this.name = "OllamaError";
    this.kind = kind;
  }
};
async function pullModel({
  tag,
  baseUrl = OLLAMA_DEFAULT2,
  fetchImpl = globalThis.fetch,
  onProgress = () => {
  },
  signal
} = {}) {
  if (!tag) throw new OllamaError("pullModel needs a tag");
  const response = await fetchImpl(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: tag, stream: true }),
    signal
  });
  if (!response.ok) throw new OllamaError(`ollama pull ${tag}: HTTP ${response.status}`, { kind: "http" });
  let last = null;
  for await (const line of ndjson(response.body)) {
    if (line.error) throw new OllamaError(`ollama pull ${tag}: ${line.error}`, { kind: "pull" });
    last = line;
    onProgress({
      status: line.status ?? "",
      received: line.completed ?? 0,
      total: line.total ?? null,
      digest: line.digest ?? null
    });
  }
  if (last?.status !== "success") {
    throw new OllamaError(`ollama pull ${tag} ended without success (last status: ${last?.status ?? "none"})`, { kind: "incomplete" });
  }
  return { tag, ok: true };
}
async function* ndjson(body) {
  const stream = body?.getReader ? readerLines(body) : nodeLines(body);
  for await (const line of stream) {
    const text = line.trim();
    if (!text) continue;
    try {
      yield JSON.parse(text);
    } catch {
    }
  }
}
async function* readerLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    yield* lines;
  }
  if (buffer) yield buffer;
}
async function* nodeLines(body) {
  let buffer = "";
  for await (const chunk of body) {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    yield* lines;
  }
  if (buffer) yield buffer;
}
var PROBE_KEEP_ALIVE_MINUTES = 23;
var KEEP_ALIVE_TOLERANCE_MINUTES = 3;
async function probeDialect({
  tag,
  baseUrl = OLLAMA_DEFAULT2,
  fetchImpl = globalThis.fetch,
  signal
} = {}) {
  const findings = {
    keepAlive: false,
    thinking: null,
    schema: false,
    stopSafe: false,
    fieldOrder: null,
    endpoint: "native",
    errors: []
  };
  let content = null;
  try {
    const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model: tag,
        temperature: 0,
        max_tokens: 96,
        keep_alive: `${PROBE_KEEP_ALIVE_MINUTES}m`,
        reasoning_effort: "none",
        // The REAL schema, so the field order this measures is the order the engine will
        // meet. A toy schema with one property cannot show an ordering problem at all.
        response_format: {
          type: "json_schema",
          json_schema: { name: "clarity_decision", strict: true, schema: DECISION_SCHEMA }
        },
        messages: [
          { role: "system", content: "Rewrite the sentence to be clearer. Answer with the JSON object." },
          { role: "user", content: "The department will conduct an investigation into the missing inventory." }
        ]
      })
    });
    if (!response.ok) {
      findings.errors.push(`/v1/chat/completions: HTTP ${response.status}`);
      return findings;
    }
    const payload = await response.json();
    content = payload?.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    findings.errors.push(`/v1/chat/completions: ${error.message}`);
    return findings;
  }
  findings.thinking = /<(?:think|thinking|reasoning)>/iu.test(content);
  try {
    const parsed = JSON.parse(stripThinking(content));
    findings.schema = true;
    const wanted = Object.keys(DECISION_SCHEMA.properties);
    const got = Object.keys(parsed).filter((key) => wanted.includes(key));
    findings.fieldOrder = got.join(",");
    findings.stopSafe = got.length === wanted.length && got.every((key, at) => key === wanted[at]);
    if (!findings.stopSafe) {
      findings.errors.push(
        `structured output returns ${got.join(", ")} rather than ${wanted.join(", ")}; the reason-stop optimisation is disabled, which costs about ten tokens a sentence`
      );
    }
  } catch {
    findings.schema = false;
    findings.errors.push("response_format did not produce parseable JSON on /v1");
  }
  try {
    const response = await fetchImpl(`${baseUrl}/api/ps`, { signal });
    const payload = await response.json();
    const entry = (payload?.models ?? []).find((model) => sameTag(model.name ?? model.model, tag));
    if (entry?.expires_at) {
      const minutes = (new Date(entry.expires_at).getTime() - Date.now()) / 6e4;
      findings.keepAliveMinutes = Math.round(minutes);
      findings.keepAlive = Math.abs(minutes - PROBE_KEEP_ALIVE_MINUTES) <= KEEP_ALIVE_TOLERANCE_MINUTES;
      if (!findings.keepAlive) {
        findings.errors.push(
          `asked /v1 to keep the model for ${PROBE_KEEP_ALIVE_MINUTES} minutes; /api/ps reports ${findings.keepAliveMinutes}. ${findings.keepAliveMinutes > PROBE_KEEP_ALIVE_MINUTES ? "Something else set that, so this says nothing about /v1." : "/v1 dropped the field."}`
        );
      }
    } else if (entry) {
      findings.errors.push("/api/ps lists the model but reports no expiry");
    } else {
      findings.errors.push("/api/ps does not list the model after a completion");
    }
  } catch (error) {
    findings.errors.push(`/api/ps: ${error.message}`);
  }
  findings.endpoint = findings.keepAlive && findings.schema && findings.thinking === false ? "v1" : "native";
  return findings;
}
function sameTag(seen, wanted) {
  if (!seen || !wanted) return false;
  const normalise = (text) => String(text).toLowerCase().replace(/:latest$/u, "");
  return normalise(seen) === normalise(wanted);
}
function nativeFetch({ baseUrl = OLLAMA_DEFAULT2, keepAlive = "30m", fetchImpl = globalThis.fetch } = {}) {
  return async function fetchLikeOpenAI(url, init = {}) {
    if (!String(url).endsWith("/chat/completions")) return fetchImpl(url, init);
    const body = JSON.parse(init.body);
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: init.signal,
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        stream: false,
        think: false,
        keep_alive: keepAlive,
        format: body.response_format?.json_schema?.schema ?? void 0,
        options: {
          temperature: body.temperature ?? 0,
          top_p: body.top_p ?? 1,
          num_predict: body.max_tokens ?? 160,
          ...body.stop ? { stop: body.stop } : {}
        }
      })
    });
    if (!response.ok) return response;
    const payload = await response.json();
    const content = payload?.message?.content ?? "";
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content
    };
  };
}
async function connectOllama({ tag, baseUrl = OLLAMA_DEFAULT2, fetchImpl = globalThis.fetch, signal } = {}) {
  const findings = await probeDialect({ tag, baseUrl, fetchImpl, signal });
  const common = { findings, useReasonStop: findings.stopSafe };
  if (findings.endpoint === "v1") {
    return { ...common, apiBase: `${baseUrl}/v1`, fetchImpl, dialect: "ollama", endpoint: "v1" };
  }
  return {
    ...common,
    apiBase: `${baseUrl}/v1`,
    fetchImpl: nativeFetch({ baseUrl, fetchImpl }),
    dialect: "openai",
    endpoint: "native"
  };
}

// obsidian-plugin/main.mjs
var DEFAULTS = {
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
  // the machine. 0 keeps it resident. The KV slot is saved first, so coming back costs a
  // file read rather than a full reload.
  idleUnloadMinutes: 10,
  // "Never drop words": refuse any rewrite that loses a content word, instead of putting
  // the single-word cases to the 2B verifier. OFF by default, because on the labelled
  // corpora it stops 0 further meaning changes and costs 15 Grammarly rows plus 48
  // preserving rewrites -- every published number was measured under `verify`.
  neverDropWords: false,
  // Which pinned artefact the managed runtime should fetch.
  modelId: MEASURED_MODEL,
  // Set once setup has been through, so it is offered exactly once rather than at every
  // launch.
  setupDone: false
};
var CACHE_EPOCH = 5;
var TolbenPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    this.cache = null;
    this.cacheSnapshots = /* @__PURE__ */ new Map();
    if (typeof this.settings.gate === "boolean") {
      this.settings.gate = this.settings.gate ? "balanced" : "off";
    }
    this.engine = null;
    this.modelName = null;
    this.runtime = null;
    this.idleTimer = null;
    this.ledger = createLedger();
    this.network = createNetworkLog();
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
        protectedTerms: context?.protectedTerms ?? []
      }),
      onStatus: (status) => this.renderStatus(status),
      gateMode: () => this.settings.gate
    });
    this.clarity = clarity;
    this.registerEditorExtension(clarity.extension);
    this.addCommand({
      id: "tolben-recheck",
      name: "Recheck open notes",
      callback: () => {
        this.clarity.invalidateAll();
        new import_obsidian.Notice("Tolben: rechecking");
      }
    });
    this.addCommand({
      id: "tolben-ledger",
      name: "Show refusal ledger for this note",
      callback: () => this.showLedger()
    });
    this.addCommand({
      id: "tolben-network",
      name: "Show what talks to the network",
      callback: () => this.showNetwork()
    });
    this.addCommand({
      id: "tolben-setup",
      name: "Set up the model server",
      callback: () => this.openSetup()
    });
    this.addSettingTab(new TolbenSettingTab(this.app, this));
    if (!this.settings.setupDone) {
      this.openSetup();
    } else {
      this.connect().catch(() => {
      });
    }
  }
  // ------------------------------------------------------------------------- setup
  /** The first-run pane. Shows the plan; downloads only if a person says so. */
  async openSetup() {
    const modal = new import_obsidian.Modal(this.app);
    modal.open();
    const root = modal.contentEl;
    root.setText?.("");
    const draw = async () => {
      const proposed = await plan({
        stateDir: this.stateDir(),
        modelId: this.settings.modelId,
        fetchImpl: this.fetch,
        readFile: (path, encoding) => this.readNodeFile(path, encoding),
        run: (command, args) => this.runCommand(command, args)
      });
      this.plan = proposed;
      renderSetup(root, proposed, {
        onRetry: () => draw(),
        onCancel: async () => {
          this.settings.setupDone = true;
          await this.save();
          modal.close();
        },
        onUseExisting: async () => {
          this.settings.baseUrl = proposed.running.llamaServer?.apiBase ?? proposed.running.ollama?.apiBase;
          this.settings.setupDone = true;
          await this.save();
          modal.close();
          this.connect().catch((error) => new import_obsidian.Notice(`Tolben: ${error.message}`));
        },
        onConfirm: () => this.runSetup(proposed, root, modal)
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
          onProgress: ({ status, received, total }) => renderProgress(root, { label: status, received, total, note: proposed.ollamaTag })
        });
        this.settings.baseUrl = proposed.running.ollama.apiBase;
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
              renderProgress(root, { label: "Loading the weights", received: 0, total: 0, note: "about 15 seconds the first time" });
            }
          }
        });
        this.runtime = result;
        this.settings.baseUrl = result.apiBase;
        this.apiKey = result.apiKey;
      }
      this.settings.setupDone = true;
      await this.save();
      modal.close();
      await this.connect();
      new import_obsidian.Notice("Tolben: ready");
    } catch (error) {
      root.replaceChildren();
      const title = root.ownerDocument.createElement("h2");
      title.textContent = error.advice?.title ?? "Setup failed";
      root.appendChild(title);
      const body = root.ownerDocument.createElement("pre");
      body.className = "tolben-advice";
      body.textContent = `${error.advice?.body ?? error.message}${error.advice?.fallback ? `

${error.advice.fallback}` : ""}`;
      root.appendChild(body);
    }
  }
  // Where the managed runtime lives: outside the vault, deliberately. A 1.5 GB model
  // inside a synced vault is a bad afternoon for whoever is paying for the sync.
  stateDir() {
    const base = process.env.XDG_DATA_HOME ?? (process.platform === "win32" ? process.env.LOCALAPPDATA : null) ?? `${process.env.HOME ?? "."}/.local/share`;
    return `${base}/tolben`;
  }
  async readNodeFile(path, encoding) {
    const { readFile: readFile3 } = await import("node:fs/promises");
    return readFile3(path, encoding);
  }
  async runCommand(command, args) {
    const { execFile } = await import("node:child_process");
    const { promisify: promisify2 } = await import("node:util");
    return promisify2(execFile)(command, args);
  }
  // ------------------------------------------------------------------------ the panes
  showLedger() {
    const path = this.app.workspace.getActiveFile()?.path ?? null;
    const modal = new import_obsidian.Modal(this.app);
    modal.open();
    const rows = path ? this.ledger.forNote(path) : [];
    renderLedger(modal.contentEl, { path: path ?? "no note open", rows }, {
      onCopy: () => {
        navigator.clipboard?.writeText?.(this.ledger.asText(path));
        new import_obsidian.Notice("Tolben: ledger copied");
      },
      onClear: () => {
        this.ledger.clear(path);
        modal.close();
      }
    });
  }
  showNetwork() {
    const model = modelById(this.settings.modelId);
    const modal = new import_obsidian.Modal(this.app);
    modal.open();
    renderNetwork(modal.contentEl, {
      network: this.network.report(),
      endpoint: this.settings.baseUrl || null,
      managed: Boolean(this.runtime?.managed),
      pid: this.runtime?.pid ?? null,
      model: this.modelName ?? model?.file ?? null,
      modelSha256: this.runtime?.managed ? model?.sha256 : null,
      measured: this.runtime?.managed ? model?.measured : void 0,
      cacheEntries: this.cache?.size ?? 0,
      ledger: this.ledger.stats(),
      vaultWrites: "settings only (data.json)"
    });
  }
  onunload() {
    this.engine = null;
    clearTimeout(this.idleTimer);
    this.runtime?.stop?.().catch(() => {
    });
    this.runtime = null;
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
      outcomeKey(clarity_prompt_default, [verifier_prompt_default]),
      // the same hash the keys use
      // The rule table edits answers deterministically before the model is consulted, so
      // its content is part of what produced every cached outcome.
      RULES_SIGNATURE,
      this.settings.mechanics,
      this.settings.rules,
      this.settings.gate === "fast",
      // The deletion policy decides whether a single lost word is put to the verifier or
      // refused outright, so an answer cached under one does not describe the other.
      this.deletionPolicy()
    ]);
  }
  outcomeCache() {
    const fingerprint = this.cacheFingerprint();
    if (this.cache && this.cache.fingerprint === fingerprint) return this.cache;
    if (this.cache) this.cacheSnapshots.set(this.cache.fingerprint, this.cache.serialize());
    const cache = createOutcomeCache({ fingerprint, serialized: this.cacheSnapshots.get(fingerprint) ?? null });
    cache.fingerprint = fingerprint;
    this.cache = cache;
    return cache;
  }
  deletionPolicy() {
    return this.settings.neverDropWords ? "refuse" : "verify";
  }
  async connect() {
    if (!this.settings.baseUrl) throw new Error("no model server configured \u2014 run setup");
    const base = this.settings.baseUrl.replace(/\/$/u, "");
    const headers = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    const response = await this.fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`model server HTTP ${response.status}`);
    this.modelName = (await response.json())?.data?.[0]?.id ?? "local";
    let fetchImpl = this.fetch;
    let dialect = "openai";
    let useReasonStop = true;
    if (/:11434(?:\/|$)/u.test(base)) {
      const connection = await connectOllama({
        tag: this.modelName,
        baseUrl: base.replace(/\/v1$/u, ""),
        fetchImpl: this.fetch
      });
      fetchImpl = connection.fetchImpl;
      dialect = connection.dialect;
      useReasonStop = connection.useReasonStop;
      this.ollamaFindings = connection.findings;
    }
    this.engine = createEngine({
      baseUrl: this.settings.baseUrl,
      model: this.modelName,
      prompt: clarity_prompt_default,
      verifierPrompt: verifier_prompt_default,
      fetchImpl,
      dialect,
      useReasonStop,
      apiKey: this.apiKey ?? null,
      timeoutMs: 12e3
    });
    this.setStatus(statusLine({ state: "ready", managed: Boolean(this.runtime?.managed) }));
    return this.modelName;
  }
  async analyze(sentence, { signal, context }) {
    if (!this.engine) await this.connect();
    const cache = this.outcomeCache();
    const key = outcomeKey(sentence, context?.protectedTerms ?? []);
    const hit = cache.get(key);
    if (hit) {
      return {
        source: sentence,
        replacement: hit.replacement ?? null,
        reason: hit.reason ?? null,
        stages: hit.stages,
        rejection: hit.rejection ?? null,
        modelRejection: hit.modelRejection ?? null,
        cached: true
      };
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
      protectedTerms: context?.protectedTerms ?? []
    });
    if (outcome.error) {
      const { kind: reported, cause } = outcome.error;
      const kind = reported === "aborted" ? "aborted" : reported === "failed" ? "failed" : reported === "verifier-unavailable" && cause === "failed" ? "failed" : "transient";
      throw Object.assign(new Error(outcome.error.message), { kind });
    }
    if (outcome.stages?.model || outcome.modelRejection || outcome.latencyMs > 0) {
      cache.set(key, {
        replacement: outcome.replacement,
        reason: outcome.reason,
        stages: outcome.stages,
        rejection: outcome.rejection,
        modelRejection: outcome.modelRejection
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
      reason
    });
  }
  // ------------------------------------------------------------------- idle unload
  /**
   * Give the machine its 2 GB back after a while, and make coming back cheap.
   *
   * The KV slot is written before the server stops, so the next sentence pays a file
   * read rather than a fifteen-second reload. Only a server Tolben started is ever
   * stopped: one the writer runs themselves is theirs.
   */
  armIdleUnload() {
    clearTimeout(this.idleTimer);
    const minutes = Number(this.settings.idleUnloadMinutes);
    if (!minutes || !this.runtime?.managed) return;
    this.idleTimer = setTimeout(() => this.unloadIdle().catch(() => {
    }), minutes * 6e4);
  }
  async unloadIdle() {
    if (!this.runtime?.managed) return;
    const { saveSlot: saveSlot2 } = await Promise.resolve().then(() => (init_server(), server_exports));
    await saveSlot2({ baseUrl: this.runtime.baseUrl, apiKey: this.runtime.apiKey, fetchImpl: this.fetch });
    await this.runtime.stop();
    this.engine = null;
    this.idleUnloaded = { ...this.runtime };
    this.runtime = null;
    this.setStatus(statusLine({ state: "idle", managed: true }));
  }
  setStatus(text) {
    this.statusEl.setText(text);
  }
  renderStatus({ count, inFlight, held = 0, error }) {
    const path = this.app.workspace.getActiveFile?.()?.path;
    this.setStatus(statusLine({
      state: error ? "error" : inFlight > 0 ? "checking" : this.settings.setupDone ? "ready" : "setup",
      count,
      refused: path ? this.ledger.countForNote(path) : 0,
      held,
      error,
      managed: Boolean(this.runtime?.managed)
    }));
  }
  async save() {
    await this.saveData(this.settings);
  }
};
var TolbenSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Set up the model server").setDesc("Find a running Ollama or llama-server, or download a pinned one. Shows every URL and hash before anything is fetched.").addButton((btn) => btn.setButtonText("Open setup").setCta().onClick(() => this.plugin.openSetup()));
    new import_obsidian.Setting(containerEl).setName("Model server").setDesc("OpenAI-compatible endpoint on loopback. Nothing leaves this machine.").addText((text) => text.setPlaceholder(DEFAULTS.baseUrl).setValue(this.plugin.settings.baseUrl).onChange(async (value) => {
      this.plugin.settings.baseUrl = value.trim() || DEFAULTS.baseUrl;
      this.plugin.engine = null;
      await this.plugin.save();
      this.plugin.clarity.invalidateAll();
    }));
    new import_obsidian.Setting(containerEl).setName("Mechanical fixes").setDesc("Repair unambiguous spelling and spacing faults deterministically before the model sees the sentence.").addToggle((toggle) => toggle.setValue(this.plugin.settings.mechanics).onChange(async (value) => {
      this.plugin.settings.mechanics = value;
      await this.plugin.save();
      this.plugin.clarity.invalidateAll();
    }));
    new import_obsidian.Setting(containerEl).setName("Deterministic rewrites").setDesc("Fix wordy idioms with a known short form (\u201Cin order to\u201D \u2192 \u201Cto\u201D) instantly, without asking the model.").addToggle((toggle) => toggle.setValue(this.plugin.settings.rules).onChange(async (value) => {
      this.plugin.settings.rules = value;
      await this.plugin.save();
      this.plugin.clarity.invalidateAll();
    }));
    new import_obsidian.Setting(containerEl).setName("Suggestion gate").setDesc("Balanced: sentences that look improvable (wordy phrases, passives\u2026) are checked first, the rest last \u2014 every suggestion still arrives. Fast: the rest are skipped entirely, ~40% less model time but their suggestions are lost. Off: document order.").addDropdown((dropdown) => dropdown.addOption("balanced", "Balanced \u2014 likely first, everything eventually").addOption("fast", "Fast \u2014 skip unlikely sentences").addOption("off", "Off").setValue(this.plugin.settings.gate).onChange(async (value) => {
      this.plugin.settings.gate = value;
      await this.plugin.save();
      this.plugin.clarity.invalidateAll();
    }));
    new import_obsidian.Setting(containerEl).setName("Never drop words").setDesc("Refuse any rewrite that loses a word, instead of asking the model whether the rest of the sentence still says it. Off by default: on the labelled corpora this stops no further meaning changes and costs 15 of Grammarly's own rewrites plus 48 preserving ones, and every published number was measured with it off. On is the right setting for text where a lost qualifier is a problem whatever a model thinks.").addToggle((toggle) => toggle.setValue(this.plugin.settings.neverDropWords).onChange(async (value) => {
      this.plugin.settings.neverDropWords = value;
      await this.plugin.save();
      this.plugin.clarity.invalidateAll();
    }));
    new import_obsidian.Setting(containerEl).setName("Typing delay").setDesc("How long after your last keystroke a finished sentence is sent, in milliseconds. Below about 80 the model is asked about text you are still typing; above about 400 the underline feels detached from the sentence that caused it.").addText((text) => text.setPlaceholder(String(DEFAULTS.debounceMs)).setValue(String(this.plugin.settings.debounceMs)).onChange(async (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) return;
      this.plugin.settings.debounceMs = Math.min(2e3, Math.max(40, parsed));
      await this.plugin.save();
    }));
    new import_obsidian.Setting(containerEl).setName("Unload the model when idle").setDesc("Minutes of no typing before a model server Tolben started is stopped and its memory returned, 0 to keep it loaded. Its state is saved first, so coming back costs a file read rather than a full reload. A server you started yourself is never stopped.").addText((text) => text.setPlaceholder(String(DEFAULTS.idleUnloadMinutes)).setValue(String(this.plugin.settings.idleUnloadMinutes)).onChange(async (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) return;
      this.plugin.settings.idleUnloadMinutes = parsed;
      await this.plugin.save();
      this.plugin.armIdleUnload();
    }));
    new import_obsidian.Setting(containerEl).setName("What talks to the network").setDesc("Every request this plugin has made since it loaded, counted by host.").addButton((btn) => btn.setButtonText("Show").onClick(() => this.plugin.showNetwork()));
    new import_obsidian.Setting(containerEl).setName("Connection").setDesc(this.plugin.modelName ? `Connected to ${this.plugin.modelName}` : "Not connected").addButton((button2) => button2.setButtonText("Test").onClick(async () => {
      try {
        const name = await this.plugin.connect();
        new import_obsidian.Notice(`Tolben: connected to ${name}`);
      } catch (error) {
        new import_obsidian.Notice(`Tolben: ${error.message}`);
      }
      this.display();
    }));
  }
};
