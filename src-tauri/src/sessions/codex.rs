use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{modified_millis, owner_words, title_of, Origin, PastSession};
use crate::engine::Engine;

// Codex keeps each session as ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl. The first line
// is the session's metadata (id, folder, which Codex made it); session_index.jsonl holds the names
// the Codex apps gave their threads.

const MAX_FILES: usize = 400;
const MAX_LINES: usize = 200;

// Injected context Codex sends as "user" messages before the owner's first real one.
fn is_injected(text: &str) -> bool {
    let text = text.trim_start();
    text.starts_with("# AGENTS.md") || text.starts_with('<')
}

pub struct Rollout {
    pub id: String,
    pub cwd: String,
    pub originator: String,
    pub first_prompt: Option<String>,
    pub messages: u32,
}

fn message_text(item: &Value) -> Option<&str> {
    item["content"].as_array()?.iter().find_map(|block| block["text"].as_str())
}

pub fn read_rollout(reader: impl BufRead) -> Option<Rollout> {
    let mut lines = reader.lines().map_while(Result::ok);
    let meta: Value = serde_json::from_str(&lines.next()?).ok()?;
    let payload = &meta["payload"];
    (meta["type"] == "session_meta").then_some(())?;
    let mut rollout = Rollout {
        id: payload["id"].as_str()?.to_string(),
        cwd: payload["cwd"].as_str()?.to_string(),
        originator: payload["originator"].as_str().unwrap_or_default().to_string(),
        first_prompt: None,
        messages: 0,
    };
    for line in lines.take(MAX_LINES) {
        let Ok(entry) = serde_json::from_str::<Value>(&line) else { continue };
        let item = &entry["payload"];
        if entry["type"] != "response_item" || item["type"] != "message" || item["role"] == "developer" {
            continue;
        }
        if item["role"] == "user" && message_text(item).is_none_or(is_injected) {
            continue;
        }
        rollout.messages += 1;
        if item["role"] == "user" && rollout.first_prompt.is_none() {
            rollout.first_prompt = message_text(item).map(str::to_string);
        }
    }
    Some(rollout)
}

fn thread_names(codex_home: &Path) -> HashMap<String, String> {
    let Ok(index) = std::fs::read_to_string(codex_home.join("session_index.jsonl")) else {
        return HashMap::new();
    };
    index
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|entry| Some((entry["id"].as_str()?.to_string(), entry["thread_name"].as_str()?.to_string())))
        .collect()
}

// Newest first by path, which sorts by date because of the YYYY/MM/DD folders and the time in the name.
pub(super) fn rollout_files(codex_home: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut folders = vec![codex_home.join("sessions")];
    while let Some(folder) = folders.pop() {
        for entry in std::fs::read_dir(&folder).into_iter().flatten().filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                folders.push(path);
            } else if path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl")) {
                files.push(path);
            }
        }
    }
    files.sort_by(|a, b| b.cmp(a));
    files.truncate(MAX_FILES);
    files
}

fn session(rollout: Rollout, names: &HashMap<String, String>, updated_at: u64) -> PastSession {
    let (words, by_dhrive) = owner_words(rollout.first_prompt.as_deref().unwrap_or_default());
    let origin = match rollout.originator.as_str() {
        _ if by_dhrive => Origin::Dhrive,
        origin if origin == super::TERMINALS_CODEX.1 => Origin::Dhrive,
        "Codex Desktop" | "codex_work_desktop" | "codex_vscode" => Origin::App,
        "codex_cli_rs" => Origin::Terminal,
        _ => Origin::Other,
    };
    let title = names.get(&rollout.id).filter(|n| !n.trim().is_empty()).cloned().unwrap_or_else(|| title_of(&words));
    PastSession { engine: Engine::Codex, id: rollout.id, title, updated_at, origin, messages: rollout.messages }
}

// Every folder's sessions from one pass over the rollouts, paired with the folder each ran in.
pub fn list(codex_home: &Path, folders: &[String]) -> Vec<(String, PastSession)> {
    let names = thread_names(codex_home);
    rollout_files(codex_home)
        .into_iter()
        .filter_map(|path| {
            let rollout = read_rollout(BufReader::new(std::fs::File::open(&path).ok()?))?;
            (folders.contains(&rollout.cwd) && rollout.messages > 0).then(|| (rollout.cwd.clone(), session(rollout, &names, modified_millis(&path))))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROLLOUT: &str = concat!(
        r#"{"type":"session_meta","payload":{"id":"01a0edfd-0000-7000-8000-000000000001","cwd":"/work/app","originator":"Codex Desktop"}}"#, "\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"rules"}]}}"#, "\n",
        r##"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions"}]}}"##, "\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"migrate the checkout"}]}}"#, "\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done."}]}}"#, "\n",
    );

    #[test]
    fn reads_the_folder_origin_and_first_real_prompt() {
        let rollout = read_rollout(ROLLOUT.as_bytes()).unwrap();
        assert_eq!((rollout.cwd.as_str(), rollout.messages), ("/work/app", 2));
        assert_eq!(rollout.first_prompt.as_deref(), Some("migrate the checkout"));
        assert!(read_rollout("{\"type\":\"other\"}".as_bytes()).is_none());
    }

    #[test]
    fn a_thread_name_from_the_codex_app_wins_over_the_prompt() {
        let rollout = read_rollout(ROLLOUT.as_bytes()).unwrap();
        let names = HashMap::from([(rollout.id.clone(), "Checkout migration".to_string())]);
        let listed = session(rollout, &names, 3);
        assert_eq!((listed.title.as_str(), listed.origin), ("Checkout migration", Origin::App));
    }

    #[test]
    fn a_terminals_pane_thread_is_dhrive_s_own() {
        let pane = ROLLOUT.replace("Codex Desktop", super::super::TERMINALS_CODEX.1);
        assert_eq!(session(read_rollout(pane.as_bytes()).unwrap(), &HashMap::new(), 3).origin, Origin::Dhrive);
    }

    #[test]
    fn lists_only_sessions_whose_folder_matches() {
        let home = std::env::temp_dir().join(format!("dhrive-codex-{}", std::process::id()));
        let day = home.join("sessions/2026/09/29");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(day.join("rollout-2026-09-29T10-00-00-01a0edfd.jsonl"), ROLLOUT).unwrap();
        std::fs::write(day.join("rollout-2026-09-29T11-00-00-other.jsonl"), ROLLOUT.replace("/work/app", "/elsewhere")).unwrap();

        let listed = list(&home, &["/work/app".to_string()]);
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!((listed[0].0.as_str(), listed[0].1.title.as_str()), ("/work/app", "migrate the checkout"));
    }
}
