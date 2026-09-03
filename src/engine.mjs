// The clarity engine: one completed sentence in, one schema-constrained decision out.
// Everything here is local; the only network hop is to a llama.cpp server on loopback.

import { parseDecision, DECISION_SCHEMA } from "./contract.mjs";

export const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "clarity_decision", strict: true, schema: DECISION_SCHEMA },
};

// Reason BEFORE verdict, deliberately. A constrained schema emits its fields in order, so
// with the verdict first the model commits to show-or-hide and then writes a
// justification for whatever it already said — and it was measured doing exactly that:
// on "customers stay with us for years" -> "customers stay with us" it answered "show"
// and then explained that "removing it loses specific information about how long". Making
// it write the reason first turns the field into a scratchpad the decision can rest on.
const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string" },
    verdict: { type: "string", enum: ["show", "hide"] },
  },
  required: ["reason", "verdict"],
  additionalProperties: false,
};

const VERDICT_FORMAT = {
  type: "json_schema",
  json_schema: { name: "edit_verdict", strict: true, schema: VERDICT_SCHEMA },
};

// The writer never sees the model's reason — the explanation is derived from the diff —
// so generation can stop as soon as the replacement is closed, and the object be completed
// locally. Roughly ten tokens a sentence are then never generated, and the decision is
// unchanged because every token before the stop is what the model would have produced
// anyway. The stop deliberately excludes the closing quote of "replacement": llama.cpp
// removes the matched text, and swallowing that quote would leave unparseable JSON.
//
// THE OPTIMISATION IS CONDITIONAL, and the condition is the field ORDER. It is only safe
// where the server emits the schema's properties in the schema's order, so that "reason"
// really is last. llama.cpp does. Ollama does not: its structured output emits action,
// reason, replacement, so this stop fires BEFORE the replacement is generated and the
// answer arrives as `{"action":"rewrite"` — a rewrite with nothing to rewrite to, on
// every sentence, on both its /v1 and native endpoints. Measured against Ollama 0.33.2
// on 2026-09-02.
//
// So `useReasonStop` is a capability, not a default: obsidian-plugin/runtime/ollama.mjs
// probes the running server's field order and turns it off when the order is not the
// schema's.
export const REASON_STOP = ',"reason"';

export function completeTruncatedJSON(content) {
  const text = String(content ?? "").trimEnd();
  // Nothing to complete. Closing an empty string would produce a fragment that only looks
  // like malformed JSON; the caller has to be told the model returned no content at all.
  if (!text.trim()) return "";
  if (text.endsWith("}")) return text;
  const head = text.replace(/,\s*"reason".*$/su, "").replace(/[,\s]*$/u, "");
  return `${head},"reason":""}`;
}

export class EngineError extends Error {
  constructor(message, { kind = "failed", cause } = {}) {
    super(message, { cause });
    this.name = "EngineError";
    this.kind = kind; // "aborted" | "timeout" | "transient" | "failed"
  }
}

// Fields a particular server needs that the OpenAI shape does not carry. Kept as data
// rather than as branches, so the request body has ONE construction and a dialect cannot
// quietly change the temperature or the schema on its way past.
//
// Ollama: `keep_alive` decides whether the weights stay resident between sentences —
// without it a 2 B model is unloaded after five minutes and the next sentence pays the
// cold load again. `reasoning_effort: "none"` is its /v1 spelling of what llama.cpp calls
// `--reasoning off`, and without one of them the model returns its thinking and an empty
// answer.
export const DIALECTS = {
  openai: {},
  ollama: { keep_alive: "30m", reasoning_effort: "none" },
};

// A model that thinks anyway, in spite of being told not to. llama.cpp with
// `--reasoning off` and Ollama with `reasoning_effort: none` both suppress this, but the
// suppression is a server feature and servers vary: a leaked <think> block would arrive
// as unparseable JSON and be reported as a broken model rather than as a configuration
// that needs fixing. Stripped before parsing, so the sentence still gets an answer.
const THINK_BLOCK = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>\s*/giu;
// An unterminated block: the stop string can cut generation off inside one.
const OPEN_THINK = /<(?:think|thinking|reasoning)>[\s\S]*$/iu;

export function stripThinking(content) {
  const text = String(content ?? "");
  const closed = text.replace(THINK_BLOCK, "");
  // Only drop an unterminated block when nothing that could be an answer follows it.
  const opened = closed.replace(OPEN_THINK, (match) => (/[{}]/u.test(match) ? match : ""));
  return opened.trim();
}

export function createEngine({
  baseUrl = "http://127.0.0.1:8080/v1",
  model = "local",
  prompt,
  verifierPrompt = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  maxTokens = 160,
  apiKey = null,
  dialect = "openai",
  useReasonStop = true,
} = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("Engine needs a prompt");
  const endpoint = `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
  const extra = DIALECTS[dialect] ?? {};
  // The managed llama-server is started with --api-key, because any process on the
  // machine — including a web page — can reach loopback. Nothing else about the request
  // changes: a server started without one is sent no header.
  const headers = {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };

  async function decide(sentence, { signal } = {}) {
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(new Error("timeout")), timeoutMs);
    const composed = typeof AbortSignal.any === "function" && signal
      ? AbortSignal.any([signal, timer.signal])
      : (signal ?? timer.signal);
    const started = Date.now();
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        signal: composed,
        body: JSON.stringify({
          ...extra,
          model,
          temperature: 0,
          top_p: 1,
          max_tokens: maxTokens,
          response_format: RESPONSE_FORMAT,
          ...(useReasonStop ? { stop: [REASON_STOP] } : {}),
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: sentence },
          ],
        }),
      });
      if (!response.ok) {
        const kind = response.status >= 500 || response.status === 429 ? "transient" : "failed";
        throw new EngineError(`Local model server returned HTTP ${response.status}`, { kind });
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const decision = parseDecision(completeTruncatedJSON(stripThinking(content)));
      return { ...decision, latencyMs: Date.now() - started };
    } catch (error) {
      if (error instanceof EngineError) throw error;
      if (signal?.aborted) throw new EngineError("Request superseded", { kind: "aborted", cause: error });
      if (timer.signal.aborted) throw new EngineError(`Local model exceeded ${timeoutMs} ms`, { kind: "timeout", cause: error });
      // A response body that is not JSON is a broken answer, not a broken connection:
      // asking again produces the same garbage, so it is never retried.
      if (error instanceof SyntaxError) {
        throw new EngineError(`Local model returned an unparseable response: ${error.message}`, { kind: "failed", cause: error });
      }
      if (error instanceof TypeError && /JSON|decision|replacement|action|reason|content/iu.test(error.message)) {
        throw new EngineError(error.message, { kind: "failed", cause: error });
      }
      throw new EngineError(error.message || String(error), { kind: "transient", cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  // One retry, and only for a transient fault. A malformed decision is never retried.
  async function rewrite(sentence, { signal, retries = 1 } = {}) {
    try {
      return await decide(sentence, { signal });
    } catch (error) {
      if (retries > 0 && error.kind === "transient" && !signal?.aborted) {
        return rewrite(sentence, { signal, retries: retries - 1 });
      }
      throw error;
    }
  }

  // A second opinion on a rewrite the generator already produced. The generator is
  // tuned to notice problems; this pass is tuned to refuse weak suggestions, which is
  // a different job and measurably not one the same prompt can do at the same time.
  async function verify(source, replacement, { signal, lost = [] } = {}) {
    if (!verifierPrompt) return { verdict: "show", reason: "no verifier configured" };
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(new Error("timeout")), timeoutMs);
    const composed = typeof AbortSignal.any === "function" && signal
      ? AbortSignal.any([signal, timer.signal])
      : (signal ?? timer.signal);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        signal: composed,
        body: JSON.stringify({
          ...extra,
          model,
          temperature: 0,
          top_p: 1,
          max_tokens: 96,
          response_format: VERDICT_FORMAT,
          messages: [
            { role: "system", content: verifierPrompt },
            {
              role: "user",
              content: lost.length
                ? `ORIGINAL: ${source}\nPROPOSED: ${replacement}\nREMOVED WORDS: ${lost.join(", ")}`
                : `ORIGINAL: ${source}\nPROPOSED: ${replacement}`,
            },
          ],
        }),
      });
      if (!response.ok) throw new EngineError(`Verifier returned HTTP ${response.status}`, { kind: "transient" });
      const payload = await response.json();
      const parsed = JSON.parse(stripThinking(payload?.choices?.[0]?.message?.content) || "{}");
      if (parsed.verdict !== "show" && parsed.verdict !== "hide") {
        throw new EngineError("Verifier returned an unknown verdict");
      }
      return { verdict: parsed.verdict, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
    } catch (error) {
      // A verifier that fails must not silently approve, and must not be mistaken for one
      // that deliberately refused: the caller fails closed on "unavailable" exactly as it
      // does on "hide", but reports it as an outage rather than as a safety refusal.
      // Classified as decide() classifies: a socket-level failure carries no .kind and
      // is a passing outage ("transient"), not deterministic garbage — reporting it as
      // "failed" burned the sentence's whole retry budget on a server restart. Only an
      // unparseable body is deterministic for this pair.
      const kind = signal?.aborted ? "aborted"
        : timer.signal.aborted ? "timeout"
        : error.kind ?? (error instanceof SyntaxError ? "failed" : "transient");
      return { verdict: "unavailable", kind, reason: `verifier unavailable: ${error.message}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { rewrite, decide, verify, endpoint, dialect, model, useReasonStop };
}
