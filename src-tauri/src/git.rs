use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

// Finishing a code step the way a developer would: commit the files it changed (on a new branch when
// the project sits on its default one), push, and open a pull request with gh. Only the step's own
// files go in the commit; anything else the owner has staged stays staged and out of it.

const LOCAL: Duration = Duration::from_secs(30);
pub(crate) const NETWORK: Duration = Duration::from_secs(120);
const MAX_MESSAGE: usize = 5000;
const MAX_PATHS: usize = 1000;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    // None when HEAD isn't on a branch.
    branch: Option<String>,
    on_default: bool,
    can_push: bool,
    gh: bool,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Committed {
    sha: String,
    branch: Option<String>,
}

// Never a prompt: git and gh fail instead of waiting on a terminal nobody sees.
// ponytail: output is read after the process ends, fine for git's and gh's few lines; a command that
// printed past the pipe's 64 KB would stall until the timeout.
pub(crate) fn run(folder: &Path, program: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(folder)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Couldn't run {program}: {error}"))?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            return Err(format!("{program} took too long and was stopped."));
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    let (mut out, mut err) = (String::new(), String::new());
    child.stdout.take().map(|mut s| s.read_to_string(&mut out));
    child.stderr.take().map(|mut s| s.read_to_string(&mut err));
    if status.success() {
        return Ok(out.trim().to_string());
    }
    let said = if err.trim().is_empty() { out } else { err };
    Err(said.trim().chars().take(600).collect())
}

pub(crate) fn git(folder: &Path, args: &[&str]) -> Result<String, String> {
    run(folder, "git", args, LOCAL)
}

fn info(folder: &Path) -> Result<GitInfo, String> {
    git(folder, &["rev-parse", "--is-inside-work-tree"]).map_err(|_| "This project isn't a git repo.".to_string())?;
    let branch = git(folder, &["symbolic-ref", "--short", "HEAD"]).ok();
    let default = git(folder, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).ok().and_then(|r| r.strip_prefix("origin/").map(str::to_string));
    let on_default = match (&branch, &default) {
        (Some(branch), Some(default)) => branch == default,
        (Some(branch), None) => branch == "main" || branch == "master",
        _ => false,
    };
    let can_push = git(folder, &["remote"]).is_ok_and(|remotes| remotes.lines().any(|r| r == "origin"));
    let gh = crate::engine::find_on_path("gh", &std::env::var_os("PATH").unwrap_or_default()).is_some();
    Ok(GitInfo { branch, on_default, can_push, gh })
}

// No branch, or the default one: work brought in goes on a branch of its own instead.
pub(crate) fn on_default_branch(folder: &Path) -> bool {
    info(folder).map_or(true, |info| info.on_default || info.branch.is_none())
}

// A branch name typed in the webview becomes an argument: never flag-like, and one git accepts.
fn valid_branch(folder: &Path, name: &str) -> bool {
    !name.starts_with('-') && name.len() <= 100 && !name.chars().any(|c| c.is_whitespace() || c.is_control()) && git(folder, &["check-ref-format", "--branch", name]).is_ok()
}

fn commit(folder: &Path, paths: &[String], message: &str, branch: Option<&str>) -> Result<Committed, String> {
    let message = message.trim();
    if message.is_empty() || message.chars().count() > MAX_MESSAGE || message.contains('\0') {
        return Err(format!("Write a commit message of up to {MAX_MESSAGE} characters."));
    }
    if paths.is_empty() || paths.len() > MAX_PATHS || !paths.iter().all(|p| crate::changes::valid_path(p)) {
        return Err("Those aren't files in this project.".into());
    }
    let paths: Vec<&str> = paths.iter().map(String::as_str).collect();
    // Checked before any branch is made, so a step already committed (by the agent, say) leaves nothing behind.
    if git(folder, &[&["status", "--porcelain", "--"], paths.as_slice()].concat())?.is_empty() {
        return Err("Nothing left to commit: these files already match the last commit.".into());
    }
    if let Some(name) = branch {
        if !valid_branch(folder, name) {
            return Err("That isn't a branch name git accepts.".into());
        }
        git(folder, &["switch", "--create", name])?;
    }
    git(folder, &[&["add", "--all", "--"], paths.as_slice()].concat())?;
    let message = format!("--message={message}");
    git(folder, &[&["commit", message.as_str(), "--"], paths.as_slice()].concat())?;
    Ok(Committed { sha: git(folder, &["rev-parse", "--short", "HEAD"])?, branch: git(folder, &["symbolic-ref", "--short", "HEAD"]).ok() })
}

// The pull request's link, as gh prints it on success or when one is already open for the branch.
fn url_in(text: &str) -> Option<String> {
    text.split_whitespace().rev().find(|w| w.starts_with("https://")).map(|w| w.trim_end_matches(['.', ',']).to_string())
}

pub(crate) fn pull_request(folder: &Path) -> Result<String, String> {
    let info = info(folder)?;
    let branch = info.branch.ok_or("Check out a branch first.")?;
    if info.on_default {
        return Err("A pull request comes from a branch; commit this on a new branch first.".into());
    }
    if !info.can_push {
        return Err("This repo has no origin remote to push to.".into());
    }
    if !info.gh {
        return Err("Opening a pull request needs the GitHub CLI (gh) installed and signed in.".into());
    }
    run(folder, "git", &["push", "--set-upstream", "origin", "HEAD"], NETWORK)?;
    match run(folder, "gh", &["pr", "create", "--fill", "--head", &branch], NETWORK) {
        Ok(out) => url_in(&out).ok_or_else(|| "gh opened it but didn't say where.".into()),
        Err(error) => url_in(&error).filter(|_| error.contains("already exists")).ok_or(error),
    }
}

fn project(folder: &str) -> Result<PathBuf, String> {
    Path::new(folder).canonicalize().ok().filter(|f| f.is_dir()).ok_or_else(|| "That project folder isn't there anymore.".into())
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| format!("git stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn git_info(folder: String) -> Result<GitInfo, String> {
    let folder = project(&folder)?;
    blocking(move || info(&folder)).await
}

#[tauri::command]
pub async fn commit_step(folder: String, paths: Vec<String>, message: String, branch: Option<String>) -> Result<Committed, String> {
    let folder = project(&folder)?;
    blocking(move || commit(&folder, &paths, &message, branch.as_deref().map(str::trim).filter(|b| !b.is_empty()))).await
}

#[tauri::command]
pub async fn open_pull_request(folder: String) -> Result<String, String> {
    let folder = project(&folder)?;
    blocking(move || pull_request(&folder)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-git-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "dev@example.com"], &["config", "user.name", "Dev"]] {
            git(&dir, args).unwrap();
        }
        for (file, text) in [("keep.txt", "a"), ("gone.txt", "b"), ("other.txt", "c")] {
            std::fs::write(dir.join(file), text).unwrap();
        }
        git(&dir, &["add", "."]).unwrap();
        git(&dir, &["commit", "-q", "-m", "base"]).unwrap();
        dir.canonicalize().unwrap()
    }

    fn step_files() -> Vec<String> {
        ["keep.txt", "gone.txt", "new.txt"].map(String::from).to_vec()
    }

    #[test]
    fn only_the_steps_files_are_committed_and_other_staged_work_stays_staged() {
        let dir = repo("only");
        std::fs::write(dir.join("other.txt"), "staged by the owner").unwrap();
        git(&dir, &["add", "other.txt"]).unwrap();
        std::fs::write(dir.join("keep.txt"), "changed").unwrap();
        std::fs::remove_file(dir.join("gone.txt")).unwrap();
        std::fs::write(dir.join("new.txt"), "new").unwrap();

        let committed = commit(&dir, &step_files(), "-Add retries\n\nwith backoff", None).unwrap();
        assert_eq!(committed.branch.as_deref(), Some("main"));
        assert_eq!(git(&dir, &["log", "-1", "--format=%s"]).unwrap(), "-Add retries", "a message can start with a dash");
        assert_eq!(git(&dir, &["show", "--name-only", "--format=", "HEAD"]).unwrap().lines().collect::<Vec<_>>(), ["gone.txt", "keep.txt", "new.txt"]);
        assert_eq!(git(&dir, &["status", "--porcelain"]).unwrap(), "M  other.txt");
    }

    #[test]
    fn a_new_branch_is_made_first_and_nothing_to_commit_leaves_no_branch_behind() {
        let dir = repo("branch");
        assert!(commit(&dir, &step_files(), "Nothing", Some("dhrive/nothing")).unwrap_err().starts_with("Nothing left to commit"));
        assert!(git(&dir, &["branch", "--list", "dhrive/nothing"]).unwrap().is_empty());

        std::fs::write(dir.join("keep.txt"), "changed").unwrap();
        for bad in ["-D", "two words", "a..b", "x".repeat(101).as_str()] {
            assert!(commit(&dir, &["keep.txt".into()], "Change", Some(bad)).is_err(), "{bad}");
        }
        let committed = commit(&dir, &["keep.txt".into()], "Change keep", Some("dhrive/change-keep")).unwrap();
        assert_eq!(committed.branch.as_deref(), Some("dhrive/change-keep"));
        assert!(commit(&dir, &["../outside".into()], "x", None).is_err());
        assert!(commit(&dir, &["keep.txt".into()], "   ", None).is_err());
    }

    #[test]
    fn the_default_branch_is_known_and_a_branch_is_needed_for_a_pull_request() {
        let dir = repo("info");
        let on_main = info(&dir).unwrap();
        assert_eq!((on_main.branch.as_deref(), on_main.on_default, on_main.can_push), (Some("main"), true, false));
        assert!(pull_request(&dir).unwrap_err().contains("new branch"));
        git(&dir, &["switch", "-q", "-c", "feature"]).unwrap();
        assert!(!info(&dir).unwrap().on_default);
        assert!(pull_request(&dir).unwrap_err().contains("no origin"));
        assert!(info(&std::env::temp_dir().join("dhrive-not-a-repo-at-all")).is_err());
    }

    #[test]
    fn the_pull_request_link_is_found_in_what_gh_says() {
        assert_eq!(url_in("Creating pull request for feature into main\n\nhttps://github.com/o/r/pull/12\n").as_deref(), Some("https://github.com/o/r/pull/12"));
        assert_eq!(url_in("a pull request for branch \"feature\" into branch \"main\" already exists:\nhttps://github.com/o/r/pull/9").as_deref(), Some("https://github.com/o/r/pull/9"));
        assert_eq!(url_in("no link here"), None);
    }
}
