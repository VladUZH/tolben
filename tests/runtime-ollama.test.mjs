// The Ollama adapter, against a fake Ollama that can be told to misbehave in the two
// specific ways this adapter exists to detect: dropping keep_alive and leaking <think>.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pullModel, probeDialect, connectOllama, nativeFetch, OllamaError } from "../obsidian-plugin/runtime/ollama.mjs";
import { createEngine, stripThinking, DIALECTS } from "../src/engine.mjs";

// A decision written in the schema's own order, which is what llama.cpp produces and what
// the engine's reason-stop depends on…
const SCHEMA_ORDER = '{"action":"rewrite","replacement":"Short.","reason":"shorter"}';
// …and the order a real Ollama produces, which is not the same one. Measured against
// Ollama 0.33.2 on 2026-09-02.
const OLLAMA_ORDER = '{"action":"rewrite","reason":"shorter","replacement":"Short."}';

// An Ollama that answers the three endpoints the adapter uses, configurably.
function fakeOllama(config) {
  return http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    config.seen.push({ url: request.url, body });

    if (request.url === "/api/pull") {
      response.writeHead(config.pullStatus ?? 200, { "content-type": "application/x-ndjson" });
      for (const line of config.pullLines) {
        response.write(`${JSON.stringify(line)}\n`);
      }
      response.end();
      return;
    }
    if (request.url === "/v1/chat/completions") {
      // The misbehaviour: a server that drops keep_alive still answers normally, which is
      // exactly why it has to be probed rather than assumed.
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: config.content ?? SCHEMA_ORDER } }],
      }));
      return;
    }
    if (request.url === "/api/chat") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: { content: config.nativeContent ?? SCHEMA_ORDER } }));
      return;
    }
    if (request.url === "/api/ps") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        models: config.resident === false ? [] : [{
          name: config.tag,
          // 23 minutes is what the probe asks for, so it is the default a well-behaved
          // fake reports back.
          expires_at: new Date(Date.now() + (config.keepAliveMinutes ?? 23) * 60000).toISOString(),
        }],
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
}

async function withOllama(config, run) {
  const state = { seen: [], tag: "hf.co/lmstudio-community/Qwen3.5-2B-GGUF:Q6_K", pullLines: [], ...config };
  const server = fakeOllama(state);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run({ baseUrl, state, tag: state.tag });
  } finally {
    server.close();
  }
}

// --------------------------------------------------------------------------- pull

test("a pull reports progress and finishes on success", async () => {
  await withOllama({
    pullLines: [
      { status: "pulling manifest" },
      { status: "pulling sha256:abc", digest: "sha256:abc", completed: 500, total: 1000 },
      { status: "pulling sha256:abc", digest: "sha256:abc", completed: 1000, total: 1000 },
      { status: "verifying sha256 digest" },
      { status: "success" },
    ],
  }, async ({ baseUrl, tag, state }) => {
    const seen = [];
    const result = await pullModel({ tag, baseUrl, onProgress: (progress) => seen.push(progress) });
    assert.equal(result.ok, true);
    assert.equal(seen.at(-1).status, "success");
    assert.equal(seen.find((row) => row.total)?.total, 1000);
    assert.equal(state.seen[0].body.model, tag, "the pinned Hugging Face tag is what is pulled");
  });
});

test("a pull that ends without success is not reported as a completed download", async () => {
  // A dropped connection mid-pull leaves a partial model and no error line. Reading that
  // as success would leave the plugin pointing at a model that is not there.
  await withOllama({
    pullLines: [{ status: "pulling sha256:abc", completed: 400, total: 1000 }],
  }, async ({ baseUrl, tag }) => {
    await assert.rejects(pullModel({ tag, baseUrl }), (error) => error instanceof OllamaError
      && error.kind === "incomplete");
  });
});

test("an error line in the stream is surfaced", async () => {
  await withOllama({
    pullLines: [{ status: "pulling" }, { error: "model not found" }],
  }, async ({ baseUrl, tag }) => {
    await assert.rejects(pullModel({ tag, baseUrl }), (error) => /model not found/u.test(error.message));
  });
});

test("NDJSON split across chunk boundaries is still parsed", async () => {
  // Ollama's lines are long and its chunks are not aligned to them; a naive parser drops
  // the object that straddles the boundary and reports a pull that never succeeded.
  const server = http.createServer((request, response) => {
    response.writeHead(200);
    response.write('{"status":"pulling","completed":1,"tot');
    response.write('al":2}\n{"status":"suc');
    response.end('cess"}\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const seen = [];
    const result = await pullModel({
      tag: "x", baseUrl: `http://127.0.0.1:${server.address().port}`,
      onProgress: (progress) => seen.push(progress),
    });
    assert.equal(result.ok, true);
    assert.equal(seen[0].total, 2);
  } finally {
    server.close();
  }
});

// ------------------------------------------------------------------- the dialect probe

test("a well-behaved /v1 is used directly", async () => {
  await withOllama({ keepAliveMinutes: 23 }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.keepAlive, true);
    assert.equal(findings.thinking, false);
    assert.equal(findings.schema, true);
    assert.equal(findings.endpoint, "v1");
    assert.equal(findings.stopSafe, true, "schema order, so the reason-stop is kept");
    assert.deepEqual(findings.errors, []);
  });
});

test("a /v1 that drops keep_alive falls back to the native endpoint", async () => {
  // The failure this catches costs a 15-second cold load every five minutes and shows up
  // as "the plugin is slow sometimes", which nobody ever reports as a bug.
  await withOllama({ keepAliveMinutes: 5 }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.keepAlive, false);
    assert.equal(findings.keepAliveMinutes, 5);
    assert.equal(findings.endpoint, "native");
  });
});

test("a /v1 that leaks think tags falls back to the native endpoint", async () => {
  await withOllama({
    content: "<think>The user wants ok true.</think>{\"ok\":true}",
  }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.thinking, true);
    assert.equal(findings.schema, true, "the JSON is still parseable once the block is stripped");
    assert.equal(findings.endpoint, "native");
  });
});

test("a /v1 that ignores the schema falls back", async () => {
  await withOllama({ content: "Sure! Here is your answer: ok is true." }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.schema, false);
    assert.equal(findings.endpoint, "native");
    assert.ok(findings.errors.some((line) => /response_format/u.test(line)));
  });
});

test("a model that is not resident after a completion is a keep_alive failure", async () => {
  await withOllama({ resident: false }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.keepAlive, false);
    assert.equal(findings.endpoint, "native");
    assert.ok(findings.errors.some((line) => /does not list the model/u.test(line)));
  });
});

test("an unreachable Ollama is findings, not an exception", async () => {
  const findings = await probeDialect({ tag: "x", baseUrl: "http://127.0.0.1:1", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(findings.endpoint, "native");
  assert.ok(findings.errors.length > 0);
});

// --------------------------------------------------------------- the native endpoint

test("the native endpoint is reshaped into what the engine reads", async () => {
  await withOllama({ nativeContent: '{"action":"keep","replacement":"","reason":"clear"}' }, async ({ baseUrl, state }) => {
    const fetchLikeOpenAI = nativeFetch({ baseUrl });
    const response = await fetchLikeOpenAI(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({
        model: "m", temperature: 0, top_p: 1, max_tokens: 160, stop: [',"reason"'],
        response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const payload = await response.json();
    assert.equal(payload.choices[0].message.content, '{"action":"keep","replacement":"","reason":"clear"}');

    const sent = state.seen.find((row) => row.url === "/api/chat").body;
    assert.equal(sent.think, false, "reasoning is suppressed as a first-class field");
    assert.equal(sent.keep_alive, "30m", "and so is keep_alive");
    assert.equal(sent.stream, false);
    assert.deepEqual(sent.format, { type: "object" }, "the schema is passed as `format`");
    assert.equal(sent.options.temperature, 0);
    assert.equal(sent.options.num_predict, 160);
    assert.deepEqual(sent.options.stop, [',"reason"']);
  });
});

test("connectOllama hands back a fetch the engine can use either way", async () => {
  await withOllama({ keepAliveMinutes: 23 }, async ({ baseUrl, tag }) => {
    const good = await connectOllama({ tag, baseUrl });
    assert.equal(good.endpoint, "v1");
    assert.equal(good.dialect, "ollama");
    assert.equal(good.useReasonStop, true);
  });
  await withOllama({ keepAliveMinutes: 2 }, async ({ baseUrl, tag }) => {
    const degraded = await connectOllama({ tag, baseUrl });
    assert.equal(degraded.endpoint, "native");
    assert.equal(degraded.dialect, "openai", "the native path carries its own fields, not the /v1 extensions");
  });
});

test("an engine built on the native path produces a decision end to end", async () => {
  await withOllama({
    // keep_alive dropped, so connectOllama chooses /api/chat — the path under test.
    keepAliveMinutes: 2,
    nativeContent: '{"action":"rewrite","replacement":"We reviewed the draft.","reason":"shorter"}',
  }, async ({ baseUrl, tag }) => {
    const connection = await connectOllama({ tag, baseUrl });
    assert.equal(connection.endpoint, "native");
    const engine = createEngine({
      baseUrl: connection.apiBase, model: tag, prompt: "system", fetchImpl: connection.fetchImpl,
    });
    const decision = await engine.rewrite("We conducted a review of the draft.");
    assert.equal(decision.action, "rewrite");
    assert.equal(decision.replacement, "We reviewed the draft.");
  });
});

// ------------------------------------------------------------------ engine plumbing

test("the ollama dialect sends keep_alive and reasoning_effort, and nothing else changes", async () => {
  let body;
  const engine = createEngine({
    prompt: "system", dialect: "ollama",
    fetchImpl: async (url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"action":"keep","replacement":"","reason":"c"}' } }] }) };
    },
  });
  await engine.rewrite("A sentence.");
  assert.equal(body.keep_alive, "30m");
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.temperature, 0, "the dialect cannot move the temperature");
  assert.equal(body.top_p, 1);
  assert.deepEqual(body.stop, [',"reason"']);
  assert.equal(body.response_format.json_schema.name, "clarity_decision");
});

test("the openai dialect sends neither", async () => {
  let body;
  const engine = createEngine({
    prompt: "system",
    fetchImpl: async (url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"action":"keep","replacement":"","reason":"c"}' } }] }) };
    },
  });
  await engine.rewrite("A sentence.");
  assert.equal(body.keep_alive, undefined);
  assert.equal(body.reasoning_effort, undefined);
  assert.deepEqual(Object.keys(DIALECTS.openai), []);
});

test("an api key travels on every call, and no key sends no header", async () => {
  const headers = [];
  const collect = async (url, init) => {
    headers.push(init.headers.authorization);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reason":"r","verdict":"show"}' } }] }) };
  };
  const keyed = createEngine({ prompt: "p", verifierPrompt: "v", apiKey: "secret", fetchImpl: collect });
  await keyed.verify("a", "b");
  const bare = createEngine({ prompt: "p", verifierPrompt: "v", fetchImpl: collect });
  await bare.verify("a", "b");
  assert.deepEqual(headers, ["Bearer secret", undefined]);
});

test("a leaked think block is stripped rather than reported as a broken model", async () => {
  const engine = createEngine({
    prompt: "system",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '<think>Hmm, the sentence is wordy.</think>\n{"action":"rewrite","replacement":"Short.","reason":"x"}' } }] }),
    }),
  });
  const decision = await engine.rewrite("A long sentence.");
  assert.equal(decision.replacement, "Short.");
});

test("stripThinking leaves ordinary content alone and does not eat an answer", () => {
  assert.equal(stripThinking('{"action":"keep"}'), '{"action":"keep"}');
  assert.equal(stripThinking('<think>a</think>{"a":1}'), '{"a":1}');
  assert.equal(stripThinking('<reasoning>a</reasoning> <think>b</think> {"a":1}'), '{"a":1}');
  // An unterminated block that still carries the JSON must not be thrown away whole.
  assert.equal(stripThinking('<think>weighing {"a":1}'), '<think>weighing {"a":1}');
  // One that carries nothing usable is dropped, so the caller reports "no content".
  assert.equal(stripThinking("<think>weighing the options"), "");
  assert.equal(stripThinking(null), "");
});

// ------------------------------------------------- what the first live run found

// Two defects, neither of which a fake could have predicted, both found the first time a
// real Ollama answered (0.33.2, 2026-09-02). These hold them closed.

test("a server that reorders the schema's fields turns the reason-stop off", async () => {
  // The engine stops generation at `,"reason"` to save the tokens of a reason nobody
  // reads. Ollama emits action, reason, replacement — so that stop fires BEFORE the
  // replacement exists, and every sentence comes back as `{"action":"rewrite"`: a rewrite
  // with nothing to rewrite to. Ten of ten sentences failed this way on the first live
  // run, with "Model omitted replacement".
  await withOllama({ keepAliveMinutes: 23, content: OLLAMA_ORDER }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.schema, true, "the JSON is fine — only its order is not");
    assert.equal(findings.fieldOrder, "action,reason,replacement");
    assert.equal(findings.stopSafe, false);
    assert.ok(findings.errors.some((line) => /reason-stop optimisation is disabled/u.test(line)));

    const connection = await connectOllama({ tag, baseUrl });
    assert.equal(connection.useReasonStop, false);
  });
});

test("the reordering is a fact about the server, not about the endpoint", async () => {
  // An Ollama whose /v1 honoured everything else would still truncate its own
  // replacements, so the finding must survive the route being "v1".
  await withOllama({ keepAliveMinutes: 23, content: OLLAMA_ORDER }, async ({ baseUrl, tag }) => {
    const connection = await connectOllama({ tag, baseUrl });
    assert.equal(connection.endpoint, "v1", "nothing else was wrong, so /v1 is used");
    assert.equal(connection.useReasonStop, false, "and the stop is still off");
  });
});

test("an engine told the stop is unsafe does not send one", async () => {
  const bodies = [];
  const reply = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: SCHEMA_ORDER } }] }) };
  };
  const safe = createEngine({ prompt: "p", fetchImpl: reply });
  await safe.rewrite("A sentence.");
  const unsafe = createEngine({ prompt: "p", fetchImpl: reply, useReasonStop: false });
  await unsafe.rewrite("A sentence.");
  assert.deepEqual(bodies[0].stop, [',"reason"'], "kept where the order is the schema's");
  assert.equal("stop" in bodies[1], false, "and absent entirely, not sent empty");
});

test("a stop that fires early is reported, never turned into a decision", async () => {
  // What the truncated answer actually looks like. The engine must refuse it rather than
  // hand the pipeline a rewrite whose replacement is the empty string.
  const engine = createEngine({
    prompt: "p",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"action":"rewrite"' } }] }) }),
  });
  await assert.rejects(engine.rewrite("A sentence."), (error) => /replacement/iu.test(error.message));
});

test("keep_alive is judged against what was asked for, not against a threshold", async () => {
  // The first live probe said keep_alive was dropped; the second, minutes later, said it
  // was honoured — because the first probe's own fallback to /api/chat had loaded the
  // model for thirty minutes. A threshold cannot tell "/v1 honoured me" from "someone
  // else got there first".
  await withOllama({ keepAliveMinutes: 30 }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.keepAlive, false, "30 minutes is not the 23 that were asked for");
    assert.equal(findings.keepAliveMinutes, 30);
    assert.ok(findings.errors.some((line) => /Something else set that/u.test(line)));
  });
  // Ollama's default when the field is dropped.
  await withOllama({ keepAliveMinutes: 5 }, async ({ baseUrl, tag }) => {
    const findings = await probeDialect({ tag, baseUrl });
    assert.equal(findings.keepAlive, false);
    assert.ok(findings.errors.some((line) => /\/v1 dropped the field/u.test(line)));
  });
  // Within tolerance of what was asked: honoured.
  await withOllama({ keepAliveMinutes: 22 }, async ({ baseUrl, tag }) => {
    assert.equal((await probeDialect({ tag, baseUrl })).keepAlive, true);
  });
});
