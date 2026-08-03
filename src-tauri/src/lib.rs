mod acp;
mod auth;
mod commands;
mod grok_binary;
mod state;

use std::sync::Arc;

use serde_json::json;
use tauri::{Emitter, Manager};

use acp::AcpProcess;
use state::GrokState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let binary = grok_binary::resolve()
                .ok_or("grok CLI not found on PATH or in ~/.grok/bin/grok")?;

            let handle = app.handle().clone();
            let on_event: acp::process::EventCallback = Arc::new(move |event| {
                let _ = handle.emit("acp-event", &event);
            });

            // `tokio::process::Command::spawn` (used inside `AcpProcess::spawn`) needs
            // an entered Tokio runtime context to register the child with the async
            // process reactor. Tauri's `setup()` runs before that context exists on
            // the main thread, so we enter it explicitly via `block_on` — and do the
            // `initialize` handshake in the same block, synchronously, so the result
            // is already sitting in managed state by the time the window can show.
            // (Doing it via a fire-and-forget spawned task + a "ready" event race with
            // the frontend's listener registration used to lose that race once the JS
            // bundle grew — the event has no replay, so a listener that attaches even
            // slightly late just misses it forever.)
            let (process, init_result) = tauri::async_runtime::block_on(async {
                let process = AcpProcess::spawn(&binary, &["agent", "stdio"], on_event)?;
                let params = json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": { "readTextFile": false, "writeTextFile": false },
                        "terminal": false
                    }
                });
                let init_result = process.request("initialize", params).await.map_err(|e| e.to_string());
                Ok::<_, acp::AcpProcessError>((process, init_result))
            })?;

            app.manage(GrokState { process, init_result });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::default_cwd,
            commands::init_status,
            commands::current_model_info,
            commands::new_session,
            commands::send_prompt,
            commands::cancel_prompt,
            commands::respond_permission,
            commands::deny_permission,
            auth::check_auth,
            auth::start_device_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
