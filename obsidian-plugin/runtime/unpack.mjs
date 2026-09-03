// Extracting the llama.cpp release archive, without asking the machine for a tool.
//
// The obvious implementation shells out to `tar` or `unzip`. Neither is reliably there:
// GNU tar does not read zip at all, `unzip` is absent from minimal Linux images, and
// Windows only gained bsdtar in 1803. A zip reader is about a hundred lines given
// node:zlib, it behaves identically on all three platforms, and it lets the one thing
// that actually matters be enforced here rather than hoped for:
//
//   no entry may write outside the destination directory.
//
// An archive is untrusted input even when its sha256 is pinned — the pin says the bytes
// are the ones that were published, not that they are harmless — so `../` in an entry
// name and an absolute path are refused rather than sanitised.
//
// Symlinks were refused too, until a real llama.cpp build directory was looked at:
//
//   libggml.so -> libggml.so.0 -> libggml.so.0.22.0
//   libllama.so -> libllama.so.0 -> libllama.so.0.3.0
//
// Every macOS and Linux release archive is full of those, `llama-server` is linked
// against `libllama.so.0` by SONAME, and a blanket refusal would have thrown on all of
// them. Skipping them instead would have been worse: extraction would appear to succeed
// and the server would die at spawn on a missing shared object.
//
// So the rule that mattered was never "no symlinks" — it was "nothing may reach outside
// the destination", and a link is just a name that points at another name. A link target
// is resolved against the link's own directory and refused if it leaves the destination,
// which is the same check `safeJoin` makes, applied to where the entry points rather
// than to where it sits.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, symlink, copyFile, stat } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";

const inflate = promisify(inflateRaw);

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP64_END_LOCATOR = 0x07064b50;
const ZIP64_END_RECORD = 0x06064b50;

export class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchiveError";
  }
}

// The end-of-central-directory record lives in the last 64KB, after a comment of unknown
// length, so it is found by scanning backwards for its signature.
function findEndRecord(buffer) {
  const floor = Math.max(0, buffer.length - 0x10000 - 22);
  for (let at = buffer.length - 22; at >= floor; at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw new ArchiveError("not a zip archive: no end-of-central-directory record");
}

// A release binary can exceed the 4 GB the original format can address, in which case the
// real offsets live in a zip64 record and the classic fields are all 0xffffffff.
function centralDirectory(buffer, endAt) {
  let entries = buffer.readUInt16LE(endAt + 10);
  let size = buffer.readUInt32LE(endAt + 12);
  let offset = buffer.readUInt32LE(endAt + 16);
  if (offset === 0xffffffff || size === 0xffffffff || entries === 0xffff) {
    const locatorAt = endAt - 20;
    if (locatorAt < 0 || buffer.readUInt32LE(locatorAt) !== ZIP64_END_LOCATOR) {
      throw new ArchiveError("zip claims 64-bit offsets but carries no zip64 locator");
    }
    const recordAt = Number(buffer.readBigUInt64LE(locatorAt + 8));
    if (buffer.readUInt32LE(recordAt) !== ZIP64_END_RECORD) {
      throw new ArchiveError("zip64 locator does not point at a zip64 record");
    }
    entries = Number(buffer.readBigUInt64LE(recordAt + 32));
    size = Number(buffer.readBigUInt64LE(recordAt + 40));
    offset = Number(buffer.readBigUInt64LE(recordAt + 48));
  }
  return { entries, size, offset };
}

function zip64Extra(extra, { size, compressedSize, offset }) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      let cursor = at + 4;
      const take = () => { const value = Number(extra.readBigUInt64LE(cursor)); cursor += 8; return value; };
      if (size === 0xffffffff) size = take();
      if (compressedSize === 0xffffffff) compressedSize = take();
      if (offset === 0xffffffff) offset = take();
      break;
    }
    at += 4 + length;
  }
  return { size, compressedSize, offset };
}

export function listEntries(buffer) {
  const end = findEndRecord(buffer);
  const { entries, offset } = centralDirectory(buffer, end);
  const list = [];
  let at = offset;
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
      throw new ArchiveError(`central directory entry ${index} has a bad signature`);
    }
    const method = buffer.readUInt16LE(at + 10);
    const externalAttributes = buffer.readUInt32LE(at + 38);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const extra = buffer.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    const sizes = zip64Extra(extra, {
      size: buffer.readUInt32LE(at + 24),
      compressedSize: buffer.readUInt32LE(at + 20),
      offset: buffer.readUInt32LE(at + 42),
    });
    // The high 16 bits of the external attributes are the Unix mode when the archive was
    // made on a Unix host: bit 0xA000 marks a symlink, 0o111 the execute bits.
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    list.push({
      name,
      method,
      ...sizes,
      mode: unixMode & 0o7777,
      symlink: (unixMode & 0xf000) === 0xa000,
      directory: name.endsWith("/"),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return list;
}

// Refused, not sanitised: a name that tries to leave the directory is a reason to stop
// looking at the archive, not to guess what it meant.
export function safeJoin(destination, name) {
  if (name.includes("\0")) throw new ArchiveError(`archive entry has a NUL in its name: ${JSON.stringify(name)}`);
  if (/^([a-zA-Z]:)?[\\/]/u.test(name)) throw new ArchiveError(`archive entry is an absolute path: ${name}`);
  const target = join(destination, name);
  const root = normalize(destination.endsWith(sep) ? destination : destination + sep);
  if (!normalize(target).startsWith(root)) throw new ArchiveError(`archive entry escapes its directory: ${name}`);
  return target;
}

// Where a link points, held to the same rule as where an entry sits. The target is kept
// RELATIVE — rewriting `libggml.so.0` to an absolute path would work on the machine that
// unpacked it and break the moment the directory moved, which for a plugin's runtime
// directory is a thing that happens.
export function safeLinkTarget(destination, name, target) {
  if (!target) throw new ArchiveError(`archive entry is a link with no target: ${name}`);
  if (target.includes("\0")) throw new ArchiveError(`link target has a NUL in it: ${name}`);
  if (/^([a-zA-Z]:)?[\\/]/u.test(target)) {
    throw new ArchiveError(`archive entry links to an absolute path: ${name} -> ${target}`);
  }
  safeJoin(destination, join(dirname(name), target));
  return target;
}

// Links are made once every regular file is written, because the copy fallback below
// needs its target to exist, and tar lists an alias before the file it points at.
//
// Windows refuses symlink() to an unprivileged account unless Developer Mode is on, so
// there the link is COPIED. A copy is not a link, but it is what the loader is asking
// for: the whole point of `libggml.so -> libggml.so.0` is that opening the first name
// reaches the second's bytes. It costs a few megabytes of duplication on the one platform
// that cannot do better, and the alternative is a plugin that cannot start.
//
// Chains are resolved by repeating the pass until nothing more can be made, rather than
// by following the chain by hand: `a -> b -> c` needs `b` before `a`, and archive order
// gives the opposite. Two or three passes settle it; a pass that makes no progress means
// something points at nothing, and that is reported rather than left half-linked.
async function materialiseLinks(destination, links) {
  let pending = links;
  const made = [];
  while (pending.length > 0) {
    const deferred = [];
    for (const link of pending) {
      const path = join(destination, link.name);
      await mkdir(dirname(path), { recursive: true });
      try {
        await symlink(link.target, path);
        made.push(link.name);
        continue;
      } catch (error) {
        if (!["EPERM", "EACCES", "ENOSYS", "UNKNOWN"].includes(error.code)) throw error;
      }
      const source = join(dirname(path), link.target);
      if (await stat(source).then(() => true, () => false)) {
        await copyFile(source, path);
        const mode = await stat(source).then((info) => info.mode & 0o777, () => 0o644);
        if (mode & 0o111) await chmod(path, 0o755);
        made.push(link.name);
      } else {
        deferred.push(link);
      }
    }
    if (deferred.length === pending.length) {
      const [first] = deferred;
      throw new ArchiveError(`could not create ${first.name} -> ${first.target}: this platform `
        + `refused a symlink and the target is not in the archive`);
    }
    pending = deferred;
  }
  return made;
}

async function readEntry(buffer, entry) {
  // The local header repeats the name and extra fields, at lengths that need not match
  // the central directory's, so the data offset is read from the local header itself.
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const from = entry.offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(from, from + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflate(raw);
  throw new ArchiveError(`archive entry ${entry.name} uses compression method ${entry.method}`);
}

/**
 * Extract `archivePath` into `destination`. Returns the files written, relative to it.
 *
 * `filter(entry)` may narrow what is taken — the provisioner uses it to skip the parts of
 * a llama.cpp release it will never run.
 */
export async function extractZip(archivePath, destination, { filter = () => true } = {}) {
  const buffer = await readFile(archivePath);
  const written = [];
  const links = [];
  for (const entry of listEntries(buffer)) {
    if (entry.directory) continue;
    if (!filter(entry)) continue;
    // A zip stores a symlink's target as the entry's own content. `7z a -snl`, which is
    // what llama.cpp packs the Windows assets with, writes them that way.
    if (entry.symlink) {
      const target = (await readEntry(buffer, entry)).toString("utf8");
      links.push({ name: entry.name, target: safeLinkTarget(destination, entry.name, target) });
      continue;
    }
    const target = safeJoin(destination, entry.name);
    const data = await readEntry(buffer, entry);
    if (data.length !== entry.size) {
      throw new ArchiveError(`archive entry ${entry.name}: expected ${entry.size} bytes, inflated ${data.length}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    // Executables must survive the round trip, and only the execute bits are carried:
    // whatever else the archive asked for is the packager's business, not ours.
    if (entry.mode & 0o111) await chmod(target, 0o755);
    written.push(entry.name);
  }
  return [...written, ...await materialiseLinks(destination, links)];
}

export function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// ---------------------------------------------------------------------------- tar.gz

// llama.cpp ships macOS and Linux as .tar.gz and only Windows as .zip, so both readers
// are needed. tar is a simpler format than zip — 512-byte header blocks, each followed by
// the file's bytes rounded up to 512 — and node:zlib gunzips it, so this needs no
// dependency either.
//
// The same rule applies as above and for the same reason: a name that leaves the
// destination is refused, not sanitised. A pinned sha256 says the bytes are the ones that
// were published; it says nothing about whether they are safe to unpack blindly.

const BLOCK = 512;

// Fields are ASCII, NUL- or space-terminated, and numbers are octal. GNU tar writes a
// base-256 form for sizes that do not fit, marked by the high bit of the first byte.
function tarNumber(block, at, length) {
  if (block[at] & 0x80) {
    let value = 0n;
    for (let index = at + 1; index < at + length; index += 1) value = (value << 8n) | BigInt(block[index]);
    return Number(value);
  }
  const text = block.toString("ascii", at, at + length).replace(/\0.*$/su, "").trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function tarString(block, at, length) {
  return block.toString("utf8", at, at + length).replace(/\0.*$/su, "");
}

export function listTarEntries(buffer) {
  const entries = [];
  let at = 0;
  let longName = null;
  let longLink = null;
  while (at + BLOCK <= buffer.length) {
    const header = buffer.subarray(at, at + BLOCK);
    // Two consecutive zero blocks end the archive; one is enough to stop reading.
    if (header.every((byte) => byte === 0)) break;
    const size = tarNumber(header, 124, 12);
    const type = String.fromCharCode(header[156]) || "0";
    // A prefix field lets a long path be split; GNU's 'L' type carries a longer one still.
    const prefix = tarString(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${tarString(header, 0, 100)}` : tarString(header, 0, 100));
    const from = at + BLOCK;
    at = from + Math.ceil(size / BLOCK) * BLOCK;

    // GNU's 'L' and 'K' records carry a name and a link target too long for the header's
    // own fields, in the block that follows, and describe the entry AFTER them.
    if (type === "L") {
      longName = buffer.toString("utf8", from, from + size).replace(/\0.*$/su, "");
      continue;
    }
    if (type === "K") {
      longLink = buffer.toString("utf8", from, from + size).replace(/\0.*$/su, "");
      continue;
    }
    longName = null;
    // 0 and \0 are regular files; 5 is a directory; 1 and 2 are hard and symbolic links.
    entries.push({
      name,
      size,
      offset: from,
      mode: tarNumber(header, 100, 8) & 0o7777,
      directory: type === "5" || name.endsWith("/"),
      symlink: type === "1" || type === "2",
      linkTarget: longLink ?? tarString(header, 157, 100),
    });
    longLink = null;
  }
  return entries;
}

/**
 * Extract a gzipped tar into `destination`, with the same refusals as extractZip.
 *
 * `strip` drops leading path segments: llama.cpp's archives put everything under a
 * `llama-<tag>/` directory, and the caller wants the binaries, not the directory.
 */
export async function extractTarGz(archivePath, destination, { filter = () => true, strip = 0 } = {}) {
  const gunzip = promisify((await import("node:zlib")).gunzip);
  const buffer = await gunzip(await readFile(archivePath));
  const written = [];
  const links = [];
  for (const entry of listTarEntries(buffer)) {
    if (entry.directory) continue;
    if (!filter(entry)) continue;
    const stripped = entry.name.split("/").slice(strip).join("/");
    if (!stripped) continue;
    if (entry.symlink) {
      links.push({ name: stripped, target: safeLinkTarget(destination, stripped, entry.linkTarget) });
      continue;
    }
    const target = safeJoin(destination, stripped);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer.subarray(entry.offset, entry.offset + entry.size));
    if (entry.mode & 0o111) await chmod(target, 0o755);
    written.push(stripped);
  }
  return [...written, ...await materialiseLinks(destination, links)];
}

/** Whichever reader the file's name calls for. */
export async function extract(archivePath, destination, options = {}) {
  if (/\.t(?:ar\.)?gz$/iu.test(archivePath)) return extractTarGz(archivePath, destination, options);
  if (/\.zip$/iu.test(archivePath)) return extractZip(archivePath, destination, options);
  throw new ArchiveError(`no reader for ${archivePath}: expected .zip or .tar.gz`);
}
