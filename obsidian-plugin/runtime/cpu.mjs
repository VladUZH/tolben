// What this CPU can execute, so a build that needs AVX2 is not handed to a machine that
// will kill it with SIGILL the first time it runs.
//
// Two halves, because no one method is available everywhere. Linux and macOS say what
// they support and are asked directly. Windows exposes no cheap, dependency-free way to
// read instruction-set flags, so there AVX2 is UNKNOWN — and unknown is optimistic, on
// the reasoning that a machine running a current Obsidian is overwhelmingly likely to
// have had AVX2 since 2013. The optimism is then checked rather than trusted: every
// candidate binary is run once with `--version` before it is committed to, and a build
// the CPU cannot execute is recognised by how it dies and the next candidate is tried.
// That check runs on all three platforms, so the flags are an optimisation, not the
// safety net.

const AVX2_FLAG = /(?:^|\s)avx2(?:\s|$)/iu;

export async function cpuFeatures({
  platform = process.platform,
  arch = process.arch,
  readFile,
  run,
} = {}) {
  if (arch !== "x64") return [];
  if (platform === "linux") {
    try {
      const info = await readFile("/proc/cpuinfo", "utf8");
      // One "flags" line per core; they agree, so the first is enough.
      const flags = /^flags\s*:(.*)$/mu.exec(info)?.[1] ?? "";
      return AVX2_FLAG.test(flags) ? ["avx2"] : [];
    } catch {
      // An unreadable /proc is a container quirk, not evidence about the CPU: fall
      // through to the run check with no claim either way.
      return ["avx2"];
    }
  }
  if (platform === "darwin") {
    try {
      const { stdout } = await run("sysctl", ["-n", "machdep.cpu.leaf7_features"]);
      return AVX2_FLAG.test(stdout) ? ["avx2"] : [];
    } catch {
      return ["avx2"];
    }
  }
  // Windows and anything else: unknown, and checked by actually running the binary.
  return ["avx2"];
}

// How a process dies when it meets an instruction its CPU does not have. SIGILL on POSIX;
// on Windows the status is surfaced as the NTSTATUS for an illegal instruction, which
// Node reports as a large unsigned exit code rather than a signal.
const WINDOWS_ILLEGAL_INSTRUCTION = 0xC000001D;

export function isIllegalInstruction({ signal, code } = {}) {
  if (signal === "SIGILL") return true;
  if (code === WINDOWS_ILLEGAL_INSTRUCTION) return true;
  // Node on Windows reports the status as a signed 32-bit integer in some spawn paths.
  if (code === WINDOWS_ILLEGAL_INSTRUCTION - 0x100000000) return true;
  return false;
}
