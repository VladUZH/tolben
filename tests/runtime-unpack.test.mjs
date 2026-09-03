// The zip reader, including the entries it must refuse.
//
// Archives are built here with Node's own deflate so the test depends on no external
// tool, and so the malicious cases can be constructed exactly rather than approximated.

import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractZip, listEntries, safeJoin, ArchiveError } from "../obsidian-plugin/runtime/unpack.mjs";

// A minimal zip writer: enough of the format to exercise the reader, with the fields the
// reader actually looks at set correctly.
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data ?? "", "utf8");
    const deflated = entry.store ? raw : deflateRawSync(raw);
    const method = entry.store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = entry.symlink ? 0xa1ff : (entry.mode ?? 0o644);
    central.writeUInt32LE((((entry.symlink ? 0xa000 : 0x8000) | mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + deflated.length;
  }
  const body = Buffer.concat(locals);
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

async function withZip(entries, run) {
  const dir = await mkdtemp(join(tmpdir(), "tolben-zip-"));
  const archive = join(dir, "release.zip");
  await writeFile(archive, buildZip(entries));
  try {
    return await run({ archive, out: join(dir, "out"), dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("files come out with their contents and their execute bit", async () => {
  await withZip([
    { name: "build/bin/llama-server", data: "#!/bin/sh\necho hi\n", mode: 0o755 },
    { name: "build/bin/libggml.so", data: "not really a library" },
    { name: "README.md", data: "# release", store: true },
  ], async ({ archive, out }) => {
    const written = await extractZip(archive, out);
    assert.deepEqual(written.sort(), ["README.md", "build/bin/libggml.so", "build/bin/llama-server"]);
    assert.equal(await readFile(join(out, "build/bin/llama-server"), "utf8"), "#!/bin/sh\necho hi\n");
    assert.equal(await readFile(join(out, "README.md"), "utf8"), "# release");
    if (process.platform !== "win32") {
      const mode = (await stat(join(out, "build/bin/llama-server"))).mode & 0o111;
      assert.ok(mode !== 0, "the server is executable");
      assert.equal((await stat(join(out, "README.md"))).mode & 0o111, 0, "the readme is not");
    }
  });
});

test("a filter narrows what is taken", async () => {
  await withZip([
    { name: "build/bin/llama-server", data: "server" },
    { name: "build/bin/llama-bench", data: "bench" },
  ], async ({ archive, out }) => {
    const written = await extractZip(archive, out, { filter: (entry) => entry.name.endsWith("llama-server") });
    assert.deepEqual(written, ["build/bin/llama-server"]);
    await assert.rejects(stat(join(out, "build/bin/llama-bench")));
  });
});

test("an entry that escapes the destination is refused, not sanitised", async () => {
  await withZip([{ name: "../../evil.sh", data: "rm -rf /" }], async ({ archive, out }) => {
    await assert.rejects(extractZip(archive, out), (error) => error instanceof ArchiveError
      && /escapes its directory/u.test(error.message));
  });
});

test("an absolute path is refused", async () => {
  await withZip([{ name: "/etc/cron.d/evil", data: "*" }], async ({ archive, out }) => {
    await assert.rejects(extractZip(archive, out), (error) => /absolute path/u.test(error.message));
  });
  await withZip([{ name: "C:\\Windows\\System32\\evil.dll", data: "*" }], async ({ archive, out }) => {
    await assert.rejects(extractZip(archive, out), (error) => /absolute path/u.test(error.message));
  });
});

test("a zip symlink that points outside the destination is refused", async () => {
  // A zip stores a symlink's target as the entry's content, and `7z a -snl` — what
  // llama.cpp packs the Windows assets with — writes them that way. Pointing a name
  // called `llama-server` at /bin/sh is the attack: extraction looks ordinary, and what
  // the provisioner then spawns is not what it verified the hash of.
  await withZip([{ name: "build/bin/llama-server", data: "/bin/sh", symlink: true }], async ({ archive, out }) => {
    await assert.rejects(extractZip(archive, out),
      (error) => error instanceof ArchiveError && /absolute path/u.test(error.message));
  });
  await withZip([{ name: "bin/a.so", data: "../../../etc/passwd", symlink: true }], async ({ archive, out }) => {
    await assert.rejects(extractZip(archive, out),
      (error) => error instanceof ArchiveError && /escapes its directory/u.test(error.message));
  });
});

test("a zip symlink that stays inside is preserved, because a release needs it to be", async () => {
  await withZip([
    { name: "libllama.so.0.3.0", data: "the real shared object" },
    { name: "libllama.so.0", data: "libllama.so.0.3.0", symlink: true },
    { name: "libllama.so", data: "libllama.so.0", symlink: true },
  ], async ({ archive, out }) => {
    const written = await extractZip(archive, out);
    assert.deepEqual(written.sort(), ["libllama.so", "libllama.so.0", "libllama.so.0.3.0"]);
    assert.equal(await readFile(join(out, "libllama.so"), "utf8"), "the real shared object");
  });
});

test("safeJoin accepts an ordinary nested name", () => {
  const target = safeJoin("/tmp/tolben", "build/bin/llama-server");
  assert.match(target, /tolben[/\\]build[/\\]bin[/\\]llama-server$/u);
  assert.throws(() => safeJoin("/tmp/tolben", "../escape"), ArchiveError);
  assert.throws(() => safeJoin("/tmp/tolben", "a/../../escape"), ArchiveError);
  assert.throws(() => safeJoin("/tmp/tolben", "a\0b"), ArchiveError);
});

test("something that is not a zip is reported as such", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tolben-zip-"));
  const archive = join(dir, "not.zip");
  await writeFile(archive, Buffer.alloc(2048, 0x41));
  try {
    await assert.rejects(extractZip(archive, join(dir, "out")),
      (error) => error instanceof ArchiveError && /not a zip archive/u.test(error.message));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("entries are listed with their sizes and modes", async () => {
  await withZip([{ name: "build/bin/llama-server", data: "x".repeat(100), mode: 0o755 }], async ({ archive }) => {
    const [entry] = listEntries(await readFile(archive));
    assert.equal(entry.name, "build/bin/llama-server");
    assert.equal(entry.size, 100);
    assert.equal(entry.mode & 0o111, 0o111);
    assert.equal(entry.symlink, false);
  });
});

// -------------------------------------------------------------------------- tar.gz

// llama.cpp ships macOS and Linux as tar.gz and only Windows as zip, so both readers
// matter — and the tar archives here are COMMITTED FIXTURES, written by a real GNU tar,
// rather than built during the run.
//
// The first version of these tests shelled out to the machine's own `tar`. It passed on
// Ubuntu and failed on macOS and Windows within a minute of reaching CI: `--transform` is
// GNU's spelling and bsdtar wants `-s`, and a mode set with chmod is meaningless on
// Windows. Every one of those failures was about the test's tooling rather than about the
// reader, which is the one thing a test must never be about.
//
// A committed archive keeps the property the shelling-out was there for — read what GNU
// tar actually writes, not what a writer in this file believes it writes — and extends it
// to the platforms where no GNU tar exists to write anything.
// tests/fixtures/make-archives.sh rebuilds them, with llama.cpp's own packing command.

import { readdir, lstat, readlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractTarGz, listTarEntries, extract, safeLinkTarget } from "../obsidian-plugin/runtime/unpack.mjs";
import { gunzipSync } from "node:zlib";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/…", which is not a
// path any fs call accepts. The cross-platform CI job is the reason this is written down.
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function withOut(body) {
  const dir = await mkdtemp(join(tmpdir(), "tolben-tar-"));
  try { return await body(join(dir, "out")); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("a real tar.gz is read, and the release directory is stripped", async () => {
  await withOut(async (out) => {
    const written = await extractTarGz(fixture("release.tar.gz"), out, {
      strip: 1,
      filter: (entry) => /llama-server$/u.test(entry.name) || /\.so(\.\d+)*$/u.test(entry.name),
    });
    assert.equal(written.includes("llama-server"), true);
    assert.equal(written.includes("LICENSE"), false, "the filter kept out what is not needed to serve");
    assert.match(await readFile(join(out, "llama-server"), "utf8"), /standing in for the server/u);
    if (process.platform !== "win32") {
      assert.ok((await stat(join(out, "llama-server"))).mode & 0o111, "the server is executable");
    }
  });
});

// The finding this whole section exists for. A real llama.cpp build/bin is full of SONAME
// chains — the archive above carries the two an `ldd llama-server` names — and the reader
// refused symlinks outright until one was looked at. It would have thrown on every macOS
// and Linux release; skipping them instead would have been worse, since extraction would
// have looked like it worked and the server would have died at spawn on a missing object.
test("the SONAME chains a release carries are preserved, not refused and not skipped", async () => {
  await withOut(async (out) => {
    const written = await extractTarGz(fixture("release.tar.gz"), out, { strip: 1 });
    for (const name of ["libggml-base.so", "libggml-base.so.0", "libggml-base.so.0.22.0",
      "libllama.so", "libllama.so.0", "libllama.so.0.3.0"]) {
      assert.equal(written.includes(name), true, `${name} is missing from the extraction`);
    }
    // What the loader needs, whichever way the platform provided it: opening the
    // unversioned name reaches the real file's bytes.
    assert.equal(await readFile(join(out, "libggml-base.so"), "utf8"), "the real shared object\n");
    assert.equal(await readFile(join(out, "libllama.so"), "utf8"), "the other real shared object\n");

    if (process.platform !== "win32") {
      // And where symlinks exist, they are links rather than copies, and RELATIVE ones —
      // an absolute target would work here and break the moment the directory moved.
      assert.equal((await lstat(join(out, "libggml-base.so"))).isSymbolicLink(), true);
      assert.equal(await readlink(join(out, "libggml-base.so")), "libggml-base.so.0");
      assert.equal(await readlink(join(out, "libggml-base.so.0")), "libggml-base.so.0.22.0");
    }
  });
});

test("a link is made even though the archive lists it before what it points at", async () => {
  // tar writes `libggml-base.so -> libggml-base.so.0` two entries BEFORE the file that
  // chain ends at, so a single ordered pass with a copy fallback — which is what Windows
  // runs — would copy from a file that does not exist yet.
  const entries = listTarEntries(gunzipSync(await readFile(fixture("release.tar.gz"))));
  const names = entries.map((entry) => entry.name);
  assert.ok(names.indexOf("llama-v0.3.0/libggml-base.so") < names.indexOf("llama-v0.3.0/libggml-base.so.0.22.0"),
    "the fixture no longer has the ordering this test is about");

  await withOut(async (out) => {
    await extractTarGz(fixture("release.tar.gz"), out, { strip: 1 });
    assert.equal(await readFile(join(out, "libggml-base.so"), "utf8"), "the real shared object\n");
  });
});

test("without stripping, the release directory survives in the paths", async () => {
  await withOut(async (out) => {
    const written = await extractTarGz(fixture("release.tar.gz"), out, {
      filter: (entry) => entry.name.endsWith("llama-server"),
    });
    assert.deepEqual(written, ["llama-v0.3.0/llama-server"]);
  });
});

test("tar entries carry their size, mode and link target", async () => {
  const entries = listTarEntries(gunzipSync(await readFile(fixture("release.tar.gz"))));
  const server = entries.find((entry) => entry.name.endsWith("llama-server"));
  assert.equal(server.size, 41);
  assert.equal(server.mode & 0o111, 0o111);
  assert.equal(server.symlink, false);

  const alias = entries.find((entry) => entry.name.endsWith("/libllama.so"));
  assert.equal(alias.symlink, true);
  assert.equal(alias.linkTarget, "libllama.so.0");
  assert.equal(alias.size, 0, "a symlink's bytes are its header's, not a body");

  assert.equal(entries.some((entry) => entry.directory), true, "the llama-v0.3.0/ directory is seen");
});

test("a tar entry whose NAME escapes its directory is refused", async () => {
  await withOut(async (out) => {
    await assert.rejects(extractTarGz(fixture("escaping-name.tar.gz"), out),
      (error) => error instanceof ArchiveError && /escapes its directory/u.test(error.message));
  });
});

test("a tar entry whose LINK escapes its directory is refused", async () => {
  // The one a name check alone lets through: `link/innocent-looking-name` is a perfectly
  // well-behaved path, and it points at ../../../etc/passwd. Planting it is enough — the
  // next archive to write through that name writes wherever it points.
  await withOut(async (out) => {
    await assert.rejects(extractTarGz(fixture("escaping-link.tar.gz"), out),
      (error) => error instanceof ArchiveError && /escapes its directory/u.test(error.message));
    await assert.rejects(readdir(out), "and nothing at all was left behind");
  });
});

test("what a link may point at, in its own right", () => {
  const dest = process.platform === "win32" ? "C:\\tolben\\runtime" : "/tmp/tolben/runtime";
  assert.equal(safeLinkTarget(dest, "libllama.so", "libllama.so.0"), "libllama.so.0");
  assert.equal(safeLinkTarget(dest, "bin/a.so", "../lib/b.so"), "../lib/b.so", "inside, by a different route");
  for (const [name, target] of [
    ["a.so", "../../etc/passwd"],
    ["bin/a.so", "../../../etc/passwd"],
    ["a.so", "/etc/passwd"],
    ["a.so", "C:\\Windows\\System32\\cmd.exe"],
    ["a.so", ""],
  ]) {
    assert.throws(() => safeLinkTarget(dest, name, target), ArchiveError, `${name} -> ${target} was allowed`);
  }
});

test("extract() picks the reader from the file name, and refuses anything else", async () => {
  await withOut(async (out) => {
    const written = await extract(fixture("release.tar.gz"), out, {
      strip: 1, filter: (entry) => entry.name.endsWith("llama-server"),
    });
    assert.deepEqual(written, ["llama-server"]);
  });
  await assert.rejects(extract("/tmp/whatever.rar", "/tmp/out"),
    (error) => error instanceof ArchiveError && /expected \.zip or \.tar\.gz/u.test(error.message));
});
