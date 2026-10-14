use std::fs::File;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::progress::Reporter;

// dhrive's own check of a delivery, after a company task's code step: the project's lint,
// typecheck, test and build scripts, the ones its engineering standard keeps (lib/standards.ts),
// run here rather than taken on the agent's word. Each runs in its own process group under the
// task's run id, so a stop takes it down with whatever it started, and none runs past LIMIT.

const CHECKS: [&str; 4] = ["lint", "typecheck", "test", "build"];
const LIMIT: Duration = Duration::from_secs(10 * 60);
const TAIL_LINES: usize = 40;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    name: String,
    ok: bool,
    // The end of what it printed, where the reason a check failed is.
    tail: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Report {
    // No package.json, or nothing a check covers changed (documents only).
    Skipped { why: String },
    // `missing`: the scripts the standard keeps that package.json doesn't have.
    Ran { checks: Vec<Check>, missing: Vec<String> },
}

fn scripts(folder: &Path) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(folder.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(json["scripts"].as_object().map(|s| s.keys().cloned().collect()).unwrap_or_default())
}

// What the task left uncommitted (backups commit after each task), less what no check reads. A
// folder git can't read counts as changed.
fn code_changed(folder: &Path) -> bool {
    let Ok(out) = Command::new("git").arg("-C").arg(folder).args(["status", "--porcelain"]).env("GIT_OPTIONAL_LOCKS", "0").output() else { return true };
    if !out.status.success() {
        return true;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().filter_map(|l| l.get(3..)).any(|p| !(p.ends_with(".md") || p.starts_with("docs/") || p.starts_with(".company/")))
}

fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn tail(text: &str) -> String {
    let text = plain(text);
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(TAIL_LINES)..].join("\n")
}

fn kill_group(pid: u32) {
    let _ = Command::new("/bin/kill").arg("-9").arg(format!("-{pid}")).stderr(Stdio::null()).status();
}

// One of dhrive's fixed commands (never a name the project chose), its output to a file: nothing
// reads a pipe while it runs, and a chatty test run would fill one and hang.
fn spawn(folder: &Path, line: &str, env: &[(String, String)], log: File) -> std::io::Result<std::process::Child> {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", &format!("{line} 2>&1")]).current_dir(folder).envs(env.iter().map(|(n, v)| (n, v)));
    command.env("CI", "1").env("NEXT_TELEMETRY_DISABLED", "1").stdin(Stdio::null()).stdout(log).stderr(Stdio::null());
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    command.spawn()
}

// Whether it passed, or None once it ran past LIMIT. A stop kills the group from cancel.rs, and an
// error says so.
fn wait(child: &mut std::process::Child, run_id: &str) -> Result<Option<bool>, String> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return if crate::cancel::is_cancelled(run_id) { Err("Stopped.".into()) } else { Ok(Some(status.success())) };
        }
        if crate::cancel::is_cancelled(run_id) {
            return Err("Stopped.".into());
        }
        if started.elapsed() > LIMIT {
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn run_one(folder: &Path, line: &str, name: &str, env: &[(String, String)], run_id: &str) -> Result<Check, String> {
    let log_path = std::env::temp_dir().join(format!("dhrive-check-{}-{name}-{}.log", std::process::id(), crate::projects::now_millis()));
    let mut child = spawn(folder, line, env, File::create(&log_path).map_err(|e| e.to_string())?).map_err(|e| format!("Couldn't run {name}: {e}"))?;
    let pid = child.id();
    crate::cancel::register(run_id, pid);
    let outcome = wait(&mut child, run_id);
    crate::cancel::unregister(run_id, pid);
    if !matches!(outcome, Ok(Some(true))) {
        kill_group(pid);
        let _ = child.wait();
    }
    let said = tail(&std::fs::read(&log_path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default());
    let _ = std::fs::remove_file(&log_path);
    Ok(match outcome? {
        Some(ok) => Check { name: name.to_string(), ok, tail: said },
        None => Check { name: name.to_string(), ok: false, tail: format!("{said}\n{name} ran past 10 minutes and was stopped.") },
    })
}

pub(crate) fn run(folder: &Path, env: &[(String, String)], run_id: &str, reporter: &Reporter) -> Result<Report, String> {
    let Some(present) = scripts(folder) else { return Ok(Report::Skipped { why: "No package.json to check.".into() }) };
    if !code_changed(folder) {
        return Ok(Report::Skipped { why: "Only documents changed.".into() });
    }
    let mut checks = Vec::new();
    if !folder.join("node_modules").is_dir() {
        reporter.phase("Checking the delivery · installing");
        let install = run_one(folder, "npm install", "install", env, run_id)?;
        if !install.ok {
            return Ok(Report::Ran { checks: vec![install], missing: Vec::new() });
        }
    }
    let wanted: Vec<&str> = CHECKS.iter().copied().filter(|c| present.iter().any(|p| p == c)).collect();
    for (n, name) in wanted.iter().enumerate() {
        reporter.phase(format!("Checking the delivery · {name} ({} of {})", n + 1, wanted.len()));
        checks.push(run_one(folder, &format!("npm run {name}"), name, env, run_id)?);
    }
    let missing = CHECKS.iter().filter(|c| !wanted.contains(c)).map(|c| c.to_string()).collect();
    Ok(Report::Ran { checks, missing })
}

#[tauri::command]
// In the company's folder, or in an army task's copy of it (army.rs) when one is named.
pub async fn run_checks(app: tauri::AppHandle, project: String, run_id: String, task: Option<String>) -> Result<Report, String> {
    if run_id.is_empty() || run_id.len() > 64 {
        return Err("Missing run id.".into());
    }
    let mut folder = crate::terminal::project_folder(&app, &project)?;
    if let Some(task) = task {
        folder = crate::worktrees::copy_dir(&folder, &task)?;
        if !folder.join(".git").exists() {
            return Err("This task has no copy of the company.".into());
        }
    }
    let env = crate::env::of_project(&project);
    let reporter = crate::events::make_reporter(&app, run_id.clone());
    crate::cancel::begin(&run_id);
    tauri::async_runtime::spawn_blocking(move || run(&folder, &env, &run_id, &reporter)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "checks_tests.rs"]
mod tests;
