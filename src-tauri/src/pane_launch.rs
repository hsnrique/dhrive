use crate::engine::Engine;

// How a Terminals pane starts its CLI: with the model the owner picked, and, for a pane the
// maestro opened, with its subtask as the first message. Such a pane works in a worktree of its
// own, so its CLI may edit files there without asking; commands still wait for the owner, in the
// pane, as they would in any terminal.

pub const MAX_TASK: usize = 20_000;

fn task_args(engine: Engine, task: String) -> Vec<String> {
    match engine {
        Engine::ClaudeCode => vec!["--permission-mode".into(), "acceptEdits".into(), task],
        Engine::Codex => vec!["--sandbox".into(), "workspace-write".into(), "--ask-for-approval".into(), "on-request".into(), task],
        Engine::Antigravity => vec!["--mode".into(), "accept-edits".into(), "--prompt-interactive".into(), task],
        Engine::Ollama => vec![],
    }
}

// A task goes in as one argument, never through a shell; one that starts with "-" would read as
// a flag, so it gets a word in front.
fn safe_task(task: &str) -> Result<Option<String>, String> {
    let task = task.trim();
    if task.is_empty() {
        return Ok(None);
    }
    if task.len() > MAX_TASK {
        return Err(format!("A pane's task can be up to {MAX_TASK} characters."));
    }
    Ok(Some(if task.starts_with('-') { format!("Task: {task}") } else { task.to_string() }))
}

pub fn args(engine: Engine, model: Option<&str>, task: Option<&str>) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    if let Some(model) = model.map(str::trim).filter(|m| !m.is_empty()) {
        if !crate::flow::valid_model(model) {
            return Err("That model name has characters a model id never has.".into());
        }
        args.extend(["--model".to_string(), model.to_string()]);
    }
    if let Some(task) = safe_task(task.unwrap_or_default())? {
        args.extend(task_args(engine, task));
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_pane_starts_the_cli_bare() {
        assert!(args(Engine::ClaudeCode, None, None).unwrap().is_empty());
        assert!(args(Engine::Codex, Some("  "), Some("   ")).unwrap().is_empty());
    }

    #[test]
    fn a_maestro_pane_starts_on_its_model_and_task_with_edits_allowed() {
        assert_eq!(args(Engine::ClaudeCode, Some("opus"), Some(" add a toggle ")).unwrap(), ["--model", "opus", "--permission-mode", "acceptEdits", "add a toggle"]);
        assert_eq!(args(Engine::Codex, Some("gpt-5.5"), Some("add the route")).unwrap(), ["--model", "gpt-5.5", "--sandbox", "workspace-write", "--ask-for-approval", "on-request", "add the route"]);
        assert_eq!(args(Engine::Antigravity, None, Some("write docs")).unwrap(), ["--mode", "accept-edits", "--prompt-interactive", "write docs"]);
    }

    #[test]
    fn nothing_from_the_webview_can_become_a_flag() {
        assert_eq!(args(Engine::ClaudeCode, None, Some("--dangerously-skip-permissions")).unwrap().last().unwrap(), "Task: --dangerously-skip-permissions");
        assert!(args(Engine::ClaudeCode, Some("--yolo"), None).is_err());
        assert!(args(Engine::Codex, None, Some(&"x".repeat(MAX_TASK + 1))).is_err());
    }
}
