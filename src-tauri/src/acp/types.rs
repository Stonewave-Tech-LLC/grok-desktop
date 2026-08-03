//! Generic JSON-RPC 2.0 envelope types for the Agent Client Protocol (ACP).
//!
//! `grok agent stdio` frames every message as one JSON object per line. We keep
//! `params`/`result` as raw `serde_json::Value` here rather than fully typed structs:
//! the exact per-method/per-notification field shapes are being captured empirically
//! (see docs/protocol-notes/) and are still being filled in. Untyped-but-correctly-framed
//! beats typed-but-guessed for a protocol we don't control.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A single line of ACP traffic, in either direction. `id` distinguishes the three
/// JSON-RPC message kinds: present + `method` => an incoming/outgoing request;
/// present + no `method` => a response; absent => a notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawMessage {
    pub jsonrpc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RawMessage {
    pub fn request(id: u64, method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: Some("2.0".into()),
            id: Some(Value::from(id)),
            method: Some(method.into()),
            params: Some(params),
            result: None,
            error: None,
        }
    }

    pub fn notification(method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: Some("2.0".into()),
            id: None,
            method: Some(method.into()),
            params: Some(params),
            result: None,
            error: None,
        }
    }

    pub fn response(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: Some("2.0".into()),
            id: Some(id),
            method: None,
            params: None,
            result: Some(result),
            error: None,
        }
    }

    pub fn error_response(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: Some("2.0".into()),
            id: Some(id),
            method: None,
            params: None,
            result: None,
            error: Some(RpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }

    /// True if this is a response to a request we sent (has `id`, no `method`).
    pub fn is_response(&self) -> bool {
        self.id.is_some() && self.method.is_none()
    }

    /// True if this is an incoming request from the agent (has both `id` and `method`).
    pub fn is_incoming_request(&self) -> bool {
        self.id.is_some() && self.method.is_some()
    }

    /// True if this is a notification (has `method`, no `id`).
    pub fn is_notification(&self) -> bool {
        self.id.is_none() && self.method.is_some()
    }
}

/// Events the process layer emits for the rest of the app to consume.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AcpEvent {
    /// A `session/update` (or any other) notification from the agent.
    Notification { method: String, params: Value },
    /// An incoming request from the agent that expects a response (e.g.
    /// `session/request_permission`). The response must be sent back via
    /// `AcpProcess::respond` using the same `id`.
    IncomingRequest {
        id: Value,
        method: String,
        params: Value,
    },
    /// The child process exited, expectedly or not.
    ProcessExited { code: Option<i32> },
    /// A line on stderr — grok's own logs, useful for a debug console.
    Stderr { line: String },
}
