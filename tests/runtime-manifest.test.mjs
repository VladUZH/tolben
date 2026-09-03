// The manifest and what is chosen from it. Pure functions, so the whole matrix of
// platform, architecture and CPU features can be walked without a machine of each kind.

import test from "node:test";
import assert from "node:assert/strict";
import {
  manifest, models, modelById, runtimeCandidates, selectRuntime, isPinned, runtimeUrl,
  downloadPlan, MEASURED_MODEL,
} from "../obsidian-plugin/runtime/manifest.mjs";
import { cpuFeatures, isIllegalInstruction } from "../obsidian-plugin/runtime/cpu.mjs";
import { detectOllama, detectLlamaServer, detectRunning, hasPinnedModel } from "../obsidian-plugin/runtime/detect.mjs";

test("every model in the manifest is pinned, sourced and licensed", () => {
  assert.ok(models().length >= 1);
  for (const model of models()) {
    assert.ok(isPinned(model), `${model.id} is not pinned`);
    assert.ok(model.sources.length >= 1, `${model.id} has no source`);
    for (const url of model.sources) assert.match(url, /^https:\/\//u, `${model.id}: ${url}`);
    assert.equal(model.licence, "Apache-2.0");
    assert.ok(model.ollama, `${model.id} has no Ollama tag`);
  }
});

test("the measured artefact is the one models/MANIFEST.json pins for the bench", async () => {
  // Two manifests, one artefact: if they ever disagree, the plugin is serving a model no
  // published number describes.
  const bench = JSON.parse(await (await import("node:fs/promises")).readFile(
    new URL("../models/MANIFEST.json", import.meta.url), "utf8"));
  const benchModel = bench.artifacts.find((artifact) => artifact.path.endsWith(".gguf"));
  const runtimeModel = modelById(MEASURED_MODEL);
  assert.equal(runtimeModel.sha256, benchModel.sha256);
  assert.equal(runtimeModel.bytes, benchModel.bytes);
  assert.equal(runtimeModel.measured, true);
});

test("exactly one model is marked as the measured one", () => {
  assert.deepEqual(models().filter((model) => model.measured).map((model) => model.id), [MEASURED_MODEL]);
});

test("an unpinned artefact never counts as pinned", () => {
  assert.equal(isPinned({ sha256: null, bytes: 10 }), false);
  assert.equal(isPinned({ sha256: "abc", bytes: 10 }), false, "a truncated hash is not a hash");
  assert.equal(isPinned({ sha256: "a".repeat(64), bytes: null }), false, "a size is part of the pin");
  assert.equal(isPinned({ sha256: "A".repeat(64), bytes: 10 }), false, "hex is lower case");
  assert.equal(isPinned({ sha256: "a".repeat(64), bytes: 10 }), true);
});

test("no current build requires a CPU feature, because llama.cpp dispatches at runtime", () => {
  // Its CPU release carries ggml-cpu-sse42, ggml-cpu-sapphirerapids and the rest inside
  // one archive and picks at load time, so there is no separate non-AVX2 asset to fall
  // back to. An entry that required something would have nothing to fall back TO, which
  // is worse than not requiring it: the machine would be told no build exists.
  for (const runtime of manifest.runtimes) {
    assert.deepEqual(runtime.requires, [], `${runtime.id} requires ${runtime.requires}`);
  }
  const candidates = runtimeCandidates({ platform: "linux", arch: "x64", features: [] });
  assert.deepEqual(candidates.map((runtime) => runtime.id), ["linux-x64"],
    "so a machine reporting no features still gets the build");
});

test("the preference ordering still works, for when a fallback build returns", () => {
  // The mechanism is kept because llama.cpp has shipped per-feature builds before and may
  // again, and because server.mjs walks this list after an illegal-instruction death.
  const fleet = [
    { id: "plain", platform: "linux", arch: "x64", requires: [] },
    { id: "avx2", platform: "linux", arch: "x64", requires: ["avx2"] },
    { id: "elsewhere", platform: "darwin", arch: "arm64", requires: [] },
  ];
  const order = (features) => fleet
    .filter((r) => r.platform === "linux" && r.arch === "x64")
    .filter((r) => r.requires.every((f) => features.includes(f)))
    .sort((a, b) => b.requires.length - a.requires.length)
    .map((r) => r.id);
  assert.deepEqual(order(["avx2"]), ["avx2", "plain"]);
  assert.deepEqual(order([]), ["plain"]);
});

test("every platform Obsidian desktop runs on has a candidate build", () => {
  for (const [platform, arch] of [["darwin", "arm64"], ["darwin", "x64"], ["linux", "x64"], ["win32", "x64"], ["win32", "arm64"]]) {
    assert.ok(runtimeCandidates({ platform, arch, features: ["avx2"] }).length > 0, `${platform}/${arch}`);
  }
});

test("an unknown platform is reported rather than guessed at", () => {
  const chosen = selectRuntime({ platform: "aix", arch: "ppc64" });
  assert.equal(chosen.runtime, null);
  assert.equal(chosen.reason, "unsupported-platform");
  assert.match(chosen.detail, /aix\/ppc64/u);
});

test("an unpinned build is refused with instructions, not fetched on trust", () => {
  // Every entry in the manifest is pinned now, so this refusal cannot be reached through
  // it — which is exactly why the table is injected rather than read. "Nothing arrives
  // from a URL nobody recorded a hash for" is the promise the whole provisioner is built
  // around, and it must be checked on purpose rather than as a side effect of what the
  // repository happens to contain this week.
  const unpinned = [{
    id: "darwin-arm64-hypothetical", platform: "darwin", arch: "arm64", requires: [],
    assetShape: "llama-{tag}-bin-macos-arm64.tar.gz", asset: null, bytes: null, sha256: null,
    binary: "llama-server", strip: 1,
  }];
  const chosen = selectRuntime({ platform: "darwin", arch: "arm64", runtimes: unpinned });
  assert.equal(chosen.runtime, null);
  assert.equal(chosen.reason, "unpinned");
  assert.match(chosen.detail, /pin-runtime/u);
  assert.match(chosen.detail, /Ollama|llama-server/u);

  // A recorded size with no hash, or a hash of the wrong shape, is not a pin either.
  for (const half of [{ bytes: 11072707, sha256: null }, { bytes: 11072707, sha256: "deadbeef" },
    { bytes: 0, sha256: "a".repeat(64) }]) {
    const runtimes = [{ ...unpinned[0], ...half }];
    assert.equal(selectRuntime({ platform: "darwin", arch: "arm64", runtimes }).reason, "unpinned",
      `${JSON.stringify(half)} was treated as a pin`);
  }
});

test("this checkout is pinned, and every entry of it", () => {
  // The other side of the same coin: with the manifest as committed, all six platforms
  // resolve to a downloadable artefact. Nothing here is a hypothetical.
  for (const runtime of manifest.runtimes) {
    const chosen = selectRuntime({ platform: runtime.platform, arch: runtime.arch, features: ["avx2"] });
    assert.equal(chosen.reason, null, `${runtime.id}: ${chosen.detail}`);
    assert.equal(chosen.runtime.id, runtime.id);
    assert.match(chosen.runtime.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(chosen.runtime.bytes > 1_000_000, `${runtime.id} has an implausible size`);
    assert.equal(chosen.runtime.asset, runtime.assetShape.replace("{tag}", manifest.runtimeTag));
    assert.equal(runtimeUrl(chosen.runtime),
      `https://github.com/ggml-org/llama.cpp/releases/download/${manifest.runtimeTag}/${runtime.asset}`);
  }
});

test("a runtime URL needs both a tag and an asset name", () => {
  assert.equal(runtimeUrl({ asset: "llama.zip" }, { tag: null }), null);
  assert.equal(runtimeUrl({ asset: null }, { tag: "b1234" }), null);
  assert.equal(
    runtimeUrl({ asset: "llama.zip" }, { tag: "b1234", repo: "ggml-org/llama.cpp" }),
    "https://github.com/ggml-org/llama.cpp/releases/download/b1234/llama.zip",
  );
});

test("the download plan is ordered runtime first, model second", () => {
  // The runtime is 100x smaller, so a failure to fetch it is discovered in seconds
  // rather than after twenty minutes of model download.
  const kinds = downloadPlan({ platform: "darwin", arch: "arm64" }).items.map((item) => item.kind);
  assert.ok(!kinds.includes("runtime") || kinds.indexOf("runtime") < kinds.indexOf("model"));
});

test("no manifest entry is half-pinned", () => {
  for (const runtime of manifest.runtimes) {
    const pieces = [runtime.asset, runtime.bytes, runtime.sha256];
    const filled = pieces.filter((piece) => piece !== null).length;
    assert.ok(filled === 0 || filled === 3, `${runtime.id} is partly pinned: ${JSON.stringify(pieces)}`);
  }
});

// --------------------------------------------------------------------------- cpu

test("AVX2 is read from the flags line on Linux", async () => {
  const yes = await cpuFeatures({ platform: "linux", arch: "x64", readFile: async () => "processor\t: 0\nflags\t\t: fpu avx avx2 bmi2\n" });
  assert.deepEqual(yes, ["avx2"]);
  const no = await cpuFeatures({ platform: "linux", arch: "x64", readFile: async () => "flags\t\t: fpu avx\n" });
  assert.deepEqual(no, [], "avx is not avx2");
});

test("an arm machine is never asked about x86 instruction sets", async () => {
  assert.deepEqual(await cpuFeatures({ platform: "darwin", arch: "arm64" }), []);
  assert.deepEqual(await cpuFeatures({ platform: "win32", arch: "arm64" }), []);
});

test("macOS is asked through sysctl", async () => {
  const asked = [];
  const features = await cpuFeatures({
    platform: "darwin", arch: "x64",
    run: async (command, args) => { asked.push([command, ...args]); return { stdout: "AVX1.0 AVX2 BMI1 BMI2" }; },
  });
  assert.deepEqual(features, ["avx2"]);
  assert.deepEqual(asked, [["sysctl", "-n", "machdep.cpu.leaf7_features"]]);
});

test("a machine that cannot be asked is assumed capable and checked by running it", async () => {
  // The run check in server.mjs is the real gate; guessing wrong here costs one failed
  // spawn, and guessing the other way would deny AVX2 builds to every Windows machine.
  assert.deepEqual(await cpuFeatures({ platform: "win32", arch: "x64" }), ["avx2"]);
  assert.deepEqual(await cpuFeatures({ platform: "linux", arch: "x64", readFile: async () => { throw new Error("no /proc"); } }), ["avx2"]);
});

test("an illegal instruction is recognised on both POSIX and Windows", () => {
  assert.equal(isIllegalInstruction({ signal: "SIGILL" }), true);
  assert.equal(isIllegalInstruction({ code: 0xC000001D }), true);
  assert.equal(isIllegalInstruction({ code: 0xC000001D - 0x100000000 }), true);
  assert.equal(isIllegalInstruction({ code: 1 }), false);
  assert.equal(isIllegalInstruction({ signal: "SIGTERM" }), false);
  assert.equal(isIllegalInstruction({}), false);
});

// ------------------------------------------------------------------------ detection

test("Ollama is recognised by its tag list", async () => {
  const found = await detectOllama({ fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: "llama3:8b" }] }) }) });
  assert.equal(found.kind, "ollama");
  assert.equal(found.apiBase, "http://127.0.0.1:11434/v1");
  assert.deepEqual(found.models, ["llama3:8b"]);
});

test("something else answering on the port is not Ollama", async () => {
  assert.equal(await detectOllama({ fetchImpl: async () => ({ ok: true, json: async () => ({ hello: "world" }) }) }), null);
});

test("llama-server is recognised by the model it was started on", async () => {
  const found = await detectLlamaServer({ fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: "Qwen3.5-2B-Q6_K" }] }) }) });
  assert.equal(found.kind, "llama-server");
  assert.deepEqual(found.models, ["Qwen3.5-2B-Q6_K"]);
});

test("nothing listening is null, not an exception, and does not hang", async () => {
  const result = await detectRunning({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.deepEqual(result, { ollama: null, llamaServer: null, preferred: null });
});

test("a hanging port is abandoned on the timeout", async () => {
  const result = await detectRunning({
    timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.equal(result.preferred, null);
});

test("an Ollama tag matches whatever case and :latest Ollama gives it back in", () => {
  const wanted = "hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K";
  assert.equal(hasPinnedModel([wanted], wanted), true);
  assert.equal(hasPinnedModel(["hf.co/lmstudio-community/qwen3.5-2b-gguf:q6_k"], wanted), true);
  assert.equal(hasPinnedModel(["hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K:latest"], wanted), true);
  assert.equal(hasPinnedModel(["llama3:8b"], wanted), false);
  assert.equal(hasPinnedModel([wanted], null), false);
});

// ------------------------------------------------------- the pinning tool's matching

test("an asset name is built from the manifest's shape, and matched exactly", async () => {
  const { matchAssets, assetNameFor } = await import("../tools/pin-runtime.mjs");
  // The real names, from llama.cpp's own .github/workflows/release.yml: macOS and Linux
  // are tar.gz, Windows is zip, and the CPU build is `win-cpu` rather than plain `win`.
  const assets = [
    { name: "llama-v0.3.0-bin-macos-arm64.tar.gz", size: 1 },
    { name: "llama-v0.3.0-bin-macos-x64.tar.gz", size: 2 },
    { name: "llama-v0.3.0-bin-ubuntu-x64.tar.gz", size: 3 },
    { name: "llama-v0.3.0-bin-win-cpu-x64.zip", size: 4 },
    { name: "llama-v0.3.0-bin-win-cuda-12.4-x64.zip", size: 5 },
    { name: "llama-v0.3.0-bin-ubuntu-vulkan-x64.tar.gz", size: 6 },
  ];
  const matched = matchAssets(assets, manifest.runtimes, "v0.3.0");
  assert.equal(matched["macos-arm64"].name, "llama-v0.3.0-bin-macos-arm64.tar.gz");
  assert.equal(matched["linux-x64"].name, "llama-v0.3.0-bin-ubuntu-x64.tar.gz");
  assert.equal(matched["windows-x64"].name, "llama-v0.3.0-bin-win-cpu-x64.zip");
  // A CUDA or Vulkan build is not the CPU build, and an exact name cannot drift into one.
  assert.notEqual(matched["windows-x64"]?.name, "llama-v0.3.0-bin-win-cuda-12.4-x64.zip");
  assert.notEqual(matched["linux-x64"]?.name, "llama-v0.3.0-bin-ubuntu-vulkan-x64.tar.gz");
  // An asset this release does not carry stays null, and the manifest keeps it unpinned.
  assert.equal(matched["windows-arm64"], null);

  assert.equal(assetNameFor({ assetShape: "llama-{tag}-bin-macos-arm64.tar.gz" }, "v9.9.9"),
    "llama-v9.9.9-bin-macos-arm64.tar.gz");
  assert.equal(assetNameFor({ assetShape: "x-{tag}.zip" }, null), null, "no tag, no name");
  assert.equal(assetNameFor({}, "v1"), null, "no shape, no name");
});

test("every entry records the archive shape and how deep its binary sits", () => {
  for (const runtime of manifest.runtimes) {
    assert.match(runtime.assetShape, /\{tag\}/u, `${runtime.id} has no {tag} in its shape`);
    assert.match(runtime.assetShape, /\.(?:tar\.gz|zip)$/u, `${runtime.id}: unreadable archive type`);
    // macOS and Linux tars put everything under llama-<tag>/; the Windows zip does not.
    const expected = runtime.assetShape.endsWith(".zip") ? 0 : 1;
    assert.equal(runtime.strip, expected, `${runtime.id} strips the wrong depth`);
    assert.match(runtime.binary, runtime.platform === "win32" ? /\.exe$/u : /llama-server$/u);
  }
});

test("the release picked is the newest one that can serve every platform", async () => {
  const { pickRelease } = await import("../tools/pin-runtime.mjs");

  // These are llama.cpp's real releases, in the order and shape the API returns them, from
  // the CI run that found this. Every build is a PRERELEASE; the repository's one proper
  // release is v0.3.0, and it carries a single asset. So `/releases/latest` — which skips
  // prereleases — returns the one release with no server binary in it, which is what the
  // first run of the pinning tool did and why it reported seven unmatched entries.
  const binaries = (tag) => manifest.runtimes.map((runtime) => ({
    name: runtime.assetShape.replace("{tag}", tag), size: 11_000_000, digest: `sha256:${"a".repeat(64)}`,
  }));

  const asApi = [
    { tag_name: "b10756", prerelease: true, draft: false, assets: binaries("b10756") },
    { tag_name: "b10754", prerelease: true, draft: false, assets: binaries("b10754") },
    { tag_name: "v0.3.0", prerelease: false, draft: false, assets: [{ name: "llama.cpp-source.zip", size: 1 }] },
  ];
  assert.equal((await pickRelease(asApi, manifest.runtimes)).tag_name, "b10756",
    "the newest complete build, not the newest non-prerelease");

  // A build still uploading, or one whose macOS job failed, is passed over rather than
  // pinned with a hole in it: a null entry reads to the writer as "no build for your
  // machine", on a machine that is perfectly well supported.
  const halfUploaded = [
    { tag_name: "b10757", prerelease: true, draft: false, assets: binaries("b10757").slice(0, 3) },
    ...asApi,
  ];
  assert.equal((await pickRelease(halfUploaded, manifest.runtimes)).tag_name, "b10756");

  // A draft is not a release anyone else can download, however complete it looks.
  const drafted = [{ tag_name: "b10758", prerelease: true, draft: true, assets: binaries("b10758") }, ...asApi];
  assert.equal((await pickRelease(drafted, manifest.runtimes)).tag_name, "b10756");

  // Nothing serves every platform: say so rather than pin a hole.
  assert.equal(await pickRelease([asApi[2]], manifest.runtimes), null);
  assert.equal(await pickRelease([], manifest.runtimes), null);
});

test("only a well-formed sha256 digest is accepted from the releases API", async () => {
  const { digestOf } = await import("../tools/pin-runtime.mjs");
  assert.equal(digestOf({ digest: `sha256:${"a".repeat(64)}` }), "a".repeat(64));
  assert.equal(digestOf({ digest: `md5:${"a".repeat(32)}` }), null);
  assert.equal(digestOf({ digest: "sha256:short" }), null);
  assert.equal(digestOf({}), null);
  assert.equal(digestOf(null), null);
});
