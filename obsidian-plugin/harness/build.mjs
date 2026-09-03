// Bundles the harness against the real @codemirror packages. Nothing is external here:
// the point is to run the extension in a genuine EditorView, which is the only place the
// viewport behaviour exists at all.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

await build({
  entryPoints: [`${root}entry.mjs`],
  outfile: `${root}bundle.js`,
  bundle: true,
  format: "iife",
  platform: "browser",
  logLevel: "info",
});
