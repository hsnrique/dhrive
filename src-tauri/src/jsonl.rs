use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

// A CLI spoken to in JSON lines over stdin and stdout (Claude Code's SDK mode, Codex's app-server),
// for short read-only questions such as "which models do you have" or "how much of the plan is
// used". Dropping it kills the CLI and anything it started.
pub struct JsonlChild {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Value>,
    deadline: Instant,
}

impl JsonlChild {
    // Away from any project, so no project's own settings or instructions get loaded.
    pub fn spawn(program: &Path, args: &[&str], timeout: Duration) -> Result<Self, String> {
        Self::spawn_in(program, args, &std::env::temp_dir(), timeout)
    }

    // In a project, for what depends on it: its own MCP servers, skills and hooks.
    pub fn spawn_in(program: &Path, args: &[&str], folder: &Path, timeout: Duration) -> Result<Self, String> {
        let mut child = Command::new(program)
            .args(args)
            .current_dir(folder)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|error| format!("Couldn't start {}: {error}", program.display()))?;
        let stdin = child.stdin.take().ok_or("No stdin to write to.")?;
        let stdout = child.stdout.take().ok_or("No stdout to read.")?;
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let parsed = serde_json::from_str::<Value>(&line);
                if parsed.is_ok_and(|value| sender.send(value).is_err()) {
                    break;
                }
            }
        });
        Ok(Self { child, stdin, lines, deadline: Instant::now() + timeout })
    }

    pub fn send(&mut self, message: &Value) -> Result<(), String> {
        writeln!(self.stdin, "{message}").and_then(|()| self.stdin.flush()).map_err(|error| format!("The CLI stopped listening: {error}"))
    }

    // The first message that matches, skipping the notifications in between.
    pub fn wait_for(&self, matches: impl Fn(&Value) -> bool) -> Result<Value, String> {
        loop {
            let left = self.deadline.checked_duration_since(Instant::now()).ok_or("The CLI didn't answer in time.")?;
            let message = self.lines.recv_timeout(left).map_err(|_| "The CLI didn't answer.".to_string())?;
            if matches(&message) {
                return Ok(message);
            }
        }
    }
}

// Claude Code's SDK protocol: a control request, answered by a control response with the same id.
impl JsonlChild {
    pub fn control(&mut self, id: &str, request: Value) -> Result<Value, String> {
        self.send(&json!({ "type": "control_request", "request_id": id, "request": request }))?;
        let answer = self.wait_for(|m| m["type"] == "control_response" && m["response"]["request_id"] == id)?;
        match answer["response"]["subtype"].as_str() {
            Some("success") => Ok(answer["response"]["response"].clone()),
            _ => Err(answer["response"]["error"].as_str().unwrap_or("Claude Code refused the request.").to_string()),
        }
    }
}

// Codex's app-server speaks JSON-RPC and wants to be introduced before any question.
impl JsonlChild {
    pub fn codex_in(program: &Path, folder: &Path, timeout: Duration) -> Result<Self, String> {
        let mut codex = Self::spawn_in(program, &["app-server"], folder, timeout)?;
        codex.call(0, "initialize", json!({ "clientInfo": { "name": "dhrive", "version": env!("CARGO_PKG_VERSION") } }))?;
        codex.send(&json!({ "method": "initialized" }))?;
        Ok(codex)
    }

    pub fn call(&mut self, id: u64, method: &str, params: Value) -> Result<Value, String> {
        self.send(&json!({ "id": id, "method": method, "params": params }))?;
        let answer = self.wait_for(|m| m["id"] == id && (m.get("result").is_some() || m.get("error").is_some()))?;
        answer.get("result").cloned().ok_or_else(|| format!("Codex refused {method}: {}", answer["error"]["message"].as_str().unwrap_or("no reason given")))
    }
}

impl Drop for JsonlChild {
    fn drop(&mut self) {
        // process_group(0) made the CLI its own group leader, so -pid reaches its children too.
        let _ = Command::new("/bin/kill").arg("-9").arg(format!("-{}", self.child.id())).status();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_are_matched_past_other_messages() {
        let mut cat = JsonlChild::spawn(Path::new("/bin/cat"), &[], Duration::from_secs(5)).unwrap();
        cat.send(&serde_json::json!({ "method": "noise" })).unwrap();
        cat.send(&serde_json::json!({ "id": 7, "result": "ok" })).unwrap();
        assert_eq!(cat.wait_for(|m| m["id"] == 7).unwrap()["result"], "ok");
    }

    #[test]
    fn a_refused_request_says_why() {
        let mut cat = JsonlChild::spawn(Path::new("/bin/cat"), &[], Duration::from_secs(5)).unwrap();
        // cat echoes the request back, which is neither a success nor a result.
        assert!(cat.control("x", json!({ "subtype": "initialize" })).is_err());
    }

    #[test]
    fn a_silent_cli_times_out_instead_of_hanging() {
        let cat = JsonlChild::spawn(Path::new("/bin/cat"), &[], Duration::from_millis(200)).unwrap();
        assert!(cat.wait_for(|_| true).is_err());
    }
}
