# Protocol notes: `grok agent stdio`'s real ACP wire shapes

`grok agent stdio` speaks the [Agent Client Protocol](https://agentclientprotocol.com)
(JSON-RPC 2.0, one message per line over stdin/stdout), but grok's own docs describe
method *categories* and update *types* without giving exact field shapes. Rather than
guess, we captured real traffic from a live, authenticated `grok` process and built the
client against that. This document is the write-up; it exists partly so other people
building ACP clients against grok don't have to redo this from scratch.

Captured with a small Node.js script that spawns `grok agent stdio`, drives a handshake
+ prompt, and logs every line — see the git history of this file's directory if you want
the harness (it wasn't kept in the repo long-term to avoid checking in noisy raw
transcripts with local absolute paths).

## The two notification channels

This is the single most important thing to know: grok's ACP traffic splits across
**two different JSON-RPC methods**, and a client that only handles one will silently
miss real activity.

- **`session/update`** — the standard ACP notification. Carries
  `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`,
  `available_commands_update`, `user_message_chunk`, `session_info_update`.
- **`_x.ai/session_notification`** — an xAI/grok-specific extension notification, same
  `{sessionId, update: {sessionUpdate: "...", ...}}` envelope shape, but carrying kinds
  `session/update` never emits: `pending_interaction`, `interaction_resolved`,
  `response_completed`, `turn_completed`, `tool_call_delta_chunk`,
  **`subagent_spawned`, `subagent_progress`, `subagent_finished`**, `model_changed`,
  `session_summary_generated`.

**Subagent activity is only observable on `_x.ai/session_notification`.** A client that
filters on `method === "session/update"` (the natural first guess, since that's the
only method grok's own docs mention) will never see a subagent spawn at all.

There's a third tier of bookkeeping-only methods with no `update` wrapper:
`_x.ai/queue/changed`, `_x.ai/sessions/changed`, `_x.ai/models/update`,
`_x.ai/announcements/update`, `_x.ai/settings/update`, `_x.ai/mcp_initialized`,
`_x.ai/mcp/init_progress`, `_x.ai/mcp/servers_updated`, `_x.ai/mcp/server_status`,
`_x.ai/session/prompt_complete`. These are useful for a session list / MCP status UI but
not for the chat transcript itself.

## `agent_message_chunk` / `agent_thought_chunk`

Confirmed to match grok's own documented TypeScript example exactly:

```json
{"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "I'll"}}
```

Same shape for `agent_thought_chunk`.

## Tool calls

```json
{
  "sessionUpdate": "tool_call",
  "toolCallId": "call-69299aef-...-0",
  "title": "run_terminal_command",
  "rawInput": {"command": "wc -l sample.txt", "description": "...", "background": false},
  "_meta": {"x.ai/tool": {"name": "run_terminal_command", "kind": "execute", "namespace": "grok_build", "read_only": false}}
}
```

Followed by one or more `tool_call_update`s for the same `toolCallId`, each a partial
patch — later updates add `status` (`in_progress` / `completed`), `kind`, `title`,
`content[]`, `rawOutput`, `locations[]`. Treat updates as merge-patches keyed by
`toolCallId`, not standalone objects — no single update necessarily has every field.

### Edits carry a ready-to-render diff

The best finding here: an `Edit`-kind tool call's `content[]` includes a `type: "diff"`
block with the **full before/after text already split out** — no unified-diff parsing
needed, just feed both strings into a diff view (we use `@codemirror/merge`):

```json
{
  "type": "diff",
  "path": "/abs/path/to/sample.txt",
  "oldText": "hello world\nline two\nline three\n",
  "newText": "hello world\nline two\nline three\nline four\n"
}
```

### Permission requests

An edit (or any non-auto-approved tool) triggers a real incoming JSON-RPC **request**
(not a notification — it has an `id` and expects a response) on
`session/request_permission`:

```json
{
  "method": "session/request_permission",
  "params": {
    "sessionId": "...",
    "toolCall": {"toolCallId": "...", "kind": "edit", "title": "Edit `sample.txt`", "rawInput": {...}},
    "options": [
      {"optionId": "allow-edits-session", "name": "Yes, allow all edits during this session", "kind": "allow_always"},
      {"optionId": "allow-once", "name": "Yes", "kind": "allow_once"},
      {"optionId": "reject-once", "name": "No, and tell Grok what to do differently", "kind": "reject_once"}
    ]
  }
}
```

Respond with:

```json
{"result": {"outcome": {"outcome": "selected", "optionId": "allow-once"}}}
```

Note the `options` array's `optionId`s are dynamic — don't hardcode them; render
whatever the request actually offers, and treat the `reject_*`-kind option as "Deny"
rather than inventing a separate cancel outcome.

Read-only shell commands (`wc`, `cat`, `ls`, etc. — grok's own built-in auto-approve
list) never trigger this at all, even in default "ask" mode. You'll also see a
`pending_interaction` / `interaction_resolved` pair on `_x.ai/session_notification`
bracketing *every* tool call that needed any kind of decision, including
auto-approved ones — that's a UI-hint lifecycle marker, not itself the permission
request.

## Background commands

`run_terminal_command` with `background: true` resolves its *launch* tool call
immediately (`rawOutput.type: "BackgroundTaskStarted"`, carrying a `task_id` and a
directly-tailable `output_file` path under `~/.grok/sessions/...`), then the **same
`toolCallId` receives further `tool_call_update`s** as the background process produces
output — `rawOutput.type: "Bash"` with `output_for_prompt` (plain text, incrementally
growing) and eventually `exit_code`. So incremental streaming *is* available purely
over ACP without needing to tail the file ourselves, though the file is there as a
fallback/alternative source for a more terminal-faithful (raw bytes, not just
prompt-formatted text) live pane.

## Subagents

As noted above, entirely on `_x.ai/session_notification`:

- **`subagent_spawned`**: `subagent_id` (== `child_session_id`), `subagent_type`,
  `description`, `capability_mode`, `role`, `model`.
- **`subagent_progress`** (fired periodically while running): `duration_ms`,
  `turn_count`, `tool_call_count`, `tokens_used`, `context_usage_pct`, `tools_used[]`,
  `error_count`. Enough for a live "Running: list_dir · 15s · 6.6k tok" status line.
- **`subagent_finished`**: `status`, `tool_calls`, `turns`, `duration_ms`,
  `tokens_used`, and a full **`output`** string — the subagent's final markdown summary.

**There is no live nested transcript** (no relayed `tool_call`/`agent_message_chunk`
stream for the child session) — only periodic metrics plus a final summary. Grok
Desktop's Activity dock is built to that reality: a live-updating status card while
running, replaced by the rendered `output` markdown on finish. A true live sub-transcript
would need a separate `session/new`-style subscription to the child's own session (its
`child_session_id` matches grok's own on-disk session ID), which is a possible future
enhancement but isn't how the parent stream exposes it today.
