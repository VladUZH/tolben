# Working on Tolben

## Verify against real servers, not against fakes

**Before calling any change to the model transport done, run it through a real Ollama and
a real llama-server.** Not a stub, not the fake Ollama in `tests/runtime-ollama.test.mjs` —
the actual programs.

This is not a matter of thoroughness. On 2026-09-02 the Ollama adapter had eighteen
passing tests and could not analyse a single sentence through a real Ollama: the engine's
reason-stop assumed the server emits a JSON schema's properties in the schema's order,
llama.cpp does and Ollama does not, and every answer came back as `{"action":"rewrite"` —
a rewrite with nothing to rewrite to. The fake passed because it had been written to
return the shape the author expected. A second defect surfaced the same way: the
`keep_alive` probe compared an expiry against a threshold, so an Ollama that any other tool
had left loaded read as healthy however thoroughly `/v1` dropped the field.

A unit test proves the code does what its author expected. It cannot prove the expectation
was right about somebody else's software.

### Getting both, in a container with neither

There is no Docker daemon. **The pinned llama.cpp release binary can be downloaded
directly** — verified 2026-09-03, when all six platform assets of `b10760` were fetched
through the agent proxy and every sha256 matched
`obsidian-plugin/runtime/manifest.json`. An earlier note here said release downloads were
refused; that was true when it was written and is not true now, so try this first:

```bash
curl -sSL -o /tmp/llama.tgz \
  https://github.com/ggml-org/llama.cpp/releases/download/b10760/llama-b10760-bin-ubuntu-x64.tar.gz
sha256sum /tmp/llama.tgz   # 00cfac8189ebec8d5576c2a5acfcd7bff230ec2aa4b8454a8f2fa77548b4cc15
mkdir -p /tmp/b10760 && tar -xzf /tmp/llama.tgz -C /tmp/b10760 --strip-components=1
LD_LIBRARY_PATH=/tmp/b10760 /tmp/b10760/llama-server -m models/Qwen3.5-2B-Q6_K.gguf \
  --host 127.0.0.1 --port 8080 -c 4096 -np 1 --jinja --reasoning off &
```

That is the *actual shipped artefact*, so it is strictly better than a local build for any
measurement: a server compiled here is not the binary a writer will run. Prefer it, and
keep the source build below for Ollama, or for when the download is refused again.

Go, cmake, gcc and `proxy.golang.org` are all present, and `git clone` of a public
repository works. Takes about eight minutes and yields both servers:

```bash
git clone --depth 1 https://github.com/ollama/ollama /home/user/ollama-src
cd /home/user/ollama-src
cmake -B build . -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 4        # llama-server falls out of this too

# Ollama
OLLAMA_MODELS=/home/user/ollama-models ./ollama serve &
node tools/ollama-check.mjs --pull --smoke 10

# llama-server, with the flags every published number was measured on
node tools/fetch-models.mjs             # the pinned Q6_K, verified against models/MANIFEST.json
./build/llama-server-local/bin/llama-server -m models/Qwen3.5-2B-Q6_K.gguf \
  --host 127.0.0.1 --port 8080 -c 4096 -np 1 --jinja --reasoning off &
npm test                                # 0 skipped, rather than 6
```

The six tests that skip without a server are the only ones that exercise the real
contract — schema-constrained decoding, the stop string, and a verifier that answers.
A run that skips them has not tested the thing the product is.

### Do not benchmark a machine that is fighting itself

Correctness tests tolerate a loaded box; **latency figures do not**. On 2026-09-03 a
holdout re-run was started while two subagent workflows were working the same four vCPUs,
and the first sentence took 67 s against a recorded p50 of 1.3 s — past the 60 s per-call
timeout, so rows would have been recorded as engine failures and scored as lost recall.
The run was discarded rather than reported. Check `uptime` before a timed run and give the
server the machine to itself.

## Where the rules live

- `docs/ROADMAP.md` — the plan, its phases, and a status table kept current.
- `REPORT.md` — the engineering log. Every measurement, dated, with the command that
  produces it. New findings go at the end as a dated section; earlier sections are history
  and are annotated rather than rewritten.
- `bench/corpus/THIRD-PARTY.md` — what in the corpora is not ours, and why it is here.

## Two rules that are not negotiable

**Nothing is fetched that is not pinned by sha256.** Not fetched-and-checked — not
fetched. `obsidian-plugin/runtime/manifest.json` is the record, and an entry with a null
hash makes the provisioner report itself unavailable rather than download on trust.

**Nothing is written into the writer's vault except `data.json`.**
`tests/plugin-vault.test.mjs` enforces it against the committed bundle as well as the
source, because a mocked Obsidian API proves only that the mock was not called.

## Numbers

Three instruments are controls, not benchmarks: `bench/oracle.mjs`,
`bench/precision-check.mjs`, `bench/unlock-check.mjs`. They print the same figures every
time unless a guard changed. **A change that moves one has to be explained in the commit
message**, and a re-baseline goes through `--write --note "why"` so the change is recorded
in the baseline file itself rather than only in a commit nobody re-reads.
