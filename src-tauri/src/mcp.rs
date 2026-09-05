//! MCP servers declared on ACP session setup (`mcpServers`, mandatory per the
//! ACP schema at agentclientprotocol.com). Slice-2 hardcoded a single probe
//! server (chrome-devtools-mcp) to answer whether grok-build actually
//! *connects* to a declared stdio server at all — it does (confirmed live,
//! see project memory). Slice-4 adds a second, optional entry for graphify's
//! own stdio server, attached only when the session's cwd already has a
//! built graph.
//!
//! Still no settings UI/persistence for either — both are constant,
//! PATH-resolved entries, not a user-configurable server list.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

#[cfg(windows)]
const NPX_NAME: &str = "npx.cmd";
#[cfg(not(windows))]
const NPX_NAME: &str = "npx";

#[cfg(windows)]
const GRAPHIFY_NAME: &str = "graphify.exe";
#[cfg(not(windows))]
const GRAPHIFY_NAME: &str = "graphify";

#[cfg(windows)]
const PYTHON_NAME: &str = "python.exe";
#[cfg(not(windows))]
const PYTHON_NAME: &str = "python3";

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

/// Optional second `McpServer` entry for graphify's own stdio server
/// (`python -m graphify.serve <graph.json>`). Two conditions, both required:
///
/// - The session's cwd must already have `graphify-out/graph.json` — this
///   never triggers (or blocks on) a full `graphify extract` run; a missing
///   graph just means this entry is silently omitted, same as a session with
///   no graphify usage at all today.
/// - `graphify`'s own `python3` must be resolvable. `uv tool install`
///   (the documented install path) places the tool's own venv `python3`
///   right next to the `graphify` launcher in the same `bin/` dir — verified
///   against a real install (Neo, 2026-09-05:
///   `~/.local/share/uv/tools/graphifyy/bin/{graphify,python3}`). That sibling
///   python has the `graphify` package importable via `-m`; an arbitrary
///   `python3` on PATH would not.
///
/// Both are best-effort: unlike the chrome-devtools probe below, a missing
/// graphify install must not fail `session/new` for everyone else.
fn graphify_server(cwd: &str) -> Option<Value> {
    let graph_path = Path::new(cwd).join("graphify-out").join("graph.json");
    if !graph_path.is_file() {
        return None;
    }
    let graphify_bin = resolve_on_path(GRAPHIFY_NAME)?;
    let python = graphify_bin.parent()?.join(PYTHON_NAME);
    if !python.is_file() {
        return None;
    }
    Some(json!({
        "name": "graphify",
        "command": python.to_string_lossy(),
        "args": ["-m", "graphify.serve", graph_path.to_string_lossy()],
        "env": [],
    }))
}

/// The ACP `McpServer` (stdio variant) entries to declare on session setup.
/// The ACP schema documents `command` as "absolute path to the MCP server
/// executable"; a bare `"npx"` risks not resolving if grok-build execs
/// directly instead of going through a shell/PATH lookup itself, so this
/// resolves the real path rather than gambling on it. Returns `Err` (rather
/// than silently falling back to an empty list, which is the exact
/// silent-degradation the chrome-devtools probe replaced) if `npx` can't be
/// found at all — a session with no working tool declaration should fail
/// loudly, not pretend nothing was asked for. graphify has no such
/// requirement — see `graphify_server` above for why it's opt-in-by-file
/// instead.
pub fn probe_servers(cwd: &str) -> Result<Vec<Value>, String> {
    let npx = resolve_on_path(NPX_NAME)
        .ok_or_else(|| format!("chrome-devtools-mcp probe: couldn't find `{NPX_NAME}` on PATH"))?;
    let mut servers = vec![json!({
        "name": "chrome-devtools",
        "command": npx.to_string_lossy(),
        "args": ["-y", "chrome-devtools-mcp@latest"],
        "env": [],
    })];
    if let Some(graphify) = graphify_server(cwd) {
        servers.push(graphify);
    }
    Ok(servers)
}

// ─────────────────────────── grok rules seeding ───────────────────────────

/// `~/.grok/rules/` is always loaded by grok (same mechanism `memory.rs` uses
/// for its own policy file, see its module docs). Unlike memory's rules file,
/// this one isn't gated behind a Settings toggle — using graphify when a
/// graph exists isn't a feature to opt into, so it's written unconditionally
/// on every launch (see `lib.rs`'s `setup()`). This plus the `mcpServers`
/// entry above is the entire "automatically native" bar: the tool exists,
/// and there's a nudge to actually reach for it, no hidden 700-line skill
/// doc injected into every prompt.
fn graphify_rules_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".grok").join("rules").join("02-anvil-graphify.md"))
}

/// Copied verbatim from graphify's own packaged `always_on/claude-md.md` —
/// the same block graphify's `install --platform claude` writes into a
/// project's CLAUDE.md. No `graphify install --platform grok` exists (the
/// installed CLI's platform list has no such target), so this seeds the
/// identical content by hand instead of inventing a grok-specific variant.
const GRAPHIFY_RULES: &str = r#"## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
"#;

/// Called at every app startup (see `lib.rs`) — self-heals the rules file
/// the same way `memory::write_agent_rules` does for its own policy file.
pub fn write_agent_rules() -> Result<(), String> {
    let path = graphify_rules_path().ok_or("could not resolve home directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, GRAPHIFY_RULES).map_err(|e| e.to_string())
}
