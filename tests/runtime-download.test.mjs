// The downloader, against a real HTTP server that can be told to misbehave.
//
// Everything here is loopback and a few kilobytes; the properties under test are about
// interruption and verification, and neither needs a large file to demonstrate.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVerified, DownloadError } from "../obsidian-plugin/runtime/download.mjs";

const PAYLOAD = randomBytes(64 * 1024);
const DIGEST = createHash("sha256").update(PAYLOAD).digest("hex");

// The knobs a test turns: whether Range is honoured, whether the body is truncated, and
// how many requests have been made.
function serve(state) {
  const server = http.createServer((request, response) => {
    state.requests.push(request.headers.range ?? null);
    if (state.status && state.status !== 200) {
      response.writeHead(state.status);
      response.end("no");
      return;
    }
    const body = state.corrupt ? Buffer.concat([PAYLOAD.subarray(0, PAYLOAD.length - 1), Buffer.from([0])]) : PAYLOAD;
    const range = state.honourRange ? /bytes=(\d+)-/u.exec(request.headers.range ?? "") : null;
    const from = range ? Number(range[1]) : 0;
    const slice = body.subarray(from);
    // A truncated response advertises the FULL length and then dies mid-body, which is
    // what a dropped connection looks like. Sending a short body with a matching
    // content-length would be a complete, valid, wrong response — a different failure.
    const cutShort = state.truncateAfter && state.requests.length === 1;
    response.writeHead(range ? 206 : 200, {
      "content-length": String(slice.length),
      ...(range ? { "content-range": `bytes ${from}-${body.length - 1}/${body.length}` } : {}),
    });
    if (!cutShort) {
      response.end(slice);
      return;
    }
    response.write(slice.subarray(0, state.truncateAfter));
    setTimeout(() => response.destroy(), 10);
  });
  return server;
}

async function withServer(state, run) {
  const server = serve(state);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/artifact.bin`;
  const dir = await mkdtemp(join(tmpdir(), "tolben-dl-"));
  try {
    return await run({ url, dir, dest: join(dir, "artifact.bin") });
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("a download is verified against its pin and lands under its final name", async () => {
  await withServer({ requests: [], honourRange: true }, async ({ url, dest }) => {
    const seen = [];
    const result = await downloadVerified({
      url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length,
      onProgress: (progress) => seen.push(progress),
    });
    assert.equal(result.bytes, PAYLOAD.length);
    assert.equal(result.reused, false);
    assert.deepEqual(await readFile(dest), PAYLOAD);
    assert.ok(seen.length > 0, "progress is reported");
    assert.equal(seen.at(-1).received, PAYLOAD.length);
    await assert.rejects(stat(`${dest}.part`), "the .part file is gone once the hash matches");
  });
});

test("an artefact with no pinned hash is never fetched", async () => {
  await withServer({ requests: [], honourRange: true }, async ({ url, dest, dir }) => {
    const state = { requests: [] };
    await assert.rejects(
      downloadVerified({ url, destination: dest, sha256: null, fetchImpl: () => { state.requests.push(1); } }),
      (error) => error instanceof DownloadError && /no pinned sha256/u.test(error.message),
    );
    assert.equal(state.requests.length, 0, "not one byte was requested");
    void dir;
  });
});

test("bytes that do not match the pin are refused and never renamed", async () => {
  await withServer({ requests: [], honourRange: true, corrupt: true }, async ({ url, dest }) => {
    await assert.rejects(
      downloadVerified({ url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length, retries: 0 }),
      (error) => error.kind === "hash" && /does not match its pin/u.test(error.message),
    );
    await assert.rejects(stat(dest), "nothing was written to the destination");
  });
});

test("an interrupted download resumes from what is on disk", async () => {
  const state = { requests: [], honourRange: true, truncateAfter: 8 * 1024 };
  await withServer(state, async ({ url, dest }) => {
    await assert.rejects(downloadVerified({
      url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length, retries: 0,
    }));
    const partial = await stat(`${dest}.part`);
    assert.ok(partial.size > 0 && partial.size < PAYLOAD.length, "a partial file survived");

    const result = await downloadVerified({ url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length });
    assert.deepEqual(await readFile(dest), PAYLOAD);
    assert.equal(result.bytes, PAYLOAD.length);
    assert.match(state.requests.at(-1) ?? "", /^bytes=\d+-$/u, "the second request asked for the rest");
  });
});

test("a server that ignores Range is not appended to", async () => {
  // The failure this prevents: 8 KB on disk, a 200 response carrying the whole file, and
  // a 72 KB file whose hash is wrong for a reason nobody can reconstruct.
  const state = { requests: [], honourRange: false, truncateAfter: 8 * 1024 };
  await withServer(state, async ({ url, dest }) => {
    await assert.rejects(downloadVerified({
      url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length, retries: 0,
    }));
    const result = await downloadVerified({ url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length });
    assert.equal(result.bytes, PAYLOAD.length);
    assert.deepEqual(await readFile(dest), PAYLOAD);
  });
});

test("a corrupted partial file is discarded rather than completed", async () => {
  const state = { requests: [], honourRange: true };
  await withServer(state, async ({ url, dest }) => {
    await writeFile(`${dest}.part`, Buffer.alloc(8 * 1024, 0xff));
    const result = await downloadVerified({ url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length });
    assert.deepEqual(await readFile(dest), PAYLOAD, "the wrong prefix did not survive into the file");
    assert.equal(result.reused, false);
  });
});

test("a file already on disk and already correct is not fetched again", async () => {
  const state = { requests: [], honourRange: true };
  await withServer(state, async ({ url, dest }) => {
    await writeFile(dest, PAYLOAD);
    const result = await downloadVerified({ url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length });
    assert.equal(result.reused, true);
    assert.equal(state.requests.length, 0, "the server was never asked");
  });
});

test("a file on disk with the wrong bytes is replaced, not trusted", async () => {
  const state = { requests: [], honourRange: true };
  await withServer(state, async ({ url, dest }) => {
    await writeFile(dest, Buffer.alloc(PAYLOAD.length, 0x41));
    const result = await downloadVerified({ url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length });
    assert.equal(result.reused, false);
    assert.deepEqual(await readFile(dest), PAYLOAD);
  });
});

test("a server error is retried, and gives up with a network error", async () => {
  const state = { requests: [], honourRange: true, status: 503 };
  await withServer(state, async ({ url, dest }) => {
    await assert.rejects(
      downloadVerified({ url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length, retries: 1 }),
      (error) => error.kind === "network",
    );
    assert.equal(state.requests.length, 2, "one retry, not an unbounded loop");
  });
});

test("a cancelled download reports the cancellation rather than a failure", async () => {
  const state = { requests: [], honourRange: true };
  await withServer(state, async ({ url, dest }) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      downloadVerified({
        url, destination: dest, sha256: DIGEST, bytes: PAYLOAD.length, signal: controller.signal,
      }),
      (error) => error.kind === "aborted",
    );
  });
});
