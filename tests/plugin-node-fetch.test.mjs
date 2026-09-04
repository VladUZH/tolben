// The plugin's fetch, against a real HTTP server on loopback rather than a fake.
//
// Until 2026-09-04 nothing tested this module at all, and it turned out to follow no
// redirect and expose no body — which is why the setup pane had never downloaded
// anything: GitHub and Hugging Face both answer a release URL with a 302. The server
// here does what they do: a relative redirect, an absolute one to another origin, a
// Range-capable file, a 303 after a POST, a loop, and a body that never ends.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFetch, MAX_REDIRECTS } from "../obsidian-plugin/node-fetch.mjs";
import { downloadVerified } from "../obsidian-plugin/runtime/download.mjs";

// Three megabytes of deterministic bytes: large enough to cross highWaterMark many times.
const FILE = Buffer.alloc(3 * 1024 * 1024);
for (let i = 0; i < FILE.length; i++) FILE[i] = (i * 31 + (i >> 8)) & 0xff;
const FILE_SHA256 = createHash("sha256").update(FILE).digest("hex");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    resolve({ server, port, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) });
  }));
}

// The "CDN": serves FILE with Range support and records what it was sent.
async function cdn() {
  const seen = [];
  const site = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === "/file") {
        const range = /^bytes=(\d+)-$/u.exec(req.headers.range ?? "");
        if (range) {
          const from = Number(range[1]);
          res.writeHead(206, { "content-length": FILE.length - from, "content-range": `bytes ${from}-${FILE.length - 1}/${FILE.length}` });
          res.end(FILE.subarray(from));
        } else {
          res.writeHead(200, { "content-length": FILE.length, "content-type": "application/octet-stream" });
          res.end(FILE);
        }
      } else if (req.url === "/echo") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization ?? null }));
      } else if (req.url === "/never-ends") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("some bytes, then silence");
        // and never end()
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("no such thing");
      }
    });
  });
  return { ...site, seen };
}

// The "origin": redirects, like github.com and huggingface.co do.
async function origin(cdnBase) {
  const seen = [];
  const site = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      switch (req.url) {
        case "/releases/download/file": res.writeHead(302, { location: "/hop2" }); res.end("Found"); break;
        case "/hop2": res.writeHead(302, { location: `${cdnBase}/file` }); res.end(); break;
        case "/to-echo-303": res.writeHead(303, { location: `${cdnBase}/echo` }); res.end(); break;
        case "/to-echo-307": res.writeHead(307, { location: `${cdnBase}/echo` }); res.end(); break;
        case "/to-echo-302": res.writeHead(302, { location: `${cdnBase}/echo` }); res.end(); break;
        case "/same-origin-echo": res.writeHead(302, { location: "/echo-here" }); res.end(); break;
        case "/echo-here": res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ auth: req.headers.authorization ?? null })); break;
        case "/loop": res.writeHead(302, { location: "/loop" }); res.end(); break;
        case "/nowhere": res.writeHead(302, { location: "http://[not a url" }); res.end(); break;
        default: res.writeHead(404); res.end("nope");
      }
    });
  });
  return { ...site, seen };
}

let files, site;
test.before(async () => { files = await cdn(); site = await origin(files.base); });
test.after(async () => { await site.close(); await files.close(); });

test("a redirect chain is followed — relative, then absolute to another origin — and the body streams", async () => {
  const response = await nodeFetch(`${site.base}/releases/download/file`);
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.redirected, true);
  assert.equal(response.url, `${files.base}/file`);
  assert.equal(response.headers.get("Content-Length"), String(FILE.length));
  assert.equal(response.headers.get("x-absent"), null);
  assert.equal(typeof response.body.on, "function", "the body is a Node stream");
  const chunks = [];
  for await (const chunk of response.body) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).equals(FILE), true);
});

test("downloadVerified, through the plugin's fetch, lands the file and verifies it — and resumes a partial", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tolben-fetch-"));
  try {
    const destination = join(dir, "asset.bin");
    const progress = [];
    const result = await downloadVerified({
      url: `${site.base}/releases/download/file`, destination, sha256: FILE_SHA256, bytes: FILE.length,
      fetchImpl: nodeFetch, onProgress: (p) => progress.push(p),
    });
    assert.equal(result.reused, false);
    assert.equal(result.bytes, FILE.length);
    assert.equal((await readFile(destination)).equals(FILE), true);
    assert.equal(progress.at(-1).received, FILE.length);
    assert.equal(progress.at(-1).total, FILE.length);

    // A second call must not fetch again.
    const before = files.seen.length;
    const again = await downloadVerified({ url: `${site.base}/releases/download/file`, destination, sha256: FILE_SHA256, bytes: FILE.length, fetchImpl: nodeFetch });
    assert.equal(again.reused, true);
    assert.equal(files.seen.length, before);

    // A partial on disk is resumed with a Range header, which the CDN answers with 206.
    await rm(destination);
    const half = Math.floor(FILE.length / 2);
    await writeFile(`${destination}.part`, FILE.subarray(0, half));
    const resumed = await downloadVerified({ url: `${files.base}/file`, destination, sha256: FILE_SHA256, bytes: FILE.length, fetchImpl: nodeFetch });
    assert.equal(resumed.reused, false);
    assert.equal(files.seen.at(-1).headers.range, `bytes=${half}-`);
    assert.equal((await readFile(destination)).equals(FILE), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("303, and 301/302 after a POST, become a GET without the body; 307 keeps both", async () => {
  const post = (path) => nodeFetch(`${site.base}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: 1 }),
  }).then((r) => r.json());
  assert.deepEqual(await post("/to-echo-303"), { method: "GET", body: "", auth: null });
  assert.deepEqual(await post("/to-echo-302"), { method: "GET", body: "", auth: null });
  assert.deepEqual(await post("/to-echo-307"), { method: "POST", body: JSON.stringify({ hello: 1 }), auth: null });
});

test("the authorization header is dropped across origins and kept on the same one", async () => {
  const headers = { Authorization: "Bearer secret" };
  const across = await nodeFetch(`${site.base}/to-echo-302`, { headers }).then((r) => r.json());
  assert.equal(across.auth, null, "the managed server's key must not reach a CDN");
  assert.equal(files.seen.at(-1).headers.authorization, undefined);
  const same = await nodeFetch(`${site.base}/same-origin-echo`, { headers }).then((r) => r.json());
  assert.equal(same.auth, "Bearer secret");
});

test("a redirect loop fails after the hop limit rather than hanging", async () => {
  const before = site.seen.length;
  await assert.rejects(nodeFetch(`${site.base}/loop`), new RegExp(`more than ${MAX_REDIRECTS} redirects`, "u"));
  assert.equal(site.seen.length - before, MAX_REDIRECTS + 1);
});

test("a redirect to an unusable location is an error, not a crash", async () => {
  await assert.rejects(nodeFetch(`${site.base}/nowhere`), /unusable location/u);
});

test("a 4xx is ok:false with its body readable; json() throws its own SyntaxError", async () => {
  const response = await nodeFetch(`${files.base}/missing`);
  assert.equal(response.ok, false);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "no such thing");
  await assert.rejects(nodeFetch(`${files.base}/missing`).then((r) => r.json()), SyntaxError);
});

test("an abort mid-body rejects text() with the signal's own reason", async () => {
  const controller = new AbortController();
  const response = await nodeFetch(`${files.base}/never-ends`, { signal: controller.signal });
  assert.equal(response.ok, true);
  const reading = response.text();
  setTimeout(() => controller.abort(new Error("the writer moved on")), 30);
  await assert.rejects(reading, /the writer moved on/u);
});

test("an abort before any byte rejects the fetch itself, with a TimeoutError from AbortSignal.timeout", async () => {
  await assert.rejects(nodeFetch(`${files.base}/never-ends-either`, { signal: AbortSignal.timeout(1) }).then((r) => r.text()),
    (error) => error.name === "TimeoutError");
  const gone = new AbortController(); gone.abort(new Error("already"));
  await assert.rejects(nodeFetch(`${files.base}/file`, { signal: gone.signal }), /already/u);
});
