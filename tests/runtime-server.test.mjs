// The server lifecycle, driven with a fake child process and a fake HTTP client.
//
// llama-server itself is not here — CI's provisioner job spawns the real one — so what
// this file holds to account is the code around it: the flags every published number
// depends on, the readiness loop, what happens when a build the CPU cannot run is
// spawned, and the orphan reaper's refusal to signal a stranger.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  serverArgs, startServer, isHealthy, warmUp, freePort, newApiKey,
  readPidFile, writePidFile, reapOrphan, pidFilePath, saveSlot, restoreSlot, ServerError,
} from "../obsidian-plugin/runtime/server.mjs";

async function withDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "tolben-srv-"));
  try { return await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// A child process that does what the test tells it to, and records that it was asked.
function fakeChild({ pid = 4242 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal); return true; };
  return child;
}

test("the server is started with the flags every published number was measured on", () => {
  const args = serverArgs({ modelPath: "/m/q6.gguf", port: 51234, apiKey: "k", slotDir: "/s" });
  const pairs = new Map();
  for (let at = 0; at < args.length; at += 1) {
    if (args[at].startsWith("-")) pairs.set(args[at], args[at + 1]);
  }
  assert.equal(pairs.get("-m"), "/m/q6.gguf");
  assert.equal(pairs.get("--host"), "127.0.0.1", "loopback only, never 0.0.0.0");
  assert.equal(pairs.get("--port"), "51234");
  assert.equal(pairs.get("--api-key"), "k");
  assert.equal(pairs.get("-c"), "4096");
  assert.equal(pairs.get("-np"), "1");
  assert.ok(args.includes("--jinja"));
  assert.equal(pairs.get("--reasoning"), "off", "without this the model returns its thinking and an empty answer");
  assert.equal(pairs.get("--slot-save-path"), "/s");
});

test("no slot directory means no slot flag, rather than an empty one", () => {
  assert.ok(!serverArgs({ modelPath: "m", port: 1, apiKey: "k" }).includes("--slot-save-path"));
});

test("an api key is random per launch and long enough to be worth having", () => {
  const keys = new Set(Array.from({ length: 50 }, newApiKey));
  assert.equal(keys.size, 50);
  assert.ok([...keys].every((key) => key.length >= 32));
});

test("freePort returns a port nothing is listening on", async () => {
  const port = await freePort();
  assert.ok(port > 1024 && port < 65536);
});

test("startServer waits for health, records a pid file, and stops cleanly", async () => {
  await withDir(async (dir) => {
    const child = fakeChild();
    let health = 0;
    const handle = await startServer({
      binary: "/opt/llama/llama-server",
      modelPath: "/m/q6.gguf",
      stateDir: dir,
      port: 51234,
      apiKey: "secret",
      spawnImpl: () => child,
      // Not ready for the first two polls, then ready.
      fetchImpl: async () => ({ ok: (health += 1) > 2 }),
      sleep: async () => {},
    });
    assert.equal(handle.baseUrl, "http://127.0.0.1:51234");
    assert.equal(handle.apiBase, "http://127.0.0.1:51234/v1");
    assert.equal(handle.pid, 4242);

    const record = await readPidFile(dir);
    assert.equal(record.pid, 4242);
    assert.equal(record.port, 51234);
    assert.equal(record.binary, "/opt/llama/llama-server");
    assert.ok(record.startedAt, "the start time is recorded so an orphan can be recognised");

    const stopping = handle.stop();
    child.emit("exit", 0, null);
    await stopping;
    assert.deepEqual(child.signals, ["SIGTERM"]);
    assert.equal(await readPidFile(dir), null, "the pid file goes when the process does");
  });
});

test("a build the CPU cannot execute is reported so the next one can be tried", async () => {
  await withDir(async (dir) => {
    const child = fakeChild();
    const starting = startServer({
      binary: "/opt/llama/llama-server", modelPath: "/m/q6.gguf", stateDir: dir, port: 1,
      spawnImpl: () => child, fetchImpl: async () => ({ ok: false }), sleep: async () => {},
    });
    child.emit("exit", null, "SIGILL");
    await assert.rejects(starting, (error) => error instanceof ServerError
      && error.kind === "illegal-instruction");
    assert.equal(await readPidFile(dir), null);
  });
});

test("a server that dies for another reason carries its stderr into the error", async () => {
  await withDir(async (dir) => {
    const child = fakeChild();
    const starting = startServer({
      binary: "/opt/llama/llama-server", modelPath: "/m/q6.gguf", stateDir: dir, port: 1,
      spawnImpl: () => child, fetchImpl: async () => ({ ok: false }), sleep: async () => {},
    });
    child.stderr.emit("data", "error loading model: unknown quantization type\n");
    child.emit("exit", 1, null);
    await assert.rejects(starting, (error) => error.kind === "spawn"
      && /unknown quantization type/u.test(error.message));
  });
});

test("a server that never becomes ready is killed rather than waited on forever", async () => {
  await withDir(async (dir) => {
    const child = fakeChild();
    let clock = 0;
    await assert.rejects(startServer({
      binary: "/opt/llama/llama-server", modelPath: "/m/q6.gguf", stateDir: dir, port: 1,
      spawnImpl: () => child, fetchImpl: async () => ({ ok: false }),
      readyTimeoutMs: 1000, now: () => (clock += 400), sleep: async () => {},
    }), (error) => error.kind === "timeout");
    assert.deepEqual(child.signals, ["SIGTERM"]);
  });
});

test("health carries the api key, so a page that guesses the port still cannot use it", async () => {
  const seen = [];
  await isHealthy({
    baseUrl: "http://127.0.0.1:9", apiKey: "secret",
    fetchImpl: async (url, init) => { seen.push([url, init.headers.authorization]); return { ok: true }; },
  });
  assert.deepEqual(seen, [["http://127.0.0.1:9/health", "Bearer secret"]]);
});

test("an unreachable server is unhealthy rather than an exception", async () => {
  assert.equal(await isHealthy({ baseUrl: "http://127.0.0.1:9", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }), false);
});

test("warm-up asks for one token and reports how long the load took", async () => {
  let body;
  const result = await warmUp({
    apiBase: "http://127.0.0.1:9/v1", apiKey: "secret",
    fetchImpl: async (url, init) => { body = JSON.parse(init.body); return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(body.max_tokens, 1);
  assert.equal(body.temperature, 0);
  assert.ok(typeof result.ms === "number");
});

test("a failed warm-up is reported, not thrown", async () => {
  const result = await warmUp({ apiBase: "x", fetchImpl: async () => { throw new Error("nope"); } });
  assert.equal(result.ok, false);
  assert.match(result.error, /nope/u);
});

// --------------------------------------------------------------------- orphan reaping

test("an orphan from a crashed session is killed", async () => {
  await withDir(async (dir) => {
    await writePidFile(dir, { pid: 999, port: 1, binary: "/opt/llama/llama-server", startedAt: "x" });
    const killed = [];
    const result = await reapOrphan(dir, {
      processes: async () => "/opt/llama/llama-server -m /m/q6.gguf --host 127.0.0.1",
      kill: (pid, signal) => killed.push([pid, signal]),
    });
    assert.deepEqual(result, { reaped: true, pid: 999 });
    assert.deepEqual(killed, [[999, "SIGTERM"]]);
    assert.equal(await readPidFile(dir), null);
  });
});

test("a reused pid is never signalled: the recorded binary must still be running", async () => {
  await withDir(async (dir) => {
    await writePidFile(dir, { pid: 999, port: 1, binary: "/opt/llama/llama-server", startedAt: "x" });
    const killed = [];
    const result = await reapOrphan(dir, {
      processes: async () => "/usr/bin/postgres -D /var/lib/postgresql",
      kill: (pid, signal) => killed.push([pid, signal]),
    });
    assert.equal(result.reaped, false);
    assert.equal(result.reason, "pid-reused");
    assert.deepEqual(killed, [], "nothing else on this machine was touched");
    assert.equal(await readPidFile(dir), null, "the stale record is cleared either way");
  });
});

test("a pid that is already gone clears the record and kills nothing", async () => {
  await withDir(async (dir) => {
    await writePidFile(dir, { pid: 999, port: 1, binary: "/opt/llama/llama-server", startedAt: "x" });
    const killed = [];
    const result = await reapOrphan(dir, { processes: async () => null, kill: (...args) => killed.push(args) });
    assert.equal(result.reason, "already-gone");
    assert.deepEqual(killed, []);
  });
});

test("a platform that cannot be asked kills nothing", async () => {
  await withDir(async (dir) => {
    await writePidFile(dir, { pid: 999, port: 1, binary: "/opt/llama/llama-server", startedAt: "x" });
    const killed = [];
    const result = await reapOrphan(dir, {
      processes: async () => { throw new Error("no ps on this image"); },
      kill: (...args) => killed.push(args),
    });
    assert.equal(result.reaped, false);
    assert.equal(result.reason, "cannot-inspect");
    assert.deepEqual(killed, []);
    assert.ok(await readPidFile(dir), "and the record is kept, so the next launch can try again");
  });
});

test("no pid file at all is not an error", async () => {
  await withDir(async (dir) => {
    assert.deepEqual(await reapOrphan(dir), { reaped: false, reason: "no-pid-file" });
  });
});

test("a corrupt pid file reads as absent rather than throwing", async () => {
  await withDir(async (dir) => {
    await writeFile(pidFilePath(dir), "{not json");
    assert.equal(await readPidFile(dir), null);
  });
});

// ------------------------------------------------------------------------ slot save

test("saving and restoring the slot names the action and the file", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true, status: 200 }; };
  await saveSlot({ baseUrl: "http://127.0.0.1:9", apiKey: "k", fetchImpl });
  await restoreSlot({ baseUrl: "http://127.0.0.1:9", apiKey: "k", fetchImpl });
  assert.deepEqual(calls.map(([url]) => url), [
    "http://127.0.0.1:9/slots/0?action=save",
    "http://127.0.0.1:9/slots/0?action=restore",
  ]);
  assert.equal(calls[0][1].filename, "tolben-slot.bin");
});

test("the slot endpoint is the server root even when handed the OpenAI base url", async () => {
  // startServer() returns both `baseUrl` and `apiBase` (= baseUrl + "/v1"), and /slots is
  // not an OpenAI route: on the real b10760, /v1/slots/0 is a 404 while /slots/0 is a 200.
  // A mocked fetch answers either, so only an explicit assertion on the URL catches it.
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200 }; };
  await saveSlot({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "k", fetchImpl });
  await saveSlot({ baseUrl: "http://127.0.0.1:9/", apiKey: "k", fetchImpl });
  assert.deepEqual(calls, [
    "http://127.0.0.1:9/slots/0?action=save",
    "http://127.0.0.1:9/slots/0?action=save",
  ]);
});

test("a server built without slot save costs a slower reload, not an error", async () => {
  const result = await saveSlot({ baseUrl: "x", fetchImpl: async () => { throw new Error("404"); } });
  assert.equal(result.ok, false);
});
