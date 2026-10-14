use serde_json::Value;

use super::command::{with_model, AgentInvocation};
use super::{AgentRun, Usage};

// Headless Antigravity can't ask for a permission, so it refuses the action and ends the run with
// no reply. Reading and searching need none; a shell command always does, and an edit does outside
// accept-edits. Each note keeps the model on the tools that work in its step.
// ponytail: commands never run in a code step either; --dangerously-skip-permissions with --sandbox
// would let them, once the owner wants that trade.
const AGY_READ_NOTE: &str = "Use only your file viewing, listing and search tools: shell commands and file edits are not available in this run. Write your whole answer in your reply, not in an artifact.";
const AGY_CODE_NOTE: &str = "Shell commands are not available in this run: make the change with your file editing tools, and end by saying which commands the owner should run to verify it.";

// Antigravity has no system-prompt flag, so the owner's instructions open the prompt.
pub fn command(invocation: &AgentInvocation) -> (String, Vec<String>) {
    let AgentInvocation { prompt, plan, model, resume, instructions, .. } = *invocation;
    let note = if plan { AGY_READ_NOTE } else { AGY_CODE_NOTE };
    let prompt = [instructions.unwrap_or_default(), note, prompt].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join("\n\n");
    let mut args: Vec<String> = vec!["--output-format".into(), "stream-json".into()];
    if !plan {
        args.extend(["--mode".into(), "accept-edits".into()]);
    }
    with_model(&mut args, model);
    if let Some(conversation) = resume {
        args.extend(["--conversation".into(), conversation.into()]);
    }
    // -p takes the next argument as its value whatever it starts with, so it goes last.
    args.extend(["-p".into(), prompt]);
    ("agy".into(), args)
}

// `agy -p --output-format stream-json` emits an `init` event naming the conversation, a
// `step_update` per tool call and reply chunk, and one `result` event with the whole reply, its
// usage, and the actions headless mode refused.

fn events(stdout: &str) -> impl Iterator<Item = Value> + '_ {
    stdout.lines().filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn result(stdout: &str) -> Option<Value> {
    events(stdout).filter(|event| event["event"] == "result").last().map(|event| event["result"].clone())
}

pub fn session_started(event: &Value) -> Option<&str> {
    (event["event"] == "init").then(|| event["conversation_id"].as_str()).flatten()
}

// Antigravity reports no price, so cost stays unknown rather than a misleading zero.
pub fn parse(stdout: &str) -> AgentRun {
    let model = events(stdout).find(|event| event["event"] == "init").and_then(|event| event["init"]["model"].as_str().map(str::to_string));
    let Some(result) = result(stdout) else {
        return AgentRun { summary: stdout.trim().to_string(), session_id: None, usage: None, blocked: Vec::new() };
    };
    let usage = result.get("usage").filter(|u| u.is_object()).map(|u| Usage {
        input_tokens: u["input_tokens"].as_u64().unwrap_or(0) + u["cache_read_tokens"].as_u64().unwrap_or(0),
        cached_tokens: u["cache_read_tokens"].as_u64().unwrap_or(0),
        output_tokens: u["output_tokens"].as_u64().unwrap_or(0),
        total_cost_usd: None,
        num_turns: result["num_turns"].as_u64().unwrap_or(1) as u32,
        model,
    });
    let blocked = blocked(&result);
    let mut summary = text(&result, "response").trim().to_string();
    // A refused action ends the run with no reply at all, which would read as a blank answer.
    if summary.is_empty() && !blocked.is_empty() {
        summary = STOPPED.into();
    }
    AgentRun { summary, session_id: Some(text(&result, "conversation_id").to_string()).filter(|id| !id.is_empty()), usage, blocked }
}

const STOPPED: &str = "Antigravity stopped before answering: it needed a permission it can't ask for when dhrive runs it.";

// "RunCommand", "WriteToFile": what headless mode refused. Antigravity names the kind of action,
// not the command, so that's all the marker can say.
fn blocked(result: &Value) -> Vec<String> {
    let mut shown: Vec<String> = Vec::new();
    for denied in result["denied_actions"].as_array().into_iter().flatten() {
        let name = Some(text(denied, "display_name")).filter(|n| !n.is_empty()).unwrap_or(text(denied, "action")).to_string();
        if !name.is_empty() && !shown.contains(&name) {
            shown.push(name);
        }
    }
    shown
}

fn file_name(params: &Value) -> &str {
    let path = ["AbsolutePath", "TargetFile", "Path"].iter().find_map(|key| params[key].as_str()).unwrap_or_default();
    path.rsplit('/').next().unwrap_or(path)
}

// A tool call as it starts → a readable activity line; reply chunks and lifecycle stay hidden,
// since the whole reply arrives at the end.
pub fn humanize(line: &str) -> Option<String> {
    let event: Value = serde_json::from_str(line.trim()).ok()?;
    let step = &event["step_update"];
    if step["step_type"] != "tool" || step["state"] != "ACTIVE" {
        return None;
    }
    let params = &step["tool_info"]["parameters"];
    let shown = match text(step, "tool_name") {
        "view_file" => format!("Reading {}", file_name(params)),
        "write_to_file" | "replace_file_content" | "multi_replace_file_content" | "sed_file" => format!("Editing {}", file_name(params)),
        "run_command" => format!("Running {}", text(params, "CommandLine")),
        "grep_search" | "find_by_name" | "list_dir" => "Searching the project".into(),
        "search_web" | "read_url_content" => "Searching the web".into(),
        _ => String::new(),
    };
    let shown = shown.trim().to_string();
    (!shown.is_empty()).then_some(shown)
}

// The reason a run failed: the result's own message when it has one, else the last stderr line.
pub fn failure(stdout: &str, stderr: &str) -> String {
    let reported = result(stdout).and_then(|r| ["error", "response"].iter().map(|key| text(&r, key).trim().to_string()).find(|m| !m.is_empty()));
    reported
        .or_else(|| stderr.lines().map(str::trim).rev().find(|line| !line.is_empty()).map(str::to_string))
        .unwrap_or_else(|| "agy failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invoke(model: Option<&str>, plan: bool) -> AgentInvocation<'_> {
        AgentInvocation { engine: crate::engine::Engine::Antigravity, model, effort: None, prompt: "add a dark mode toggle", plan, resume: None, images: &[], allow: &[], instructions: None, with_env: false, watch: crate::engine::Watch::Owner }
    }

    fn args_for(plan: bool) -> Vec<String> {
        command(&invoke(None, plan)).1
    }

    fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2).any(|w| w[0] == flag && w[1] == value)
    }

    #[test]
    fn antigravity_reads_only_in_plan_steps_and_edits_in_code_steps() {
        let plan = args_for(true);
        assert!(has_pair(&plan, "--output-format", "stream-json") && !plan.iter().any(|a| a == "--mode"), "the default mode refuses edits");
        assert!(plan.last().unwrap().starts_with(AGY_READ_NOTE) && plan.last().unwrap().ends_with("add a dark mode toggle"));
        let code = args_for(false);
        assert!(has_pair(&code, "--mode", "accept-edits") && code.last().unwrap().starts_with(AGY_CODE_NOTE));
        assert!(!code.iter().any(|a| a == "--dangerously-skip-permissions"));
    }

    #[test]
    fn antigravity_resumes_the_conversation_and_opens_with_the_owners_instructions() {
        let args = command(&AgentInvocation { resume: Some("c-1"), instructions: Some("Be brief."), ..invoke(Some("gemini-3.1-pro-high"), false) }).1;
        assert!(has_pair(&args, "--conversation", "c-1") && has_pair(&args, "--model", "gemini-3.1-pro-high"));
        assert_eq!(args[args.len() - 2], "-p");
        assert_eq!(args.last().unwrap(), &format!("Be brief.\n\n{AGY_CODE_NOTE}\n\nadd a dark mode toggle"));
    }

    // Trimmed from a real `agy -p --output-format stream-json` run (1.2.17).
    const RUN: &str = concat!(
        r#"{"event":"init","conversation_id":"97573a22-482b-4023-b057-b949b4557c35","init":{"model":"gemini-3.8-flash-low","permission_mode":"request-review"}}"#, "\n",
        r#"{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/r/src/math.js"}}}}"#, "\n",
        r#"{"event":"step_update","step_update":{"step_index":3,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"npm test"}}}}"#, "\n",
        r#"{"event":"step_update","step_update":{"step_index":4,"state":"ACTIVE","step_type":"agent_response","text_delta":"Fix"}}"#, "\n",
        r#"{"event":"result","result":{"conversation_id":"97573a22-482b-4023-b057-b949b4557c35","status":"SUCCESS","response":"Fix `add` in math.js.\n","num_turns":1,"usage":{"input_tokens":14245,"output_tokens":493,"cache_read_tokens":100},"denied_actions":[{"action":"command","display_name":"RunCommand"},{"action":"command","display_name":"RunCommand"}]}}"#, "\n",
    );

    #[test]
    fn reads_the_reply_conversation_usage_and_refusals() {
        let run = parse(RUN);
        assert_eq!(run.summary, "Fix `add` in math.js.");
        assert_eq!(run.session_id.as_deref(), Some("97573a22-482b-4023-b057-b949b4557c35"));
        let usage = run.usage.unwrap();
        assert_eq!((usage.input_tokens, usage.cached_tokens, usage.output_tokens, usage.total_cost_usd), (14345, 100, 493, None));
        assert_eq!(usage.model.as_deref(), Some("gemini-3.8-flash-low"));
        assert_eq!(run.blocked, ["RunCommand"]);
        let silent = RUN.replace(r#""response":"Fix `add` in math.js.\n""#, r#""response":"""#);
        assert_eq!(parse(&silent).summary, STOPPED);
    }

    #[test]
    fn the_conversation_is_named_by_the_init_event() {
        let init: Value = serde_json::from_str(RUN.lines().next().unwrap()).unwrap();
        assert_eq!(session_started(&init), Some("97573a22-482b-4023-b057-b949b4557c35"));
        assert_eq!(session_started(&serde_json::json!({"event":"result"})), None);
    }

    #[test]
    fn humanizes_tool_calls_only() {
        let lines: Vec<Option<String>> = RUN.lines().map(humanize).collect();
        assert_eq!(lines[1].as_deref(), Some("Reading math.js"));
        assert_eq!(lines[2].as_deref(), Some("Running npm test"));
        assert!(lines[0].is_none() && lines[3].is_none() && lines[4].is_none());
    }

    #[test]
    fn failure_prefers_the_reported_error() {
        let stdout = r#"{"event":"result","result":{"status":"ERROR","error":"Your AI credits balance is too low to continue."}}"#;
        assert_eq!(failure(stdout, "noise\n"), "Your AI credits balance is too low to continue.");
        assert_eq!(failure("", "warning: x\nlast line\n"), "last line");
        assert_eq!(failure("", ""), "agy failed");
    }
}
