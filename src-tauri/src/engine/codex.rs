use serde_json::Value;

use super::{AgentRun, Usage};

// `codex exec --json` emits one event per line: thread/turn lifecycle, `item.*` events for
// messages, commands and file edits, and `turn.completed` carrying token usage.

fn events(stdout: &str) -> impl Iterator<Item = Value> + '_ {
    stdout.lines().filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
}

fn kind(event: &Value) -> &str {
    event.get("type").and_then(Value::as_str).unwrap_or_default()
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

// Codex doesn't report a price, so cost stays unknown rather than a misleading zero. Its
// input_tokens already include the cached ones.
pub fn parse(stdout: &str) -> AgentRun {
    let mut summary = String::new();
    let mut usage: Option<Usage> = None;
    let mut session_id = None;
    for event in events(stdout) {
        match kind(&event) {
            "thread.started" => session_id = Some(text(&event, "thread_id").to_string()).filter(|id| !id.is_empty()),
            "item.completed" => {
                let item = &event["item"];
                if text(item, "type") == "agent_message" {
                    summary = text(item, "text").trim().to_string();
                }
            }
            "turn.completed" => {
                let turn = Usage {
                    input_tokens: event["usage"]["input_tokens"].as_u64().unwrap_or(0),
                    cached_tokens: event["usage"]["cached_input_tokens"].as_u64().unwrap_or(0),
                    output_tokens: event["usage"]["output_tokens"].as_u64().unwrap_or(0),
                    total_cost_usd: None,
                    num_turns: 1,
                    model: None,
                };
                usage = Some(match usage {
                    Some(sum) => sum.merge(turn),
                    None => turn,
                });
            }
            _ => {}
        }
    }
    if summary.is_empty() && usage.is_none() {
        summary = stdout.trim().to_string();
    }
    AgentRun { summary, session_id, usage, blocked: Vec::new() }
}

// One event → a readable activity line for the live log; None hides lifecycle noise.
pub fn humanize(line: &str) -> Option<String> {
    let event: Value = serde_json::from_str(line.trim()).ok()?;
    let item = event.get("item")?;
    let started = kind(&event) == "item.started";
    let shown = match (text(item, "type"), started) {
        ("command_execution", true) => format!("Running {}", text(item, "command")),
        ("file_change", false) => describe_changes(item),
        ("agent_message", false) | ("reasoning", false) => text(item, "text").replace("**", ""),
        _ => String::new(),
    };
    let shown = shown.trim().to_string();
    (!shown.is_empty()).then_some(shown)
}

fn describe_changes(item: &Value) -> String {
    let files: Vec<&str> = item["changes"]
        .as_array()
        .map(|changes| {
            changes
                .iter()
                .filter_map(|change| change["path"].as_str())
                .map(|path| path.rsplit('/').next().unwrap_or(path))
                .collect()
        })
        .unwrap_or_default();
    if files.is_empty() {
        String::new()
    } else {
        format!("Editing {}", files.join(", "))
    }
}

// The reason a run failed: the turn's own error event, else the last non-empty stderr line.
pub fn failure(stdout: &str, stderr: &str) -> String {
    let reported = events(stdout)
        .filter_map(|event| match kind(&event) {
            "turn.failed" => Some(text(&event["error"], "message").to_string()),
            "error" => Some(text(&event, "message").to_string()),
            _ => None,
        })
        .filter(|message| !message.trim().is_empty())
        .last();
    reported
        .or_else(|| stderr.lines().map(str::trim).rev().find(|line| !line.is_empty()).map(str::to_string))
        .unwrap_or_else(|| "codex failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = concat!(
        r#"{"type":"thread.started","thread_id":"t-1"}"#, "\n",
        r#"{"type":"turn.started"}"#, "\n",
        r#"{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"**Reading the router**"}}"#, "\n",
        r#"{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"bash -lc 'npm test'","status":"in_progress"}}"#, "\n",
        r#"{"type":"item.completed","item":{"id":"i2","type":"file_change","changes":[{"path":"/r/src/auth.ts","kind":"update"}]}}"#, "\n",
        r#"{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"Fixed the redirect loop."}}"#, "\n",
        r#"{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}"#, "\n",
    );

    #[test]
    fn parses_the_final_message_and_token_usage() {
        let run = parse(RUN);
        assert_eq!(run.summary, "Fixed the redirect loop.");
        assert_eq!(run.session_id.as_deref(), Some("t-1"));
        let usage = run.usage.unwrap();
        assert_eq!((usage.input_tokens, usage.cached_tokens, usage.output_tokens, usage.num_turns), (24763, 24448, 122, 1));
        assert_eq!(usage.total_cost_usd, None);
    }

    #[test]
    fn plain_text_output_still_yields_a_summary() {
        let run = parse("  final message\n");
        assert_eq!(run.summary, "final message");
        assert!(run.usage.is_none());
    }

    #[test]
    fn humanizes_commands_edits_and_messages() {
        let lines: Vec<Option<String>> = RUN.lines().map(humanize).collect();
        assert_eq!(lines[2].as_deref(), Some("Reading the router"));
        assert_eq!(lines[3].as_deref(), Some("Running bash -lc 'npm test'"));
        assert_eq!(lines[4].as_deref(), Some("Editing auth.ts"));
        assert_eq!(lines[5].as_deref(), Some("Fixed the redirect loop."));
        assert!(lines[0].is_none() && lines[6].is_none());
    }

    #[test]
    fn failure_prefers_the_reported_error() {
        let stdout = r#"{"type":"turn.failed","error":{"message":"stream disconnected"}}"#;
        assert_eq!(failure(stdout, "noise\n"), "stream disconnected");
        assert_eq!(failure("", "last line\n"), "last line");
        assert_eq!(failure("", ""), "codex failed");
    }
}
