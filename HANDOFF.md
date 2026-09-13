# Handoff: Windows voice helper

Written by ACE (Stonewave's server-side agent, Linux box, no Windows/.NET
runtime available) for whichever Claude Code session picks this up next on
Neo's Windows machine. Read this fully before touching anything — it has the
why behind every decision and exactly what's done vs. not.

## The task

Windows voice mode in Grok Desktop (aka Anvil) has never had an
implementation — `src-tauri/src/voice.rs` looks for a native sidecar binary
and returns `"Voice helper isn't available for this platform yet"` when it
finds none. macOS has a working one (`src-tauri/voice-helper-macos/main.swift`,
Swift + Apple's Speech framework). Windows has nothing.

Branch: `ace/anvil-app-ui-polish` (already checked out remotely as of commit
`ef03e13` — `git pull` first). This is also the branch the pending v1.1.2
release is waiting on, so finishing this cleanly unblocks that release too
— see git log (`Bump 1.1.2 for Imagine Studio, operator memory, and UI
polish.`) for that context, but that's not your job here, just background.

## What's already done (by me, unverified — that's your job)

- `src-tauri/voice-helper-windows/Program.cs` — C# console app,
  `System.Speech.Recognition` (SAPI), speaks the exact same line-delimited
  JSON protocol as the macOS helper. Full reasoning (why SAPI not the newer
  WinRT `Windows.Media.SpeechRecognition` API) is in the file's header
  comment — short version: WinRT speech APIs are documented as sometimes
  needing MSIX package identity, and this is a plain unpackaged sidecar exe,
  so SAPI is the safer bet even though it's older/less accurate.
- `src-tauri/voice-helper-windows/VoiceHelper.csproj` — targets
  `net8.0-windows`, references `System.Speech`.
- `src-tauri/tauri.windows.conf.json` — `externalBin` wiring, mirrors the
  existing `tauri.macos.conf.json`.
- `src-tauri/voice-helper-windows/README.md` — build/publish/verify steps
  (the same steps are folded into this doc below, so you don't need to
  cross-reference, but it's there too).

**None of this has ever been compiled or run.** I wrote it against Microsoft's
documented `System.Speech.Recognition` API surface with no way to build or
test it — treat it as a first draft, not working code, until you've verified
it yourself.

## Your job, in order

1. `git pull` on `ace/anvil-app-ui-polish`.
2. Build:
   ```powershell
   cd src-tauri/voice-helper-windows
   dotnet publish -c Release -r win-x64 --self-contained true `
     -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
   ```
   Fix whatever compile errors show up — this is genuinely untested, expect
   at least minor issues (namespace/property names, nullable warnings-as-errors,
   whatever). Use your own judgment; you have the Windows toolchain and I
   don't.
3. Copy the published exe to where Tauri's sidecar resolution expects it
   (both the dev-mode fallback path and the bundled build read this same
   file — see `resolve_helper_path()` in `src-tauri/src/voice.rs`):
   ```powershell
   copy bin\Release\net8.0-windows\win-x64\publish\VoiceHelper.exe `
     ..\binaries\voice-helper-x86_64-pc-windows-msvc.exe
   ```
4. **Test the standalone exe directly in a terminal before touching the app**
   — isolates helper bugs from Tauri/frontend bugs:
   ```powershell
   .\binaries\voice-helper-x86_64-pc-windows-msvc.exe
   ```
   Expect `{"type":"locale",...}` then `{"type":"ready"}`. Speak — expect
   `partial` events while talking, `final` per phrase. Press Enter on stdin
   — expect `{"type":"ended"}` and a clean exit (`$LASTEXITCODE` = `0`).

   If you get `{"type":"error","message":"No speech recognizer installed..."}`,
   that's an environment gap (Settings > Time & Language > Speech needs
   setup on that machine), not necessarily a code bug — but double check
   before assuming that's the whole story.
5. Once the standalone exe works, run `cargo tauri dev` from `src-tauri/`
   and test voice mode in the real app end to end.
6. Commit the built `.exe` to `src-tauri/binaries/voice-helper-x86_64-pc-windows-msvc.exe`
   (binary checked into git directly, same convention as the macOS one —
   there's no CI build step for either helper) along with any code fixes,
   push to `ace/anvil-app-ui-polish`.

## Protocol reference (stdout, one JSON object per line)

```
{"type":"locale","text":"de-DE"}   — which language the recognizer resolved to
{"type":"ready"}                   — mic + recognizer are live
{"type":"partial","text":"..."}    — live, not-yet-final transcript
{"type":"final","text":"..."}      — the recognizer's own final result
{"type":"error","message":"..."}   — no recognizer installed / no mic / etc.
{"type":"ended"}                   — clean shutdown after a stop request
```

Control (stdin): any line read on stdin means "stop" — end the current
recognition and shut down after the final result. This is a fixed contract
— the Rust side (`voice.rs`) and frontend (`Composer.tsx`) already implement
against it for macOS, don't change the shape without touching those too.

## If something needs a decision or you're stuck

Ping ACE via the `send_to_ace` MCP tool (`stonewave-mcp`) rather than
guessing — same channel Neo's Mac-side agents already use to reach me. Keep
the **same `thread_id`** across follow-up messages on this task so context
doesn't fragment across multiple fresh threads. If `stonewave-mcp` isn't set
up in this Claude Code session yet, ask Neo — he's set it up before on his
Mac, same agent-key mechanism applies here.
