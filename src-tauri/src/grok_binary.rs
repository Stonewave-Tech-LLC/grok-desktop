//! Locates the `grok` CLI binary on the user's machine.

use std::env;
use std::path::PathBuf;

#[cfg(windows)]
const BIN_NAME: &str = "grok.exe";
#[cfg(not(windows))]
const BIN_NAME: &str = "grok";

/// Resolve the `grok` binary: search `PATH` first (respects the user's own
/// install/update), then fall back to the well-known `~/.grok/bin/` install
/// location the official installers (`install.sh` on Unix, `install.ps1` on
/// Windows) use.
///
/// Walks `PATH` manually rather than shelling out to `which`/`where` — `which`
/// doesn't exist on Windows (Windows has `where` instead), and `env::split_paths`
/// already handles the `:` vs `;` separator difference for us.
pub fn resolve() -> Option<String> {
    if let Some(path) = find_on_path() {
        return Some(path.to_string_lossy().to_string());
    }

    let fallback: PathBuf = dirs::home_dir()?.join(".grok").join("bin").join(BIN_NAME);
    if fallback.exists() {
        return Some(fallback.to_string_lossy().to_string());
    }

    None
}

fn find_on_path() -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    env::split_paths(&path_var).find_map(|dir| {
        let candidate = dir.join(BIN_NAME);
        candidate.is_file().then_some(candidate)
    })
}
