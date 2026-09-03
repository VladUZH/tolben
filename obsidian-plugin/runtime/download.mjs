// A download that can be interrupted and resumed, and that is never trusted.
//
// Three properties, each of which cost something to get wrong at least once in a project
// like this one:
//
//   1. The hash is computed over the bytes that landed ON DISK, not over the response
//      stream. A stream hash proves the server sent the right thing; a disk hash proves
//      the file is the right thing, which is the claim actually being made.
//   2. A resumed download re-hashes what is already there before asking for the rest, so
//      a partial file corrupted by a crash cannot be silently completed into a file whose
//      hash is wrong for reasons nobody can reconstruct.
//   3. The file is written to `<name>.part` and renamed only after the hash matches, so
//      the destination path either does not exist or holds verified bytes. Nothing can
//      observe a half-written model.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class DownloadError extends Error {
  constructor(message, { kind = "failed", cause } = {}) {
    super(message, { cause });
    this.name = "DownloadError";
    this.kind = kind; // "network" | "hash" | "range" | "failed" | "aborted"
  }
}

async function sizeOf(path) {
  try { return (await stat(path)).size; } catch { return 0; }
}

async function hashOf(path, { hash = createHash("sha256") } = {}) {
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

// The hash of a partial file, kept open so the rest of the download can be appended to
// the same digest rather than re-read at the end.
async function resumeHash(path, bytes) {
  const hash = createHash("sha256");
  if (bytes === 0) return hash;
  await pipeline(createReadStream(path, { start: 0, end: bytes - 1 }), hash, { end: false });
  return hash;
}

/**
 * Fetch `url` to `destination`, verifying it against `sha256`.
 *
 * `onProgress({ received, total })` is called as bytes land. `signal` aborts. A `.part`
 * file left by an earlier attempt is resumed when the server honours a Range request and
 * discarded when it does not.
 */
export async function downloadVerified({
  url,
  destination,
  sha256,
  bytes = null,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
  signal,
  retries = 2,
} = {}) {
  if (!/^[0-9a-f]{64}$/u.test(String(sha256))) {
    throw new DownloadError(`Refusing to download ${url}: no pinned sha256`, { kind: "failed" });
  }
  await mkdir(dirname(destination), { recursive: true });

  // Already there and correct: the common case on a second run, and it must not re-fetch.
  if (await sizeOf(destination) > 0) {
    const existing = await hashOf(destination);
    if (existing === sha256) return { path: destination, bytes: await sizeOf(destination), reused: true };
    await rm(destination, { force: true });
  }

  const partial = `${destination}.part`;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await attemptDownload({ url, destination, partial, sha256, bytes, fetchImpl, onProgress, signal });
    } catch (error) {
      if (error.kind === "aborted" || signal?.aborted) throw error;
      // A hash mismatch is deterministic for these bytes: the partial file is wrong and
      // resuming it would fail identically, so it is discarded before the retry.
      if (error.kind === "hash") await rm(partial, { force: true });
      if (attempt > retries) throw error;
    }
  }
}

async function attemptDownload({ url, destination, partial, sha256, bytes, fetchImpl, onProgress, signal }) {
  let have = await sizeOf(partial);
  // A partial larger than the pinned size is not a prefix of anything: start again.
  if (bytes && have >= bytes) { await rm(partial, { force: true }); have = 0; }

  const headers = have > 0 ? { range: `bytes=${have}-` } : {};
  let response;
  try {
    response = await fetchImpl(url, { headers, signal });
  } catch (error) {
    if (signal?.aborted) throw new DownloadError("Download cancelled", { kind: "aborted", cause: error });
    throw new DownloadError(`${url}: ${error.message}`, { kind: "network", cause: error });
  }

  // 206 means the range was honoured. 200 with a range asked means it was not, and the
  // body is the whole file — so what is on disk is worthless and must not be appended to.
  if (have > 0 && response.status !== 206) {
    await rm(partial, { force: true });
    have = 0;
  }
  if (!response.ok && response.status !== 206) {
    throw new DownloadError(`${url}: HTTP ${response.status}`, {
      kind: response.status >= 500 || response.status === 429 ? "network" : "failed",
    });
  }

  const hash = await resumeHash(partial, have);
  const advertised = Number(response.headers?.get?.("content-length") ?? 0);
  const total = bytes ?? (advertised > 0 ? have + advertised : null);
  let received = have;
  onProgress({ received, total });

  const body = response.body && typeof response.body.getReader === "function"
    ? Readable.fromWeb(response.body)
    : response.body;
  if (!body) throw new DownloadError(`${url}: response carried no body`, { kind: "network" });

  const sink = createWriteStream(partial, { flags: have > 0 ? "a" : "w" });
  body.on?.("data", (chunk) => {
    hash.update(chunk);
    received += chunk.length;
    onProgress({ received, total });
  });
  try {
    await pipeline(body, sink, { signal });
  } catch (error) {
    if (signal?.aborted) throw new DownloadError("Download cancelled", { kind: "aborted", cause: error });
    throw new DownloadError(`${url}: ${error.message}`, { kind: "network", cause: error });
  }

  const digest = hash.digest("hex");
  if (digest !== sha256) {
    throw new DownloadError(
      `${url} does not match its pin.\n  pinned ${sha256}\n  gotten ${digest}`,
      { kind: "hash" },
    );
  }
  if (bytes && received !== bytes) {
    throw new DownloadError(`${url}: expected ${bytes} bytes, wrote ${received}`, { kind: "hash" });
  }
  await rename(partial, destination);
  return { path: destination, bytes: received, reused: false };
}

export { hashOf };
