// Local-only backend. Serves the demo and forwards one sentence at a time to a
// llama.cpp server on loopback. No text leaves this machine.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "./src/engine.mjs";
import { analyzeSentence } from "./src/pipeline.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const MODEL_BASE_URL = process.env.MODEL_BASE_URL ?? "http://127.0.0.1:8080/v1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const prompt = await readFile(join(ROOT, "src/clarity-prompt.txt"), "utf8");
const verifierPrompt = await readFile(join(ROOT, "src/verifier-prompt.txt"), "utf8");
let engine = null;
let modelName = null;

async function connect() {
  const response = await fetch(`${MODEL_BASE_URL.replace(/\/$/u, "")}/models`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`model server HTTP ${response.status}`);
  modelName = (await response.json())?.data?.[0]?.id ?? "local";
  engine = createEngine({ baseUrl: MODEL_BASE_URL, model: modelName, prompt, verifierPrompt, timeoutMs: 12000 });
  return modelName;
}

function json(response, status, body) {
  // A client that walked away leaves nothing to answer; writing anyway raises on the
  // dead socket, and an unhandled response error would take the process with it.
  if (response.writableEnded || response.destroyed) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error("Sentence payload is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Every request target is attacker-shaped: an absent or malformed Host header must not
// be allowed to reach `new URL`, which throws on `http://`.
function requestURL(request) {
  const host = request.headers.host?.trim();
  try {
    return new URL(request.url, `http://${host || "127.0.0.1"}`);
  } catch {
    return null;
  }
}

async function handle(request, response) {
  const url = requestURL(request);
  if (!url) return json(response, 400, { error: "bad request" });

  if (url.pathname === "/api/status") {
    if (!engine) {
      try { await connect(); } catch (error) {
        return json(response, 200, { ready: false, error: error.message, baseUrl: MODEL_BASE_URL });
      }
    }
    return json(response, 200, { ready: true, model: modelName, baseUrl: MODEL_BASE_URL });
  }

  if (url.pathname === "/api/rewrite" && request.method === "POST") {
    let body;
    try { body = await readBody(request); } catch (error) { return json(response, 400, { error: error.message }); }
    // `null`, `5` and `[]` are all valid JSON: reach for `.sentence` defensively.
    const sentence = typeof body?.sentence === "string" ? body.sentence.trim() : "";
    if (!sentence) return json(response, 400, { error: "sentence is required" });
    if (!engine) {
      try { await connect(); } catch (error) { return json(response, 503, { error: error.message }); }
    }
    const controller = new AbortController();
    // `aborted` never fires once the body has been read; only the response reports the
    // socket closing. Without this the model keeps generating for a sentence nobody is
    // waiting for, and with `-np 1` that blocks the sentence the writer is now on.
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    const started = Date.now();
    try {
      const outcome = await analyzeSentence(sentence, {
        engine,
        signal: controller.signal,
        mechanics: body.mechanics !== false,
        rules: body.rules !== false,
        // On by default: the demo runs against the same single-slot server. `gate:false`
        // in the body turns it off per request.
        gate: body.gate !== false,
      });
      const payload = { ...outcome, totalMs: Date.now() - started, model: modelName };
      // The pipeline reports an unreachable model inside a normal outcome. Answering 200
      // would tell the editor the sentence is clear and it would never be looked at
      // again, so a failed analysis has to arrive as a failure.
      if (outcome.error) return json(response, 503, payload);
      return json(response, 200, payload);
    } catch (error) {
      return json(response, 500, { error: error.message });
    }
  }

  // Static files, restricted to this directory.
  const relative = url.pathname === "/" ? "public/index.html"
    : url.pathname.startsWith("/src/") ? url.pathname.slice(1)
    : join("public", url.pathname.slice(1));
  const target = join(ROOT, normalize(relative).replace(/^(\.\.[/\\])+/u, ""));
  if (!target.startsWith(ROOT)) return json(response, 403, { error: "forbidden" });
  try {
    await stat(target);
    const body = await readFile(target);
    response.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    json(response, 404, { error: "not found" });
  }
}

// Nothing a request can contain may reject out of the handler: on Node an unhandled
// rejection here is fatal, so one bad byte from a browser would take the demo down.
const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    process.stderr.write(`request failed: ${error?.stack ?? error}\n`);
    try {
      json(response, 500, { error: "internal error" });
    } catch {
      response.destroy();
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`tolben demo on http://127.0.0.1:${PORT}  (model: ${MODEL_BASE_URL})\n`);
});
