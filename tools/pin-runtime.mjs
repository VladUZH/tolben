// Resolve the llama.cpp release assets and record them in the plugin's runtime manifest.
//
//   node tools/pin-runtime.mjs               # show what would be pinned
//   node tools/pin-runtime.mjs --write       # record it
//   node tools/pin-runtime.mjs --check       # exit 1 if the recorded pins no longer hold
//   node tools/pin-runtime.mjs --tag b1234   # a specific release instead of the newest
//   node tools/pin-runtime.mjs --list        # the last ten releases and what each carries
//   node tools/pin-runtime.mjs --json        # the resolved entries, exactly as the manifest wants them
//
// Why this is a tool rather than a hard-coded table: llama.cpp cuts several releases a
// week, and a table typed by hand is a table that is wrong. Why it is a tool rather than
// a runtime lookup: resolving the URL and its hash from the same API at the moment of
// download is not a pin, it is trust — a compromised or mistaken API would be believed.
// Running this writes the pins into a file a human reviews and commits; the provisioner
// then refuses anything that does not match them.
//
// GitHub's releases API reports each asset's `digest` as "sha256:<hex>" for releases
// published since 2025. Where it is absent the asset is downloaded and hashed here, which
// is slow but happens once per release rather than once per install.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MANIFEST = fileURLToPath(new URL("../obsidian-plugin/runtime/manifest.json", import.meta.url));

// The asset each manifest entry wants, built from the `assetShape` the manifest records
// rather than from a table here. The shapes come from llama.cpp's own release workflow:
//
//   macOS/Linux   llama-<tag>-bin-{macos,ubuntu}-<arch>.tar.gz
//   Windows       llama-<tag>-bin-win-cpu-<arch>.zip
//
// Reading them from the manifest rather than duplicating them keeps one place to change
// when llama.cpp renames something again — it has renamed things before, and the first
// version of this file held seven regexes that all stopped matching at once.
export function assetNameFor(runtime, tag) {
  if (!runtime?.assetShape || !tag) return null;
  return runtime.assetShape.replace("{tag}", tag);
}

export function matchAssets(assets, runtimes, tag) {
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const found = {};
  for (const runtime of runtimes) {
    found[runtime.id] = byName.get(assetNameFor(runtime, tag)) ?? null;
  }
  return found;
}

async function releases(count = 10) {
  const repo = JSON.parse(await readFile(MANIFEST, "utf8")).runtimeRepo;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=${count}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`releases list: HTTP ${response.status}`);
  return response.json();
}

async function release(tag) {
  const repo = JSON.parse(await readFile(MANIFEST, "utf8")).runtimeRepo;
  const url = tag
    ? `https://api.github.com/repos/${repo}/releases/tags/${tag}`
    : `https://api.github.com/repos/${repo}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}. `
      + "This tool needs the GitHub releases API; run it from a machine that can reach it, or in CI.");
  }
  return response.json();
}

// Which release to pin.
//
// llama.cpp cuts a build several times a day and marks EVERY ONE of them a prerelease.
// The repository's only non-prerelease is `v0.3.0`, which carries a single asset and none
// of the server binaries — so `/releases/latest`, which by definition skips prereleases,
// answers a question nobody asked. That is what the first CI run of this tool reported:
//
//   release v0.3.0 (1 assets)
//   UNMATCHED macos-arm64 ...   (and six more)
//
// and it was read here, at first, as llama.cpp having moved to semantic versions. It had
// not. The build tags are exactly where they always were; `latest` was simply the wrong
// place to look for them.
//
// The right question is "the newest release that can serve every platform the manifest
// asks for", which is what this asks. Newest first, drafts skipped, and the first release
// carrying all of them wins — so a build still uploading when we looked, or one whose
// macOS job failed, is passed over rather than pinned half-complete. That last property
// matters more than it sounds: a partial pin would leave one platform null, which the
// provisioner reports as "no build for your machine" to someone whose machine is fine.
export async function pickRelease(entries, runtimes) {
  for (const entry of entries) {
    if (entry.draft) continue;
    const matched = matchAssets(entry.assets ?? [], runtimes, entry.tag_name);
    if (runtimes.every((runtime) => matched[runtime.id])) return entry;
  }
  return null;
}

async function hashRemote(url) {
  const response = await fetch(url, { headers: { accept: "application/octet-stream" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const hash = createHash("sha256");
  for await (const chunk of response.body) hash.update(chunk);
  return hash.digest("hex");
}

export function digestOf(asset) {
  const digest = asset?.digest ?? "";
  const match = /^sha256:([0-9a-f]{64})$/u.exec(digest);
  return match ? match[1] : null;
}

async function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const tagAt = process.argv.indexOf("--tag");
  const wanted = tagAt >= 0 ? process.argv[tagAt + 1] : null;

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const pinned = check ? manifest.runtimeTag : wanted;
  let data;
  if (pinned) {
    data = await release(pinned);
  } else {
    const recent = await releases(30);
    data = await pickRelease(recent, manifest.runtimes);
    if (!data) {
      const seen = recent.slice(0, 5).map((entry) => entry.tag_name).join(", ");
      process.stdout.write(`No release among the newest ${recent.length} (${seen}, …) carries all `
        + `${manifest.runtimes.length} assets the manifest asks for.\n`
        + "Run --list to see what they do carry, and fix `assetShape` in "
        + "obsidian-plugin/runtime/manifest.json.\n");
      process.exitCode = 1;
      return;
    }
  }
  const matched = matchAssets(data.assets ?? [], manifest.runtimes, data.tag_name);
  if (process.argv.includes("--list")) {
    // One line per release: how many of the manifest's six it carries, and its total
    // asset count. This used to print every asset of every release — 280 lines on every
    // push, which is a dump rather than a report, and it buried the pin resolution that
    // is the thing anyone reads this job for. The full asset list is still printed, by
    // the main path, exactly when something fails to match and the question arises.
    for (const entry of await releases()) {
      const found = matchAssets(entry.assets ?? [], manifest.runtimes, entry.tag_name);
      const have = manifest.runtimes.filter((runtime) => found[runtime.id]).length;
      process.stdout.write(`  ${have === manifest.runtimes.length ? "complete" : "PARTIAL "} `
        + `${entry.tag_name.padEnd(12)} ${have}/${manifest.runtimes.length} wanted, `
        + `${(entry.assets ?? []).length} assets${entry.draft ? ", DRAFT" : ""}`
        + `${entry.prerelease ? ", prerelease" : ""}\n`);
    }
    return;
  }

  const assets = data.assets ?? [];
  process.stdout.write(`release ${data.tag_name} (${assets.length} assets)\n\n`);

  let unresolved = 0;
  let drifted = 0;
  const resolved = [];
  for (const runtime of manifest.runtimes) {
    const asset = matched[runtime.id];
    if (!asset) {
      unresolved += 1;
      process.stdout.write(`  UNMATCHED ${runtime.id.padEnd(20)} no asset named ${assetNameFor(runtime, data.tag_name)}\n`);
      resolved.push({ ...runtime, asset: null, bytes: null, sha256: null });
      continue;
    }
    let sha256 = digestOf(asset);
    if (!sha256) {
      process.stdout.write(`  hashing   ${runtime.id.padEnd(20)} ${asset.name} (the API reported no digest)\n`);
      sha256 = await hashRemote(asset.browser_download_url);
    }
    const changed = runtime.sha256 && runtime.sha256 !== sha256;
    if (changed) drifted += 1;
    process.stdout.write(`  ${changed ? "DRIFTED  " : "ok       "} ${runtime.id.padEnd(20)} ${asset.name}  ${(asset.size / 1e6).toFixed(1)} MB  ${sha256.slice(0, 12)}…\n`);
    resolved.push({ ...runtime, asset: asset.name, bytes: asset.size, sha256 });
  }

  // The exact bytes the manifest wants. The table above rounds sizes to MB and truncates
  // hashes to twelve characters, which is right for reading a log and useless for copying
  // one — and copying is how a pin resolved in CI reaches the file, on a machine that
  // cannot reach the releases API to run --write itself. `--check` then re-verifies the
  // transcription against the API on the next push, which is what makes copying safe.
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({
      runtimeTag: data.tag_name,
      pinned: new Date().toISOString().slice(0, 10),
      runtimes: resolved,
    }, null, 1)}\n`);
    return;
  }

  if (check) {
    const stale = resolved.filter((runtime, index) => {
      const before = manifest.runtimes[index];
      return before.sha256 && before.sha256 !== runtime.sha256;
    });
    // Every unmatched entry is a failure under --check: the release was re-cut with an
    // asset missing, or renamed one. Under a bare run it is only a report, because a
    // manifest with nothing pinned yet is a state the provisioner handles deliberately.
    if (unresolved > 0) {
      process.stdout.write(`\n${unresolved} pinned asset(s) are no longer in ${data.tag_name} at all\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(stale.length === 0
      ? `\nall pinned assets still hash to what obsidian-plugin/runtime/manifest.json records\n`
      : `\n${stale.length} pinned asset(s) no longer match: the release was re-cut, or something is wrong\n`);
    if (stale.length > 0) process.exitCode = 1;
    return;
  }

  // What the release ACTUALLY carries, whenever an asset was not found. Without this the
  // output says only that a name did not match, which is the least useful half of the
  // information — the first run of this tool printed seven failed patterns and could not
  // say what to change them to.
  if (unresolved > 0) {
    process.stdout.write(`\nWhat ${data.tag_name} actually carries:\n`);
    if (assets.length === 0) process.stdout.write("  (no assets at all — is this a source-only release?)\n");
    for (const asset of assets) {
      process.stdout.write(`  ${asset.name}  ${(asset.size / 1e6).toFixed(1)} MB  ${digestOf(asset) ?? "no digest"}\n`);
    }
    process.stdout.write("\nIf the naming has changed, `assetShape` in obsidian-plugin/runtime/manifest.json is what to update.\n");
  }

  if (!write) {
    process.stdout.write(`\n${unresolved} unmatched, ${drifted} drifted. Nothing written; pass --write to record it.\n`);
    return;
  }

  manifest.runtimeTag = data.tag_name;
  manifest.runtimes = resolved;
  manifest.pinned = new Date().toISOString().slice(0, 10);
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`\nwritten: ${resolved.filter((runtime) => runtime.sha256).length} of ${resolved.length} platforms pinned to ${data.tag_name}\n`);
}

const runDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (runDirectly) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
