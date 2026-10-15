use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::engine::{self, Agent, Engine, Usage};
use crate::prompts::{prompt_for, split_questions};

// A task runs as steps, each on the CLI and model the owner picked for it: a read-only plan, then
// code that follows the plan. A chat is a single read-only step for thinking out loud. A split is the
// maestro's read-only step, turning one brief into subtasks for several CLIs. Learning the company is a
// read-only step that drafts a company's brief from its project, and planning its day is a read-only
// step that turns the brief into the day's tasks. Writing a commit message reads only the changes
// it's handed. Each step is one CLI run in the project.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Plan,
    Code,
    Chat,
    Split,
    Company,
    Day,
    Found,
    Talk,
    Commit,
}

impl Step {
    // Only the code step may edit files or run commands; planning and chatting only read.
    fn read_only(self) -> bool {
        self != Step::Code
    }

    fn doing(self) -> &'static str {
        match self {
            Step::Plan => "planning",
            Step::Code => "coding",
            Step::Chat => "thinking",
            Step::Split => "splitting the work",
            Step::Company => "learning the company",
            Step::Day => "planning the day",
            Step::Found => "founding the company",
            Step::Talk => "thinking",
            Step::Commit => "writing the commit message",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRequest {
    run_id: String,
    folder: String,
    step: Step,
    engine: Engine,
    model: Option<String>,
    #[serde(default)]
    effort: Option<String>,
    task: String,
    plan: Option<String>,
    // The CLI conversation to continue in this project, when the owner keeps context.
    resume: Option<String>,
    // Files the owner attached, as absolute paths.
    #[serde(default)]
    attachments: Vec<String>,
    // The conversation's own instructions; the ones for every project are read here.
    #[serde(default)]
    instructions: String,
    // A company task with Ask first off runs on its own (engine::Watch), with MCP tools if `mcp`.
    #[serde(default)]
    unattended: bool,
    #[serde(default)]
    mcp: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    output: String,
    usage: Option<Usage>,
    session_id: Option<String>,
    // The planner asked questions instead of planning, so the code step should wait for answers.
    needs_answers: bool,
    // What the CLI refused to let the model do, as short markers.
    blocked: Vec<String>,
}

const MAX_TASK: usize = 20_000;
const MAX_PLAN: usize = 100_000;
const MAX_MODEL: usize = 100;
const MAX_RUN_ID: usize = 64;
const MAX_SESSION: usize = 100;

// A model id goes to the CLI as an argument, so it must not look like a flag
// ("--dangerously-skip-permissions") or carry anything but an identifier.
pub(crate) fn valid_model(model: &str) -> bool {
    let mut chars = model.chars();
    model.len() <= MAX_MODEL
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || "._:/-[]".contains(c))
}

// An effort level is one of the words the CLI listed ("low", "xhigh"); it goes in as an argument too.
pub(crate) fn valid_effort(effort: &str) -> bool {
    (1..=12).contains(&effort.len()) && effort.bytes().all(|b| b.is_ascii_lowercase())
}

// Session ids are UUIDs or thread names the CLIs gave us; like models, they go in as arguments.
pub(crate) fn valid_session(session: &str) -> bool {
    let mut chars = session.chars();
    session.len() <= MAX_SESSION && chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) && chars.all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
}

fn check(request: &StepRequest) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let folder = Path::new(&request.folder);
    if !folder.is_dir() {
        return Err("Pick a project folder that exists.".into());
    }
    if request.task.trim().is_empty() || request.task.len() > MAX_TASK {
        return Err(format!("Describe the task in up to {MAX_TASK} characters."));
    }
    if request.plan.as_ref().is_some_and(|plan| plan.len() > MAX_PLAN) {
        return Err(format!("Plans can be up to {MAX_PLAN} characters."));
    }
    if request.model.as_deref().map(str::trim).is_some_and(|m| !m.is_empty() && !valid_model(m)) {
        return Err("That model name has characters a model id never has.".into());
    }
    if request.effort.as_deref().map(str::trim).is_some_and(|e| !e.is_empty() && !valid_effort(e)) {
        return Err("That effort level isn't one a CLI lists.".into());
    }
    if request.resume.as_deref().is_some_and(|session| !valid_session(session)) {
        return Err("That saved session id isn't one a CLI would give.".into());
    }
    crate::instructions::checked(&request.instructions)?;
    if request.run_id.is_empty() || request.run_id.len() > MAX_RUN_ID {
        return Err("Missing run id.".into());
    }
    let attachments = crate::attachments::checked(&request.attachments)?;
    Ok((folder.canonicalize().map_err(|error| format!("Can't open that folder: {error}"))?, attachments))
}

fn watch_of(request: &StepRequest) -> engine::Watch {
    if request.unattended && !request.step.read_only() {
        engine::Watch::Alone { mcp: request.mcp }
    } else {
        engine::Watch::Owner
    }
}

#[tauri::command]
pub async fn run_step(app: tauri::AppHandle, request: StepRequest) -> Result<StepResult, String> {
    let (folder, attachments) = check(&request)?;
    crate::account::allow_runs(&app).await?;
    if request.engine == Engine::Ollama {
        crate::local::ollama::require(request.model.as_deref().map(str::trim).filter(|m| !m.is_empty())).await?;
    }
    tauri::async_runtime::spawn_blocking(move || run_blocking(&app, &folder, &attachments, request))
        .await
        .map_err(|error| format!("The step stopped unexpectedly: {error}"))?
}

fn run_blocking(app: &tauri::AppHandle, folder: &Path, attachments: &[PathBuf], request: StepRequest) -> Result<StepResult, String> {
    let reporter = crate::events::make_reporter(app, request.run_id.clone());
    crate::cancel::start(&request.run_id)?;
    let watch = watch_of(&request);
    let agent = Agent::new(request.engine, request.model).with_effort(request.effort);
    reporter.phase(format!("{} is {}", request.engine.label(), request.step.doing()));
    let prompt = prompt_for(request.step, &request.task, request.plan.as_deref()) + &crate::attachments::prompt_note(attachments) + &crate::connectors::prompt_note(folder);
    let images: Vec<PathBuf> = attachments.iter().filter(|file| crate::attachments::is_image(file)).cloned().collect();
    let allow = crate::rules::rules_for(app, folder);
    let env = crate::env::of_folder(app, folder);
    let prompt = prompt + &crate::env::prompt_note(&env);
    // check() already refused oversized instructions; this only drops control characters.
    let instructions = crate::instructions::for_run(app, &crate::instructions::checked(&request.instructions).unwrap_or_default());
    let task = engine::Task { prompt: &prompt, read_only: request.step.read_only(), resume: request.resume.as_deref(), images: &images, allow: &allow, instructions: instructions.as_deref(), env: &env, watch };
    let before = (request.step == Step::Code).then(|| crate::changes::snapshot(folder)).flatten();
    let run = engine::run_agent(&agent, folder, &task, &reporter);
    if let Some(changes) = before.and_then(|before| crate::changes::since(folder, &before)) {
        reporter.changes(serde_json::to_string(&changes).unwrap_or_default());
    }
    let run = run?;
    let (output, needs_answers) = if request.step == Step::Plan { split_questions(&run.summary) } else { (run.summary, false) };
    Ok(StepResult { output, usage: run.usage, session_id: run.session_id, needs_answers, blocked: run.blocked })
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder()).await.ok().flatten()?;
    picked.into_path().ok().map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(folder: &str, task: &str, model: Option<&str>) -> StepRequest {
        StepRequest {
            run_id: "r1".into(),
            folder: folder.into(),
            step: Step::Code,
            engine: Engine::Codex,
            model: model.map(str::to_string),
            effort: None,
            task: task.into(),
            plan: None,
            resume: None,
            attachments: vec![],
            instructions: String::new(),
            unattended: false,
            mcp: false,
        }
    }

    #[test]
    fn only_a_code_step_with_ask_first_off_is_left_alone() {
        let alone = StepRequest { unattended: true, mcp: true, ..request("/tmp", "x", None) };
        assert_eq!(watch_of(&alone), engine::Watch::Alone { mcp: true });
        assert_eq!(watch_of(&StepRequest { step: Step::Plan, ..alone }), engine::Watch::Owner, "a read-only step always keeps its rules");
        assert_eq!(watch_of(&request("/tmp", "x", None)), engine::Watch::Owner);
    }





    #[test]
    fn only_the_code_step_can_edit() {
        assert!(Step::Chat.read_only() && Step::Plan.read_only() && Step::Split.read_only() && Step::Company.read_only() && Step::Day.read_only() && Step::Found.read_only() && Step::Talk.read_only() && Step::Commit.read_only() && !Step::Code.read_only());
    }

    #[test]
    fn model_ids_that_could_be_flags_are_refused() {
        for good in ["opus", "gpt-6-astra", "claude-opus-5-5", "gpt-5.5", "opus[1m]", "anthropic/claude"] {
            assert!(valid_model(good), "{good}");
        }
        for bad in ["--dangerously-skip-permissions", "-m", "opus; rm -rf /", "a b", "", &"x".repeat(101)] {
            assert!(!valid_model(bad), "{bad}");
        }
    }

    // Runs the real Claude Code on a tiny project, so it needs `claude` signed in and spends a few
    // cents. Run it by hand: cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
    #[test]
    #[ignore]
    fn plans_with_the_real_claude_cli() {
        let project = std::env::temp_dir().join(format!("dhrive-smoke-{}", std::process::id()));
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("calc.py"), "def add(a, b):\n    return a - b\n").unwrap();
        let reporter = std::sync::Arc::new(crate::progress::Reporter::new("smoke", |_| {}));
        let agent = Agent::new(Engine::ClaudeCode, Some("haiku".into()));
        let prompt = prompt_for(Step::Plan, "Fix add() in calc.py.", None);

        let run = engine::run_agent(&agent, &project, &engine::Task { prompt: &prompt, read_only: true, resume: None, images: &[], allow: &[], instructions: None, env: &[], watch: engine::Watch::Owner }, &reporter);

        std::fs::remove_dir_all(&project).unwrap();
        let plan = run.expect("the plan step should succeed").summary;
        assert!(plan.contains("calc.py") || plan.contains("add"), "{plan}");
    }

    #[test]
    fn effort_levels_are_plain_words() {
        assert!(["low", "medium", "xhigh", "max"].iter().all(|e| valid_effort(e)));
        assert!(["--model", "High", "a b", "", "x".repeat(13).as_str()].iter().all(|e| !valid_effort(e)));
    }

    #[test]
    fn session_ids_that_could_be_flags_are_refused() {
        assert!(valid_session("3f48b81e-5044-40ac-aa5f-2f7c80c18525") && valid_session("t-1"));
        for bad in ["--fork-session", "a b", "../x", "", &"x".repeat(101)] {
            assert!(!valid_session(bad), "{bad}");
        }
    }

    #[test]
    fn requests_are_checked_before_any_cli_runs() {
        let here = std::env::temp_dir();
        let here = here.to_str().unwrap();
        assert!(check(&request(here, "add dark mode", Some("gpt-6-astra"))).is_ok());
        assert!(check(&request(here, "add dark mode", Some(""))).is_ok());
        assert!(check(&request("/definitely/not/here", "add dark mode", None)).is_err());
        assert!(check(&request(here, "   ", None)).is_err());
        assert!(check(&request(here, "add dark mode", Some("--yolo"))).is_err());
        assert!(check(&request(here, &"x".repeat(MAX_TASK + 1), None)).is_err());
        let long = StepRequest { instructions: "x".repeat(crate::instructions::MAX_INSTRUCTIONS + 1), ..request(here, "add dark mode", None) };
        assert!(check(&long).is_err());
    }
}
