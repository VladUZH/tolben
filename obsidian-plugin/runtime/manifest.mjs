// Which pinned artefact this machine should run, and whether it may be downloaded at all.
//
// The rule this file exists to enforce: an artefact with no sha256 is never fetched. A
// runtime the writer did not choose, arriving over the network from a URL nobody pinned,
// is exactly the thing this project tells people it does not do — so an unpinned entry is
// reported as unavailable rather than fetched on trust. `node tools/pin-runtime.mjs
// --write` is what fills them in, from the GitHub releases API, and CI checks they still
// resolve to the same bytes.

import manifest from "./manifest.json" with { type: "json" };

export { manifest };

export const MEASURED_MODEL = "qwen3.5-2b-q6_k";

export function models() {
  return manifest.models;
}

export function modelById(id) {
  return manifest.models.find((model) => model.id === id) ?? null;
}

// Candidate runtimes for this platform, most capable first. A build with more CPU
// requirements is preferred when the machine meets them; the plain build is the fallback,
// which is why "requires" is compared by length rather than by name.
//
// In practice every current entry requires nothing: llama.cpp's CPU release dispatches
// instruction sets at runtime, so one archive serves an AVX-512 machine and a 2012 laptop
// alike. The ordering is kept because that has not always been true and need not stay
// true — and because the illegal-instruction fallback in server.mjs walks this list.
export function runtimeCandidates({ platform, arch, features = [], runtimes = manifest.runtimes } = {}) {
  const supported = new Set(features);
  return runtimes
    .filter((runtime) => runtime.platform === platform && runtime.arch === arch)
    .filter((runtime) => runtime.requires.every((feature) => supported.has(feature)))
    .sort((left, right) => right.requires.length - left.requires.length);
}

// What the provisioner should actually do about the runtime, and — when the answer is
// "nothing" — a reason the setup pane can show a person verbatim.
//
// `runtimes` defaults to the manifest's own table and exists to be replaced by a test.
// Every entry is pinned in this checkout, so the three refusals below — unsupported
// platform, unsupported CPU, unpinned asset — can no longer be reached through it; and
// "unpinned" in particular is the one that keeps the promise that nothing arrives from a
// URL nobody recorded a hash for. A property that important must be checked on purpose
// rather than as a side effect of what the repository happens to contain this week.
export function selectRuntime({ platform, arch, features = [], runtimes = manifest.runtimes } = {}) {
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
      detail: `Every pinned build for ${platform}/${arch} needs ${missing}, which this CPU does not report.`,
    };
  }
  const pinned = candidates.find(isPinned);
  if (!pinned) {
    return {
      runtime: null,
      reason: "unpinned",
      detail: `The llama.cpp build for ${candidates[0].id} has no recorded sha256, so it will not be downloaded. `
        + "Run `node tools/pin-runtime.mjs --write` from a machine that can reach the GitHub releases API, "
        + "or point Tolben at an Ollama or llama-server you already run.",
    };
  }
  return { runtime: pinned, reason: null, detail: null };
}

export function isPinned(artifact) {
  return Boolean(artifact
    && typeof artifact.sha256 === "string" && /^[0-9a-f]{64}$/u.test(artifact.sha256)
    && Number.isInteger(artifact.bytes) && artifact.bytes > 0);
}

export function runtimeUrl(runtime, { tag = manifest.runtimeTag, repo = manifest.runtimeRepo } = {}) {
  if (!tag || !runtime?.asset) return null;
  return `https://github.com/${repo}/releases/download/${tag}/${runtime.asset}`;
}

// Every URL, size and hash the writer is about to authorise, in the order they will be
// fetched. The setup pane shows this BEFORE the first byte moves, which is the point:
// nothing downloads that was not named on a screen someone looked at.
export function downloadPlan({ platform, arch, features = [], modelId = MEASURED_MODEL, runtimes } = {}) {
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
      sha256: runtime.sha256,
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
      measured: model.measured,
    });
  }
  return {
    items,
    totalBytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
    runtimeUnavailable: runtime ? null : { reason, detail },
  };
}
