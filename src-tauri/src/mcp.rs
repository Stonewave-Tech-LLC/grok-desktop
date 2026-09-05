//! Slice-2 MCP probe: a single hardcoded stdio server (chrome-devtools-mcp)
//! passed through ACP's `mcpServers` session-setup field. That field is
//! mandatory on `session/new`/`session/load` per the ACP schema
//! (agentclientprotocol.com) and grok-build has always required it as part
//! of those params — this app just hardcoded it to `[]` until now (see
//! SLICE5's list_sessions comment for the same "can't test against a live
//! grok binary from this box" caveat, which applies here too).
//!
//! Deliberately a probe, not a feature: one constant server, no settings UI,
//! no persistence. The question this answers is whether grok-build actually
//! *connects* to a declared stdio server at all — stdio transport is
//! spec-mandatory for every ACP agent, so if this doesn't work it's a
//! grok-build compliance gap, not something to work around here.

use std::env;
use std::path::PathBuf;

use serde_json::{json, Value};

#[cfg(windows)]
const NPX_NAME: &str = "npx.cmd";
#[cfg(not(windows))]
const NPX_NAME: &str = "npx";

/// Walks `PATH` manually, same approach as `grok_binary::resolve()` — no
/// `which`/`where` shell-out needed since `env::split_paths` already handles
/// the `:` vs `;` separator difference between platforms.
fn resolve_on_path(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    env::split_paths(&path_var).find_map(|dir| {
        let candidate = dir.join(name);
        candidate.is_file().then_some(candidate)
    })
}

/// The ACP `McpServer` (stdio variant) entries to declare on session
/// setup — currently just the one probe server. The ACP schema documents
/// `command` as "absolute path to the MCP server executable"; a bare
/// `"npx"` risks not resolving if grok-build execs directly instead of
/// going through a shell/PATH lookup itself, so this resolves the real path
/// rather than gambling on it. Returns `Err` (rather than silently falling
/// back to an empty list, which is the exact silent-degradation this probe
/// replaces) if `npx` can't be found at all — a session with no working
/// tool declaration should fail loudly, not pretend nothing was asked for.
pub fn probe_servers() -> Result<Vec<Value>, String> {
    let npx = resolve_on_path(NPX_NAME)
        .ok_or_else(|| format!("chrome-devtools-mcp probe: couldn't find `{NPX_NAME}` on PATH"))?;
    Ok(vec![json!({
        "name": "chrome-devtools",
        "command": npx.to_string_lossy(),
        "args": ["-y", "chrome-devtools-mcp@latest"],
        "env": [],
    })])
}
