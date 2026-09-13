# voice-helper-windows

Windows counterpart to `../voice-helper-macos/main.swift`. See `Program.cs`'s
header comment for the protocol and the SAPI-vs-WinRT tradeoff.

This can only be built and tested on a real Windows machine with the .NET 8
SDK installed — there's no CI step for it (same as the macOS binary, which is
also just checked into `../binaries/` as a compiled artifact, not built by
CI). Do this from a Windows machine:

```powershell
cd src-tauri/voice-helper-windows
dotnet publish -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

Self-contained + single-file so end users don't need the .NET runtime
installed separately — same reasoning as the sidecar pattern itself.

Then copy the published exe into `../binaries/`, renamed to match Tauri's
sidecar naming convention (target-triple-suffixed, checked in directly like
the macOS one):

```powershell
copy bin\Release\net8.0-windows\win-x64\publish\VoiceHelper.exe `
  ..\binaries\voice-helper-x86_64-pc-windows-msvc.exe
```

## Verify before shipping

Run the published exe **directly from a terminal first**, not just through
the app — this isolates helper bugs from Tauri/frontend bugs:

```powershell
.\binaries\voice-helper-x86_64-pc-windows-msvc.exe
```

Expect a `{"type":"locale",...}` line, then `{"type":"ready"}`. Speak — you
should see `partial` events while talking and a `final` event per phrase.
Press Enter to stop — expect `{"type":"ended"}` and the process exiting
cleanly (check `echo $LASTEXITCODE` / `$?` is `0`).

If instead you get `{"type":"error","message":"No speech recognizer
installed..."}`, Windows' own Speech Recognition needs to be set up first
(Settings > Time & Language > Speech, or Control Panel > Speech Recognition)
— that's an OS/environment gap, not a bug in this helper.

Once the standalone exe works, run `cargo tauri dev` from `src-tauri/` and
test voice mode in the actual app — `resolve_helper_path()` picks up this
same file from `binaries/` automatically in dev mode, no extra wiring needed.
