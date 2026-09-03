// The model speaks exactly one shape. Anything else is a parse failure, not a suggestion.

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["keep", "rewrite"] },
    replacement: { type: "string" },
    reason: { type: "string" },
  },
  required: ["action", "replacement", "reason"],
  additionalProperties: false,
};

export function parseDecision(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new TypeError("Model returned no content");
  }
  // Schema-constrained servers return bare JSON; tolerate a fenced block defensively.
  const body = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new TypeError(`Model returned invalid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Model returned a non-object decision");
  }
  const { action, replacement, reason } = parsed;
  if (action !== "keep" && action !== "rewrite") {
    throw new TypeError(`Model returned an unknown action: ${String(action)}`);
  }
  if (typeof replacement !== "string") throw new TypeError("Model omitted replacement");
  if (typeof reason !== "string") throw new TypeError("Model omitted reason");
  if (action === "rewrite" && !replacement.trim()) {
    throw new TypeError("Model chose rewrite without a replacement");
  }
  return { action, replacement: replacement.trim(), reason: reason.trim() };
}
