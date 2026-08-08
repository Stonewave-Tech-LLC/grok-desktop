//! Owns a `grok agent stdio` child process and speaks newline-delimited JSON-RPC 2.0
//! (the Agent Client Protocol) over its stdin/stdout. This layer is protocol-framing
//! only — it doesn't know what a `session/prompt` or a `tool_call` is, just how to
//! send a request and get a response, and how to surface unsolicited traffic from the
//! agent (notifications, and incoming requests like permission prompts) to a caller.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::types::{AcpEvent, RawMessage, RpcError};

pub type EventCallback = Arc<dyn Fn(AcpEvent) + Send + Sync>;

#[derive(Debug, thiserror::Error)]
pub enum AcpProcessError {
    #[error("failed to spawn grok: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("agent returned an error: {message} (code {code})")]
    Rpc { code: i64, message: String },
    #[error("the agent process has exited")]
    ProcessGone,
    #[error("request channel closed before a response arrived")]
    ChannelClosed,
}

pub struct AcpProcess {
    child: Mutex<Child>,
    stdin_tx: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>>,
    next_id: AtomicU64,
}

impl AcpProcess {
    /// Spawn `binary agent stdio` (or any argv) and start the reader/writer tasks.
    /// `on_event` is called from the reader task for every notification, incoming
    /// request, stderr line, and process-exit event.
    pub fn spawn(
        binary: &str,
        args: &[&str],
        envs: &[(&str, &str)],
        on_event: EventCallback,
    ) -> Result<Arc<Self>, AcpProcessError> {
        let mut command = Command::new(binary);
        command
            .args(args)
            .envs(envs.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(crate::windows_util::CREATE_NO_WINDOW);
        let mut child = command.spawn()?;

        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");
        let stderr = child.stderr.take().expect("stderr was piped");

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Writer task: serializes stdin writes so concurrent `request()` calls don't
        // interleave partial lines.
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = stdin_rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.write_all(b"\n").await.is_err() {
                    break;
                }
                if stdin.flush().await.is_err() {
                    break;
                }
            }
        });

        // Reader task: one JSON object per line, dispatched to pending-request
        // resolution or to the on_event callback.
        {
            let pending = pending.clone();
            let on_event = on_event.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if line.trim().is_empty() {
                                continue;
                            }
                            let parsed: Result<RawMessage, _> = serde_json::from_str(&line);
                            match parsed {
                                Ok(msg) => dispatch(msg, &pending, &on_event).await,
                                Err(e) => {
                                    on_event(AcpEvent::Stderr {
                                        line: format!("[unparsable stdout line] {e}: {line}"),
                                    });
                                }
                            }
                        }
                        Ok(None) => {
                            on_event(AcpEvent::ProcessExited { code: None });
                            break;
                        }
                        Err(e) => {
                            on_event(AcpEvent::Stderr {
                                line: format!("[stdout read error] {e}"),
                            });
                            break;
                        }
                    }
                }
            });
        }

        // Stderr task: forward grok's own logs so the app can show a debug console.
        {
            let on_event = on_event.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    on_event(AcpEvent::Stderr { line });
                }
            });
        }

        Ok(Arc::new(Self {
            child: Mutex::new(child),
            stdin_tx,
            pending,
            next_id: AtomicU64::new(1),
        }))
    }

    /// Send a JSON-RPC request and await its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, AcpProcessError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let msg = RawMessage::request(id, method, params);
        let line = serde_json::to_string(&msg).expect("RawMessage always serializes");
        self.stdin_tx
            .send(line)
            .map_err(|_| AcpProcessError::ProcessGone)?;

        match rx.await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(err)) => Err(AcpProcessError::Rpc {
                code: err.code,
                message: err.message,
            }),
            Err(_) => Err(AcpProcessError::ChannelClosed),
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    pub fn notify(&self, method: &str, params: Value) -> Result<(), AcpProcessError> {
        let msg = RawMessage::notification(method, params);
        let line = serde_json::to_string(&msg).expect("RawMessage always serializes");
        self.stdin_tx
            .send(line)
            .map_err(|_| AcpProcessError::ProcessGone)
    }

    /// Reply to an incoming request from the agent (e.g. a permission prompt).
    pub fn respond(&self, id: Value, result: Value) -> Result<(), AcpProcessError> {
        let msg = RawMessage::response(id, result);
        let line = serde_json::to_string(&msg).expect("RawMessage always serializes");
        self.stdin_tx
            .send(line)
            .map_err(|_| AcpProcessError::ProcessGone)
    }

    pub fn respond_error(
        &self,
        id: Value,
        code: i64,
        message: impl Into<String>,
    ) -> Result<(), AcpProcessError> {
        let msg = RawMessage::error_response(id, code, message);
        let line = serde_json::to_string(&msg).expect("RawMessage always serializes");
        self.stdin_tx
            .send(line)
            .map_err(|_| AcpProcessError::ProcessGone)
    }

    pub async fn kill(&self) {
        let _ = self.child.lock().await.kill().await;
    }
}

async fn dispatch(
    msg: RawMessage,
    pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>>,
    on_event: &EventCallback,
) {
    if msg.is_response() {
        // id is always a number for responses to requests we generated.
        let id = msg.id.as_ref().and_then(|v| v.as_u64());
        if let Some(id) = id {
            if let Some(tx) = pending.lock().await.remove(&id) {
                let result = match msg.error {
                    Some(err) => Err(err),
                    None => Ok(msg.result.unwrap_or(Value::Null)),
                };
                let _ = tx.send(result);
                return;
            }
        }
        on_event(AcpEvent::Stderr {
            line: format!("[unmatched response] {:?}", msg.id),
        });
    } else if msg.is_incoming_request() {
        on_event(AcpEvent::IncomingRequest {
            id: msg.id.unwrap(),
            method: msg.method.unwrap(),
            params: msg.params.unwrap_or(Value::Null),
        });
    } else if msg.is_notification() {
        on_event(AcpEvent::Notification {
            method: msg.method.unwrap(),
            params: msg.params.unwrap_or(Value::Null),
        });
    }
}
