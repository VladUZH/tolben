// Fetch every artefact in models/MANIFEST.json and verify it against its pinned sha256.
//
// The weights are gitignored, so a fresh checkout has none of them and every model-facing
// test skips. This puts them back, and — the point of the exercise — proves the bytes are
// the ones the numbers in REPORT.md were measured on.
//
//   node tools/fetch-models.mjs            # fetch what is missing, verify everything
//   node tools/fetch-models.mjs --verify   # verify only, fetch nothing
//
// Exit status is 1 if anything on disk does not match its pin.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = `${ROOT}models/MANIFEST.json`;

async function sha256(path) {
  const hash = createHash("sha256");
  const handle = await readFile(path);
  hash.update(handle);
  return hash.digest("hex");
}

async function present(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function fetchArtifact(artifact, path) {
  const url = `https://huggingface.co/${artifact.repo}/resolve/main/${artifact.file}`;
  process.stdout.write(`  fetching ${artifact.file} (${(artifact.bytes / 1e6).toFixed(0)} MB)\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await mkdir(dirname(path), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const verifyOnly = process.argv.includes("--verify");
  let bad = 0;
  for (const artifact of manifest.artifacts) {
    const path = `${ROOT}${artifact.path}`;
    if (!await present(path)) {
      if (verifyOnly) { process.stdout.write(`  MISSING  ${artifact.path}\n`); bad += 1; continue; }
      await fetchArtifact(artifact, path);
    }
    const actual = await sha256(path);
    if (actual === artifact.sha256) {
      process.stdout.write(`  ok       ${artifact.path}\n`);
      continue;
    }
    bad += 1;
    process.stdout.write(`  MISMATCH ${artifact.path}\n    pinned ${artifact.sha256}\n    ondisk ${actual}\n`);
  }
  process.stdout.write(bad === 0
    ? `\nall ${manifest.artifacts.length} artefacts match models/MANIFEST.json\n`
    : `\n${bad} artefact(s) do not match the manifest — the numbers in REPORT.md do not describe this tree\n`);
  if (bad > 0) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
