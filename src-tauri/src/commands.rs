//! Tauri commands the frontend calls via `invoke(...)`. Thin wrappers around
//! `AcpProcess` — the actual ACP method names/params live here since this is the
//! seam between "generic JSON-RPC" (acp::process) and "grok's specific protocol".

use base64::Engine;
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

/// The current model name/description, read from initialize's cached
/// `_meta.modelState`. Informational only — switching models isn't wired yet,
/// since ACP's `session/set_model` accepted our calls (200 OK) without visibly
/// changing anything in a live test, and this account only has one model
/// anyway, so there was nothing to actually verify switching between.
#[tauri::command]
pub fn current_model_info(state: State<'_, GrokState>) -> Result<Value, String> {
    let result = state.init_result.clone()?;
    let model_state = result
        .get("_meta")
        .and_then(|m| m.get("modelState"))
        .cloned()
        .unwrap_or(Value::Null);
    Ok(model_state)
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

/// Reattaches a session that was created by a *previous* app run — grok persists
/// sessions to disk under ~/.grok/sessions/ regardless of which process created
/// them, and `session/load` (agentCapabilities.loadSession) resumes one by ID on a
/// fresh process. Confirmed live: the result's `_meta.sessionId` matches the
/// original exactly, so the *backend* context (files touched, prior turns) carries
/// over correctly. It does NOT replay the old messages as session/update
/// notifications, though — the visual transcript is restored separately from our
/// own persisted store state (see src/store/sessions.ts's persist middleware).
#[tauri::command]
pub async fn load_session(
    state: State<'_, GrokState>,
    session_id: String,
    cwd: String,
) -> Result<Value, String> {
    let params = json!({
        "sessionId": session_id,
        "cwd": cwd,
        "mcpServers": [],
    });
    state
        .process
        .request("session/load", params)
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedImage {
    data_url: String,
    /// The real absolute path that actually resolved — not necessarily the
    /// `path` argument (which may have been a relative short path). The
    /// frontend needs this for the download button, since re-encoding the
    /// `data:` URL back to bytes would be redundant when we already have the
    /// file on disk.
    path: String,
}

/// Reads a local image and returns it as a `data:` URL so the frontend can
/// render an inline `<img>` preview without widening Tauri's asset-protocol
/// filesystem scope. `path` from a tool call's `rawOutput.path` is always
/// absolute and used as-is. `path` from the model's own prose is often a
/// "short path" (e.g. `images/8.jpg`) — grok's TUI turns that into an OSC-8
/// terminal hyperlink pointing at the real file, but a generic markdown
/// renderer has no such mechanism, so we resolve it ourselves: first against
/// the session's cwd (a real project file the model referenced), then against
/// grok's own on-disk session folder. Confirmed by inspecting `~/.grok/sessions/`
/// directly: the real layout is `~/.grok/sessions/<percent-encoded-cwd>/<sessionId>/images/<n>.jpg`
/// (an earlier guess of `~/.grok/sessions/<sessionId>/...` — no cwd segment — was wrong).
#[tauri::command]
pub fn read_image_data_url(path: String, cwd: Option<String>, session_id: Option<String>) -> Result<ResolvedImage, String> {
    let mut candidates = Vec::new();
    if std::path::Path::new(&path).is_absolute() {
        candidates.push(path.clone());
    } else {
        if let Some(cwd) = &cwd {
            candidates.push(format!("{}/{}", cwd.trim_end_matches('/'), path));
        }
        if let (Some(cwd), Some(session_id)) = (&cwd, &session_id) {
            if let Some(home) = dirs::home_dir() {
                let encoded_cwd = urlencoding::encode(cwd);
                candidates.push(
                    home.join(".grok/sessions")
                        .join(encoded_cwd.as_ref())
                        .join(session_id)
                        .join(&path)
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        candidates.push(path.clone());
    }

    for candidate in &candidates {
        if let Ok(bytes) = std::fs::read(candidate) {
            let mime = match std::path::Path::new(candidate)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str()
            {
                "png" => "image/png",
                "webp" => "image/webp",
                "gif" => "image/gif",
                _ => "image/jpeg",
            };
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            return Ok(ResolvedImage {
                data_url: format!("data:{mime};base64,{encoded}"),
                path: candidate.clone(),
            });
        }
    }
    Err(format!("could not read image from any of: {candidates:?}"))
}

/// Copies a resolved image (see `read_image_data_url`) to a user-chosen
/// destination — backs the download button in the image lightbox. A plain
/// file copy rather than re-encoding the `data:` URL the frontend already
/// has, so the saved file is byte-identical to the original.
#[tauri::command]
pub fn save_image_as(source_path: String, dest_path: String) -> Result<(), String> {
    std::fs::copy(&source_path, &dest_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}
