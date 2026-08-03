//! Login state and the device-code login flow, driven by shelling out to the
//! `grok` CLI itself rather than reverse-engineering an ACP auth extension — `grok
//! login --device-auth` already prints a URL + code to stderr and polls until
//! confirmed, which is exactly what a GUI onboarding screen needs.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::grok_binary;

#[tauri::command]
pub fn check_auth() -> Result<bool, String> {
    let binary = grok_binary::resolve().ok_or_else(|| "grok CLI not found".to_string())?;
    let output = Command::new(binary)
        .arg("models")
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("You are logged in") || stdout.contains("Default model"))
}

#[derive(Clone, Serialize)]
struct LoginUrl {
    url: String,
    code: Option<String>,
}

#[derive(Clone, Serialize)]
struct LoginResult {
    success: bool,
    message: Option<String>,
}

/// Runs `grok login --device-auth` and streams its stderr (where the CLI prints the
/// verification URL + code) back to the frontend as events, then reports success once
/// the process exits. Long-running (waits for the user to confirm in a browser), so
/// this spawns onto Tauri's async runtime and returns immediately.
#[tauri::command]
pub fn start_device_login(app: AppHandle) -> Result<(), String> {
    let binary = grok_binary::resolve().ok_or_else(|| "grok CLI not found".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut child = match Command::new(&binary)
            .args(["login", "--device-auth"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "auth-login-result",
                    LoginResult { success: false, message: Some(e.to_string()) },
                );
                return;
            }
        };

        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut emitted = false;
            for line in reader.lines().map_while(Result::ok) {
                if emitted {
                    continue;
                }
                if let Some(idx) = line.find("https://") {
                    let url = line[idx..].trim().to_string();
                    // The device-auth URL carries the code as a query param
                    // (?user_code=XXXX-XXXX), so we don't need to also parse the
                    // separate "Confirm this code" line that follows it.
                    let code = url
                        .split("user_code=")
                        .nth(1)
                        .map(|s| s.trim_end_matches('/').to_string());
                    let _ = app.emit("auth-login-url", LoginUrl { url, code });
                    emitted = true;
                }
            }
        }

        let status = child.wait();
        let success = status.map(|s| s.success()).unwrap_or(false);
        let _ = app.emit(
            "auth-login-result",
            LoginResult {
                success,
                message: if success { None } else { Some("Login did not complete".to_string()) },
            },
        );
    });

    Ok(())
}
