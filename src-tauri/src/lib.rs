mod acp;
mod auth;
mod commands;
mod grok_binary;
mod memory;
mod state;
mod voice;
mod windows_util;

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
                .ok_or("grok CLI not found on PATH or in ~/.grok/bin")?;

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
            // grok agent stdio has no --experimental-memory flag of its own (confirmed
            // via --help); enabling memory means setting GROK_MEMORY=1 on this
            // process's env at spawn time. Read once here — the frontend can't ask
            // yet — and freeze the resolved state into GrokState.memory_active,
            // since flipping the Settings toggle later can't retroactively change
            // an already-spawned child's environment (that needs a restart).
            let memory_active = memory::read_enabled_flag();
            let envs: &[(&str, &str)] = if memory_active { &[("GROK_MEMORY", "1")] } else { &[] };
            // Self-heals the ~/.grok/rules/ policy file on every launch where
            // memory is active — covers installs that enabled memory before
            // this file existed, and repairs it if it's ever deleted by hand.
            if memory_active {
                let _ = memory::write_agent_rules();
            }

            let (process, init_result) = tauri::async_runtime::block_on(async {
                let process = AcpProcess::spawn(&binary, &["agent", "stdio"], envs, on_event)?;
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

            app.manage(GrokState { process, init_result, memory_active });
            app.manage(voice::VoiceState::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::default_cwd,
            commands::init_status,
            commands::current_model_info,
            commands::new_session,
            commands::load_session,
            commands::list_sessions,
            commands::send_prompt,
            commands::cancel_prompt,
            commands::respond_permission,
            commands::deny_permission,
            commands::respond_ext,
            commands::read_image_data_url,
            commands::save_image_as,
            auth::check_auth,
            auth::start_device_login,
            memory::get_memory_enabled,
            memory::set_memory_enabled,
            memory::memory_runtime_status,
            memory::list_anvil_entries,
            memory::read_anvil_entry,
            memory::write_anvil_entry,
            memory::delete_anvil_entry,
            voice::start_voice,
            voice::stop_voice,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
