// A fetch-shaped adapter over Node's http client.
//
// Obsidian's renderer is a browser context on an `app://` origin, so a plain `fetch` to
// the model server on loopback is a cross-origin request — subject to CORS and to
// Chromium's private-network rules. Plugins have Node available, so the request is made
// from Node instead and neither ever applies. Obsidian's own `requestUrl` would also
// work, but it takes no AbortSignal, and the coordinator's whole job is cancelling
// requests the writer has moved past.
//
// Only the surface `engine.mjs` actually uses is implemented: ok, status, json(), text().

import http from "node:http";
import https from "node:https";

export function nodeFetch(url, { method = "GET", headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    // The signal's own reason travels: AbortSignal.timeout carries a TimeoutError, and
    // reporting every abort as "Request superseded" told the writer a hung server was
    // superseded by nothing.
    const abortReason = () =>
      (signal?.reason instanceof Error ? signal.reason : new Error("Request superseded"));
    if (signal?.aborted) {
      reject(abortReason());
      return;
    }
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(
      {
        protocol: target.protocol,
        // WHATWG URL keeps an IPv6 literal bracketed; Node's http stack wants it bare,
        // and the bracketed form resolves as a DNS name ("getaddrinfo ENOTFOUND [::1]").
        hostname: target.hostname.replace(/^\[|\]$/gu, ""),
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: body ? { ...headers, "content-length": Buffer.byteLength(body) } : headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            text: async () => text,
            // Left to throw its own SyntaxError: engine.mjs distinguishes an unparseable
            // body from a broken connection, and flattening it here would lose that.
            json: async () => JSON.parse(text),
          });
        });
      },
    );

    const abort = () => {
      const reason = abortReason();
      request.destroy(reason);
      reject(reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    request.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    request.on("close", () => signal?.removeEventListener("abort", abort));
    if (body) request.write(body);
    request.end();
  });
}
