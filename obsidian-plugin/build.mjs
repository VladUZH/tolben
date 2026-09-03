// Bundles the plugin into the single CommonJS main.js Obsidian loads.
//
// Everything Obsidian already has in its own bundle is marked external and resolved by
// `require` at runtime — the plugin must use Obsidian's CodeMirror instance, not a
// second copy, or its decorations would belong to a different editor entirely.

import { build, context } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Exported so tests/plugin-bundle.test.mjs can build the same thing in memory and hold the
// committed main.js to it: the bundle is a tracked build output, and it once fell six
// safety guards behind the sources without anything noticing.
export const options = {
  entryPoints: [`${root}main.mjs`],
  outfile: `${root}main.js`,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2020",
  sourcemap: process.argv.includes("--watch") ? "inline" : false,
  logLevel: "info",
  // Prompt files travel inside the bundle: the plugin folder is a symlink into the repo
  // and reading them off disk would make the path a thing that can break.
  loader: { ".txt": "text" },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "node:http",
    "node:https",
  ],
};

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly && process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  process.stdout.write("watching…\n");
} else if (runDirectly) {
  await build(options);
}
