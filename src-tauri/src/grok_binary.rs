//! Locates the `grok` CLI binary on the user's machine.

use std::path::PathBuf;
use std::process::Command;

/// Resolve the `grok` binary: prefer whatever `PATH` resolves (respects the user's
/// own install/update), fall back to the well-known `~/.grok/bin/grok` install
/// location the official installer uses.
pub fn resolve() -> Option<String> {
    if let Ok(output) = Command::new("which").arg("grok").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    let fallback: PathBuf = dirs::home_dir()?.join(".grok/bin/grok");
    if fallback.exists() {
        return Some(fallback.to_string_lossy().to_string());
    }

    None
}
