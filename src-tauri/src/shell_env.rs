use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

// A macOS app launched from Finder/Dock inherits a minimal PATH (/usr/bin:/bin:…), not the
// user's shell PATH — so Homebrew/npm tools (claude, codex, gemini, supabase) can't be found,
// even though they work from a terminal. Recover the real PATH at startup from two sources and
// merge them into the process environment so every child Command can locate the tools:
//   1. the login shell's PATH (authoritative — has the user's active toolchain ordering),
//   2. well-known toolchain bin directories that exist (a backstop for when an exotic or broken
//      shell config returns nothing useful — the failure mode that silently hides every agent).
const MARKER: &str = "__DHRIVE_PATH__";

pub fn hydrate_path() {
    let shell_path = login_shell_path().unwrap_or_default();
    let backstop = well_known_dirs();
    let current = std::env::var("PATH").unwrap_or_default();
    let merged = merge(&[&shell_path, &backstop, &current]);
    if !merged.is_empty() {
        std::env::set_var("PATH", merged);
    }
}

fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    // -l sources login files (.zprofile, where Homebrew lives); -i sources .zshrc (where
    // nvm/npm shims often live). The marker lets us extract PATH even past prompts/MOTD.
    let script = format!("printf '{MARKER}%s{MARKER}' \"$PATH\"");
    let output = Command::new(shell).args(["-lic", &script]).output().ok()?;
    extract(&String::from_utf8_lossy(&output.stdout))
}

fn extract(stdout: &str) -> Option<String> {
    let start = stdout.find(MARKER)? + MARKER.len();
    let end = stdout[start..].find(MARKER)? + start;
    let path = &stdout[start..end];
    (!path.trim().is_empty()).then(|| path.to_string())
}

// Standard locations where user-level CLIs install, probed the way tools like open-design do.
// Only directories that actually exist are returned, newest Node version first, so a shell that
// told us nothing still resolves the agents (and the node a node-based CLI's shebang needs).
fn well_known_dirs() -> String {
    candidate_dirs(std::env::var("HOME").ok().as_deref())
        .into_iter()
        .filter(|dir| dir.is_dir())
        .filter_map(|dir| dir.to_str().map(str::to_string))
        .collect::<Vec<_>>()
        .join(":")
}

fn candidate_dirs(home: Option<&str>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let home = home.filter(|h| !h.is_empty()).map(Path::new);
    // ~/.local/bin first — where the modern native claude installs, and the front of the user's
    // real PATH — so the backstop reaches the same binary the shell would have.
    if let Some(home) = home {
        dirs.push(home.join(".local/bin"));
    }
    dirs.extend(["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"].iter().map(PathBuf::from));
    if let Some(home) = home {
        for rel in [".cargo/bin", ".bun/bin", ".deno/bin", "Library/pnpm", ".npm-global/bin"] {
            dirs.push(home.join(rel));
        }
        dirs.extend(nvm_bins(home));
    }
    dirs
}

fn nvm_bins(home: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) else {
        return Vec::new();
    };
    let mut versions: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    versions.sort_by_key(|dir| std::cmp::Reverse(version_key(dir)));
    versions.into_iter().map(|dir| dir.join("bin")).collect()
}

// "v24.15.0" → [24, 15, 0] so versions sort numerically (v9 < v24), not lexically.
fn version_key(dir: &Path) -> Vec<u64> {
    dir.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim_start_matches('v').split('.').filter_map(|p| p.parse().ok()).collect())
        .unwrap_or_default()
}

// Earlier sources win, so /opt/homebrew/bin precedes /usr/bin; nothing already present is
// dropped, and duplicates collapse.
fn merge(sources: &[&str]) -> String {
    let mut seen = HashSet::new();
    sources
        .iter()
        .flat_map(|source| source.split(':'))
        .filter(|dir| !dir.is_empty() && seen.insert(dir.to_string()))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pulls_path_from_between_markers() {
        let out = "zsh noise\n__DHRIVE_PATH__/opt/homebrew/bin:/usr/bin__DHRIVE_PATH__more";
        assert_eq!(extract(out), Some("/opt/homebrew/bin:/usr/bin".to_string()));
    }

    #[test]
    fn extract_rejects_missing_or_empty() {
        assert_eq!(extract("nothing here"), None);
        assert_eq!(extract("__DHRIVE_PATH____DHRIVE_PATH__"), None);
    }

    #[test]
    fn merge_prefers_earlier_keeps_later_and_dedupes() {
        let merged = merge(&["/opt/homebrew/bin:/usr/bin", "", "/usr/bin:/bin"]);
        assert_eq!(merged, "/opt/homebrew/bin:/usr/bin:/bin");
    }

    #[test]
    fn merge_lets_the_backstop_supply_dirs_a_broken_shell_omitted() {
        // Shell returned nothing (first source empty); backstop + current still build a PATH.
        let merged = merge(&["", "/opt/homebrew/bin:/Users/x/.local/bin", "/usr/bin:/bin"]);
        assert_eq!(merged, "/opt/homebrew/bin:/Users/x/.local/bin:/usr/bin:/bin");
    }

    #[test]
    fn candidates_include_homebrew_and_user_toolchains() {
        let dirs = candidate_dirs(Some("/Users/x"));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/Users/x/.local/bin")));
        assert!(dirs.contains(&PathBuf::from("/Users/x/.cargo/bin")));
    }

    #[test]
    fn candidates_without_home_are_system_only() {
        let dirs = candidate_dirs(None);
        assert!(dirs.iter().all(|d| d.starts_with("/opt") || d.starts_with("/usr")));
    }

    #[test]
    fn version_key_sorts_numerically_not_lexically() {
        assert!(version_key(Path::new("/x/v24.15.0")) > version_key(Path::new("/x/v9.9.9")));
        assert!(version_key(Path::new("/x/v20.0.0")) > version_key(Path::new("/x/v18.20.3")));
    }
}
