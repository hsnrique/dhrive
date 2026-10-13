use std::path::PathBuf;

use super::{Engine, Watch};

pub struct AgentInvocation<'a> {
    pub engine: Engine,
    // The model to run within the chosen CLI (e.g. "opus"); None uses that CLI's own default.
    pub model: Option<&'a str>,
    // How hard the model thinks ("high"), as the CLI names its levels; None leaves the CLI's default.
    pub effort: Option<&'a str>,
    pub prompt: &'a str,
    // A plan step only reads the project; it never edits files or runs commands.
    pub plan: bool,
    // The CLI's conversation to continue (a Claude session or a Codex thread), when context is kept.
    pub resume: Option<&'a str>,
    // Images the owner attached; Codex takes them as images, Claude reads the files it's told of.
    pub images: &'a [PathBuf],
    // Tool rules the owner allowed for good in this project ("Bash(npm test:*)").
    pub allow: &'a [String],
    // The owner's instructions from dhrive, which always open with dhrive's own sentence.
    pub instructions: Option<&'a str>,
    // The company's environment is on the process; Codex keeps names with KEY, SECRET or TOKEN in
    // them from the commands it runs unless told otherwise.
    pub with_env: bool,
    // Only a code step is ever left alone; a read-only one keeps its read-only rules (Watch).
    pub watch: Watch,
}

// Tools a step may use without asking; for anything else Claude Code asks, and dhrive puts the
// question to the owner (approvals.rs). Searching the web is only reading, so it never asks; opening
// a page does. A read-only step (plan, chat) may read the repo and its history but never write: it runs in the default permission mode, because acceptEdits also approves shell commands
// that write files (`echo hi > note.txt` went through), and the edit tools are denied outright,
// which wins over any allow rule.
// ponytail: an owner's own rule allowing every Bash command still lets a read-only step write
// through the shell, since Claude Code has no read-only shell to force. Codex's read-only sandbox
// has no such gap.
const READ_TOOLS: &str = "Read,Glob,Grep,WebSearch,Bash(git status:*),Bash(git log:*),Bash(git diff:*),Bash(git show:*)";
const EDIT_TOOLS: &str = "Edit,Write,NotebookEdit";
const CODE_TOOLS: &str = "Read,Glob,Grep,WebSearch,Edit,Write,Bash";

// Whether this step runs on its own, and if so whether MCP tools are there: Some(mcp) or None.
fn alone(plan: bool, watch: Watch) -> Option<bool> {
    match watch {
        Watch::Alone { mcp } if !plan => Some(mcp),
        _ => None,
    }
}

pub fn build_command(invocation: &AgentInvocation) -> (String, Vec<String>) {
    match invocation.engine {
        Engine::ClaudeCode => claude_command(invocation),
        Engine::Codex => codex_command(invocation, invocation.resume, false),
        Engine::Ollama => codex_command(invocation, None, true),
        Engine::Antigravity => super::antigravity::command(invocation),
    }
}

// Every CLI exposes its model the same way; each builder places it where its parser is happy.
pub(super) fn with_model(args: &mut Vec<String>, model: Option<&str>) {
    if let Some(model) = model {
        args.push("--model".into());
        args.push(model.into());
    }
}

// The prompt goes in over stdin as the first message (claude_stdin.rs), and Claude Code asks its
// permission questions back on the same stream instead of refusing on its own.
fn claude_command(invocation: &AgentInvocation) -> (String, Vec<String>) {
    let AgentInvocation { plan, model, effort, resume, allow, instructions, watch, .. } = *invocation;
    let alone = alone(plan, watch);
    let (mode, tools) = match (plan, alone) {
        (true, _) => ("default", READ_TOOLS),
        (false, Some(_)) => ("bypassPermissions", CODE_TOOLS),
        (false, None) => ("acceptEdits", CODE_TOOLS),
    };
    let tools = std::iter::once(tools.to_string()).chain(allow.iter().cloned()).collect::<Vec<_>>().join(",");
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--input-format".into(),
        "stream-json".into(),
        // stream-json emits an event per step (requires --verbose) so the UI can show the run
        // working in real time, instead of one silent blob at the end.
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--permission-prompt-tool".into(),
        "stdio".into(),
        "--permission-mode".into(),
        mode.into(),
        "--allowedTools".into(),
        tools,
    ];
    if plan {
        args.extend(["--disallowedTools".into(), EDIT_TOOLS.into()]);
    }
    // With no --mcp-config, strict leaves the run with no MCP server at all.
    if alone == Some(false) {
        args.push("--strict-mcp-config".into());
    }
    if let Some(text) = instructions {
        args.extend(["--append-system-prompt".into(), text.into()]);
    }
    with_model(&mut args, model);
    if let Some(level) = effort {
        args.extend(["--effort".into(), level.into()]);
    }
    if let Some(session) = resume {
        args.push("--resume".into());
        args.push(session.into());
    }
    ("claude".into(), args)
}

fn codex_command(invocation: &AgentInvocation, resume: Option<&str>, local: bool) -> (String, Vec<String>) {
    let AgentInvocation { prompt, plan, model, effort, images, instructions, with_env, watch, .. } = *invocation;
    let sandbox = if plan { "read-only" } else { "workspace-write" };
    let mut args: Vec<String> = vec!["exec".into()];
    if resume.is_some() {
        args.push("resume".into());
    }
    // The project may not be a git repo yet; Codex refuses to run in one without this. JSONL events
    // carry token usage and the final message; plain text carries neither.
    args.extend(["--skip-git-repo-check".into(), "--json".into()]);
    // Codex's own open-weight mode, pointed at Ollama. The owner's MCP servers stay off: their tool
    // lists alone can overflow a local model's context.
    if local {
        args.extend(["--oss", "--local-provider", "ollama", "-c", "mcp_servers={}"].map(String::from));
    }
    // A config value is read as TOML, and a JSON string (as serde writes it) is a valid TOML string.
    // ponytail: this replaces any developer_instructions in the owner's own config.toml; merge the two
    // if someone keeps some there.
    if let Some(text) = instructions {
        args.extend(["-c".into(), format!("developer_instructions={}", serde_json::Value::from(text))]);
    }
    if with_env {
        args.extend(["-c".into(), "shell_environment_policy.ignore_default_excludes=true".into()]);
    }
    // Codex never asks in a code step; left alone without MCP, it starts none. Local runs have none.
    if !local && alone(plan, watch) == Some(false) {
        args.extend(["-c".into(), "mcp_servers={}".into()]);
    }
    // Local models have no reasoning levels to set.
    if let Some(level) = effort.filter(|_| !local) {
        args.extend(["-c".into(), format!("model_reasoning_effort={}", serde_json::Value::from(level))]);
    }
    // `exec resume` has no --sandbox flag, so the same setting goes in as a config override there.
    match resume {
        Some(_) => args.extend(["-c".into(), format!("sandbox_mode={sandbox}")]),
        None => args.extend(["--sandbox".into(), sandbox.into()]),
    }
    // Codex takes the session and prompt as trailing positionals, so every flag goes before them;
    // --image takes several values, so "--" ends it before they start. Local models get none: few of
    // them can see.
    with_model(&mut args, model);
    if !local {
        for image in images {
            args.extend(["--image".into(), image.to_string_lossy().into_owned()]);
        }
    }
    args.push("--".into());
    args.extend(resume.map(str::to_string));
    args.push(prompt.into());
    ("codex".into(), args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invoke(engine: Engine, model: Option<&str>, plan: bool) -> AgentInvocation<'_> {
        AgentInvocation { engine, model, effort: None, prompt: "add a dark mode toggle", plan, resume: None, images: &[], allow: &[], instructions: None, with_env: false, watch: Watch::Owner }
    }

    fn args_for(engine: Engine, plan: bool) -> Vec<String> {
        build_command(&invoke(engine, None, plan)).1
    }

    fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2).any(|w| w[0] == flag && w[1] == value)
    }

    #[test]
    fn the_effort_goes_to_each_cli_as_it_names_it() {
        assert!(has_pair(&build_command(&AgentInvocation { effort: Some("xhigh"), ..invoke(Engine::ClaudeCode, None, true) }).1, "--effort", "xhigh"));
        assert!(has_pair(&build_command(&AgentInvocation { effort: Some("high"), resume: Some("t-1"), ..invoke(Engine::Codex, None, false) }).1, "-c", "model_reasoning_effort=\"high\""));
        assert!(!build_command(&AgentInvocation { effort: Some("high"), ..invoke(Engine::Ollama, None, false) }).1.iter().any(|a| a.contains("reasoning")));
        assert!(!args_for(Engine::ClaudeCode, false).iter().any(|a| a == "--effort"), "no effort, no flag");
    }

    #[test]
    fn plan_steps_are_read_only_in_both_clis() {
        let claude = args_for(Engine::ClaudeCode, true);
        assert!(has_pair(&claude, "--permission-mode", "default"), "acceptEdits lets shell writes through");
        assert!(has_pair(&claude, "--disallowedTools", "Edit,Write,NotebookEdit"));
        let allowed = claude.windows(2).find(|w| w[0] == "--allowedTools").map(|w| w[1].as_str()).unwrap();
        assert!(allowed.contains("Bash(git status:*)") && allowed.contains("Bash(git diff:*)") && allowed.contains("WebSearch"));
        assert!(!allowed.split(',').any(|tool| ["Edit", "Write", "Bash"].contains(&tool)), "{allowed}");
        assert!(has_pair(&args_for(Engine::Codex, true), "--sandbox", "read-only"));
    }

    #[test]
    fn code_steps_can_edit_and_run_commands() {
        assert!(has_pair(&args_for(Engine::ClaudeCode, false), "--allowedTools", "Read,Glob,Grep,WebSearch,Edit,Write,Bash"));
        assert!(has_pair(&args_for(Engine::ClaudeCode, false), "--permission-mode", "acceptEdits"));
        assert!(!args_for(Engine::ClaudeCode, false).iter().any(|a| a == "--disallowedTools"));
        assert!(has_pair(&args_for(Engine::Codex, false), "--sandbox", "workspace-write"));
    }

    #[test]
    fn claude_streams_both_ways_and_asks_its_permission_questions_over_stdio() {
        let args = args_for(Engine::ClaudeCode, false);
        assert!(args.contains(&"-p".to_string()) && args.contains(&"--verbose".to_string()));
        assert!(has_pair(&args, "--input-format", "stream-json") && has_pair(&args, "--output-format", "stream-json"));
        assert!(has_pair(&args, "--permission-prompt-tool", "stdio"));
        assert!(!args.iter().any(|a| a.contains("dark mode")), "the prompt goes in over stdin");
    }

    #[test]
    fn a_code_step_left_alone_asks_nobody_and_has_mcp_only_if_the_owner_said_so() {
        let alone = |mcp| Watch::Alone { mcp };
        let claude = |watch, plan| build_command(&AgentInvocation { watch, ..invoke(Engine::ClaudeCode, None, plan) }).1;
        assert!(has_pair(&claude(alone(false), false), "--permission-mode", "bypassPermissions"));
        assert!(claude(alone(false), false).iter().any(|a| a == "--strict-mcp-config"), "no MCP server starts");
        assert!(!claude(alone(true), false).iter().any(|a| a == "--strict-mcp-config"), "the owner let MCP tools run");
        assert!(has_pair(&claude(Watch::Owner, false), "--permission-mode", "acceptEdits"), "watched, it asks as before");
        assert!(has_pair(&claude(alone(true), true), "--permission-mode", "default"), "a read-only step is never left alone");
        let codex = |watch| build_command(&AgentInvocation { watch, ..invoke(Engine::Codex, None, false) }).1;
        assert!(has_pair(&codex(alone(false)), "-c", "mcp_servers={}"));
        assert!(!codex(alone(true)).iter().any(|a| a == "mcp_servers={}"));
        assert!(!codex(Watch::Owner).iter().any(|a| a == "mcp_servers={}"));
    }

    #[test]
    fn codex_lets_the_companys_environment_reach_its_commands_only_when_there_is_one() {
        let flag = "shell_environment_policy.ignore_default_excludes=true";
        assert!(has_pair(&build_command(&AgentInvocation { with_env: true, ..invoke(Engine::Codex, None, false) }).1, "-c", flag));
        assert!(has_pair(&build_command(&AgentInvocation { with_env: true, resume: Some("t-1"), ..invoke(Engine::Codex, None, false) }).1, "-c", flag));
        assert!(!build_command(&invoke(Engine::Codex, None, false)).1.iter().any(|a| a == flag));
        assert!(!build_command(&AgentInvocation { with_env: true, ..invoke(Engine::ClaudeCode, None, false) }).1.iter().any(|a| a == flag), "Claude Code passes its environment on as it is");
    }

    #[test]
    fn rules_the_owner_allowed_join_the_allowed_tools() {
        let allow = ["Bash(npm test:*)".to_string(), "WebFetch(domain:docs.stripe.com)".to_string()];
        let args = build_command(&AgentInvocation { allow: &allow, ..invoke(Engine::ClaudeCode, None, true) }).1;
        assert!(has_pair(&args, "--allowedTools", &format!("{READ_TOOLS},Bash(npm test:*),WebFetch(domain:docs.stripe.com)")));
        assert!(has_pair(&args, "--disallowedTools", EDIT_TOOLS), "a read-only step still can't edit");
    }

    #[test]
    fn the_owners_instructions_reach_every_cli_as_system_instructions() {
        let text = "The owner keeps these.\n- Say \"done\" at the end";
        let claude = build_command(&AgentInvocation { instructions: Some(text), ..invoke(Engine::ClaudeCode, None, true) }).1;
        assert!(has_pair(&claude, "--append-system-prompt", text));
        for engine in [Engine::Codex, Engine::Ollama] {
            let args = build_command(&AgentInvocation { instructions: Some(text), resume: Some("t-1"), ..invoke(engine, None, false) }).1;
            assert!(has_pair(&args, "-c", r#"developer_instructions="The owner keeps these.\n- Say \"done\" at the end""#), "{engine:?} {args:?}");
            assert_eq!(args.last().map(String::as_str), Some("add a dark mode toggle"));
        }
        assert!(!args_for(Engine::ClaudeCode, false).iter().any(|a| a == "--append-system-prompt"));
        assert!(!args_for(Engine::Codex, false).iter().any(|a| a.starts_with("developer_instructions")));
    }

    #[test]
    fn codex_skips_the_git_check_and_streams_json() {
        let args = args_for(Engine::Codex, false);
        assert_eq!(args.first().map(String::as_str), Some("exec"));
        assert!(args.iter().any(|a| a == "--skip-git-repo-check") && args.iter().any(|a| a == "--json"));
    }

    #[test]
    fn the_model_is_passed_to_both_and_omitted_when_none() {
        for engine in Engine::ALL {
            assert!(has_pair(&build_command(&invoke(engine, Some("opus"), false)).1, "--model", "opus"), "{engine:?}");
            assert!(!args_for(engine, false).iter().any(|a| a == "--model"), "{engine:?}");
        }
    }

    #[test]
    fn codex_keeps_the_prompt_last_after_the_model_flag() {
        let args = build_command(&invoke(Engine::Codex, Some("gpt-6-astra"), false)).1;
        assert_eq!(args.last().map(String::as_str), Some("add a dark mode toggle"));
    }

    #[test]
    fn claude_resumes_the_given_session() {
        let args = build_command(&AgentInvocation { resume: Some("sess-1"), ..invoke(Engine::ClaudeCode, None, false) }).1;
        assert!(has_pair(&args, "--resume", "sess-1"));
        assert!(!args_for(Engine::ClaudeCode, false).iter().any(|a| a == "--resume"));
    }

    #[test]
    fn codex_resumes_through_exec_resume_with_the_sandbox_as_config() {
        let args = build_command(&AgentInvocation { resume: Some("t-1"), ..invoke(Engine::Codex, Some("gpt-6-astra"), true) }).1;
        assert_eq!(&args[..2], ["exec", "resume"]);
        assert!(has_pair(&args, "-c", "sandbox_mode=read-only"));
        assert!(!args.iter().any(|a| a == "--sandbox"));
        assert_eq!(&args[args.len() - 3..], ["--", "t-1", "add a dark mode toggle"]);
    }

    #[test]
    fn codex_gets_attached_images_before_the_positionals() {
        let images = [PathBuf::from("/tmp/shot.png")];
        let args = build_command(&AgentInvocation { images: &images, resume: Some("t-1"), ..invoke(Engine::Codex, None, true) }).1;
        let at = args.iter().position(|a| a == "--image").unwrap();
        assert_eq!(&args[at..], ["--image", "/tmp/shot.png", "--", "t-1", "add a dark mode toggle"]);
        let local = build_command(&AgentInvocation { images: &images, ..invoke(Engine::Ollama, None, true) }).1;
        assert!(!local.iter().any(|a| a == "--image"));
        assert!(!build_command(&AgentInvocation { images: &images, ..invoke(Engine::ClaudeCode, None, true) }).1.iter().any(|a| a == "--image"));
    }

    #[test]
    fn ollama_runs_codex_in_local_mode_without_mcp_or_resume() {
        let args = build_command(&AgentInvocation { resume: Some("t-1"), ..invoke(Engine::Ollama, Some("ornith:9b"), false) }).1;
        assert!(has_pair(&args, "--local-provider", "ollama") && args.contains(&"--oss".to_string()));
        assert!(has_pair(&args, "-c", "mcp_servers={}"));
        assert!(has_pair(&args, "--sandbox", "workspace-write") && has_pair(&args, "--model", "ornith:9b"));
        assert!(!args.iter().any(|a| a == "resume" || a == "t-1"));
        assert!(!args_for(Engine::Codex, false).contains(&"--oss".to_string()));
    }

    #[test]
    fn binary_matches_engine() {
        assert_eq!(build_command(&invoke(Engine::ClaudeCode, None, false)).0, "claude");
        assert_eq!(build_command(&invoke(Engine::Codex, None, false)).0, "codex");
        assert_eq!(build_command(&invoke(Engine::Ollama, None, false)).0, "codex");
        assert_eq!(build_command(&invoke(Engine::Antigravity, None, false)).0, "agy");
    }
}
