mod claude;
mod codex;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::engine::Engine;

// The conversations the owner already had with each CLI in a project's folder, read from the
// CLIs' own records, so a project can pick up where the owner left off in the Claude app, the
// terminal, or Codex. These records are the CLIs' internal formats: everything is parsed
// leniently, a line or file that doesn't parse is skipped, and nothing is ever written back.

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    App,
    Terminal,
    Dhrive,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastSession {
    engine: Engine,
    id: String,
    title: String,
    // Last write to the CLI's record, in milliseconds since the epoch.
    updated_at: u64,
    origin: Origin,
    messages: u32,
}

const MAX_SESSIONS: usize = 30;
const MAX_FOLDERS: usize = 200;
const MAX_TITLE: usize = 80;
// dhrive's own runs open with one of its briefs (prompts.rs); the owner's words follow a label.
const BRIEFS: &[&str] = &[
    "You are the planner for this project.",
    "You are the implementer for this project.",
    "You are talking with the owner of this project",
    "You are the maestro for this project.",
    "You are joining this company to help run it.",
    "You run this company day to day.",
    "You are founding a new company with the owner.",
    "You speak for this company to its owner.",
];

// What a Terminals pane tells its CLI it was started from, so the CLI records it and the pane's
// sessions stay with the pane instead of turning into conversations. Claude Code keeps it as the
// session's entrypoint, Codex as its originator.
// ponytail: Codex reads an internal variable for this; if it stops, panes' sessions show up in the
// list again, where the owner can hide them.
pub(crate) const TERMINALS_CLAUDE: (&str, &str) = ("CLAUDE_CODE_ENTRYPOINT", "dhrive-terminals");
pub(crate) const TERMINALS_CODEX: (&str, &str) = ("CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "dhrive_terminals");

// What the owner actually asked: dhrive's prompts carry the brief first, then "Task:" or "Message:".
fn owner_words(text: &str) -> (String, bool) {
    if !BRIEFS.iter().any(|brief| text.starts_with(brief)) {
        return (text.to_string(), false);
    }
    let after = ["\n\nTask:\n", "\n\nMessage:\n", "\n\nThe owner adds:\n", "\n\nThe owner says:\n"].iter().find_map(|label| text.split_once(label).map(|(_, rest)| rest)).unwrap_or(text);
    let task = after.split("\n\nPlan to follow:\n").next().unwrap_or(after);
    (task.to_string(), true)
}

pub(crate) fn title_of(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    match line.char_indices().nth(MAX_TITLE) {
        Some((cut, _)) => format!("{}…", line[..cut].trim_end()),
        None => line.to_string(),
    }
}

fn modified_millis(path: &Path) -> u64 {
    std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn claude_home() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| home().map(|h| h.join(".claude")))
}

fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).or_else(|| home().map(|h| h.join(".codex")))
}

// The rollout Codex keeps for a thread, found by the id that ends its name.
pub(crate) fn codex_rollout(thread: &str) -> Option<PathBuf> {
    let suffix = format!("-{thread}.jsonl");
    codex::rollout_files(&codex_home()?).into_iter().find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(&suffix)))
}

// dhrive's own runs are left out: each is already one of dhrive's conversations. Only ids a CLI
// would accept as a --resume argument get through.
fn newest_first(mut sessions: Vec<PastSession>) -> Vec<PastSession> {
    sessions.retain(|s| s.origin != Origin::Dhrive && crate::flow::valid_session(&s.id) && !s.title.is_empty());
    sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    sessions.truncate(MAX_SESSIONS);
    sessions
}

// The CLIs record the folder they ran in fully resolved (/private/tmp, not /tmp), so each folder is
// matched in that form and answered under the path it was asked with.
fn by_folder(folders: Vec<String>) -> HashMap<String, Vec<PastSession>> {
    let resolved: Vec<(String, String)> = folders
        .into_iter()
        .filter_map(|asked| Some((Path::new(&asked).canonicalize().ok()?.to_string_lossy().into_owned(), asked)))
        .collect();
    let mut found: HashMap<String, Vec<PastSession>> = HashMap::new();
    for (folder, _) in &resolved {
        found.insert(folder.clone(), claude_home().map(|h| claude::list(&h, folder)).unwrap_or_default());
    }
    let wanted: Vec<String> = resolved.iter().map(|(folder, _)| folder.clone()).collect();
    for (folder, session) in codex_home().map(|h| codex::list(&h, &wanted)).unwrap_or_default() {
        found.entry(folder).or_default().push(session);
    }
    resolved.into_iter().map(|(folder, asked)| (asked, newest_first(found.remove(&folder).unwrap_or_default()))).collect()
}

// The name a CLI session has in its own records, for one of these ids in that folder.
pub(crate) fn title_in(folder: &str, ids: &[String]) -> Option<String> {
    by_folder(vec![folder.to_string()]).remove(folder)?.into_iter().find(|s| ids.contains(&s.id)).map(|s| s.title)
}

#[tauri::command]
pub async fn list_sessions(folders: Vec<String>) -> Result<HashMap<String, Vec<PastSession>>, String> {
    if folders.len() > MAX_FOLDERS {
        return Err(format!("dhrive reads the sessions of up to {MAX_FOLDERS} projects at a time."));
    }
    tauri::async_runtime::spawn_blocking(move || by_folder(folders))
        .await
        .map_err(|error| format!("Couldn't read the CLIs' sessions: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dhrive_runs_are_named_after_the_owners_request() {
        for step in [crate::flow::Step::Plan, crate::flow::Step::Code, crate::flow::Step::Chat, crate::flow::Step::Split, crate::flow::Step::Company, crate::flow::Step::Day, crate::flow::Step::Found] {
            assert_eq!(owner_words(&crate::prompts::prompt_for(step, "add dark mode", None)), ("add dark mode".to_string(), true), "{step:?}");
        }
        let prompt = "You are the planner for this project. Read the code.\n\nTask:\nadd dark mode\n\nPlan to follow:\n1. x";
        assert_eq!(owner_words(prompt), ("add dark mode".to_string(), true));
        let chat = "You are talking with the owner of this project, who is thinking.\n\nMessage:\nshould we cache?";
        assert_eq!(owner_words(chat).0, "should we cache?");
        assert_eq!(owner_words("modo tdah, onde paramos?"), ("modo tdah, onde paramos?".to_string(), false));
    }

    #[test]
    fn titles_are_the_first_line_cut_to_a_readable_length() {
        assert_eq!(title_of("\n  fix login  \nmore"), "fix login");
        let long = "a".repeat(100);
        assert_eq!(title_of(&long).chars().count(), MAX_TITLE + 1);
        assert!(title_of(&"ç".repeat(90)).ends_with('…'));
    }

    #[test]
    #[ignore = "reads the Claude Code and Codex records on this Mac"]
    fn lists_the_real_sessions_of_a_folder() {
        let folder = std::env::var("DHRIVE_SESSIONS_FOLDER").unwrap_or_else(|_| std::env::current_dir().unwrap().to_string_lossy().into_owned());
        let listed = tauri::async_runtime::block_on(list_sessions(vec![folder.clone()])).unwrap();
        for s in &listed[&folder] {
            eprintln!("{:?} {:?} {} msgs  {}  {}", s.engine, s.origin, s.messages, s.id, s.title);
        }
    }

    #[test]
    fn listing_keeps_resumable_ids_newest_first_and_leaves_dhrives_own_runs_out() {
        let at = |id: &str, updated_at: u64| PastSession { engine: Engine::ClaudeCode, id: id.into(), title: "t".into(), updated_at, origin: Origin::App, messages: 1 };
        let ours = PastSession { origin: Origin::Dhrive, ..at("ours", 7) };
        let listed = newest_first(vec![at("old", 1), at("--bad", 9), at("new", 5), ours]);
        assert_eq!(listed.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["new", "old"]);
    }
}
