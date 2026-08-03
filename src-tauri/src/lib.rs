mod acp;
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
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let binary = grok_binary::resolve()
                .ok_or("grok CLI not found on PATH or in ~/.grok/bin/grok")?;

            let handle = app.handle().clone();
            let on_event: acp::process::EventCallback = Arc::new(move |event| {
                let _ = handle.emit("acp-event", &event);
            });

            let process = AcpProcess::spawn(&binary, &["agent", "stdio"], on_event)?;
            app.manage(GrokState {
                process: process.clone(),
            });

            let handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let params = json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": { "readTextFile": false, "writeTextFile": false },
                        "terminal": false
                    }
                });
                match process.request("initialize", params).await {
                    Ok(result) => {
                        let _ = handle2.emit("acp-ready", &result);
                    }
                    Err(e) => {
                        let _ = handle2.emit("acp-init-error", e.to_string());
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::new_session,
            commands::send_prompt,
            commands::cancel_prompt,
            commands::respond_permission,
            commands::deny_permission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
