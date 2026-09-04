// A fetch-shaped adapter over Node's http client.
//
// Obsidian's renderer is a browser context on an `app://` origin, so a plain `fetch` to
// the model server on loopback is a cross-origin request — subject to CORS and to
// Chromium's private-network rules. Plugins have Node available, so the request is made
// from Node instead and neither ever applies. Obsidian's own `requestUrl` would also
// work, but it takes no AbortSignal, and the coordinator's whole job is cancelling
// requests the writer has moved past.
//
// Two consumers, two shapes. The engine wants `ok`, `status`, `json()` and `text()` from a
// loopback server that never redirects. The provisioner wants a release asset from GitHub
// or Hugging Face, and both answer a release URL with a 302 to a CDN and then a body of
// up to 1.5 GB — so redirects are followed, `headers.get()` is real, and `body` is the
// response stream itself rather than a string. Until 2026-09-04 this file implemented only
// the engine's half, and the setup pane had never downloaded anything: "HTTP 302", three
// times, on every install. REPORT.md under that date has the run that found it.

import http from "node:http";
import https from "node:https";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Enough for any CDN chain in the wild and small enough that a loop is an error in
// seconds rather than a hang.
export const MAX_REDIRECTS = 10;

// Headers that must not travel to a different origin: the managed server's API key is
// sent as a bearer token, and a redirect is the one way a request to it could be steered
// elsewhere. Same rule the WHATWG fetch algorithm applies.
const ORIGIN_BOUND_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

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

    // What the abort handler has to destroy changes as the chain advances: the request
    // in flight, then the response being streamed. Destroying with the reason makes a
    // consumer mid-pipeline fail with that reason rather than a bare "aborted".
    let current = null;
    let settled = false;
    const abort = () => {
      const reason = abortReason();
      current?.destroy(reason);
      if (!settled) { settled = true; reject(reason); }
    };
    signal?.addEventListener("abort", abort, { once: true });
    const detach = () => signal?.removeEventListener("abort", abort);
    const fail = (error) => { detach(); if (!settled) { settled = true; reject(error); } };

    const hop = (currentUrl, currentMethod, currentHeaders, currentBody, hops, redirected) => {
      const client = currentUrl.protocol === "https:" ? https : http;
      const request = client.request(
        {
          protocol: currentUrl.protocol,
          // WHATWG URL keeps an IPv6 literal bracketed; Node's http stack wants it bare,
          // and the bracketed form resolves as a DNS name ("getaddrinfo ENOTFOUND [::1]").
          hostname: currentUrl.hostname.replace(/^\[|\]$/gu, ""),
          port: currentUrl.port,
          path: `${currentUrl.pathname}${currentUrl.search}`,
          method: currentMethod,
          headers: currentBody
            ? { ...currentHeaders, "content-length": Buffer.byteLength(currentBody) }
            : currentHeaders,
        },
        (response) => {
          const status = response.statusCode;
          const location = response.headers.location;
          if (REDIRECT_STATUSES.has(status) && location && !signal?.aborted) {
            response.resume();   // the redirect's own body is nobody's business
            if (hops >= MAX_REDIRECTS) {
              fail(new Error(`${url}: more than ${MAX_REDIRECTS} redirects`));
              return;
            }
            let next;
            try {
              next = new URL(location, currentUrl);
            } catch (error) {
              fail(new Error(`${currentUrl}: redirect to an unusable location "${location}"`));
              return;
            }
            // 303 always becomes a GET; 301 and 302 do for a POST, as every browser does.
            // 307 and 308 keep the method and the body.
            const toGet = status === 303 || ((status === 301 || status === 302) && currentMethod === "POST");
            const nextMethod = toGet ? "GET" : currentMethod;
            const nextBody = toGet ? undefined : currentBody;
            const nextHeaders = { ...currentHeaders };
            if (toGet) delete nextHeaders["content-type"];
            if (next.origin !== currentUrl.origin) {
              for (const name of Object.keys(nextHeaders)) {
                if (ORIGIN_BOUND_HEADERS.has(name.toLowerCase())) delete nextHeaders[name];
              }
            }
            hop(next, nextMethod, nextHeaders, nextBody, hops + 1, true);
            return;
          }

          current = response;
          response.once("close", detach);
          let buffered = null;
          const text = () => {
            if (!buffered) {
              buffered = new Promise((res, rej) => {
                const chunks = [];
                response.on("data", (chunk) => chunks.push(chunk));
                response.once("error", rej);
                response.once("end", () => res(Buffer.concat(chunks).toString("utf8")));
              });
            }
            return buffered;
          };
          settled = true;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            url: currentUrl.href,
            redirected,
            headers: {
              get: (name) => {
                const value = response.headers[String(name).toLowerCase()];
                if (value == null) return null;
                return Array.isArray(value) ? value.join(", ") : String(value);
              },
            },
            // The stream itself, for a consumer that must not hold 1.5 GB in memory.
            // Reading it and calling text() are alternatives, not a sequence.
            body: response,
            text,
            // Left to throw its own SyntaxError: engine.mjs distinguishes an unparseable
            // body from a broken connection, and flattening it here would lose that.
            json: async () => JSON.parse(await text()),
          });
        },
      );
      current = request;
      request.on("error", fail);
      if (currentBody) request.write(currentBody);
      request.end();
    };

    // Header names are matched case-insensitively when stripped, but sent as given.
    hop(target, method, { ...headers }, body, 0, false);
  });
}
