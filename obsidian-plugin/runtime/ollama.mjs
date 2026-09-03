// Ollama, for the writer who already runs it.
//
// Two things this file does that the OpenAI-compatible engine cannot:
//
//   The pull. Ollama fetches models itself, from its own registry, and it can pull
//   straight from Hugging Face — `hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K` is the
//   SAME artefact models/MANIFEST.json pins, so a writer on Ollama runs the bytes every
//   published number was measured on rather than a similarly-named requantisation.
//   Ollama does the verification; what this adds is the size prompt before it starts and
//   a progress channel while it runs.
//
//   The dialect check. `keep_alive` and `reasoning_effort` are Ollama extensions to a
//   body that is otherwise OpenAI-shaped, and an OpenAI-compatible endpoint is entitled
//   to ignore fields it does not know. Ignoring `keep_alive` costs a 15-second cold load
//   every five minutes; ignoring `reasoning_effort` means <think> in the content. Neither
//   fails loudly. So they are PROBED against the running server, once, and the finding is
//   reported rather than assumed — and where /v1 does not honour them, the native
//   /api/chat endpoint, which certainly does, is used instead.
//
//   The probe also reads the FIELD ORDER of a structured answer, which is the one that
//   was actually wrong. `engine.mjs` stops generation at `,"reason"` to save the tokens
//   of a reason nobody reads — safe only where the server emits the schema's properties
//   in the schema's order. Ollama emits action, reason, replacement, so that stop fires
//   before the replacement exists and EVERY sentence comes back as `{"action":"rewrite"`.
//   Measured against Ollama 0.33.2 on 2026-09-02, on both endpoints. Unit tests against a
//   fake could not have found this: it is a fact about a real server's JSON writer.

import { stripThinking } from "../../src/engine.mjs";
import { DECISION_SCHEMA } from "../../src/contract.mjs";

export const OLLAMA_DEFAULT = "http://127.0.0.1:11434";

export class OllamaError extends Error {
  constructor(message, { kind = "failed", cause } = {}) {
    super(message, { cause });
    this.name = "OllamaError";
    this.kind = kind;
  }
}

// ------------------------------------------------------------------------------ pull

/**
 * Pull a model, reporting progress.
 *
 * Ollama answers /api/pull with a stream of newline-delimited JSON objects, one per
 * status change, each carrying `completed` and `total` while bytes are moving. The
 * caller must have shown the size first: this starts a multi-gigabyte download.
 */
export async function pullModel({
  tag,
  baseUrl = OLLAMA_DEFAULT,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
  signal,
} = {}) {
  if (!tag) throw new OllamaError("pullModel needs a tag");
  const response = await fetchImpl(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: tag, stream: true }),
    signal,
  });
  if (!response.ok) throw new OllamaError(`ollama pull ${tag}: HTTP ${response.status}`, { kind: "http" });

  let last = null;
  for await (const line of ndjson(response.body)) {
    if (line.error) throw new OllamaError(`ollama pull ${tag}: ${line.error}`, { kind: "pull" });
    last = line;
    onProgress({
      status: line.status ?? "",
      received: line.completed ?? 0,
      total: line.total ?? null,
      digest: line.digest ?? null,
    });
  }
  // Ollama's final line is {"status":"success"}. Anything else means the stream ended
  // early — a dropped connection mid-pull, which must not read as a completed download.
  if (last?.status !== "success") {
    throw new OllamaError(`ollama pull ${tag} ended without success (last status: ${last?.status ?? "none"})`, { kind: "incomplete" });
  }
  return { tag, ok: true };
}

// Ollama streams NDJSON; a chunk boundary can fall anywhere, including mid-object.
async function* ndjson(body) {
  const stream = body?.getReader ? readerLines(body) : nodeLines(body);
  for await (const line of stream) {
    const text = line.trim();
    if (!text) continue;
    try {
      yield JSON.parse(text);
    } catch {
      // A line that is not JSON is not a status; skipping it is better than failing a
      // 1.5 GB pull over a keep-alive comment.
    }
  }
}

async function* readerLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    yield* lines;
  }
  if (buffer) yield buffer;
}

async function* nodeLines(body) {
  let buffer = "";
  for await (const chunk of body) {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    yield* lines;
  }
  if (buffer) yield buffer;
}

// ------------------------------------------------------------------- the dialect probe

// A deliberately odd keep-alive to ask for. The probe must distinguish "/v1 honoured what
// I sent" from "the model happened to already be resident with a long expiry", and a
// threshold cannot: an Ollama that another tool left loaded for thirty minutes reads as
// healthy however thoroughly /v1 drops the field. Asking for a duration nothing else would
// choose, and checking the expiry landed NEAR IT, tells the two apart.
//
// This is not hypothetical. The first live probe against Ollama 0.33.2 reported keep_alive
// dropped; the second, minutes later, reported it honoured — because the first probe's own
// fallback to /api/chat had loaded the model for thirty minutes.
const PROBE_KEEP_ALIVE_MINUTES = 23;
const KEEP_ALIVE_TOLERANCE_MINUTES = 3;

/**
 * Ask the running server whether its /v1 endpoint honours what Tolben needs, and say which
 * endpoint to use.
 *
 * Four findings, each independently useful:
 *   keepAlive  — did the model stay loaded for the time ASKED FOR? Read from /api/ps,
 *                which lists what is resident and until when. A five-minute expiry means
 *                /v1 dropped the field, and every sentence after a pause pays a cold load.
 *   thinking   — did any <think> reach the content?
 *   schema     — did response_format produce parseable JSON?
 *   stopSafe   — did the properties come back in the schema's order? If not, the engine's
 *                reason-stop would cut the replacement off before it was generated.
 *
 * `endpoint` is "v1" when the first three hold and "native" otherwise, because /api/chat
 * takes `keep_alive` and `think: false` as first-class fields rather than as extensions it
 * may ignore. `stopSafe` is separate: it is a property of the server, not of the endpoint,
 * so it disables the optimisation either way rather than changing the route.
 */
export async function probeDialect({
  tag,
  baseUrl = OLLAMA_DEFAULT,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const findings = {
    keepAlive: false, thinking: null, schema: false, stopSafe: false,
    fieldOrder: null, endpoint: "native", errors: [],
  };

  let content = null;
  try {
    const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model: tag,
        temperature: 0,
        max_tokens: 96,
        keep_alive: `${PROBE_KEEP_ALIVE_MINUTES}m`,
        reasoning_effort: "none",
        // The REAL schema, so the field order this measures is the order the engine will
        // meet. A toy schema with one property cannot show an ordering problem at all.
        response_format: {
          type: "json_schema",
          json_schema: { name: "clarity_decision", strict: true, schema: DECISION_SCHEMA },
        },
        messages: [
          { role: "system", content: "Rewrite the sentence to be clearer. Answer with the JSON object." },
          { role: "user", content: "The department will conduct an investigation into the missing inventory." },
        ],
      }),
    });
    if (!response.ok) {
      findings.errors.push(`/v1/chat/completions: HTTP ${response.status}`);
      return findings;
    }
    const payload = await response.json();
    content = payload?.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    findings.errors.push(`/v1/chat/completions: ${error.message}`);
    return findings;
  }

  findings.thinking = /<(?:think|thinking|reasoning)>/iu.test(content);
  try {
    const parsed = JSON.parse(stripThinking(content));
    findings.schema = true;
    // The order the keys came back in, against the order the schema declares. `stopSafe`
    // is the only thing that reads it, but the order itself is recorded because it is the
    // sort of finding that explains a later bug report in one line.
    const wanted = Object.keys(DECISION_SCHEMA.properties);
    const got = Object.keys(parsed).filter((key) => wanted.includes(key));
    findings.fieldOrder = got.join(",");
    findings.stopSafe = got.length === wanted.length && got.every((key, at) => key === wanted[at]);
    if (!findings.stopSafe) {
      findings.errors.push(
        `structured output returns ${got.join(", ")} rather than ${wanted.join(", ")}; `
        + "the reason-stop optimisation is disabled, which costs about ten tokens a sentence",
      );
    }
  } catch {
    findings.schema = false;
    findings.errors.push("response_format did not produce parseable JSON on /v1");
  }

  // /api/ps says what is resident and when it expires. The expiry must be near what was
  // ASKED FOR: Ollama's default without the field is five minutes, and an expiry that is
  // neither five minutes nor the requested duration means something other than this
  // request set it, which is not evidence that /v1 honoured anything.
  try {
    const response = await fetchImpl(`${baseUrl}/api/ps`, { signal });
    const payload = await response.json();
    const entry = (payload?.models ?? []).find((model) => sameTag(model.name ?? model.model, tag));
    if (entry?.expires_at) {
      const minutes = (new Date(entry.expires_at).getTime() - Date.now()) / 60000;
      findings.keepAliveMinutes = Math.round(minutes);
      findings.keepAlive = Math.abs(minutes - PROBE_KEEP_ALIVE_MINUTES) <= KEEP_ALIVE_TOLERANCE_MINUTES;
      if (!findings.keepAlive) {
        findings.errors.push(
          `asked /v1 to keep the model for ${PROBE_KEEP_ALIVE_MINUTES} minutes; /api/ps reports `
          + `${findings.keepAliveMinutes}. ${findings.keepAliveMinutes > PROBE_KEEP_ALIVE_MINUTES
            ? "Something else set that, so this says nothing about /v1."
            : "/v1 dropped the field."}`,
        );
      }
    } else if (entry) {
      findings.errors.push("/api/ps lists the model but reports no expiry");
    } else {
      findings.errors.push("/api/ps does not list the model after a completion");
    }
  } catch (error) {
    findings.errors.push(`/api/ps: ${error.message}`);
  }

  findings.endpoint = findings.keepAlive && findings.schema && findings.thinking === false ? "v1" : "native";
  return findings;
}

function sameTag(seen, wanted) {
  if (!seen || !wanted) return false;
  const normalise = (text) => String(text).toLowerCase().replace(/:latest$/u, "");
  return normalise(seen) === normalise(wanted);
}

/**
 * The native /api/chat endpoint, shaped like the OpenAI one the engine expects.
 *
 * Used when the probe finds /v1 dropping fields. `format` takes the JSON schema
 * directly, `think: false` suppresses reasoning, and `keep_alive` is documented rather
 * than tolerated. The response is reshaped into the `choices[0].message.content` the
 * engine reads, so nothing downstream knows which endpoint answered.
 */
export function nativeFetch({ baseUrl = OLLAMA_DEFAULT, keepAlive = "30m", fetchImpl = globalThis.fetch } = {}) {
  // `options.stop` is forwarded only when the engine sent one. The engine is what decides
  // whether a stop is safe here, from the probe's field-order finding; duplicating that
  // decision would be two places to get it wrong.
  return async function fetchLikeOpenAI(url, init = {}) {
    if (!String(url).endsWith("/chat/completions")) return fetchImpl(url, init);
    const body = JSON.parse(init.body);
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: init.signal,
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        stream: false,
        think: false,
        keep_alive: keepAlive,
        format: body.response_format?.json_schema?.schema ?? undefined,
        options: {
          temperature: body.temperature ?? 0,
          top_p: body.top_p ?? 1,
          num_predict: body.max_tokens ?? 160,
          ...(body.stop ? { stop: body.stop } : {}),
        },
      }),
    });
    if (!response.ok) return response;
    const payload = await response.json();
    const content = payload?.message?.content ?? "";
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    };
  };
}

/**
 * Everything the plugin needs to talk to a running Ollama: which endpoint, which fetch,
 * and what the probe found — so the setup pane can say "using /api/chat because this
 * Ollama's /v1 ignores keep_alive" rather than being silently slower.
 */
export async function connectOllama({ tag, baseUrl = OLLAMA_DEFAULT, fetchImpl = globalThis.fetch, signal } = {}) {
  const findings = await probeDialect({ tag, baseUrl, fetchImpl, signal });
  // `useReasonStop` travels with the connection because it is a fact about the SERVER,
  // not about the endpoint chosen: Ollama reorders on both /v1 and /api/chat, so an
  // Ollama whose /v1 honours everything else would still truncate its own replacements.
  const common = { findings, useReasonStop: findings.stopSafe };
  if (findings.endpoint === "v1") {
    return { ...common, apiBase: `${baseUrl}/v1`, fetchImpl, dialect: "ollama", endpoint: "v1" };
  }
  return {
    ...common,
    apiBase: `${baseUrl}/v1`,
    fetchImpl: nativeFetch({ baseUrl, fetchImpl }),
    dialect: "openai",
    endpoint: "native",
  };
}
