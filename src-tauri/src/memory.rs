//! Anvil Memory: a structured, categorized (typed, multi-file) knowledge store
//! that sits alongside grok CLI's own flatter memory system. Entries are plain
//! Markdown files with YAML-ish frontmatter under `.anvil/memory/` (project,
//! git-trackable) and `~/.anvil/memory/` (global) — this module owns their
//! CRUD, the generated index (`MEMORY.md` per scope, never hand-edited), and a
//! generated bridge block written into grok's *own* `~/.grok/memory/**/MEMORY.md`
//! so entries are still automatically searched/injected by grok's native memory
//! (when enabled) rather than just sitting in files nobody reads.
//!
//! Also owns the memory *enable* toggle: `grok agent stdio` has no flag of its
//! own for this (confirmed via `--help`), so enabling means setting
//! `GROK_MEMORY=1` on the child process's env at spawn time — which has to
//! happen before the frontend/localStorage exists, hence a small Rust-owned
//! config file (`~/.grok-desktop/config.json`) as the source of truth instead
//! of the usual zustand `persist` store.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::state::GrokState;

// ───────────────────────── enable/disable toggle ─────────────────────────

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    #[serde(default)]
    memory_enabled: bool,
}

fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".grok-desktop").join("config.json"))
}

fn read_config() -> AppConfig {
    config_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path().ok_or("could not resolve home directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Read at Tauri `setup()` time, before the frontend can ask — decides whether
/// to pass `GROK_MEMORY=1` to the spawned process.
pub fn read_enabled_flag() -> bool {
    read_config().memory_enabled
}

#[tauri::command]
pub fn get_memory_enabled() -> bool {
    read_config().memory_enabled
}

#[tauri::command]
pub fn set_memory_enabled(enabled: bool) -> Result<(), String> {
    write_config(&AppConfig { memory_enabled: enabled })?;
    // Memory tools existing is not the same as grok actually using them —
    // live-tested this session: asked "what do you remember?", grok answered
    // "nothing" without ever calling memory_search, and even once it did
    // search, an empty result was treated as "memory is empty" instead of
    // falling back to reading MEMORY.md directly (which had real content).
    // grok's own diagnosis of that transcript called this a policy gap, not a
    // search bug — nothing tells the model to search proactively or to not
    // trust a single empty search. `~/.grok/rules/` is always loaded by grok
    // (confirmed from its own docs), so seeding a short policy file there
    // fixes it for every session, not just ones going through this app.
    if enabled {
        write_agent_rules()?;
    } else {
        remove_agent_rules();
    }
    Ok(())
}

fn agent_rules_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".grok").join("rules").join("00-anvil-memory-usage.md"))
}

const AGENT_MEMORY_POLICY: &str = r#"# Cross-session memory usage

Memory tools (`memory_search`, `memory_get`) are enabled. Treat cross-session
memory as available whenever these tools exist.

- On any question about prior sessions, past decisions, established
  conventions, or continuity ("what did we...", "do you remember...", "what
  do you know about this project") — call `memory_search` BEFORE answering.
  Never claim you have no memory without having searched first.
- If `memory_search` returns no results, don't conclude memory is empty —
  fall back to `memory_get` on `~/.grok/memory/MEMORY.md` (global) and the
  current workspace's `MEMORY.md`. An empty search result is not proof of
  empty memory.
- Grok Desktop (Anvil) mirrors a curated operator layer into these same
  files under an `<!-- anvil:memory:begin -->` block (state card first,
  then typed entries: project/decision/issue/person/preference/reference,
  plus episodic captures and playbooks). Read it like any other memory
  content — it's just as trustworthy.
- Also read, when present: `<repo>/.anvil/memory/STATE.md` (focus / last
  decided / open blockers) and the typed markdown files beside it. Forge
  Grok on this Mac uses the same paths. Prefer `memory_search` / `memory_get`
  first; fall back to those files if search is empty.
- Prefer the memory tools over shelling out to `find`/`grep`/`sqlite3`
  against `~/.grok/memory/` to inspect it manually — that's for a human
  debugging the system, not the normal path to recall something.

This file is managed by Grok Desktop's memory toggle in Settings — written
when memory is enabled, removed when disabled.
"#;

/// Also called at app startup (see lib.rs) whenever memory is already
/// enabled from a previous run — keeps the rules file present/up to date
/// even for installs that enabled memory before this policy file existed,
/// and self-heals if it's ever deleted by hand.
pub fn write_agent_rules() -> Result<(), String> {
    let path = agent_rules_path().ok_or("could not resolve home directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, AGENT_MEMORY_POLICY).map_err(|e| e.to_string())
}

fn remove_agent_rules() {
    if let Some(path) = agent_rules_path() {
        let _ = fs::remove_file(path);
    }
}

/// Whether *this already-running* process actually has memory active — set
/// once at spawn time in `GrokState`, deliberately not re-read from the config
/// file here, since flipping the Settings toggle mid-session can't retroactively
/// change an already-spawned child's environment.
#[tauri::command]
pub fn memory_runtime_status(state: tauri::State<'_, GrokState>) -> bool {
    state.memory_active
}

// ───────────────────── workspace-hash (matches grok's own) ─────────────────────

/// Reproduces grok-build's `compute_workspace_hash` (crates/codegen/xai-grok-memory/src/storage.rs)
/// exactly, so Anvil's project bridge writes to the same `~/.grok/memory/{slug}-{hash8}/`
/// directory grok itself uses for that project.
pub fn compute_workspace_dir(cwd: &Path) -> String {
    let (slug_source, hash_input) = match git_origin_identity(cwd) {
        Some(identity) => {
            let slug_source = identity.rsplit('/').next().unwrap_or(&identity).to_string();
            (slug_source, identity)
        }
        None => {
            let canonical = fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
            let name = canonical
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("workspace")
                .to_string();
            (name, canonical.to_string_lossy().to_string())
        }
    };
    let mut slug = slugify(&slug_source);
    if slug.is_empty() {
        slug = "workspace".to_string();
    }
    let hash = blake3::hash(hash_input.as_bytes());
    let hash8 = &hash.to_hex()[..8];
    format!("{slug}-{hash8}")
}

fn git_origin_identity(cwd: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let url = String::from_utf8(output.stdout).ok()?;
    normalize_remote_url(url.trim())
}

/// `git@host:org/repo.git` | `https://host/org/repo.git` | `ssh://git@host/org/repo` -> `org/repo`.
fn normalize_remote_url(url: &str) -> Option<String> {
    let path = if let Some(colon_pos) = url.find(':') {
        if url[..colon_pos].contains('@') && !url[..colon_pos].contains('/') {
            &url[colon_pos + 1..]
        } else {
            url.split("//")
                .nth(1)
                .and_then(|rest| rest.split_once('/'))
                .map(|(_, p)| p)?
        }
    } else {
        return None;
    };
    let cleaned = path
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .trim_start_matches('/');
    if cleaned.is_empty() || !cleaned.contains('/') {
        return None;
    }
    Some(cleaned.to_string())
}

fn slugify(input: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    slug.chars().take(40).collect()
}

// ───────────────────────── storage locations ─────────────────────────

/// Walk up from `cwd` looking for a `.git` directory — same repo-root
/// discovery grok itself uses for `AGENTS.md`. Falls back to `cwd` when not
/// inside a git repo.
fn find_repo_root(cwd: &Path) -> PathBuf {
    let mut dir = cwd;
    loop {
        if dir.join(".git").exists() {
            return dir.to_path_buf();
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return cwd.to_path_buf(),
        }
    }
}

fn anvil_project_dir(cwd: &Path) -> PathBuf {
    find_repo_root(cwd).join(".anvil").join("memory")
}

fn anvil_global_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".anvil").join("memory"))
}

fn grok_memory_global_file() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".grok").join("memory").join("MEMORY.md"))
}

fn grok_memory_workspace_file(cwd: &Path) -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".grok")
            .join("memory")
            .join(compute_workspace_dir(cwd))
            .join("MEMORY.md")
    })
}

/// Refuses to touch anything outside an `.anvil/memory/` tree (project or
/// global) — defense in depth, since this module can delete files, unlike the
/// existing lenient `read_image_data_url`.
fn safe_path_check(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("could not resolve path: {e}"))?;
    if !canonical.to_string_lossy().contains("/.anvil/memory/") {
        return Err("refusing to touch a path outside .anvil/memory".to_string());
    }
    Ok(canonical)
}

// ───────────────────────── entry frontmatter ─────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntryMeta {
    slug: String,
    r#type: String,
    name: String,
    description: String,
    status: Option<String>,
    modified_at_ms: i64,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    #[serde(flatten)]
    meta: MemoryEntryMeta,
    body: String,
}

struct ParsedEntry {
    name: String,
    r#type: String,
    description: String,
    status: Option<String>,
    body: String,
}

/// Minimal frontmatter parser — three flat string fields plus an optional
/// status, no nested structures, so a hand-rolled parser is enough and avoids
/// a new `serde_yaml` dependency for something this simple.
fn parse_entry(content: &str) -> Option<ParsedEntry> {
    let rest = content.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    let frontmatter = &rest[..end];
    let after = &rest[end + 4..];
    let body = after.strip_prefix('\n').unwrap_or(after).to_string();

    let mut name = String::new();
    let mut r#type = String::new();
    let mut description = String::new();
    let mut status = None;
    for line in frontmatter.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim().to_string();
            match key.trim() {
                "name" => name = value,
                "type" => r#type = value,
                "description" => description = value,
                "status" => status = Some(value),
                _ => {}
            }
        }
    }
    Some(ParsedEntry { name, r#type, description, status, body })
}

fn render_entry(name: &str, r#type: &str, description: &str, status: Option<&str>, body: &str) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("name: {name}\n"));
    out.push_str(&format!("type: {type}\n"));
    out.push_str(&format!("description: {description}\n"));
    if let Some(status) = status {
        out.push_str(&format!("status: {status}\n"));
    }
    out.push_str("---\n\n");
    out.push_str(body.trim_end());
    out.push('\n');
    out
}

fn title_case(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn file_modified_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn scan_type_dir(dir: &Path, r#type: &str) -> Vec<MemoryEntryMeta> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(dir) else { return out };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else { continue };
        let Some(parsed) = parse_entry(&content) else { continue };
        let slug = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        out.push(MemoryEntryMeta {
            slug,
            r#type: r#type.to_string(),
            name: parsed.name,
            description: parsed.description,
            status: parsed.status,
            modified_at_ms: file_modified_ms(&path),
            path: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    out
}

/// All entries directly under a scope root, grouped by their type subdirectory.
fn scan_scope(base_dir: &Path) -> Vec<MemoryEntryMeta> {
    let mut entries = Vec::new();
    let Ok(read) = fs::read_dir(base_dir) else { return entries };
    for type_entry in read.flatten() {
        let type_path = type_entry.path();
        if !type_path.is_dir() {
            continue;
        }
        let Some(t) = type_path.file_name().and_then(|n| n.to_str()) else { continue };
        entries.extend(scan_type_dir(&type_path, t));
    }
    entries.sort_by(|a, b| a.r#type.cmp(&b.r#type).then(a.name.cmp(&b.name)));
    entries
}

// ───────────────────────── index regeneration ─────────────────────────

/// The scope's `MEMORY.md` is pure generated output — one line per entry,
/// grouped by type. Never hand-edited; regenerated wholesale on every
/// add/edit/delete so there's exactly one thing a human/UI ever edits (the
/// entry file) and one thing that's always derived (the index).
fn regenerate_index(base_dir: &Path) -> Result<(), String> {
    let entries = scan_scope(base_dir);

    let mut out = String::new();
    out.push_str("<!-- Generated by Grok Desktop's Memory panel. Do not edit directly — edit the entry files under each type/ subdirectory; this index is regenerated automatically. -->\n\n");
    out.push_str("# Memory Index\n");
    let mut current_type = String::new();
    for e in &entries {
        if e.r#type != current_type {
            current_type = e.r#type.clone();
            out.push_str(&format!("\n## {}\n", title_case(&current_type)));
        }
        out.push_str(&format!("- [{}]({}/{}.md) — {}\n", e.name, e.r#type, e.slug, e.description));
    }

    fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;
    fs::write(base_dir.join("MEMORY.md"), out).map_err(|e| e.to_string())
}

// ───────────────────────── operator memory: project state card ─────────────────────────
//
// The `## Aktueller Zustand` pattern (Focus / Last decided / Open-Blockers,
// auto last-commit) Neo already uses by hand in CLAUDE.md files — brought
// natively into Anvil instead of inventing a competing format. See
// docs/OPERATOR_MEMORY.md, diamond 4. One card per project workspace, no
// global equivalent (project state is inherently per-workspace).

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StateCard {
    focus: String,
    last_decided: String,
    open_blockers: String,
    updated_at_ms: i64,
    /// Never stored in STATE.md — always computed live from `git log` at
    /// read time, same spirit as a git-hook-updated field but without
    /// installing an actual hook from a GUI app.
    last_commit: Option<String>,
}

impl StateCard {
    fn has_content(&self) -> bool {
        !self.focus.is_empty() || !self.last_decided.is_empty() || !self.open_blockers.is_empty()
    }
}

fn state_card_path(cwd: &Path) -> PathBuf {
    anvil_project_dir(cwd).join("STATE.md")
}

fn last_commit_summary(cwd: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(["log", "-1", "--format=%h %s (%cr)"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

/// Three fixed `## `-headed sections, freeform prose body each — deliberately
/// not the same frontmatter parser as typed entries (this is a single
/// singular card, not a collection with a slug/description/status shape).
fn parse_state_card(content: &str) -> StateCard {
    let mut sections: [String; 3] = [String::new(), String::new(), String::new()];
    let mut current: Option<usize> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(header) = trimmed.strip_prefix("## ") {
            let key = header.trim().to_lowercase();
            current = if key.starts_with("focus") {
                Some(0)
            } else if key.starts_with("last decided") {
                Some(1)
            } else if key.starts_with("open") || key.starts_with("blocker") {
                Some(2)
            } else {
                None
            };
            continue;
        }
        if trimmed.starts_with('#') || trimmed.starts_with("<!--") {
            continue;
        }
        if let Some(idx) = current {
            if !sections[idx].is_empty() {
                sections[idx].push('\n');
            }
            sections[idx].push_str(line);
        }
    }
    StateCard {
        focus: sections[0].trim().to_string(),
        last_decided: sections[1].trim().to_string(),
        open_blockers: sections[2].trim().to_string(),
        updated_at_ms: 0,
        last_commit: None,
    }
}

fn render_state_card_file(focus: &str, last_decided: &str, open_blockers: &str) -> String {
    let blank = |s: &str| {
        let t = s.trim();
        if t.is_empty() { "—" } else { t }.to_string()
    };
    format!(
        "<!-- Generated/edited via Grok Desktop's Memory panel. \"Last commit\" isn't stored here — it's computed live from git each time this is read. -->\n\
         # Current State\n\n\
         ## Focus\n{}\n\n\
         ## Last decided\n{}\n\n\
         ## Open / Blockers\n{}\n",
        blank(focus),
        blank(last_decided),
        blank(open_blockers),
    )
}

fn load_state_card(cwd: &Path) -> StateCard {
    let path = state_card_path(cwd);
    let mut card = fs::read_to_string(&path)
        .ok()
        .map(|s| parse_state_card(&s))
        .unwrap_or_default();
    card.updated_at_ms = file_modified_ms(&path);
    card.last_commit = last_commit_summary(cwd);
    card
}

#[tauri::command]
pub fn read_state_card(cwd: String) -> Result<StateCard, String> {
    Ok(load_state_card(Path::new(&cwd)))
}

#[tauri::command]
pub fn write_state_card(
    cwd: String,
    focus: String,
    last_decided: String,
    open_blockers: String,
    state: tauri::State<'_, GrokState>,
) -> Result<(), String> {
    let cwd_path = Path::new(&cwd);
    let path = state_card_path(cwd_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, render_state_card_file(&focus, &last_decided, &open_blockers)).map_err(|e| e.to_string())?;

    if state.memory_active {
        regenerate_bridge_project(cwd_path, &anvil_project_dir(cwd_path))?;
    }
    Ok(())
}

// ───────────────────────── grok-native bridge ─────────────────────────

const BRIDGE_BEGIN: &str = "<!-- anvil:memory:begin — generated by Grok Desktop, do not edit directly, edit via the Memory panel -->";
const BRIDGE_END: &str = "<!-- anvil:memory:end -->";

fn render_state_card_bridge_section(card: &StateCard) -> String {
    if !card.has_content() && card.last_commit.is_none() {
        return String::new();
    }
    let mut out = String::new();
    out.push_str("## Current State\n");
    if !card.focus.is_empty() {
        out.push_str(&format!("- **Focus**: {}\n", card.focus.replace('\n', " ")));
    }
    if !card.last_decided.is_empty() {
        out.push_str(&format!("- **Last decided**: {}\n", card.last_decided.replace('\n', " ")));
    }
    if !card.open_blockers.is_empty() {
        out.push_str(&format!("- **Open/Blockers**: {}\n", card.open_blockers.replace('\n', " ")));
    }
    if let Some(commit) = &card.last_commit {
        out.push_str(&format!("- **Last commit**: {commit}\n"));
    }
    out
}

fn render_entries_bridge_section(entries: &[MemoryEntryMeta]) -> String {
    let mut out = String::new();
    let mut current_type = String::new();
    for e in entries {
        if e.r#type != current_type {
            current_type = e.r#type.clone();
            out.push_str(&format!("## Anvil: {}\n", title_case(&current_type)));
        }
        out.push_str(&format!("- **{}**: {}\n", e.name, e.description));
    }
    out
}

fn render_bridge_block(entries: &[MemoryEntryMeta]) -> String {
    let mut out = String::new();
    out.push_str(BRIDGE_BEGIN);
    out.push('\n');
    out.push_str(&render_entries_bridge_section(entries));
    out.push_str(BRIDGE_END);
    out.push('\n');
    out
}

/// Project scope's bridge additionally leads with the state card (diamond 4:
/// it's the first thing grok should read, not one entry among many) — global
/// scope has no state card at all, so it keeps using `render_bridge_block`.
fn render_project_bridge_block(card: &StateCard, entries: &[MemoryEntryMeta]) -> String {
    let mut out = String::new();
    out.push_str(BRIDGE_BEGIN);
    out.push('\n');
    out.push_str(&render_state_card_bridge_section(card));
    out.push_str(&render_entries_bridge_section(entries));
    out.push_str(BRIDGE_END);
    out.push('\n');
    out
}

/// Replaces only the content between the anvil markers, leaving whatever
/// grok's own `/remember`/auto-save logic has written elsewhere in the same
/// file completely untouched. Regenerated wholesale each time (never patched
/// in place), so there's no drift between what's on disk and what's rendered.
fn upsert_bridge_block(grok_memory_file: &Path, block: &str) -> Result<(), String> {
    if let Some(parent) = grok_memory_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = fs::read_to_string(grok_memory_file).unwrap_or_default();
    let new_content = if let (Some(start), Some(end)) = (existing.find(BRIDGE_BEGIN), existing.find(BRIDGE_END)) {
        let end = end + BRIDGE_END.len();
        format!("{}{}{}", &existing[..start], block, &existing[end..])
    } else {
        let mut combined = existing;
        if !combined.is_empty() && !combined.ends_with('\n') {
            combined.push('\n');
        }
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(block);
        combined
    };
    fs::write(grok_memory_file, new_content).map_err(|e| e.to_string())
}

fn regenerate_bridge_project(cwd: &Path, project_base_dir: &Path) -> Result<(), String> {
    let entries = scan_scope(project_base_dir);
    let card = load_state_card(cwd);
    let block = render_project_bridge_block(&card, &entries);
    let target = grok_memory_workspace_file(cwd).ok_or("could not resolve home directory")?;
    upsert_bridge_block(&target, &block)
}

fn regenerate_bridge_global(global_base_dir: &Path) -> Result<(), String> {
    let entries = scan_scope(global_base_dir);
    let block = render_bridge_block(&entries);
    let target = grok_memory_global_file().ok_or("could not resolve home directory")?;
    upsert_bridge_block(&target, &block)
}

// ───────────────────────── commands ─────────────────────────

#[tauri::command]
pub fn list_anvil_entries(cwd: Option<String>) -> Result<Vec<MemoryEntryMeta>, String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut push_scope = |dir: std::path::PathBuf| {
        let key = fs::canonicalize(&dir).unwrap_or(dir);
        if !seen.insert(key.clone()) {
            return;
        }
        out.extend(scan_scope(&key));
    };
    if let Some(cwd) = &cwd {
        push_scope(anvil_project_dir(Path::new(cwd)));
    }
    if let Some(global_dir) = anvil_global_dir() {
        push_scope(global_dir);
    }
    Ok(out)
}

#[tauri::command]
pub fn read_anvil_entry(path: String) -> Result<MemoryEntry, String> {
    let canonical = safe_path_check(Path::new(&path))?;
    let content = fs::read_to_string(&canonical).map_err(|e| e.to_string())?;
    let parsed = parse_entry(&content).ok_or("could not parse entry frontmatter")?;
    let slug = canonical.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    Ok(MemoryEntry {
        meta: MemoryEntryMeta {
            slug,
            r#type: parsed.r#type,
            name: parsed.name,
            description: parsed.description,
            status: parsed.status,
            modified_at_ms: file_modified_ms(&canonical),
            path: canonical.to_string_lossy().to_string(),
        },
        body: parsed.body,
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn write_anvil_entry(
    scope: String,
    r#type: String,
    slug: String,
    name: String,
    description: String,
    status: Option<String>,
    body: String,
    cwd: Option<String>,
    state: tauri::State<'_, GrokState>,
) -> Result<(), String> {
    let safe_slug = {
        let s = slugify(&slug);
        if s.is_empty() { "entry".to_string() } else { s }
    };
    let base_dir = match scope.as_str() {
        "project" => {
            let cwd_str = cwd.as_deref().ok_or("project scope requires cwd")?;
            anvil_project_dir(Path::new(cwd_str))
        }
        "global" => anvil_global_dir().ok_or("could not resolve home directory")?,
        other => return Err(format!("unknown scope: {other}")),
    };

    let type_dir = base_dir.join(&r#type);
    fs::create_dir_all(&type_dir).map_err(|e| e.to_string())?;
    let file_path = type_dir.join(format!("{safe_slug}.md"));
    let rendered = render_entry(&name, &r#type, &description, status.as_deref(), &body);
    fs::write(&file_path, rendered).map_err(|e| e.to_string())?;

    regenerate_index(&base_dir)?;

    if state.memory_active {
        if scope == "project" {
            if let Some(cwd_str) = &cwd {
                regenerate_bridge_project(Path::new(cwd_str), &base_dir)?;
            }
        } else {
            regenerate_bridge_global(&base_dir)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_anvil_entry(
    path: String,
    cwd: Option<String>,
    state: tauri::State<'_, GrokState>,
) -> Result<(), String> {
    let canonical = safe_path_check(Path::new(&path))?;
    let type_dir = canonical.parent().ok_or("invalid path")?.to_path_buf();
    let base_dir = type_dir.parent().ok_or("invalid path")?.to_path_buf();

    fs::remove_file(&canonical).map_err(|e| e.to_string())?;
    regenerate_index(&base_dir)?;

    if state.memory_active {
        let is_global = anvil_global_dir().map(|g| g == base_dir).unwrap_or(false);
        if is_global {
            regenerate_bridge_global(&base_dir)?;
        } else if let Some(cwd_str) = &cwd {
            regenerate_bridge_project(Path::new(cwd_str), &base_dir)?;
        }
    }

    Ok(())
}

// ───────────────────────── operator memory: dream (densify + learn) ─────────────────────────
//
// Three clocks (see docs/OPERATOR_MEMORY.md): compaction (grok, in-session,
// not our concern), flush (grok captures a graded session summary — v1
// promotes it into an episodic entry), dream (cross-session densify + learn
// — this). Copy-on-write throughout: a dream never touches the live
// `.anvil/memory/` store directly. It writes a *candidate* under the
// sibling `.anvil/dream/` directory (deliberately NOT inside
// `.anvil/memory/` — `scan_scope` there treats every subdirectory as a type,
// which would make a `.dream-candidate` folder show up as bogus entries).
// The cockpit shows what a pending candidate would change; a human
// Attaches or Discards. Nothing here auto-attaches.
//
// grok-build's own `/dream` (like `/flush`, see v1) is TUI-only and isn't
// exposed over ACP — it can't be triggered remotely, and it operates on
// grok's OWN `~/.grok/memory/` store, not this curated layer anyway. This
// is Anvil's own synthesis, run as one explicit turn on the current
// session (same mechanism as Capture Now), never presented as if it were
// grok's native `/dream`.

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DreamStateCard {
    focus: Option<String>,
    last_decided: Option<String>,
    open_blockers: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct DreamEpisodic {
    name: String,
    description: String,
    body: String,
    #[serde(default)]
    supersedes: Vec<String>,
}

#[derive(Deserialize, Default)]
pub struct DreamPlaybook {
    name: String,
    description: String,
    body: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct DreamMetaFile {
    generated_at_ms: i64,
    summary: String,
    status: String, // "pending" | "attached" | "discarded"
    superseded_slugs: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamCandidateInfo {
    generated_at_ms: i64,
    summary: String,
    status: String,
    superseded_count: usize,
    entries: Vec<MemoryEntryMeta>,
    has_state_card_update: bool,
    state_card: Option<StateCard>,
}

fn dream_dir(cwd: &Path) -> PathBuf {
    find_repo_root(cwd).join(".anvil").join("dream")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn unique_dream_slug(prefix: &str, index: usize) -> String {
    format!("{prefix}-{}-{}", now_ms(), index)
}

fn write_candidate_entry(dir: &Path, type_name: &str, slug: &str, name: &str, description: &str, body: &str) -> Result<(), String> {
    let type_dir = dir.join(type_name);
    fs::create_dir_all(&type_dir).map_err(|e| e.to_string())?;
    let safe_slug = {
        let s = slugify(slug);
        if s.is_empty() { "entry".to_string() } else { s }
    };
    let path = type_dir.join(format!("{safe_slug}.md"));
    fs::write(&path, render_entry(name, type_name, description, None, body)).map_err(|e| e.to_string())
}

/// Writes a brand-new candidate, replacing whatever pending/attached/
/// discarded one existed before — a fresh dream always supersedes the
/// previous candidate's *proposal*, regardless of what the human did with
/// it (an attached one already copied its useful content into the live
/// store; a discarded one was already rejected).
#[tauri::command]
pub fn write_dream_candidate(
    cwd: String,
    state_card: Option<DreamStateCard>,
    episodics: Vec<DreamEpisodic>,
    playbooks: Vec<DreamPlaybook>,
    summary: String,
) -> Result<(), String> {
    let cwd_path = Path::new(&cwd);
    let dir = dream_dir(cwd_path);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    if let Some(card) = &state_card {
        let rendered = render_state_card_file(
            card.focus.as_deref().unwrap_or(""),
            card.last_decided.as_deref().unwrap_or(""),
            card.open_blockers.as_deref().unwrap_or(""),
        );
        fs::write(dir.join("STATE.md"), rendered).map_err(|e| e.to_string())?;
    }

    let mut superseded_slugs = Vec::new();
    for (i, e) in episodics.iter().enumerate() {
        let slug = unique_dream_slug("dream-episodic", i);
        write_candidate_entry(&dir, "episodic", &slug, &e.name, &e.description, &e.body)?;
        superseded_slugs.extend(e.supersedes.iter().cloned());
    }
    for (i, p) in playbooks.iter().enumerate() {
        let slug = unique_dream_slug("dream-playbook", i);
        write_candidate_entry(&dir, "playbook", &slug, &p.name, &p.description, &p.body)?;
    }

    let meta = DreamMetaFile {
        generated_at_ms: now_ms(),
        summary,
        status: "pending".to_string(),
        superseded_slugs,
    };
    fs::write(dir.join("DREAM_META.json"), serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn read_dream_candidate(cwd: String) -> Result<Option<DreamCandidateInfo>, String> {
    let dir = dream_dir(Path::new(&cwd));
    let Ok(meta_raw) = fs::read_to_string(dir.join("DREAM_META.json")) else {
        return Ok(None);
    };
    let meta: DreamMetaFile = serde_json::from_str(&meta_raw).map_err(|e| e.to_string())?;
    let entries = scan_scope(&dir);
    let state_card = fs::read_to_string(dir.join("STATE.md")).ok().map(|s| {
        let mut card = parse_state_card(&s);
        card.last_commit = None;
        card
    });
    Ok(Some(DreamCandidateInfo {
        generated_at_ms: meta.generated_at_ms,
        summary: meta.summary,
        status: meta.status,
        superseded_count: meta.superseded_slugs.len(),
        has_state_card_update: state_card.is_some(),
        state_card,
        entries,
    }))
}

/// Copies the candidate's entries into the live store, deletes whatever it
/// declared superseded, overwrites STATE.md if a state-card update was
/// proposed, then regenerates the index and bridge exactly like a normal
/// write — this is the *only* place a dream ever touches the live store,
/// and only on explicit human action.
#[tauri::command]
pub fn attach_dream_candidate(cwd: String, state: tauri::State<'_, GrokState>) -> Result<(), String> {
    let cwd_path = Path::new(&cwd);
    let dir = dream_dir(cwd_path);
    let meta_raw = fs::read_to_string(dir.join("DREAM_META.json")).map_err(|_| "no pending dream to attach".to_string())?;
    let mut meta: DreamMetaFile = serde_json::from_str(&meta_raw).map_err(|e| e.to_string())?;
    if meta.status != "pending" {
        return Err(format!("dream is not pending (status: {})", meta.status));
    }

    let live_dir = anvil_project_dir(cwd_path);

    for slug in &meta.superseded_slugs {
        let path = live_dir.join("episodic").join(format!("{slug}.md"));
        let _ = fs::remove_file(path);
    }

    for entry_type in ["episodic", "playbook"] {
        let src_dir = dir.join(entry_type);
        let Ok(read) = fs::read_dir(&src_dir) else { continue };
        let dst_dir = live_dir.join(entry_type);
        fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;
        for f in read.flatten() {
            let src = f.path();
            if src.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Some(name) = src.file_name() {
                fs::copy(&src, dst_dir.join(name)).map_err(|e| e.to_string())?;
            }
        }
    }

    let candidate_state = dir.join("STATE.md");
    if candidate_state.is_file() {
        let content = fs::read_to_string(&candidate_state).map_err(|e| e.to_string())?;
        fs::create_dir_all(&live_dir).map_err(|e| e.to_string())?;
        fs::write(live_dir.join("STATE.md"), content).map_err(|e| e.to_string())?;
    }

    regenerate_index(&live_dir)?;
    if state.memory_active {
        regenerate_bridge_project(cwd_path, &live_dir)?;
    }

    meta.status = "attached".to_string();
    fs::write(dir.join("DREAM_META.json"), serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn discard_dream_candidate(cwd: String) -> Result<(), String> {
    let dir = dream_dir(Path::new(&cwd));
    if let Ok(meta_raw) = fs::read_to_string(dir.join("DREAM_META.json")) {
        if let Ok(mut meta) = serde_json::from_str::<DreamMetaFile>(&meta_raw) {
            meta.status = "discarded".to_string();
            if let Ok(rendered) = serde_json::to_string_pretty(&meta) {
                let _ = fs::write(dir.join("DREAM_META.json"), rendered);
            }
        }
    }
    Ok(())
}
