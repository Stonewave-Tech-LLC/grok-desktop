// Tiny CLI helper that does live speech-to-text using Windows' built-in SAPI
// speech recognition engine (System.Speech.Recognition) and prints one JSON
// object per line to stdout — the Windows counterpart to
// ../voice-helper-macos/main.swift. Deliberately SAPI rather than the newer
// Windows.Media.SpeechRecognition (WinRT) API: several WinRT speech APIs are
// documented as needing package identity (MSIX) for full functionality, and
// this helper is a plain unpackaged sidecar exe, same as the Rust side's
// `grok agent stdio` subprocess. System.Speech has worked from classic
// unpackaged Win32/console processes since .NET Framework, no packaging
// required — the trade-off is that SAPI's on-device recognizer is older and
// less accurate than the WinRT engine behind Windows' own Voice Typing.
//
// Line protocol (stdout, one JSON object per line) — identical to the macOS
// helper's protocol, see main.swift's header comment:
//   {"type":"locale","text":"de-DE"}
//   {"type":"ready"}
//   {"type":"partial","text":"..."}
//   {"type":"final","text":"..."}
//   {"type":"error","message":"..."}
//   {"type":"ended"}
//
// Control (stdin): any line read on stdin is treated as "stop" — ends the
// current recognition and shuts down after the final result.
//
// NOT YET VERIFIED ON REAL HARDWARE — written and cross-checked against
// Microsoft's System.Speech docs on a Linux box with no Windows runtime
// available to run it. Before relying on this, build it and run
// `VoiceHelper.exe` directly from a terminal (not just through Tauri) and
// confirm: a "ready" event appears, then "partial"/"final" events while
// speaking, and typing Enter on stdin produces "ended" and a clean exit.
// System.Speech relies on the OS's own installed recognizer (Settings > Time
// & Language > Speech), not a bundled model — if that's missing for the
// requested locale this reports a clear "error" event rather than crashing.

using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;

internal sealed class VoiceEvent
{
    [JsonPropertyName("type")] public string Type { get; init; } = "";
    [JsonPropertyName("text")] public string? Text { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
}

internal static class Program
{
    private static readonly object EmitLock = new();
    private static SpeechRecognitionEngine? _engine;
    private static volatile bool _stopping;

    private static void Emit(VoiceEvent evt)
    {
        var json = JsonSerializer.Serialize(evt);
        lock (EmitLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    private static int Main(string[] args)
    {
        // Stdin reader on a background thread — ReadLine() blocks, which is
        // fine off the main thread. Any line (content unused) means "stop",
        // mirroring the macOS helper's control protocol exactly.
        var stdinThread = new Thread(() =>
        {
            Console.In.ReadLine();
            _stopping = true;
            try { _engine?.RecognizeAsyncStop(); } catch { /* engine may not exist yet */ }
        })
        { IsBackground = true };
        stdinThread.Start();

        // Optional first CLI arg overrides the locale (`VoiceHelper.exe
        // de-DE`), same convention as the macOS helper, for a future
        // language picker in Settings. Falls back to the OS UI culture.
        var requestedLocale = args.Length > 0 ? args[0] : CultureInfo.CurrentUICulture.Name;

        RecognizerInfo? recognizerInfo;
        try
        {
            var installed = SpeechRecognitionEngine.InstalledRecognizers();
            recognizerInfo = null;
            foreach (var info in installed)
            {
                if (string.Equals(info.Culture.Name, requestedLocale, StringComparison.OrdinalIgnoreCase))
                {
                    recognizerInfo = info;
                    break;
                }
            }
            // Fall back to whatever's installed — mirrors the macOS helper's
            // Locale.current / SFSpeechRecognizer() fallback chain. Most
            // Windows installs only ship en-US by default regardless of the
            // display language, so this fallback is the common case, not an
            // edge case.
            if (recognizerInfo is null && installed.Count > 0)
            {
                recognizerInfo = installed[0];
            }
        }
        catch (Exception ex)
        {
            Emit(new VoiceEvent { Type = "error", Message = $"Couldn't enumerate speech recognizers: {ex.Message}" });
            return 1;
        }

        if (recognizerInfo is null)
        {
            Emit(new VoiceEvent
            {
                Type = "error",
                Message = "No speech recognizer installed for this Windows install (Settings > Time & Language > Speech)"
            });
            return 1;
        }

        Emit(new VoiceEvent { Type = "locale", Text = recognizerInfo.Culture.Name });

        try
        {
            _engine = new SpeechRecognitionEngine(recognizerInfo);
            _engine.LoadGrammar(new DictationGrammar());
            _engine.SetInputToDefaultAudioDevice();
        }
        catch (Exception ex)
        {
            Emit(new VoiceEvent { Type = "error", Message = $"Couldn't start audio engine: {ex.Message}" });
            return 1;
        }

        using var doneSignal = new ManualResetEventSlim(false);
        var exitCode = 0;

        _engine.SpeechHypothesized += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Result?.Text))
            {
                Emit(new VoiceEvent { Type = "partial", Text = e.Result.Text });
            }
        };

        _engine.SpeechRecognized += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Result?.Text))
            {
                Emit(new VoiceEvent { Type = "final", Text = e.Result.Text });
            }
        };

        _engine.RecognizeCompleted += (_, e) =>
        {
            // A cancellation from our own RecognizeAsyncStop() can surface
            // here as e.Error depending on the OS build — only treat it as a
            // real error if we didn't ask to stop, same guard the macOS
            // helper uses around its own stopping flag.
            if (e.Error is not null && !_stopping)
            {
                Emit(new VoiceEvent { Type = "error", Message = e.Error.Message });
                exitCode = 1;
            }
            Emit(new VoiceEvent { Type = "ended" });
            doneSignal.Set();
        };

        Emit(new VoiceEvent { Type = "ready" });
        _engine.RecognizeAsync(RecognizeMode.Multiple);

        doneSignal.Wait();

        try { _engine.Dispose(); } catch { /* best effort on the way out */ }
        return exitCode;
    }
}
