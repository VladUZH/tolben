// The Obsidian plugin loads obsidian-plugin/main.js, a tracked esbuild output. Nothing else
// exercised that file: every plugin test imports the .mjs sources, so the bundle sat six
// safety guards and one verifier-schema change behind them and stayed green. This builds
// the same bundle in memory and holds the committed file to it byte for byte. When it
// fails, `npm run plugin:build` is the fix, and the diff is the review.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { options } from "../obsidian-plugin/build.mjs";

test("the committed plugin bundle is what its sources build", async () => {
  const result = await build({ ...options, write: false, logLevel: "silent" });
  assert.equal(result.outputFiles.length, 1);
  const fresh = result.outputFiles[0].text;
  const committed = await readFile(options.outfile, "utf8");
  assert.equal(
    committed,
    fresh,
    "obsidian-plugin/main.js is not what obsidian-plugin/main.mjs builds to — run `npm run plugin:build` and commit the result",
  );
});
