use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::engine::Engine;
use crate::jsonl::JsonlChild;

// How full a conversation's CLI session is, and making room in it. Claude Code answers /context for a
// resumed session without a model call; Codex writes each turn's token count into its rollout. Either
// compacts a session on request: Claude Code through /compact, Codex through thread/compact/start.

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    used: u64,
    max: u64,
    // What fills it, largest first; only Claude Code says.
    parts: Vec<Part>,
    // Where the CLI compacts on its own, in tokens, when it does and says so.
    auto_compact_at: Option<u64>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Part {
    name: String,
    tokens: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRef {
    engine: Engine,
    session: String,
    folder: String,
    // The model the conversation ran it with: Claude's window depends on it.
    model: Option<String>,
}

const PROBE: Duration = Duration::from_secs(20);
const COMPACTING: Duration = Duration::from_secs(300);

// Everything here came from the webview and becomes CLI arguments.
fn checked(r: &SessionRef) -> Result<(PathBuf, PathBuf, Option<&str>), String> {
    if r.engine == Engine::Ollama {
        return Err("Ollama models start fresh each time; there's no session to measure.".into());
    }
    if r.engine == Engine::Antigravity {
        return Err("Antigravity doesn't share how full its conversation is with other apps yet.".into());
    }
    if !crate::flow::valid_session(&r.session) {
        return Err("That isn't a session id a CLI would give.".into());
    }
    let model = r.model.as_deref().map(str::trim).filter(|m| !m.is_empty());
    if model.is_some_and(|m| !crate::flow::valid_model(m)) {
        return Err("That model name has characters a model id never has.".into());
    }
    let folder = Path::new(&r.folder).canonicalize().ok().filter(|f| f.is_dir()).ok_or("That project folder isn't there anymore.")?;
    let program = r.engine.locate().ok_or_else(|| format!("{} isn't installed.", r.engine.label()))?;
    Ok((program, folder, model))
}

// The owner's MCP servers and hooks stay off: only the session is looked at.
fn claude(program: &Path, folder: &Path, session: &str, model: Option<&str>, timeout: Duration) -> Result<JsonlChild, String> {
    let mut args = vec!["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--settings", r#"{"disableAllHooks":true}"#, "--resume", session];
    args.extend(model.map(|m| ["--model", m]).into_iter().flatten());
    JsonlChild::spawn_in(program, &args, folder, timeout)
}

fn claude_usage(claude: &mut JsonlChild) -> Result<ContextUsage, String> {
    Ok(parse_claude(&claude.control("dhrive-context", json!({ "subtype": "get_context_usage", "detail": "summary" }))?))
}

pub fn parse_claude(answer: &Value) -> ContextUsage {
    let mut parts: Vec<Part> = answer["categories"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["kind"] == "used")
        .filter_map(|c| Some(Part { name: c["name"].as_str()?.to_string(), tokens: c["tokens"].as_u64().filter(|t| *t > 0)? }))
        .collect();
    parts.sort_by_key(|p| std::cmp::Reverse(p.tokens));
    let auto_compact_at = (answer["isAutoCompactEnabled"] == true).then(|| answer["autoCompactThreshold"].as_u64()).flatten();
    ContextUsage { used: answer["totalTokens"].as_u64().unwrap_or(0), max: answer["maxTokens"].as_u64().unwrap_or(0), parts, auto_compact_at }
}

// The last turn's count: what went in and came out of the model is what the session now holds.
pub fn parse_codex_rollout(reader: impl BufRead) -> Option<ContextUsage> {
    let counted = reader.lines().map_while(Result::ok).filter(|line| line.contains("\"token_count\"")).filter_map(|line| serde_json::from_str::<Value>(&line).ok()).filter(|e| e["payload"]["info"].is_object()).last()?;
    let info = &counted["payload"]["info"];
    Some(ContextUsage { used: info["last_token_usage"]["total_tokens"].as_u64()?, max: info["model_context_window"].as_u64()?, ..ContextUsage::default() })
}

fn read(r: &SessionRef) -> Result<ContextUsage, String> {
    let (program, folder, model) = checked(r)?;
    if r.engine == Engine::ClaudeCode {
        return claude_usage(&mut claude(&program, &folder, &r.session, model, PROBE)?);
    }
    let rollout = crate::sessions::codex_rollout(&r.session).ok_or("Codex has no record of this session yet.")?;
    let file = std::fs::File::open(rollout).map_err(|error| format!("Couldn't read Codex's record: {error}"))?;
    parse_codex_rollout(BufReader::new(file)).ok_or_else(|| "Codex hasn't counted this session yet.".into())
}

// Claude answers with its new size right away; Codex only counts again on the next turn.
fn compact(r: &SessionRef) -> Result<Option<ContextUsage>, String> {
    let (program, folder, model) = checked(r)?;
    if r.engine == Engine::ClaudeCode {
        let mut claude = claude(&program, &folder, &r.session, model, COMPACTING)?;
        claude.send(&json!({ "type": "user", "message": { "role": "user", "content": "/compact" } }))?;
        // A session too short to compact still ends in success, with no boundary before it and the
        // reason as its text ("Not enough messages to compact.").
        let first = claude.wait_for(|m| m["type"] == "result" || m["subtype"] == "compact_boundary")?;
        let result = if first["type"] == "result" { first.clone() } else { claude.wait_for(|m| m["type"] == "result")? };
        if first["type"] == "result" || result["is_error"] == true {
            return Err(result["result"].as_str().unwrap_or("Claude Code couldn't compact this session.").to_string());
        }
        return claude_usage(&mut claude).map(Some);
    }
    let mut codex = JsonlChild::codex_in(&program, &folder, COMPACTING)?;
    codex.call(1, "thread/resume", json!({ "threadId": r.session, "excludeTurns": true }))?;
    codex.call(2, "thread/compact/start", json!({ "threadId": r.session }))?;
    let done = codex.wait_for(|m| m["method"] == "turn/completed" && m["params"]["threadId"] == r.session.as_str())?;
    match done["params"]["turn"]["status"].as_str() {
        Some("completed") => Ok(None),
        _ => Err(done["params"]["turn"]["error"]["message"].as_str().unwrap_or("Codex couldn't compact this session.").to_string()),
    }
}

#[tauri::command]
pub async fn context_usage(session: SessionRef) -> Result<ContextUsage, String> {
    tauri::async_runtime::spawn_blocking(move || read(&session)).await.map_err(|error| format!("Couldn't measure the session: {error}"))?
}

#[tauri::command]
pub async fn compact_session(session: SessionRef) -> Result<Option<ContextUsage>, String> {
    tauri::async_runtime::spawn_blocking(move || compact(&session)).await.map_err(|error| format!("The compaction stopped: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_says_what_fills_the_session_and_where_it_compacts() {
        // Trimmed from what Claude Code 2.1.284 answered.
        let answer = json!({ "totalTokens": 49_855, "maxTokens": 200_000, "autoCompactThreshold": 167_000, "isAutoCompactEnabled": true, "categories": [
            { "name": "System prompt", "tokens": 7040, "kind": "used" },
            { "name": "System tools", "tokens": 36_443, "kind": "used" },
            { "name": "System tools (deferred)", "tokens": 36_948, "kind": "deferred" },
            { "name": "Messages", "tokens": 6372, "kind": "used" },
            { "name": "Agents", "tokens": 0, "kind": "used" },
            { "name": "Free space", "tokens": 150_145, "kind": "free" }
        ]});
        let usage = parse_claude(&answer);
        assert_eq!((usage.used, usage.max, usage.auto_compact_at), (49_855, 200_000, Some(167_000)));
        assert_eq!(usage.parts.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["System tools", "System prompt", "Messages"]);
        assert_eq!(parse_claude(&json!({ "totalTokens": 1, "maxTokens": 2, "isAutoCompactEnabled": false, "autoCompactThreshold": 9 })).auto_compact_at, None);
    }

    #[test]
    fn codex_counts_come_from_the_last_turn_it_recorded() {
        let rollout = [
            r#"{"type":"session_meta","payload":{"id":"t-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":9000},"model_context_window":258400}}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","info":null}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":16995},"model_context_window":258400}}}"#,
            r#"{"type":"response_item","payload":{"text":"token_count"}}"#,
        ]
        .join("\n");
        assert_eq!(parse_codex_rollout(rollout.as_bytes()), Some(ContextUsage { used: 16_995, max: 258_400, ..ContextUsage::default() }));
        assert_eq!(parse_codex_rollout(r#"{"type":"session_meta"}"#.as_bytes()), None);
    }

    // Needs a real session: DHRIVE_LIVE_ENGINE (claude-code or codex), DHRIVE_LIVE_SESSION, and the
    // folder it ran in as DHRIVE_LIVE_FOLDER. Compacting spends a little of the plan.
    #[test]
    #[ignore = "measures and compacts a real CLI session"]
    fn a_real_session_is_measured_and_compacted() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name}"));
        let engine = if var("DHRIVE_LIVE_ENGINE") == "codex" { Engine::Codex } else { Engine::ClaudeCode };
        let session = SessionRef { engine, session: var("DHRIVE_LIVE_SESSION"), folder: var("DHRIVE_LIVE_FOLDER"), model: std::env::var("DHRIVE_LIVE_MODEL").ok() };
        let before = read(&session).unwrap();
        eprintln!("before: {} of {} ({} parts)", before.used, before.max, before.parts.len());
        assert!(before.used > 0 && before.max > before.used);
        match compact(&session) {
            Ok(after) => assert_eq!(after.is_some(), engine == Engine::ClaudeCode, "Claude says its new size at once"),
            Err(reason) => eprintln!("not compacted: {reason}"),
        }
    }

    #[test]
    fn only_a_real_session_in_a_real_folder_is_measured() {
        let here = std::env::temp_dir().to_string_lossy().into_owned();
        let session = |engine, session: &str, folder: &str, model: Option<&str>| SessionRef { engine, session: session.into(), folder: folder.into(), model: model.map(str::to_string) };
        assert!(checked(&session(Engine::Ollama, "s-1", &here, None)).is_err());
        assert!(checked(&session(Engine::ClaudeCode, "--fork-session", &here, None)).is_err());
        assert!(checked(&session(Engine::ClaudeCode, "s-1", "/not/here", None)).is_err());
        assert!(checked(&session(Engine::ClaudeCode, "s-1", &here, Some("--yolo"))).is_err());
    }
}
