## What this changes

<!-- One paragraph. What is different after this, and why. -->

## How it was verified

<!-- Delete what does not apply. -->

- [ ] `npm test` passes with **0 skipped** — i.e. against a real model server, not with the
      six live-model tests skipping.
- [ ] If this touches the model transport, it was run against a real `llama-server` **and**
      a real Ollama, not only against the test doubles.
- [ ] The three control instruments (`bench/oracle.mjs`, `bench/precision-check.mjs`,
      `bench/unlock-check.mjs`) print what they printed before — or the commit message
      explains what moved and why.

## Guarantees this does not weaken

- [ ] Nothing is fetched that is not pinned by sha256.
- [ ] Nothing is written into the user's vault except `data.json`.
- [ ] No outbound network connection is made after setup completes.

## Provenance

- [ ] Commits are signed off (`git commit -s`) per the DCO — see CONTRIBUTING.md.
