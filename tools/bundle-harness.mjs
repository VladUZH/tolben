// Load the shipped plugin bundle outside Obsidian.
//
// obsidian-plugin/main.js requires `obsidian` and Obsidian's CodeMirror packages at
// runtime. Here the bundle is copied into a directory of its own, `obsidian` resolves to
// tools/obsidian-stub.cjs — five UI classes and nothing else — and the CodeMirror packages
// to the repository's node_modules. Used by tools/plugin-lifecycle.mjs against a real
// server and by tests/plugin-lifecycle.test.mjs against a fake one.
import { mkdir, copyFile, symlink, rm, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadShippedBundle(dir) {
  const rig = resolve(dir);
  await rm(rig, { recursive: true, force: true });
  await mkdir(join(rig, "node_modules", "obsidian"), { recursive: true });
  await copyFile(join(REPO, "tools", "obsidian-stub.cjs"), join(rig, "node_modules", "obsidian", "index.js"));
  for (const scope of ["@codemirror", "@lezer"]) {
    try {
      await access(join(REPO, "node_modules", scope));
      await symlink(join(REPO, "node_modules", scope), join(rig, "node_modules", scope));
    } catch { /* not installed, or already linked: the bundle will say so if it matters */ }
  }
  await copyFile(join(REPO, "obsidian-plugin", "main.js"), join(rig, "main.js"));
  const require = createRequire(pathToFileURL(join(rig, "main.js")));
  const bundle = require(join(rig, "main.js"));
  return { TolbenPlugin: bundle.default ?? bundle, dir: rig };
}
