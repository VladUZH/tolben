# System-wide text-field access: open codebases worth reading

Temp research notes, 2026-08-28. Question: whose SOURCE CODE can we study to learn how
real products read and write text in *other apps'* fields (the Limatum problem), setting
the underline UX aside entirely.

There are three viable mechanisms on macOS, and every product below is a combination of
them: (A) the Accessibility API (AXUIElement — read `AXValue`/`AXSelectedText`, write
back, observe focus); (B) clipboard round-trip + synthetic Cmd-V; (C) synthetic
keystrokes (CGEvent). A→graceful, B→universal-but-clobbering, C→last resort. The
interesting engineering is always the *fallback chain and the per-app quirks list*.

## 1. Libraries: the AX layer itself

| Repo | Language | Why read it |
|---|---|---|
| [tmandry/AXSwift](https://github.com/tmandry/AXSwift) | Swift | The canonical Swift wrapper over the C AX client API. Complete coverage, explicit errors. Read `UIElement.swift` for attribute get/set and `Observer` for `AXObserver` event streams (focus changes, value changes). |
| [openclaw/AXorcist](https://github.com/openclaw/AXorcist) | Swift | Newer, chainable/fuzzy queries over the UI tree, CF↔Swift value conversion, caching. Good for "find the focused text area anywhere" patterns. |
| [drewster99/macos-accessibility-client](https://github.com/drewster99/macos-accessibility-client) | Swift/SwiftUI | A working INSPECTOR: follows the system-wide focused element live and watches the AXObserver stream. The fastest way to learn what events actually fire per app. Run it against Pages/Chrome/Slack and watch. |
| [doom-fish/axuielement-rs](https://github.com/doom-fish/axuielement-rs) | Rust | Safe Rust bindings for AXUIElement, zero Swift. Relevant if the engine stays Rust-adjacent. |
| [Hammerspoon](https://github.com/Hammerspoon/hammerspoon) | ObjC/Lua | `hs.axuielement` is a decade-hardened AX binding with the best docs in existence; its issue tracker is an encyclopedia of per-app AX breakage. |

## 2. Products that INSERT text system-wide (the write path)

| Repo | Mechanism | The lesson |
|---|---|---|
| [espanso](https://github.com/espanso/espanso) | Rust, cross-platform text expander | **The deepest injection playbook anywhere.** Per-platform backends (macOS/X11/Wayland/Windows), clipboard backup→inject→restore with timing, key-event injection fallback, per-app config overrides, secure-input detection. Read `espanso-inject/` and `espanso-clipboard/`. |
| [Beingpax/VoiceInk](https://github.com/beingpax/VoiceInk) | Swift, GPL-3, macOS dictation (4.3k★) | Modern, active, small enough to read whole. Inserts transcribed text at the cursor in any app; **checks `AXRole` of the focused element before deciding how to paste**; "Power Mode" = per-app behavior profiles — exactly the quirks-list shape Limatum will need. |
| [cjpais/Handy](https://github.com/cjpais/handy) | Rust/Tauri, cross-platform dictation | The cross-platform version of the same problem; compare its Linux/Windows insertion code with espanso's. |
| [theJayTea/WritingTools](https://github.com/theJayTea/WritingTools) | Python (Win) + Swift port (macOS) | The pragmatic minimum: global hotkey → grab *selection* (Cmd-C round-trip) → process → paste back. No AX tree walking at all. Worth reading as the "how far can you get without AX" baseline — and for its handling of apps where even that breaks. |

## 3. Products that READ/observe other apps' text (the read path)

| Repo | The lesson |
|---|---|
| [Vimac](https://github.com/dexterleng/vimac) (archived; successor Homerow is closed) | Scanning entire AX trees fast, hint-mode overlays positioned from AX frames — the performance tricks for walking big UI trees without beachballing. |
| [rxhanson/Rectangle](https://github.com/rxhanson/Rectangle) | Not text, but the canonical **permission UX**: detecting/prompting/recovering AX trust (`AXIsProcessTrusted`), which every AX app must get right and most get wrong. |
| Harper's editor integrations ([Automattic/harper](https://github.com/automattic/harper)) | The OPPOSITE architecture for contrast: no system-wide access at all — LSP + per-editor plugins. The honest cost/benefit baseline Limatum's D-decisions already weigh. |

## 4. What to look for while reading (the Limatum questions)

1. **Focus tracking**: who uses `kAXFocusedUIElementChangedNotification` vs polling the
   system-wide element? (macos-accessibility-client demonstrates both live.)
2. **Reading without breaking**: `AXValue` for full text vs `AXSelectedTextRange` +
   `AXStringForRange` for windows around the caret — large documents make full-value
   reads expensive; who chunks?
3. **Writing without clobbering undo**: three routes seen in the wild —
   `AXUIElementSetAttributeValue(kAXValueAttribute)` (fast, often kills undo + cursor),
   `AXSelectedText` replacement (VoiceInk-style, gentler), clipboard+Cmd-V (espanso-style,
   universal, needs backup/restore). Note our web demo hit the same trilemma and chose
   execCommand for native undo — the AX analogue is the selected-text route.
4. **The quirks list**: Electron/Chromium needs `AXManualAccessibility` enabled per
   process; Java/SWT apps often expose nothing; secure input (password fields, some
   terminals) blocks everything; Google Docs is canvas (invisible to AX too). Every
   mature repo has this list — diff theirs against Limatum's.
5. **Permissions and packaging**: AX trust prompts, re-trust after every rebuild during
   development (espanso and Rectangle both script around it), and the hard constraint
   that AX apps can't ship in the Mac App Store sandbox.

## 5. Closed but documented (no code, still instructive)

- **Refine** (refine.sh) — proves AX-based system-wide checking ships as a product today;
  its guides describe per-app support tiers.
- **Grammarly Desktop** — the floating-widget architecture is the workaround pattern for
  when inline AX decoration is impossible.
- **Apple Writing Tools** — the platform's own answer; third-party apps adopt it free via
  standard text views, which is the strongest argument *against* building AX plumbing for
  apps that use standard `NSTextView`/`UITextView` at all.
