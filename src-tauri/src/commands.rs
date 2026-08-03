//! Tauri commands the frontend calls via `invoke(...)`. Thin wrappers around
//! `AcpProcess` — the actual ACP method names/params live here since this is the
//! seam between "generic JSON-RPC" (acp::process) and "grok's specific protocol".

use serde_json::{json, Value};
use tauri::State;

use crate::state::GrokState;

/// The frontend doesn't have a home directory concept of its own — resolve it here
/// rather than sending a literal `~`, which grok's subprocess would never expand.
#[tauri::command]
pub fn default_cwd() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "could not resolve home directory".to_string())
}

/// The result of the one-time ACP `initialize` handshake, already completed by the
/// time this is callable (see lib.rs's setup()). A plain request/response command
/// rather than a "ready" event — the frontend calls this once on mount and gets a
/// correct answer regardless of how fast its own JS finished loading.
#[tauri::command]
pub fn init_status(state: State<'_, GrokState>) -> Result<Value, String> {
    state.init_result.clone()
}

#[tauri::command]
pub async fn new_session(
    state: State<'_, GrokState>,
    cwd: String,
    yolo: bool,
) -> Result<Value, String> {
    let mut params = json!({
        "cwd": cwd,
        "mcpServers": [],
    });
    if yolo {
        params["_meta"] = json!({ "yoloMode": true });
    }
    state
        .process
        .request("session/new", params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_prompt(
    state: State<'_, GrokState>,
    session_id: String,
    text: String,
) -> Result<Value, String> {
    let params = json!({
        "sessionId": session_id,
        "prompt": [{ "type": "text", "text": text }],
    });
    state
        .process
        .request("session/prompt", params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_prompt(state: State<'_, GrokState>, session_id: String) -> Result<(), String> {
    state
        .process
        .notify("session/cancel", json!({ "sessionId": session_id }))
        .map_err(|e| e.to_string())
}

/// Answer an incoming `session/request_permission` (or similar) request from the
/// agent. `option_id` should be one of the `optionId`s the request offered.
#[tauri::command]
pub fn respond_permission(
    state: State<'_, GrokState>,
    id: Value,
    option_id: String,
) -> Result<(), String> {
    state
        .process
        .respond(
            id,
            json!({ "outcome": { "outcome": "selected", "optionId": option_id } }),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn deny_permission(state: State<'_, GrokState>, id: Value) -> Result<(), String> {
    state
        .process
        .respond(id, json!({ "outcome": { "outcome": "cancelled" } }))
        .map_err(|e| e.to_string())
}
