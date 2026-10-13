use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::engine::Engine;

// The CLIs update themselves. dhrive notes each version it sees, and when one changes it checks that
// every flag dhrive drives it with is still there, so a renamed flag shows up as a marker next to
// the CLI instead of every run failing with a cryptic error.

const CLAUDE_FLAGS: &[&str] = &["--print", "--output-format", "--input-format", "--verbose", "--permission-mode", "--allowedTools", "--disallowedTools", "--permission-prompt-tool", "--append-system-prompt", "--model", "--resume", "--strict-mcp-config"];
const CODEX_EXEC_FLAGS: &[&str] = &["--json", "--sandbox", "--skip-git-repo-check", "--model", "--oss", "--local-provider", "--config"];
const CODEX_RESUME_FLAGS: &[&str] = &["--json", "--skip-git-repo-check", "--model", "--config"];
const AGY_FLAGS: &[&str] = &["--print", "--output-format", "--mode", "--model", "--conversation", "--prompt-interactive"];
// What a Terminals pane the maestro opened starts Codex with (pane_launch.rs).
const CODEX_PANE_FLAGS: &[&str] = &["--model", "--sandbox", "--ask-for-approval"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cli {
    engine: Engine,
    label: &'static str,
    installed: bool,
    docs_url: &'static str,
    version: Option<String>,
    // The version it had before, when it changed since dhrive last looked.
    updated_from: Option<String>,
    // Flags dhrive relies on that this version no longer lists.
    missing: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Seen {
    version: String,
    missing: Vec<String>,
}

fn output_text(program: &Path, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .output()
        .map(|out| format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
        .unwrap_or_default()
}

// "2.1.284 (Claude Code)", "codex-cli 0.158.0-alpha.2.1", "ollama version is 0.34.4" → the version.
fn parse_version(text: &str) -> Option<String> {
    text.split_whitespace().find(|word| word.starts_with(|c: char| c.is_ascii_digit()) && word.contains('.')).map(str::to_string)
}

// Ollama's row reports Ollama's own version; the Codex it runs through has its own row.
pub fn version(engine: Engine) -> Option<String> {
    let program = match engine {
        Engine::Ollama => crate::local::ollama::binary()?,
        _ => engine.locate()?,
    };
    parse_version(&output_text(&program, &["--version"]))
}

fn missing(help: &str, flags: &[&str]) -> Vec<String> {
    let words: Vec<&str> = help.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')).collect();
    flags.iter().filter(|flag| !words.contains(flag)).map(|flag| flag.to_string()).collect()
}

fn missing_flags(engine: Engine) -> Vec<String> {
    let Some(program) = engine.locate() else {
        return Vec::new();
    };
    match engine {
        Engine::ClaudeCode => missing(&output_text(&program, &["--help"]), CLAUDE_FLAGS),
        Engine::Codex => {
            let mut gone = missing(&output_text(&program, &["exec", "--help"]), CODEX_EXEC_FLAGS);
            let pane = missing(&output_text(&program, &["--help"]), CODEX_PANE_FLAGS);
            for flag in missing(&output_text(&program, &["exec", "resume", "--help"]), CODEX_RESUME_FLAGS).into_iter().chain(pane) {
                if !gone.contains(&flag) {
                    gone.push(flag);
                }
            }
            gone
        }
        Engine::Antigravity => missing(&output_text(&program, &["--help"]), AGY_FLAGS),
        Engine::Ollama => Vec::new(),
    }
}

// What this version means next to the last one seen: the record to keep, and the old version when
// it changed. The flag check only runs for a version dhrive hasn't checked yet.
fn compare(previous: Option<&Seen>, version: &str, check_flags: impl FnOnce() -> Vec<String>) -> (Seen, Option<String>) {
    match previous {
        Some(seen) if seen.version == version => (seen.clone(), None),
        _ => (Seen { version: version.into(), missing: check_flags() }, previous.map(|seen| seen.version.clone())),
    }
}

fn seen_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("clis.json"))
}

fn read_seen(path: Option<&Path>) -> HashMap<Engine, Seen> {
    path.and_then(|path| std::fs::read_to_string(path).ok()).and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
}

// An update seen earlier in this session stays marked until dhrive restarts, even though the record
// on disk already holds the new version.
fn updates() -> &'static Mutex<HashMap<Engine, String>> {
    static UPDATES: OnceLock<Mutex<HashMap<Engine, String>>> = OnceLock::new();
    UPDATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn check(engine: Engine, seen: &mut HashMap<Engine, Seen>) -> Cli {
    let installed = engine.installed();
    let version = if installed { version(engine) } else { None };
    let mut missing = Vec::new();
    if let Some(version) = &version {
        let (record, from) = compare(seen.get(&engine), version, || missing_flags(engine));
        if let (Some(from), Ok(mut updates)) = (from, updates().lock()) {
            updates.insert(engine, from);
        }
        missing = record.missing.clone();
        seen.insert(engine, record);
    }
    let updated_from = updates().lock().ok().and_then(|updates| updates.get(&engine).cloned());
    Cli { engine, label: engine.label(), installed, docs_url: engine.docs_url(), version, updated_from, missing }
}

fn check_all(path: Option<PathBuf>) -> Vec<Cli> {
    let mut seen = read_seen(path.as_deref());
    let clis = Engine::ALL.into_iter().map(|engine| check(engine, &mut seen)).collect();
    if let (Some(path), Ok(json)) = (path, serde_json::to_string_pretty(&seen)) {
        let _ = crate::projects::write_atomic(&path, &json);
    }
    clis
}

// Every supported CLI, installed or not, so the UI can point at the setup docs for a missing one.
#[tauri::command]
pub async fn list_clis(app: tauri::AppHandle) -> Vec<Cli> {
    let path = seen_path(&app);
    tauri::async_runtime::spawn_blocking(move || check_all(path)).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_version_out_of_each_cli() {
        assert_eq!(parse_version("2.1.284 (Claude Code)\n").as_deref(), Some("2.1.284"));
        assert_eq!(parse_version("codex-cli 0.158.0-alpha.2.1").as_deref(), Some("0.158.0-alpha.2.1"));
        assert_eq!(parse_version("Warning: could not connect\nollama version is 0.34.4").as_deref(), Some("0.34.4"));
        assert_eq!(parse_version("1.2.17\n").as_deref(), Some("1.2.17"));
        assert_eq!(parse_version("command not found"), None);
    }

    #[test]
    fn a_flag_counts_only_as_a_whole_word() {
        let help = "  -p, --print   Print\n  --allowedTools, --allowed-tools <tools...>\n  --model-provider";
        assert!(missing(help, &["--print", "--allowedTools"]).is_empty());
        assert_eq!(missing(help, &["--model"]), ["--model"]);
    }

    #[test]
    fn flags_are_checked_once_per_new_version() {
        let old = Seen { version: "2.1.284".into(), missing: Vec::new() };
        let (same, from) = compare(Some(&old), "2.1.284", || panic!("already checked"));
        assert_eq!((same, from), (old.clone(), None));

        let (updated, from) = compare(Some(&old), "2.2.0", || vec!["--resume".into()]);
        assert_eq!(from.as_deref(), Some("2.1.284"));
        assert_eq!(updated.missing, ["--resume"]);

        let (first, from) = compare(None, "0.34.4", Vec::new);
        assert_eq!((first.version.as_str(), from), ("0.34.4", None));
    }

    #[test]
    fn the_installed_clis_still_have_every_flag_dhrive_uses() {
        for engine in [Engine::ClaudeCode, Engine::Codex, Engine::Antigravity].into_iter().filter(|e| e.locate().is_some()) {
            assert!(missing_flags(engine).is_empty(), "{engine:?}: {:?}", missing_flags(engine));
        }
    }
}
