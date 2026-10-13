use std::io::Write;
use std::process::ChildStdin;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::approvals;
use crate::progress::Reporter;

// A Claude Code run spoken to over stdin (--input-format stream-json): the task goes in as the
// first user message, each permission question is put to the owner and answered, and stdin closes
// once the result is in, which is what lets the CLI exit.
pub struct Conversation {
    prompt: String,
    stdin: Mutex<Option<ChildStdin>>,
}

impl Conversation {
    pub fn new(prompt: &str) -> Arc<Self> {
        Arc::new(Self { prompt: prompt.to_string(), stdin: Mutex::new(None) })
    }

    pub fn open(&self, stdin: ChildStdin) {
        if let Ok(mut slot) = self.stdin.lock() {
            *slot = Some(stdin);
        }
        self.send(&json!({ "type": "user", "message": { "role": "user", "content": self.prompt } }));
    }

    // A write that fails means the CLI already exited; its output says why.
    fn send(&self, message: &Value) {
        if let Some(stdin) = self.stdin.lock().ok().as_mut().and_then(|slot| slot.as_mut()) {
            let _ = writeln!(stdin, "{message}").and_then(|()| stdin.flush());
        }
    }

    pub fn on_line(&self, line: &str, reporter: &Reporter) {
        if let Some(question) = approvals::question(line) {
            let decision = approvals::ask(reporter, &question);
            self.send(&approvals::response(&question, decision));
        } else if is_result(line) {
            if let Ok(mut slot) = self.stdin.lock() {
                slot.take();
            }
        }
    }
}

fn is_result(line: &str) -> bool {
    line.contains("\"result\"") && serde_json::from_str::<Value>(line.trim()).is_ok_and(|event| event["type"] == "result")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_final_result_closes_stdin() {
        assert!(is_result(r#"{"type":"result","subtype":"success","result":"done"}"#));
        assert!(!is_result(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"result"}]}}"#));
        assert!(!is_result("not json \"result\""));
    }
}
