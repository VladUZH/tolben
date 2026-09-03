// What is already running on this machine, asked before anything is downloaded.
//
// A writer who runs Ollama or llama-server already has the hard part done, and 1.5 GB is
// a rude thing to fetch behind someone's back. Both probes are loopback-only and take a
// short timeout: a machine with nothing listening must not make the setup pane hang.

const DEFAULT_TIMEOUT_MS = 1500;

export const OLLAMA_DEFAULT = "http://127.0.0.1:11434";
export const LLAMA_SERVER_DEFAULT = "http://127.0.0.1:8080";

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

// Ollama answers /api/tags with the models it has pulled. The list matters as much as the
// liveness: an Ollama with no suitable model still needs a pull, and the setup pane says
// so rather than reporting "ready" and failing on the first sentence.
export async function detectOllama({
  fetchImpl = globalThis.fetch, baseUrl = OLLAMA_DEFAULT, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const payload = await ask(fetchImpl, `${baseUrl}/api/tags`, timeoutMs);
  if (!payload || !Array.isArray(payload.models)) return null;
  return {
    kind: "ollama",
    baseUrl,
    apiBase: `${baseUrl}/v1`,
    models: payload.models.map((model) => model.name).filter(Boolean),
  };
}

// llama-server answers /v1/models with whatever it was started on. It has no model
// registry to choose from — one server, one model — so the id is reported for display and
// for the bench's provenance line, not for selection.
export async function detectLlamaServer({
  fetchImpl = globalThis.fetch, baseUrl = LLAMA_SERVER_DEFAULT, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const payload = await ask(fetchImpl, `${baseUrl}/v1/models`, timeoutMs);
  const id = payload?.data?.[0]?.id;
  if (!id) return null;
  return { kind: "llama-server", baseUrl, apiBase: `${baseUrl}/v1`, models: [id] };
}

// Whether an Ollama tag is one of the artefacts this project pins. Ollama normalises
// `hf.co/owner/repo:Q6_K` to lower case and appends `:latest` to bare names, so the
// comparison is case-insensitive and tolerant of the suffix.
export function hasPinnedModel(names, ollamaTag) {
  if (!ollamaTag) return false;
  const wanted = ollamaTag.toLowerCase();
  return names.some((name) => {
    const seen = String(name).toLowerCase().replace(/:latest$/u, "");
    return seen === wanted || seen === wanted.replace(/:latest$/u, "");
  });
}

// Both probes at once — they are independent and each costs a timeout. Order of
// preference when both answer: llama-server, because it is the configuration every
// published number was measured on.
export async function detectRunning(options = {}) {
  const [ollama, llama] = await Promise.all([
    detectOllama(options),
    detectLlamaServer(options),
  ]);
  return { ollama, llamaServer: llama, preferred: llama ?? ollama ?? null };
}
