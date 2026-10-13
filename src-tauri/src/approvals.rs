use std::collections::HashMap;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::progress::Reporter;

// A tool call Claude Code wants to make and isn't allowed to without asking (a shell command, a web
// page), put to the owner the way Claude Code itself asks: allow it once, always allow it in this
// project, or deny it. The run waits for the answer; a stop answers "deny".

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    id: String,
    tool: String,
    // What the call is for: the command, the page, the file.
    detail: String,
    description: String,
    // The rule Claude Code suggests for "always", as an allowed-tools entry ("Bash(npm test:*)").
    rule: Option<String>,
    #[serde(skip)]
    input: Value,
    #[serde(skip)]
    suggestion: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Decision {
    Allow { always: bool },
    Deny,
}

const MAX_RULE: usize = 200;

fn pending() -> &'static Mutex<HashMap<String, Sender<Decision>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Sender<Decision>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

// Allowed-tools entries dhrive keeps per project: a tool name, optionally with what it covers in
// parentheses. A bare Bash would allow every command, so Bash always names one.
pub fn valid_rule(rule: &str) -> bool {
    let (tool, content) = match rule.split_once('(') {
        Some((tool, rest)) => match rest.strip_suffix(')') {
            Some(content) if !content.is_empty() => (tool, Some(content)),
            _ => return false,
        },
        None => (rule, None),
    };
    let tool_ok = tool.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && tool.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    let content_ok = content.is_none_or(|c| !c.contains([',', '\n', '(', ')']));
    rule.len() <= MAX_RULE && tool_ok && content_ok && !(tool == "Bash" && content.is_none())
}

fn rule_of(suggestion: &Value) -> Option<String> {
    let rule = suggestion["rules"].as_array()?.first()?;
    let tool = rule["toolName"].as_str()?;
    let rule = rule["ruleContent"].as_str().map_or_else(|| tool.to_string(), |content| format!("{tool}({content})"));
    valid_rule(&rule).then_some(rule)
}

fn detail_of(input: &Value) -> String {
    ["command", "url", "query", "file_path", "path"].iter().find_map(|key| input[*key].as_str()).unwrap_or_default().to_string()
}

// A `can_use_tool` control request from Claude Code's stream, or None for any other line.
pub fn question(line: &str) -> Option<Question> {
    if !line.contains("\"can_use_tool\"") {
        return None;
    }
    let event: Value = serde_json::from_str(line.trim()).ok()?;
    let request = &event["request"];
    if event["type"] != "control_request" || request["subtype"] != "can_use_tool" {
        return None;
    }
    let suggestion = request["permission_suggestions"].as_array().and_then(|all| all.iter().find(|s| s["type"] == "addRules").cloned());
    Some(Question {
        id: event["request_id"].as_str()?.to_string(),
        tool: request["tool_name"].as_str()?.to_string(),
        detail: detail_of(&request["input"]),
        description: request["description"].as_str().unwrap_or_default().to_string(),
        rule: suggestion.as_ref().and_then(rule_of),
        input: request["input"].clone(),
        suggestion,
    })
}

// What goes back to Claude Code. "Always" also allows it for the rest of this run, in the session
// only: dhrive keeps the rule itself and never writes the owner's .claude settings.
pub fn response(question: &Question, decision: Decision) -> Value {
    let answer = match decision {
        Decision::Allow { always } => {
            let mut allow = json!({ "behavior": "allow", "updatedInput": question.input });
            if let (true, Some(suggestion)) = (always, &question.suggestion) {
                allow["updatedPermissions"] = json!([{ "type": "addRules", "rules": suggestion["rules"], "behavior": "allow", "destination": "session" }]);
            }
            allow
        }
        Decision::Deny => json!({ "behavior": "deny", "message": "The owner declined this. Carry on without it, or say what you need and why." }),
    };
    json!({ "type": "control_response", "response": { "subtype": "success", "request_id": question.id, "response": answer } })
}

// Puts the question to the owner and waits. Checking for a stop every quarter second keeps a stopped
// run from waiting on an answer that will never come.
pub fn ask(reporter: &Reporter, question: &Question) -> Decision {
    let (sender, answers) = mpsc::channel();
    if let Ok(mut map) = pending().lock() {
        map.insert(question.id.clone(), sender);
    }
    reporter.approval(serde_json::to_string(question).unwrap_or_default());
    let decision = loop {
        match answers.recv_timeout(Duration::from_millis(250)) {
            Ok(decision) => break decision,
            Err(RecvTimeoutError::Timeout) if !crate::cancel::is_cancelled(reporter.run_id()) => continue,
            Err(_) => break Decision::Deny,
        }
    };
    if let Ok(mut map) = pending().lock() {
        map.remove(&question.id);
    }
    decision
}

#[tauri::command]
pub fn answer_approval(id: String, allow: bool, always: bool) -> Result<(), String> {
    let sender = pending().lock().ok().and_then(|map| map.get(&id).cloned()).ok_or("That question was already answered, or its run ended.")?;
    let decision = if allow { Decision::Allow { always } } else { Decision::Deny };
    sender.send(decision).map_err(|_| "That run already ended.".to_string())
}

#[cfg(test)]
#[path = "approvals_tests.rs"]
mod tests;
