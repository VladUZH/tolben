// What to tell someone when the runtime will not start.
//
// Every message here is for a failure that is not a bug in this plugin and not something
// the writer did wrong: the operating system, an antivirus, or Obsidian's own packaging
// stopped a downloaded binary from running. The generic "spawn ENOENT" that Node reports
// is true and useless, and a person who meets it concludes the plugin is broken.
//
// Each message names what happened, why, and the one thing to click — and every one of
// them offers the same escape hatch, because it always works: run Ollama or llama-server
// yourself and point Tolben at it.

const OLLAMA_FALLBACK =
  "If you would rather not fight this: install Ollama, run `ollama serve`, and Tolben will "
  + "find it on 127.0.0.1:11434 and use it instead. Settings → Tolben → Model server.";

// Obsidian inside a Flatpak or Snap sandbox cannot execute a binary the plugin downloaded
// into the vault: the sandbox mounts that path without exec permission, and no amount of
// chmod changes it. This is not detectable from the failure — it has to be checked for.
export function detectSandbox(env = process.env) {
  if (env.FLATPAK_ID || env.FLATPAK_SANDBOX_DIR) return "flatpak";
  if (env.SNAP && env.SNAP_NAME) return "snap";
  return null;
}

const SANDBOX_MESSAGES = {
  flatpak: {
    title: "Obsidian is running inside Flatpak, which will not run a downloaded model server",
    body: [
      "Flatpak mounts the vault without permission to execute anything in it, so the",
      "llama-server binary Tolben downloads cannot be started. This is the sandbox working",
      "as designed, not a fault in the download.",
      "",
      "Two ways forward:",
      "  • Install Ollama on the host (outside Flatpak) and run `ollama serve`.",
      "  • Or grant Obsidian access to a directory it may execute from:",
      "      flatpak override --user --filesystem=~/.local/share/tolben md.obsidian.Obsidian",
      "    then restart Obsidian and run setup again.",
    ].join("\n"),
  },
  snap: {
    title: "Obsidian is running inside Snap, which will not run a downloaded model server",
    body: [
      "Snap confinement blocks executing binaries from outside the snap, so the",
      "llama-server binary Tolben downloads cannot be started.",
      "",
      "Install Ollama on the host and run `ollama serve`; Tolben will find it on",
      "127.0.0.1:11434. A snap-confined Obsidian cannot manage a runtime of its own.",
    ].join("\n"),
  },
};

// The signatures each platform produces when it refuses to run a downloaded executable.
function classify(platform, error) {
  const text = `${error?.code ?? ""} ${error?.signal ?? ""} ${error?.message ?? error ?? ""}`;
  if (platform === "darwin") {
    // Gatekeeper kills the process rather than refusing the exec, so it arrives as a
    // SIGKILL with no output — which is why it is matched on the signal, not the message.
    if (/SIGKILL/u.test(text) || /not opened because|cannot be opened because|malicious software/iu.test(text)) {
      return "gatekeeper";
    }
  }
  if (platform === "win32") {
    if (/EPERM|EACCES|access is denied|operation did not complete successfully because the file contains a virus/iu.test(text)) {
      return "smartscreen";
    }
  }
  if (/EACCES|permission denied/iu.test(text)) return "permissions";
  if (/ENOENT/u.test(text)) return "missing";
  return "unknown";
}

const MESSAGES = {
  gatekeeper: (binary) => ({
    title: "macOS blocked the model server because it was downloaded",
    body: [
      "Gatekeeper quarantines executables that arrive over the network and did not come",
      "from the App Store. It kills them silently, which is why there is no error to read.",
      "",
      "To clear the quarantine flag on this one file:",
      `    xattr -d com.apple.quarantine "${binary}"`,
      "",
      "Or open System Settings → Privacy & Security, where a button offering to run",
      "llama-server anyway appears for about an hour after the first attempt.",
    ].join("\n"),
  }),
  smartscreen: (binary) => ({
    title: "Windows blocked the model server",
    body: [
      "SmartScreen or your antivirus stopped llama-server from running. Antivirus software",
      "reliably flags newly downloaded, unsigned executables that allocate a great deal of",
      "memory, which is a fair description of a model server.",
      "",
      "The file to allow is:",
      `    ${binary}`,
      "",
      "Add that path to your antivirus exclusions, or right-click the file → Properties →",
      "Unblock. Its sha256 is pinned in the plugin's manifest.json, so you can check what",
      "you are allowing before you allow it.",
    ].join("\n"),
  }),
  permissions: (binary) => ({
    title: "The model server is not executable",
    body: [
      `The file is there but the operating system will not run it:`,
      `    ${binary}`,
      "",
      "Usually this is a vault on a drive mounted `noexec` — an external disk, a network",
      "share, or an encrypted volume. Moving the vault to internal storage fixes it.",
    ].join("\n"),
  }),
  missing: (binary) => ({
    title: "The model server is not where it should be",
    body: [
      `Tolben expected to find it at:`,
      `    ${binary}`,
      "",
      "Something removed it after it was downloaded and verified — most often an antivirus",
      "quarantining the file. Run setup again to re-download it, and if it disappears a",
      "second time, add the folder to your antivirus exclusions.",
    ].join("\n"),
  }),
  unknown: (binary, error) => ({
    title: "The model server would not start",
    body: [
      `Tolben tried to run:`,
      `    ${binary}`,
      "",
      "and the operating system said:",
      `    ${error?.message ?? String(error)}`,
    ].join("\n"),
  }),
};

/**
 * Turn a spawn failure into something a person can act on.
 *
 * The sandbox check comes first because it explains failures that would otherwise be
 * classified as a permissions problem and send someone chmod-ing a file that will never
 * run whatever its mode is.
 */
export function explainSpawnFailure({ platform = process.platform, binary, error, env = process.env } = {}) {
  const sandbox = detectSandbox(env);
  if (sandbox) return { kind: sandbox, ...SANDBOX_MESSAGES[sandbox], fallback: OLLAMA_FALLBACK };
  const kind = classify(platform, error);
  return { kind, ...MESSAGES[kind](binary, error), fallback: OLLAMA_FALLBACK };
}

export { OLLAMA_FALLBACK };
