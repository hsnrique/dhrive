use std::path::Path;

use serde_json::{json, Value};

use super::Engine;

// What a CLI's stream says while a run is still going, which dhrive passes on at once rather than
// when the run returns: the conversation it writes to, and each file edit Claude makes, so the owner
// watches the code change as it happens.

// The conversation the run writes to. Every Claude event carries it (the first ones are the
// owner's hooks, before init), Codex names it in `thread.started`, Antigravity in `init`. Ollama
// never resumes, so it has no session to keep.
pub fn session_started(engine: Engine, line: &str) -> Option<String> {
    let event: Value = serde_json::from_str(line.trim()).ok()?;
    let id = match engine {
        Engine::ClaudeCode => event["session_id"].as_str(),
        Engine::Codex if event["type"] == "thread.started" => event["thread_id"].as_str(),
        Engine::Antigravity => super::antigravity::session_started(&event),
        _ => None,
    }?;
    crate::flow::valid_session(id).then(|| id.to_string())
}

const MAX_EDIT_TEXT: usize = 20_000;

fn clip(text: &str) -> String {
    match text.char_indices().nth(MAX_EDIT_TEXT) {
        Some((cut, _)) => text[..cut].to_string(),
        None => text.to_string(),
    }
}

// Each Edit, MultiEdit or Write in a Claude assistant event, as {path, before, after} with the path
// from the project's root. A Write has no "before": the whole content is new, or replaces the file.
pub fn edits(line: &str, workspace: &Path) -> Vec<Value> {
    if !line.contains("\"tool_use\"") {
        return Vec::new();
    }
    let Ok(event) = serde_json::from_str::<Value>(line.trim()) else { return Vec::new() };
    if event["type"] != "assistant" {
        return Vec::new();
    }
    let blocks = event["message"]["content"].as_array().cloned().unwrap_or_default();
    blocks
        .iter()
        .filter(|b| b["type"] == "tool_use")
        .flat_map(|b| {
            let input = &b["input"];
            let path = input["file_path"].as_str().map(|p| Path::new(p).strip_prefix(workspace).map(|r| r.to_string_lossy().into_owned()).unwrap_or_else(|_| p.to_string()));
            let pairs: Vec<(String, String)> = match b["name"].as_str() {
                Some("Edit") => vec![(input["old_string"].as_str().unwrap_or_default().into(), input["new_string"].as_str().unwrap_or_default().into())],
                Some("MultiEdit") => input["edits"].as_array().into_iter().flatten().map(|e| (e["old_string"].as_str().unwrap_or_default().into(), e["new_string"].as_str().unwrap_or_default().into())).collect(),
                Some("Write") => vec![(String::new(), input["content"].as_str().unwrap_or_default().into())],
                _ => Vec::new(),
            };
            pairs.into_iter().filter_map(move |(before, after)| Some(json!({ "path": path.clone()?, "before": clip(&before), "after": clip(&after) })))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_session_is_named_by_the_streams_first_event_and_only_for_resumable_engines() {
        let claude = r#"{"type":"system","subtype":"hook_started","session_id":"3f48b81e-5044-40ac-aa5f-2f7c80c18525"}"#;
        assert_eq!(session_started(Engine::ClaudeCode, claude).as_deref(), Some("3f48b81e-5044-40ac-aa5f-2f7c80c18525"));
        assert_eq!(session_started(Engine::ClaudeCode, r#"{"type":"user"}"#), None);
        let codex = r#"{"type":"thread.started","thread_id":"019ab-cd"}"#;
        assert_eq!(session_started(Engine::Codex, codex).as_deref(), Some("019ab-cd"));
        assert_eq!(session_started(Engine::Ollama, codex), None);
        assert_eq!(session_started(Engine::ClaudeCode, codex), None);
        assert_eq!(session_started(Engine::ClaudeCode, r#"{"type":"system","subtype":"init","session_id":"--fork-session"}"#), None);
        assert_eq!(session_started(Engine::Codex, "not json"), None);
    }

    #[test]
    fn edits_and_writes_come_out_with_paths_from_the_project_root() {
        let line = r#"{"type":"assistant","message":{"content":[
            {"type":"tool_use","name":"Edit","input":{"file_path":"/w/notes.md","old_string":"line two","new_string":"line 2"}},
            {"type":"tool_use","name":"Write","input":{"file_path":"/w/hello.txt","content":"hi"}},
            {"type":"tool_use","name":"MultiEdit","input":{"file_path":"/elsewhere/a.ts","edits":[{"old_string":"a","new_string":"b"},{"old_string":"c","new_string":"d"}]}},
            {"type":"tool_use","name":"Bash","input":{"command":"ls"}},
            {"type":"text","text":"tool_use"}
        ]}}"#.replace('\n', " ");
        let found = edits(&line, Path::new("/w"));
        assert_eq!(found, [
            json!({ "path": "notes.md", "before": "line two", "after": "line 2" }),
            json!({ "path": "hello.txt", "before": "", "after": "hi" }),
            json!({ "path": "/elsewhere/a.ts", "before": "a", "after": "b" }),
            json!({ "path": "/elsewhere/a.ts", "before": "c", "after": "d" }),
        ]);
        assert!(edits(r#"{"type":"user","message":{"content":[{"type":"tool_use"}]}}"#, Path::new("/w")).is_empty());
        let huge = format!(r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"Write","input":{{"file_path":"/w/big.txt","content":"{}"}}}}]}}}}"#, "x".repeat(30_000));
        assert_eq!(edits(&huge, Path::new("/w"))[0]["after"].as_str().unwrap().len(), MAX_EDIT_TEXT);
    }
}
