//! Manages the platform-specific voice-recognition helper subprocess (macOS
//! implementation: `voice-helper-macos/main.swift`, using Apple's Speech
//! framework — a Windows implementation using WinRT speech recognition is
//! planned but not yet wired in here). The helper is a Tauri sidecar binary
//! (see `bundle.externalBin` in tauri.conf.json): a small native process
//! speaking a one-way, line-delimited JSON protocol on stdout, stopped by
//! writing any line to its stdin. This mirrors the existing `AcpProcess`
//! pattern in `acp/process.rs` — same shape, much smaller protocol, and kept
//! as a genuinely separate process because the Speech/AVFoundation APIs on
//! macOS (and WinRT speech APIs on Windows) don't have mature Rust bindings,
//! whereas the native Swift/C# surface is the stable, documented one.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[cfg(target_os = "macos")]
fn target_triple() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else {
        "x86_64-apple-darwin"
    }
}
#[cfg(target_os = "windows")]
fn target_triple() -> &'static str {
    "x86_64-pc-windows-msvc"
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn target_triple() -> &'static str {
    ""
}

fn exe_suffix() -> &'static str {
    if cfg!(target_os = "windows") { ".exe" } else { "" }
}

/// Bundled apps get the sidecar copied next to the main executable (Tauri's
/// `externalBin` convention) — but Tauri strips the target-triple suffix
/// during that copy (confirmed by inspecting a real build's `Contents/MacOS/`:
/// `binaries/voice-helper-aarch64-apple-darwin` lands as plain `voice-helper`
/// next to the main binary), so the bundled name and the checked-in dev-mode
/// name are genuinely different strings, not just different directories.
fn resolve_helper_path() -> Option<PathBuf> {
    let bundled_name = format!("voice-helper{}", exe_suffix());
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(&bundled_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    // cargo tauri dev / cargo run don't run the bundling step at all, so fall
    // back to the raw checked-in binary (still target-triple-suffixed) next
    // to this crate.
    let dev_name = format!("voice-helper-{}{}", target_triple(), exe_suffix());
    let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&dev_name);
    dev_candidate.exists().then_some(dev_candidate)
}

#[derive(Default)]
pub struct VoiceState {
    child: Mutex<Option<Child>>,
}

#[derive(Deserialize, Serialize, Clone)]
struct VoiceEvent {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
    message: Option<String>,
}

#[tauri::command]
pub async fn start_voice(app: AppHandle, state: State<'_, VoiceState>) -> Result<(), String> {
    // Starting a new session implicitly cancels whatever the previous one
    // was doing — signal it to stop before replacing it below.
    stop_voice_internal(&state).await;

    let path = resolve_helper_path().ok_or_else(|| {
        "Voice helper isn't available for this platform yet".to_string()
    })?;

    let mut child = Command::new(&path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Couldn't start voice helper: {e}"))?;

    let stdout = child.stdout.take().ok_or("voice helper has no stdout pipe")?;
    *state.child.lock().await = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<VoiceEvent>(line) {
                Ok(event) => {
                    let _ = app_handle.emit("voice-event", event);
                }
                Err(_) => {
                    // Non-JSON stray output — surface as a debug-visible error
                    // event rather than silently dropping it.
                    let _ = app_handle.emit(
                        "voice-event",
                        VoiceEvent { kind: "error".into(), text: None, message: Some(format!("unexpected helper output: {line}")) },
                    );
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_voice(state: State<'_, VoiceState>) -> Result<(), String> {
    stop_voice_internal(&state).await;
    Ok(())
}

async fn stop_voice_internal(state: &VoiceState) {
    let mut guard = state.child.lock().await;
    if let Some(child) = guard.as_mut() {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(b"stop\n").await;
        }
    }
}
