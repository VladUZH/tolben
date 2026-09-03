// A count of every request this plugin has made, and where it went.
//
// "Nothing leaves your machine" is the central claim, and a claim is worth what its
// evidence is worth. The evidence a person can check themselves is a packet capture; the
// evidence the plugin can offer without one is this: a wrapper around the ONLY function
// it has for making a request, counting each one by host and classifying it as loopback
// or not. If the non-loopback count is anything but zero, the claim is false, and the
// "What talks to the network" pane says so in its first line.
//
// It is deliberately not clever. A counter that could be bypassed would be worse than no
// counter, so nodeFetch is wrapped once, at the single point the plugin builds its
// engine, and nothing else in the plugin is given a way to make a request.

// Addresses that never leave the machine: IPv6 loopback and the one name that is
// guaranteed to resolve to it.
const LOOPBACK_NAME = /^(?:localhost|::1)$/iu;

export function isLoopback(host) {
  if (!host) return false;
  const bare = String(host).replace(/^\[|\]$/gu, "").toLowerCase();
  if (LOOPBACK_NAME.test(bare)) return true;
  // All of 127/8 is loopback, not only .0.1 — and the shorter spellings a URL accepts,
  // 127.1 and 127.0.1, are loopback too. The octet range is checked rather than assumed:
  // "127.0.0.256" is not an address at all, so it would be resolved as a NAME, and a
  // name can point anywhere. Counting it as loopback would be the one mistake that makes
  // this whole file a lie.
  const octets = bare.split(".");
  if (octets[0] !== "127" || octets.length > 4) return false;
  return octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

export function createNetworkLog({ now = () => Date.now() } = {}) {
  const hosts = new Map();     // "127.0.0.1:8080" -> { requests, loopback, lastAt }
  let requests = 0;
  let offMachine = 0;
  let failures = 0;

  function record(url) {
    requests += 1;
    let host = "(unparseable)";
    let loopback = false;
    try {
      const parsed = new URL(url);
      host = parsed.host;
      loopback = isLoopback(parsed.hostname);
    } catch {
      // An unparseable URL is not evidence of safety, so it counts against the claim.
    }
    if (!loopback) offMachine += 1;
    const entry = hosts.get(host) ?? { requests: 0, loopback, lastAt: null };
    entry.requests += 1;
    entry.loopback = loopback;
    entry.lastAt = now();
    hosts.set(host, entry);
    return loopback;
  }

  return {
    /** Wrap a fetch so every call through it is counted. */
    wrap(fetchImpl) {
      return async (url, init) => {
        record(url);
        try {
          return await fetchImpl(url, init);
        } catch (error) {
          failures += 1;
          throw error;
        }
      };
    },
    report() {
      return {
        requests,
        offMachine,
        failures,
        hosts: [...hosts.entries()]
          .map(([host, entry]) => ({ host, ...entry }))
          .sort((left, right) => right.requests - left.requests),
      };
    },
    reset() {
      hosts.clear();
      requests = 0;
      offMachine = 0;
      failures = 0;
    },
  };
}
