use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::claude_stdin::Conversation;
use super::{antigravity, codex, command, parse, retry, stream, Agent, AgentRun, Engine, Task};
use crate::progress::Reporter;

// Running a vendor CLI (Claude Code, Codex) as a child process: build its command line, stream
// and humanize its output, retry transient provider failures, and explain setup problems.

// When an agent fails because it isn't fully installed/configured (no auth, not signed
// in, untrusted folder…), turn the raw dump into a friendly "finish setup" message
// pointing at that engine's docs — instead of leaking the error into the chat.
const SETUP_MARKERS: &[&str] = &[
    "api key",
    "api_key",
    "auth method",
    "authenticat",
    "oauth",
    "not authenticated",
    "unauthorized",
    "not logged in",
    "please log in",
    "please run",
    "login",
    "sign in",
    "credentials",
    "not trusted",
    "set an auth",
    "no auth",
];

// A sign-in that ran out is the common case, and it has one fix the owner can run, so it gets that
// fix and nothing else; any other setup problem keeps the CLI's own words and its docs.
const SIGNED_OUT_MARKERS: &[&str] = &["oauth", "expired", "not logged in", "please log in", "loggedin\": false"];

fn sign_in_command(engine: Engine) -> Option<&'static str> {
    match engine {
        Engine::ClaudeCode => Some("claude auth login"),
        Engine::Codex => Some("codex login"),
        Engine::Antigravity | Engine::Ollama => None,
    }
}

fn setup_hint(engine: Engine, haystack: &str, detail: &str) -> Option<String> {
    let lower = haystack.to_lowercase();
    if !SETUP_MARKERS.iter().any(|marker| lower.contains(marker)) {
        return None;
    }
    let label = engine.label();
    if let Some(command) = sign_in_command(engine).filter(|_| SIGNED_OUT_MARKERS.iter().any(|marker| lower.contains(marker))) {
        return Some(format!("{label} is signed out. Run `{command}` in a terminal, then try again."));
    }
    Some(format!("{label} isn't set up yet: {detail}\n{}", engine.docs_url()))
}

// Run the agent, retrying transient provider failures (overload/rate-limit/5xx/network) with
// exponential backoff so a flaky provider can't fail the whole step. Terminal failures (auth/setup,
// a missing binary, or the run timeout) surface immediately, and a stop is honored during backoff.
pub fn run(agent: &Agent, workspace: &Path, task: &Task, reporter: &Arc<Reporter>) -> Result<AgentRun, String> {
    match run_with_retries(agent, workspace, task, reporter) {
        // The CLI may have forgotten the conversation (cleared history, another machine); the
        // task still matters more than the context, so it runs once more from a fresh session.
        Err(message) if task.resume.is_some() && lost_session(&message) => {
            reporter.log(format!("{} couldn't reopen the previous session, so this step starts a fresh one.", agent.engine.label()));
            run_with_retries(agent, workspace, &Task { resume: None, ..*task }, reporter)
        }
        result => result,
    }
}

const LOST_SESSION_MARKERS: &[&str] = &["no conversation found", "session not found", "thread not found", "could not find session", "no session found"];

fn lost_session(message: &str) -> bool {
    let lower = message.to_lowercase();
    LOST_SESSION_MARKERS.iter().any(|marker| lower.contains(marker))
}

fn run_with_retries(agent: &Agent, workspace: &Path, task: &Task, reporter: &Arc<Reporter>) -> Result<AgentRun, String> {
    let mut attempt = 1;
    loop {
        match run_agent_once(agent, workspace, task, reporter) {
            Ok(run) => return Ok(run),
            Err(failure) => {
                let can_retry = attempt < retry::MAX_ATTEMPTS
                    && failure.transient
                    && !crate::cancel::is_cancelled(reporter.run_id());
                if !can_retry {
                    return Err(failure.message);
                }
                let wait = retry::backoff_delay(attempt);
                reporter.log(format!(
                    "{} is temporarily unavailable — retrying in {}s ({}/{})",
                    agent.engine.label(),
                    wait.as_secs(),
                    attempt + 1,
                    retry::MAX_ATTEMPTS,
                ));
                if !retry::sleep_unless_cancelled(reporter.run_id(), wait) {
                    return Err(failure.message);
                }
                attempt += 1;
            }
        }
    }
}

struct AgentFailure {
    message: String,
    transient: bool,
}

// Both CLIs stream structured events; each becomes a readable activity line so a long run looks
// alive. What the stream reports is passed on the moment it appears, not when the run returns: the
// session, so the conversation survives a run that fails or is stopped, and each file edit, so the
// code can be watched as it changes.
fn stream_lines(engine: Engine, workspace: &Path, reporter: Arc<Reporter>, conversation: Option<Arc<Conversation>>) -> crate::proc::LineMap {
    let workspace = workspace.to_path_buf();
    let announced = AtomicBool::new(false);
    Arc::new(move |line: &str| {
        if let Some(conversation) = &conversation {
            conversation.on_line(line, &reporter);
        }
        if !announced.load(Ordering::Relaxed) {
            if let Some(session) = stream::session_started(engine, line) {
                announced.store(true, Ordering::Relaxed);
                reporter.session(session);
            }
        }
        if engine == Engine::ClaudeCode {
            for edit in stream::edits(line, &workspace) {
                reporter.edit(edit.to_string());
            }
        }
        match engine {
            Engine::ClaudeCode => parse::humanize_stream_line(line),
            Engine::Codex | Engine::Ollama => codex::humanize(line),
            Engine::Antigravity => antigravity::humanize(line),
        }
    })
}

fn run_agent_once(agent: &Agent, workspace: &Path, task: &Task, reporter: &Arc<Reporter>) -> Result<AgentRun, AgentFailure> {
    let engine = agent.engine;
    let (binary, args) = command::build_command(&command::AgentInvocation { engine, model: agent.model.as_deref(), effort: agent.effort.as_deref(), prompt: task.prompt, plan: task.read_only, resume: task.resume, images: task.images, allow: task.allow, instructions: task.instructions, with_env: !task.env.is_empty(), watch: task.watch });
    // A bundled copy (codex inside the ChatGPT app) runs from its full path; otherwise PATH finds it.
    let program = engine.locate().map(|path| path.to_string_lossy().into_owned()).unwrap_or(binary.clone());
    let mut command = Command::new(&program);
    command.args(&args).current_dir(workspace).envs(task.env.iter().map(|(name, value)| (name, value)));

    // Claude Code takes the task over stdin and asks its permission questions there too.
    let conversation = (engine == Engine::ClaudeCode).then(|| Conversation::new(task.prompt));
    let feed = conversation.clone().map(|c| -> crate::proc::Feed { Box::new(move |stdin| c.open(stdin)) });
    let output = match crate::proc::run_streaming(command, reporter.clone(), stream_lines(engine, workspace, reporter.clone(), conversation), feed) {
        Ok(output) => output,
        // A spawn failure (e.g. the binary isn't installed) won't fix itself on retry.
        Err(err) => {
            return Err(AgentFailure {
                message: format!("failed to spawn {binary}: {err}"),
                transient: false,
            })
        }
    };
    if output.success {
        return Ok(parse::extract_run(engine, &output.stdout));
    }
    let combined = format!("{}\n{}", output.stderr, output.stdout);
    // Show the real failure (Claude's final result event / stderr), never the init banner.
    let detail = match engine {
        Engine::ClaudeCode => parse::claude_failure(&output.stdout, &output.stderr),
        Engine::Codex | Engine::Ollama => codex::failure(&output.stdout, &output.stderr),
        Engine::Antigravity => antigravity::failure(&output.stdout, &output.stderr),
    };
    // A setup/auth problem is terminal — surface the friendly hint, never retry it.
    if let Some(hint) = setup_hint(engine, &combined, &detail) {
        return Err(AgentFailure { message: hint, transient: false });
    }
    Err(AgentFailure {
        message: format!("{} failed: {detail}", engine.label()),
        transient: retry::is_transient_failure(&combined),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_auth_becomes_a_friendly_setup_hint() {
        let stderr = "Approval mode overridden because the current folder is not trusted.\nPlease set an Auth method or sign in.";
        let hint = setup_hint(Engine::Codex, stderr, "Please set an Auth method")
            .expect("should detect setup issue");
        assert!(hint.starts_with("Codex isn't set up yet: Please set an Auth method"));
        assert!(hint.contains("developers.openai.com/codex"));
    }

    #[test]
    fn an_expired_sign_in_says_only_how_to_sign_in_again() {
        let detail = "Failed to authenticate: OAuth session expired and could not be refreshed";
        assert_eq!(setup_hint(Engine::ClaudeCode, detail, detail).unwrap(), "Claude Code is signed out. Run `claude auth login` in a terminal, then try again.");
        assert_eq!(setup_hint(Engine::Codex, "Not logged in", "x").unwrap(), "Codex is signed out. Run `codex login` in a terminal, then try again.");
        assert!(setup_hint(Engine::Antigravity, "authentication expired", "authentication expired").unwrap().starts_with("Antigravity isn't set up yet"));
    }

    #[test]
    fn a_forgotten_session_is_recognised_but_other_failures_are_not() {
        assert!(lost_session("Claude Code failed: No conversation found with session ID: 3f48b81e"));
        assert!(lost_session("Codex failed: thread not found: t-1"));
        assert!(!lost_session("Claude Code failed: Overloaded"));
    }

    // The whole path with the real CLI: the task goes in over stdin, Claude asks before a shell
    // write, the answer goes back, and the run ends once stdin closes. A read-only step, because
    // a code step's acceptEdits mode lets a write inside the project through without asking.
    fn attempt_a_write(allow: bool) -> bool {
        let dir = std::env::temp_dir().join(format!("dhrive-approve-{allow}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run_id = format!("live-approve-{allow}");
        let reporter = Arc::new(Reporter::new(run_id.clone(), move |progress| {
            if let crate::progress::Progress::Approval(json) = progress {
                let id = serde_json::from_str::<serde_json::Value>(&json).unwrap()["id"].as_str().unwrap().to_string();
                crate::approvals::answer_approval(id, allow, false).unwrap();
            }
        }));
        crate::cancel::begin(&run_id);
        let agent = Agent::new(Engine::ClaudeCode, Some("haiku".into()));
        let task = Task { prompt: "Use the Bash tool to run exactly: echo hi > probe.txt . Then reply done.", read_only: true, resume: None, images: &[], allow: &[], instructions: None, env: &[], watch: crate::engine::Watch::Owner };
        let run = run(&agent, &dir, &task, &reporter).unwrap();
        let wrote = dir.join("probe.txt").exists();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(!run.summary.is_empty());
        wrote
    }

    #[test]
    #[ignore = "runs the real Claude Code, signed in"]
    fn the_owner_decides_whether_a_blocked_command_runs() {
        assert!(attempt_a_write(true), "allowed, so the command ran");
        assert!(!attempt_a_write(false), "denied, so it didn't");
    }

    // Plan reads without editing, then the code step continues the same conversation and edits.
    #[test]
    #[ignore = "runs the real Antigravity, signed in"]
    fn antigravity_plans_then_codes_in_one_conversation() {
        let dir = std::env::temp_dir().join(format!("dhrive-agy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("math.js"), "export const add = (a, b) => a - b;\n").unwrap();
        let reporter = Arc::new(Reporter::new("live-agy".to_string(), |_| {}));
        crate::cancel::begin("live-agy");
        let agent = Agent::new(Engine::Antigravity, Some("gemini-3.8-flash-low".into()));
        let plan = Task { prompt: "Plan the fix for the add function in math.js. Do not edit any file.", read_only: true, resume: None, images: &[], allow: &[], instructions: None, env: &[], watch: crate::engine::Watch::Owner };
        let planned = run(&agent, &dir, &plan, &reporter).unwrap();
        assert!(!planned.summary.is_empty() && planned.blocked.is_empty(), "{:?} {:?}", planned.summary, planned.blocked);
        assert!(std::fs::read_to_string(dir.join("math.js")).unwrap().contains("a - b"), "the plan step edited");
        let code = Task { prompt: "Carry out your plan.", read_only: false, resume: planned.session_id.as_deref(), ..plan };
        let coded = run(&agent, &dir, &code, &reporter).unwrap();
        assert_eq!(coded.session_id, planned.session_id);
        assert!(std::fs::read_to_string(dir.join("math.js")).unwrap().contains("a + b"), "{}", coded.summary);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_normal_compile_error_is_not_a_setup_hint() {
        assert!(setup_hint(Engine::ClaudeCode, "error: cannot find type Foo in scope", "x").is_none());
    }
}
