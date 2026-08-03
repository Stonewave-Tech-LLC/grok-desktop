// Mirrors src-tauri/src/acp/types.rs's `AcpEvent`. Kept loosely typed on the
// `params`/`payload` side (raw JSON) since the exact per-notification field
// shapes are still being confirmed empirically against the real `grok` CLI —
// see docs/protocol-notes/. Unknown shapes should degrade gracefully, not throw.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AcpEvent =
  | { kind: "notification"; method: string; params: JsonValue }
  | { kind: "incoming_request"; id: JsonValue; method: string; params: JsonValue }
  | { kind: "process_exited"; code: number | null }
  | { kind: "stderr"; line: string };

// --- session/update notification payload (params.update.sessionUpdate) ---
// Field names per grok's docs (15-agent-mode.md); exact nested shapes for
// tool_call/tool_call_update are refined once protocol-notes recon lands.
export type SessionUpdateKind =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | string; // fall back to a raw string for forward-compat with new kinds

export interface SessionUpdateNotification {
  sessionId: string;
  update: {
    sessionUpdate: SessionUpdateKind;
    [key: string]: JsonValue | string;
  };
}
