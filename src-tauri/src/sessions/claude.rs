use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use super::{modified_millis, owner_words, title_of, Origin, PastSession};
use crate::engine::Engine;

// Claude Code keeps one JSON-lines file per session under ~/.claude/projects/<folder>/, the folder
// named after the project's path with every non-alphanumeric character turned into "-".

pub fn project_dir(folder: &str) -> String {
    folder.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

#[derive(Default, Debug, PartialEq)]
pub struct Summary {
    pub custom_title: Option<String>,
    pub first_prompt: Option<String>,
    pub entrypoint: Option<String>,
    pub messages: u32,
}

fn user_text(entry: &Value) -> Option<String> {
    match &entry["message"]["content"] {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks) => blocks.iter().find(|b| b["type"] == "text").and_then(|b| b["text"].as_str()).map(str::to_string),
        _ => None,
    }
}

// Tool results come back as "user" entries too; only what a person typed has plain text.
fn is_typed(text: &str) -> bool {
    let text = text.trim_start();
    !text.is_empty() && !text.starts_with('<')
}

// Claude Code writes every thinking block, tool call and tool result as its own entry, so an
// assistant entry is a reply only when it carries text.
fn replied(entry: &Value) -> bool {
    entry["message"]["content"].as_array().is_some_and(|blocks| blocks.iter().any(|b| b["type"] == "text" && b["text"].as_str().is_some_and(|t| !t.trim().is_empty())))
}

// What counts as a message is what the owner typed and what the assistant said back, not the tool
// traffic between them.
pub fn summarize(reader: impl BufRead) -> Summary {
    let mut summary = Summary::default();
    for line in reader.lines().map_while(Result::ok) {
        let Ok(entry) = serde_json::from_str::<Value>(&line) else { continue };
        match entry["type"].as_str() {
            Some("custom-title") => summary.custom_title = entry["customTitle"].as_str().map(str::to_string),
            Some(kind @ ("user" | "assistant")) => {
                summary.entrypoint = summary.entrypoint.or_else(|| entry["entrypoint"].as_str().map(str::to_string));
                if kind == "assistant" {
                    summary.messages += u32::from(replied(&entry));
                } else if let Some(text) = user_text(&entry).filter(|text| is_typed(text)) {
                    summary.messages += 1;
                    summary.first_prompt.get_or_insert(text);
                }
            }
            _ => {}
        }
    }
    summary
}

fn session(id: &str, summary: Summary, updated_at: u64) -> PastSession {
    let (words, by_dhrive) = owner_words(summary.first_prompt.as_deref().unwrap_or_default());
    let origin = match summary.entrypoint.as_deref() {
        _ if by_dhrive => Origin::Dhrive,
        Some(entry) if entry == super::TERMINALS_CLAUDE.1 => Origin::Dhrive,
        Some("claude-desktop") => Origin::App,
        Some("cli") => Origin::Terminal,
        _ => Origin::Other,
    };
    let title = summary.custom_title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| title_of(&words));
    PastSession { engine: Engine::ClaudeCode, id: id.into(), title, updated_at, origin, messages: summary.messages }
}

pub fn list(claude_home: &Path, folder: &str) -> Vec<PastSession> {
    let Ok(entries) = std::fs::read_dir(claude_home.join("projects").join(project_dir(folder))) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|path| {
            let id = path.file_stem()?.to_str()?.to_string();
            let summary = summarize(BufReader::new(std::fs::File::open(&path).ok()?));
            (summary.messages > 0).then(|| session(&id, summary, modified_millis(&path)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP_SESSION: &str = concat!(
        r#"{"type":"queue-operation","operation":"enqueue","content":"ignored"}"#, "\n",
        r#"{"type":"user","entrypoint":"claude-desktop","message":{"role":"user","content":"modo tdah, onde paramos?"}}"#, "\n",
        r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Paramos no deploy."}]}}"#, "\n",
        r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}"#, "\n",
        "not json\n",
        r#"{"type":"custom-title","customTitle":"Modo TDAH no Mac"}"#, "\n",
    );

    #[test]
    fn folders_map_to_claude_codes_project_directory_names() {
        assert_eq!(project_dir("/Users/ana/Documents/GitHub/dhrive-app"), "-Users-ana-Documents-GitHub-dhrive-app");
        assert_eq!(project_dir("/private/tmp/x_y.z"), "-private-tmp-x-y-z");
    }

    #[test]
    fn a_session_is_named_by_its_title_and_counts_only_typed_messages_and_replies() {
        let summary = summarize(APP_SESSION.as_bytes());
        assert_eq!(summary.messages, 2);
        let listed = session("3d6f467d", summary, 7);
        assert_eq!((listed.title.as_str(), listed.origin, listed.updated_at), ("Modo TDAH no Mac", Origin::App, 7));
    }

    #[test]
    fn thinking_tool_calls_and_tool_results_are_not_messages() {
        let traffic = concat!(
            r#"{"type":"user","message":{"content":"fix login"}}"#, "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hm"}]}}"#, "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}"#, "\n",
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#, "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Fixed."}]}}"#, "\n",
        );
        assert_eq!(summarize(traffic.as_bytes()).messages, 2);
    }

    #[test]
    fn untitled_sessions_use_the_first_typed_prompt_and_dhrive_runs_are_marked() {
        let run = r#"{"type":"user","entrypoint":"sdk-cli","message":{"content":"You are the planner for this project. Read.\n\nTask:\nadd rate limiting"}}"#;
        let listed = session("a1", summarize(run.as_bytes()), 1);
        assert_eq!((listed.title.as_str(), listed.origin), ("add rate limiting", Origin::Dhrive));
        let pane = r#"{"type":"user","entrypoint":"dhrive-terminals","message":{"content":"fix the login"}}"#;
        assert_eq!(session("a2", summarize(pane.as_bytes()), 1).origin, Origin::Dhrive);
        let caveat = r#"{"type":"user","message":{"content":"<local-command-caveat>x</local-command-caveat>"}}"#;
        assert_eq!(summarize(caveat.as_bytes()).first_prompt, None);
    }

    #[test]
    fn lists_only_the_sessions_recorded_for_that_folder() {
        let home = std::env::temp_dir().join(format!("dhrive-claude-{}", std::process::id()));
        let dir = home.join("projects").join(project_dir("/work/app"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("3d6f467d-0000-0000-0000-000000000000.jsonl"), APP_SESSION).unwrap();
        std::fs::write(dir.join("empty.jsonl"), "{}\n").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();

        let listed = list(&home, "/work/app");
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "3d6f467d-0000-0000-0000-000000000000");
        assert!(list(&home, "/work/other").is_empty());
    }
}
