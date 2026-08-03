use std::sync::Arc;

use serde_json::Value;

use crate::acp::AcpProcess;

/// App-wide Tauri-managed state: the single long-lived ACP process (hosts every
/// session opened in this window), plus the result of its one-time `initialize`
/// handshake. The frontend reads `init_result` via a plain command rather than only
/// listening for a one-shot "ready" event — events fire-and-forget with no replay, so
/// a frontend whose JS bundle is still loading when the (near-instant) handshake
/// finishes would simply never see it. A command is a request/response the frontend
/// can call whenever its own code is ready, so there's no race to lose.
pub struct GrokState {
    pub process: Arc<AcpProcess>,
    pub init_result: Result<Value, String>,
}
