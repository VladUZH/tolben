// The Obsidian community-plugin directory reads files from the REPOSITORY ROOT of the
// `repo` named in community-plugins.json — not from wherever the plugin's sources happen to
// live. Tolben's plugin is under obsidian-plugin/, so the root carries a copy of
// manifest.json and versions.json, and copies drift.
//
// These are the checks the directory itself would fail us on, run here so the answer is
// known before a submission PR is opened rather than after a reviewer closes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = async (path) => JSON.parse(await readFile(`${root}${path}`, "utf8"));
const raw = (path) => readFile(`${root}${path}`, "utf8");

test("the root manifest.json is byte-identical to the plugin's", async () => {
  assert.equal(
    await raw("manifest.json"),
    await raw("obsidian-plugin/manifest.json"),
    "the directory reads the ROOT manifest and the release attaches the plugin's; if they "
    + "differ, the listing describes something other than what installs",
  );
});

test("the root versions.json is byte-identical to the plugin's", async () => {
  assert.equal(await raw("versions.json"), await raw("obsidian-plugin/versions.json"));
});

test("versions.json has an entry for the manifest's version", async () => {
  const manifest = await read("manifest.json");
  const versions = await read("versions.json");
  assert.ok(
    Object.hasOwn(versions, manifest.version),
    `versions.json has no entry for ${manifest.version}, so Obsidian would not offer it to `
    + "anyone; release.yml fails on this too, but only once the tag has been pushed",
  );
  assert.equal(versions[manifest.version], manifest.minAppVersion);
});

test("the manifest carries every field the directory requires", async () => {
  const manifest = await read("manifest.json");
  for (const field of ["id", "name", "version", "minAppVersion", "description", "author"]) {
    assert.ok(manifest[field], `manifest.json is missing ${field}`);
  }
  // The directory rejects an id that is prefixed with "obsidian" or suffixed "-plugin",
  // and one that is not lowercase-with-hyphens.
  assert.match(manifest.id, /^[a-z0-9-]+$/u);
  assert.ok(!manifest.id.startsWith("obsidian"), "an id may not start with 'obsidian'");
  assert.ok(!manifest.id.endsWith("-plugin"), "an id may not end with '-plugin'");
  // The description is shown in a list of hundreds; the directory asks for a short one and
  // rejects one that starts with the plugin's own name.
  assert.ok(manifest.description.length <= 250, "the description must be at most 250 characters");
  assert.ok(
    !manifest.description.toLowerCase().startsWith(manifest.name.toLowerCase()),
    "the description must not open with the plugin's own name; the listing already shows it",
  );
});

test("no command id repeats the plugin id", async () => {
  // Obsidian prefixes every command with the plugin id when it registers it, so an id of
  // "tolben-setup" is published as "tolben:tolben-setup". This is cheap to fix now and
  // impossible later: a released command id is a hotkey binding in someone's config.
  const source = await raw("obsidian-plugin/main.mjs");
  const manifest = await read("manifest.json");
  const ids = [...source.matchAll(/\bid:\s*"([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(ids.length > 0, "no command ids were found, so this test is not testing anything");
  for (const id of ids) {
    assert.ok(
      !id.startsWith(`${manifest.id}-`) && id !== manifest.id,
      `command id "${id}" repeats the plugin id; Obsidian would publish it as `
      + `"${manifest.id}:${id}"`,
    );
  }
});
