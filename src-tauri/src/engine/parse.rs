use serde::Deserialize;
use serde_json::Value;

use super::{antigravity, codex, AgentRun, Engine, Usage};

#[derive(Deserialize)]
struct ClaudeResult {
    result: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    total_cost_usd: Option<f64>,
    #[serde(default)]
    num_turns: Option<u32>,
    #[serde(default)]
    usage: Option<ClaudeUsage>,
    #[serde(default)]
    permission_denials: Vec<Denial>,
}

#[derive(Deserialize)]
struct Denial {
    #[serde(default)]
    tool_name: String,
    #[serde(default)]
    tool_input: Value,
}

const MAX_DETAIL: usize = 60;

// "Bash: npm install", "Write: theme.ts", "WebFetch: docs.stripe.com": the tool and what it was for,
// short enough for a marker. Each refused call shows once.
fn blocked(denials: &[Denial]) -> Vec<String> {
    let mut shown: Vec<String> = Vec::new();
    for denial in denials.iter().filter(|d| !d.tool_name.is_empty()) {
        let input = &denial.tool_input;
        let detail = input["command"].as_str().map(str::to_string)
            .or_else(|| input["file_path"].as_str().or(input["notebook_path"].as_str()).map(|p| p.rsplit('/').next().unwrap_or(p).to_string()))
            .or_else(|| input["url"].as_str().map(|u| u.split("//").nth(1).unwrap_or(u).split('/').next().unwrap_or(u).to_string()));
        let line = match detail.map(|d| d.lines().next().unwrap_or_default().trim().to_string()).filter(|d| !d.is_empty()) {
            Some(d) if d.chars().count() > MAX_DETAIL => format!("{}: {}…", denial.tool_name, d.chars().take(MAX_DETAIL).collect::<String>()),
            Some(d) => format!("{}: {d}", denial.tool_name),
            None => denial.tool_name.clone(),
        };
        if !shown.contains(&line) {
            shown.push(line);
        }
    }
    shown
}

#[derive(Deserialize)]
struct ClaudeUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
}

pub fn extract_run(engine: Engine, stdout: &str) -> AgentRun {
    match engine {
        Engine::ClaudeCode => parse_claude(stdout),
        Engine::Codex | Engine::Ollama => codex::parse(stdout),
        Engine::Antigravity => antigravity::parse(stdout),
    }
}

fn parse_claude(stdout: &str) -> AgentRun {
    // stream-json emits one event per line; the final "result" event carries summary/usage.
    let model = stdout.lines().find_map(init_model);
    if let Some(parsed) = stdout.lines().rev().find_map(parse_result_line) {
        return build_run(parsed, model);
    }
    // Back-compat: a single json blob (the old --output-format json), or raw text.
    match serde_json::from_str::<ClaudeResult>(stdout.trim()) {
        Ok(parsed) => build_run(parsed, model),
        Err(_) => AgentRun {
            summary: stdout.trim().to_string(),
            session_id: None,
            usage: None,
            blocked: Vec::new(),
        },
    }
}

// The first stream-json event (system/init) names the model the session runs on.
fn init_model(line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("subtype").and_then(Value::as_str) != Some("init") {
        return None;
    }
    value.get("model").and_then(Value::as_str).map(str::to_string)
}

fn parse_result_line(line: &str) -> Option<ClaudeResult> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("result") {
        return None;
    }
    serde_json::from_value(value).ok()
}

// On failure, surface the real reason — the final "result" event's message (or stderr) —
// never the noisy "init" banner that's the first line of a stream-json run.
pub fn claude_failure(stdout: &str, stderr: &str) -> String {
    for line in stdout.lines().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("result") {
            continue;
        }
        for field in ["result", "error"] {
            if let Some(text) = value.get(field).and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    return text.trim().to_string();
                }
            }
        }
    }
    let last = |text: &str| {
        text.lines().map(str::trim).rev().find(|line| !line.is_empty()).map(str::to_string)
    };
    last(stderr).or_else(|| last(stdout)).unwrap_or_else(|| "claude failed".into())
}

fn build_run(parsed: ClaudeResult, model: Option<String>) -> AgentRun {
    let usage = parsed.usage.map(|u| Usage {
        input_tokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        output_tokens: u.output_tokens,
        total_cost_usd: parsed.total_cost_usd,
        num_turns: parsed.num_turns.unwrap_or(0),
        model,
    });
    AgentRun {
        blocked: blocked(&parsed.permission_denials),
        summary: parsed.result,
        session_id: parsed.session_id,
        usage,
    }
}

// Turn one Claude stream-json event into a readable activity line for the live log; returns
// None for events with nothing worth showing (system init, tool results, the final result).
pub fn humanize_stream_line(line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    match value.get("type").and_then(Value::as_str)? {
        "assistant" => humanize_assistant(&value),
        _ => None,
    }
}

fn humanize_assistant(value: &Value) -> Option<String> {
    let content = value.get("message").and_then(|m| m.get("content")).and_then(Value::as_array)?;
    let mut parts = Vec::new();
    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = block.get("text").and_then(Value::as_str).unwrap_or("").trim();
                if !text.is_empty() {
                    parts.push(text.to_string());
                }
            }
            Some("tool_use") => parts.push(describe_tool(
                block.get("name").and_then(Value::as_str).unwrap_or("a tool"),
                block.get("input").and_then(|input| input.get("file_path")).and_then(Value::as_str),
            )),
            _ => {}
        }
    }
    let joined = parts.join("\n");
    (!joined.trim().is_empty()).then_some(joined)
}

fn describe_tool(name: &str, file_path: Option<&str>) -> String {
    let file = file_path.and_then(|path| path.rsplit('/').next()).filter(|name| !name.is_empty());
    match (name, file) {
        ("Read", Some(file)) => format!("Reading {file}"),
        ("Edit", Some(file)) => format!("Editing {file}"),
        ("Write", Some(file)) => format!("Writing {file}"),
        (name, Some(file)) => format!("{name} {file}"),
        (name, None) => format!("Using {name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_json_yields_result_and_usage() {
        let out = r#"{"result":"done editing","session_id":"abc","total_cost_usd":0.012,"num_turns":3,"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":100}}"#;
        let run = extract_run(Engine::ClaudeCode, out);
        assert_eq!(run.session_id.as_deref(), Some("abc"));
        assert_eq!(run.summary, "done editing");
        let usage = run.usage.unwrap();
        assert_eq!(usage.input_tokens, 110);
        assert_eq!(usage.output_tokens, 20);
        assert_eq!(usage.num_turns, 3);
    }

    #[test]
    fn claude_falls_back_to_raw_on_bad_json() {
        let run = extract_run(Engine::ClaudeCode, "  not json  ");
        assert_eq!(run.summary, "not json");
        assert!(run.usage.is_none());
    }


    #[test]
    fn claude_stream_json_extracts_final_result_event() {
        let stream = concat!(
            r#"{"type":"system","subtype":"init","session_id":"abc","model":"claude-sonnet-4-6"}"#, "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/w/ContentView.swift"}}]}}"#, "\n",
            r#"{"type":"result","subtype":"success","result":"done editing","session_id":"abc","total_cost_usd":0.02,"num_turns":4,"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":100}}"#, "\n",
        );
        let run = extract_run(Engine::ClaudeCode, stream);
        assert_eq!(run.summary, "done editing");
        let usage = run.usage.unwrap();
        assert_eq!(usage.input_tokens, 110);
        assert_eq!(usage.num_turns, 4);
        assert_eq!(usage.total_cost_usd, Some(0.02));
        assert_eq!(usage.model.as_deref(), Some("claude-sonnet-4-6"));
    }

    #[test]
    fn refused_tool_calls_become_short_markers_once_each() {
        let result = r#"{"type":"result","result":"ok","permission_denials":[
            {"tool_name":"Bash","tool_input":{"command":"echo \"hi\" > note.txt\nmore","description":"x"}},
            {"tool_name":"Bash","tool_input":{"command":"echo \"hi\" > note.txt\nmore"}},
            {"tool_name":"Write","tool_input":{"file_path":"/w/src/theme.ts","content":"x"}},
            {"tool_name":"WebFetch","tool_input":{"url":"https://docs.stripe.com/api/checkout","prompt":"x"}},
            {"tool_name":"mcp__linear__create_issue","tool_input":{}},
            {"tool_input":{}}
        ]}"#;
        let run = extract_run(Engine::ClaudeCode, &result.replace('\n', " "));
        assert_eq!(run.blocked, ["Bash: echo \"hi\" > note.txt", "Write: theme.ts", "WebFetch: docs.stripe.com", "mcp__linear__create_issue"]);
        let long = format!(r#"{{"type":"result","result":"ok","permission_denials":[{{"tool_name":"Bash","tool_input":{{"command":"{}"}}}}]}}"#, "x".repeat(100));
        assert!(extract_run(Engine::ClaudeCode, &long).blocked[0].ends_with('…'));
        assert!(extract_run(Engine::ClaudeCode, r#"{"type":"result","result":"ok"}"#).blocked.is_empty());
    }

    #[test]
    fn humanizes_tool_use_into_activity() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/w/DhriveApp/ContentView.swift"}}]}}"#;
        assert_eq!(humanize_stream_line(line).as_deref(), Some("Editing ContentView.swift"));
    }

    #[test]
    fn humanizes_assistant_text() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"  Adding a dark mode toggle  "}]}}"#;
        assert_eq!(humanize_stream_line(line).as_deref(), Some("Adding a dark mode toggle"));
    }

    #[test]
    fn hides_noise_events() {
        assert!(humanize_stream_line(r#"{"type":"system","subtype":"init"}"#).is_none());
        assert!(humanize_stream_line(r#"{"type":"result","result":"x"}"#).is_none());
        assert!(humanize_stream_line("not json").is_none());
    }

    #[test]
    fn claude_failure_prefers_result_over_init_banner() {
        let stream = concat!(
            r#"{"type":"system","subtype":"init","apiKeySource":"none"}"#, "\n",
            r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Invalid API key · Please run /login"}"#, "\n",
        );
        assert_eq!(claude_failure(stream, ""), "Invalid API key · Please run /login");
    }

    #[test]
    fn claude_failure_falls_back_to_stderr_then_last_line() {
        assert_eq!(claude_failure("", "boom\n"), "boom");
        assert_eq!(claude_failure("a\nlast line\n", ""), "last line");
        assert_eq!(claude_failure("", ""), "claude failed");
    }
}
