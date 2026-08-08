// Tiny CLI helper that does live speech-to-text using macOS's own Speech
// framework and prints one JSON object per line to stdout. Deliberately a
// separate native helper process rather than calling the Speech/AVFoundation
// APIs from Rust via FFI bindings — those Apple frameworks don't have mature,
// stable Rust bindings, whereas the Swift APIs here are the officially
// documented, stable surface. This mirrors the existing architecture: the
// Rust side already manages `grok agent stdio` as a subprocess speaking a
// line-delimited protocol (see src-tauri/src/acp/process.rs) — this is the
// same shape, just a much smaller protocol.
//
// Line protocol (stdout, one JSON object per line):
//   {"type":"locale","text":"de-DE"}           — which language the recognizer resolved to
//   {"type":"ready"}                          — mic + recognizer are live
//   {"type":"partial","text":"..."}            — live, not-yet-final transcript
//   {"type":"final","text":"..."}              — the recognizer's own final result
//   {"type":"error","message":"..."}           — permission denied / no mic / etc.
//   {"type":"ended"}                           — clean shutdown after a stop request
//
// Control (stdin): any line read on stdin is treated as "stop" — ends the
// audio request and shuts down after the final result (or a short timeout).

import Foundation
import Speech
import AVFoundation

struct Event: Encodable {
    let type: String
    let text: String?
    let message: String?

    init(type: String, text: String? = nil, message: String? = nil) {
        self.type = type
        self.text = text
        self.message = message
    }
}

func emit(_ event: Event) {
    guard let data = try? JSONEncoder().encode(event), let json = String(data: data, encoding: .utf8) else { return }
    print(json)
    fflush(stdout)
}

let audioEngine = AVAudioEngine()
var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
var recognitionTask: SFSpeechRecognitionTask?
var stopping = false

func shutDown(_ exitCode: Int32) {
    if audioEngine.isRunning {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
    }
    recognitionRequest = nil
    recognitionTask = nil
    exit(exitCode)
}

func stopListening() {
    guard !stopping else { return }
    stopping = true
    recognitionRequest?.endAudio()
    // The in-flight recognitionTask's result handler will fire once more
    // with `isFinal == true` after endAudio() — that handler emits "ended"
    // and shuts down. Fall back to a hard stop if that never arrives (e.g.
    // silence with nothing recognized yet).
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        emit(Event(type: "ended"))
        shutDown(0)
    }
}

func startListening() {
    // `Locale.current` resolves oddly for a bare helper process spawned
    // outside the normal app-launch path (observed live: it silently landed
    // on en-US on a Mac whose actual system language is German). Reading
    // `NSLocale.preferredLanguages` instead — the user's own ordered language
    // list from System Settings — is the more direct, reliable source: it's
    // a plain user-defaults read, not tied to how this process was launched.
    // Optional first CLI arg overrides it (`voice-helper de-DE`), for a
    // future language picker in Settings.
    let requestedLocaleId = CommandLine.arguments.count > 1
        ? CommandLine.arguments[1]
        : (Locale.preferredLanguages.first ?? "en-US")
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: requestedLocaleId)) ?? SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
    guard let recognizer, recognizer.isAvailable else {
        emit(Event(type: "error", message: "Speech recognizer unavailable for locale \(requestedLocaleId)"))
        shutDown(1)
        return
    }
    // Surfaced so the resolved language is actually visible/debuggable from
    // the app side instead of being silently baked in.
    emit(Event(type: "locale", text: recognizer.locale.identifier))

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    recognitionRequest = request

    let inputNode = audioEngine.inputNode
    let recordingFormat = inputNode.outputFormat(forBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
        recognitionRequest?.append(buffer)
    }

    audioEngine.prepare()
    do {
        try audioEngine.start()
    } catch {
        emit(Event(type: "error", message: "Couldn't start audio engine: \(error.localizedDescription)"))
        shutDown(1)
        return
    }

    emit(Event(type: "ready"))

    recognitionTask = recognizer.recognitionTask(with: request) { result, error in
        if let result {
            let text = result.bestTranscription.formattedString
            if result.isFinal {
                emit(Event(type: "final", text: text))
                emit(Event(type: "ended"))
                shutDown(0)
            } else {
                emit(Event(type: "partial", text: text))
            }
        }
        if let error {
            // A cancellation from our own endAudio()/stop path surfaces here
            // as an error too (depending on OS version) — only treat it as a
            // real error if we didn't ask to stop.
            if !stopping {
                emit(Event(type: "error", message: error.localizedDescription))
                shutDown(1)
            }
        }
    }
}

func requestPermissionsThenStart() {
    SFSpeechRecognizer.requestAuthorization { authStatus in
        guard authStatus == .authorized else {
            emit(Event(type: "error", message: "Speech recognition permission not granted"))
            shutDown(1)
            return
        }
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            guard granted else {
                emit(Event(type: "error", message: "Microphone permission not granted"))
                shutDown(1)
                return
            }
            DispatchQueue.main.async {
                startListening()
            }
        }
    }
}

// Stdin reader on a background thread — readLine() blocks, which is fine off
// the main thread. Any line (content unused) means "stop".
DispatchQueue.global(qos: .userInitiated).async {
    _ = readLine()
    DispatchQueue.main.async {
        stopListening()
    }
}

requestPermissionsThenStart()
RunLoop.main.run()
