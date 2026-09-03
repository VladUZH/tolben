// Nothing reaches the vault except Obsidian's own settings file.
//
// The plugin used to write analysis-cache.json into the vault: a record of every sentence
// the writer finished and what a model said about each one, left in their notes. This
// file is the guard that keeps it gone, and it is a source-level guard on purpose.
//
// A runtime test would need the whole Obsidian API, and a mock of it proves only that the
// mock was not called. What actually matters is that the plugin has no CODE that writes
// to the vault — so the committed bundle, which is what Obsidian loads, is read and
// searched for the calls that could. That cannot be satisfied by a passing stub.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const BUNDLE = new URL("../obsidian-plugin/main.js", import.meta.url);
const SOURCE = new URL("../obsidian-plugin/main.mjs", import.meta.url);

// Every way a plugin can put bytes in the vault through Obsidian's API. `adapter.write`
// and `adapter.append` take a path; `vault.create`, `vault.modify` and `vault.append`
// take a file. `saveData` is the exception the whole test exists to permit: it writes
// data.json in the plugin's own folder and is how Obsidian stores settings.
const VAULT_WRITES = [
  /\badapter\s*\.\s*write\b/gu,
  /\badapter\s*\.\s*append\b/gu,
  /\badapter\s*\.\s*writeBinary\b/gu,
  /\badapter\s*\.\s*mkdir\b/gu,
  /\bvault\s*\.\s*create\b/gu,
  /\bvault\s*\.\s*createBinary\b/gu,
  /\bvault\s*\.\s*modify\b/gu,
  /\bvault\s*\.\s*append\b/gu,
  /\bvault\s*\.\s*copy\b/gu,
];

async function sources() {
  return {
    bundle: await readFile(BUNDLE, "utf8"),
    source: await readFile(SOURCE, "utf8"),
  };
}

test("the plugin makes no call that writes into the vault", async () => {
  const { bundle, source } = await sources();
  for (const [name, text] of [["main.js", bundle], ["main.mjs", source]]) {
    for (const pattern of VAULT_WRITES) {
      const found = text.match(pattern) ?? [];
      assert.deepEqual(found, [], `${name} calls ${pattern.source}, which writes into the vault`);
    }
  }
});

test("settings still go through saveData, which is data.json and nothing else", async () => {
  const { bundle, source } = await sources();
  assert.match(source, /saveData\(/u, "settings are still persisted");
  assert.match(bundle, /saveData\(/u);
});

test("the outcome cache is not written anywhere", async () => {
  const { bundle, source } = await sources();
  // In code, not in a comment: the note recording that this file used to be written is
  // history worth keeping, whereas a live mention is a path something opens.
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /analysis-cache\.json/u);
  assert.doesNotMatch(bundle, /analysis-cache\.json/u, "and the bundle carries no trace either");
});

test("the managed runtime is kept outside the vault", async () => {
  const { source } = await sources();
  // A 1.5 GB model inside a synced vault is a bad afternoon for whoever pays for the
  // sync, so the state directory is derived from the OS data directory, never from
  // manifest.dir or the adapter's base path.
  const stateDir = /stateDir\(\)\s*\{([\s\S]*?)\n {2}\}/u.exec(source)?.[1] ?? "";
  assert.ok(stateDir.length > 0, "stateDir() exists");
  assert.doesNotMatch(stateDir, /manifest\s*\.\s*dir/u);
  assert.doesNotMatch(stateDir, /basePath|getBasePath/u);
  assert.match(stateDir, /XDG_DATA_HOME|LOCALAPPDATA/u);
});

test("the refusal ledger has no persistence at all", async () => {
  const ledger = await readFile(new URL("../obsidian-plugin/ledger.mjs", import.meta.url), "utf8");
  // Not "does not currently write" — has no way to. The module imports nothing.
  assert.doesNotMatch(ledger, /^import /mu, "the ledger imports nothing, so it can reach nothing");
  assert.doesNotMatch(ledger, /require\(/u);
  assert.doesNotMatch(ledger, /localStorage|indexedDB|writeFile|adapter/u);
});

test("the bundle is the sources: a guard on main.mjs alone would be worthless", async () => {
  // tests/plugin-bundle.test.mjs proves they match; this asserts the dependency, so that
  // deleting that test does not quietly turn every check above into a check of a file
  // Obsidian never loads.
  const bundleTest = await readFile(new URL("./plugin-bundle.test.mjs", import.meta.url), "utf8");
  assert.match(bundleTest, /main\.js/u);
});
