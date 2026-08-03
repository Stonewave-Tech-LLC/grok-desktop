use std::sync::Arc;

use crate::acp::AcpProcess;

/// App-wide Tauri-managed state: the single long-lived ACP process (hosts every
/// session opened in this window).
pub struct GrokState {
    pub process: Arc<AcpProcess>,
}
