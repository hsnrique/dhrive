use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::git::git;
use crate::worktrees::{author, branch_for, copy_dir, ensure, ensure_repo, remove};

// An army's tasks run side by side, each in its own copy of the company (worktrees.rs) on its own
// branch, and land one at a time. Landing has two steps: sync commits the task's work and merges the
// company's latest into the copy, so its checks run on what it will land on, and a conflict is left
// there for its agent to resolve; land then merges the branch into the company's folder. Whatever the
// folder itself has uncommitted is committed first, so a copy never starts from, or lands on, less
// than the folder holds.

const MAX_TITLE: usize = 120;

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Synced {
    Clean,
    // A merge left in progress in the copy, with these files to resolve.
    Conflicts { files: Vec<String> },
}

fn message(title: &str) -> String {
    let line: String = title.lines().next().unwrap_or_default().chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect();
    if line.trim().is_empty() { "A task of the company".into() } else { line.trim().to_string() }
}

// Everything in `folder` committed, a merge in progress concluded; false when there was nothing.
fn commit_all(folder: &Path, message: &str) -> Result<bool, String> {
    git(folder, &["add", "-A"])?;
    let merging = git(folder, &["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).is_ok();
    if !merging && git(folder, &["diff", "--cached", "--quiet"]).is_ok() {
        return Ok(false);
    }
    let args: &[&str] = if merging { &["commit", "-q", "--no-edit"] } else { &["commit", "-q", "-m", message] };
    git(folder, &[author(folder), args].concat())?;
    Ok(true)
}

fn conflicted(folder: &Path) -> Vec<String> {
    git(folder, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default().lines().map(str::to_string).collect()
}

// A conflict marker still in a file means the agent didn't finish resolving it.
fn markers_left(folder: &Path) -> bool {
    git(folder, &["grep", "-q", "-E", "^(<<<<<<<|>>>>>>>) "]).is_ok()
}

fn copy_of(folder: &Path, task: &str) -> Result<PathBuf, String> {
    let copy = copy_dir(folder, task)?;
    if copy.join(".git").exists() { Ok(copy) } else { Err("This task has no copy of the company.".into()) }
}

// The copy the task works in, made from everything the folder holds now.
pub fn prepare(folder: &Path, task: &str) -> Result<PathBuf, String> {
    ensure_repo(folder)?;
    commit_all(folder, "The company's folder as it was")?;
    Ok(ensure(folder, &copy_dir(folder, task)?, task)?.folder)
}

pub fn sync(folder: &Path, task: &str, title: &str) -> Result<Synced, String> {
    let copy = copy_of(folder, task)?;
    if git(&copy, &["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).is_ok() {
        if markers_left(&copy) {
            return Ok(Synced::Conflicts { files: conflicted(&copy) });
        }
        commit_all(&copy, &message(title))?;
    }
    commit_all(&copy, &message(title))?;
    commit_all(folder, "The company's folder as it was")?;
    let onto = git(folder, &["symbolic-ref", "--short", "HEAD"])?;
    match git(&copy, &[author(&copy), &["merge", "--no-edit", &onto]].concat()) {
        Ok(_) => Ok(Synced::Clean),
        Err(_) => Ok(Synced::Conflicts { files: conflicted(&copy) }),
    }
}

pub fn land(folder: &Path, task: &str, title: &str) -> Result<(), String> {
    let copy = copy_of(folder, task)?;
    if markers_left(&copy) {
        return Err("The task's copy still has conflicts to resolve.".into());
    }
    commit_all(&copy, &message(title))?;
    commit_all(folder, "The company's folder as it was")?;
    let branch = branch_for(task);
    if let Err(error) = git(folder, &[author(folder), &["merge", "--no-ff", "--no-edit", "-m", &message(title), &branch]].concat()) {
        let _ = git(folder, &["merge", "--abort"]);
        return Err(format!("It couldn't land: {}", if conflicted(folder).is_empty() { error } else { conflicted(folder).join(", ") }));
    }
    remove(folder, &copy, task)
}

// A task that won't land: its work stays committed on its branch for the owner, the copy goes.
pub fn discard(folder: &Path, task: &str, title: &str) -> Result<(), String> {
    let Ok(copy) = copy_of(folder, task) else { return Ok(()) };
    let _ = git(&copy, &["merge", "--abort"]);
    commit_all(&copy, &format!("Unfinished: {}", message(title)))?;
    remove(folder, &copy, task)
}

fn checked(task: &str, title: &str) -> Result<(), String> {
    if !crate::worktrees::valid_pane(task) || title.len() > 4 * MAX_TITLE {
        return Err("That isn't one of the company's tasks.".into());
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn army_prepare(app: tauri::AppHandle, project: String, task: String) -> Result<String, String> {
    checked(&task, "")?;
    let folder = crate::terminal::project_folder(&app, &project)?;
    blocking(move || prepare(&folder, &task).map(|p| p.to_string_lossy().into_owned())).await
}

#[tauri::command]
pub async fn army_sync(app: tauri::AppHandle, project: String, task: String, title: String) -> Result<Synced, String> {
    checked(&task, &title)?;
    let folder = crate::terminal::project_folder(&app, &project)?;
    blocking(move || sync(&folder, &task, &title)).await
}

#[tauri::command]
pub async fn army_land(app: tauri::AppHandle, project: String, task: String, title: String) -> Result<(), String> {
    checked(&task, &title)?;
    let folder = crate::terminal::project_folder(&app, &project)?;
    blocking(move || land(&folder, &task, &title)).await
}

#[tauri::command]
pub async fn army_discard(app: tauri::AppHandle, project: String, task: String, title: String) -> Result<(), String> {
    checked(&task, &title)?;
    let folder = crate::terminal::project_folder(&app, &project)?;
    blocking(move || discard(&folder, &task, &title)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "1a2b3c4d-0000-4000-8000-000000000001";
    const B: &str = "2b3c4d5e-0000-4000-8000-000000000002";

    fn company(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("dhrive-army-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git(&root, args).unwrap();
        }
        std::fs::write(root.join("app.js"), "one\ntwo\nthree\n").unwrap();
        root
    }
    fn read(path: PathBuf) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn two_tasks_work_side_by_side_and_land_one_after_the_other() {
        let folder = company("side");
        let (a, b) = (prepare(&folder, A).unwrap(), prepare(&folder, B).unwrap());
        assert_eq!(git(&folder, &["status", "--porcelain"]).unwrap(), "", "the folder's own files were committed first");
        std::fs::write(a.join("api.js"), "api\n").unwrap();
        std::fs::write(b.join("page.js"), "page\n").unwrap();
        assert_eq!(sync(&folder, A, "API").unwrap(), Synced::Clean);
        land(&folder, A, "API").unwrap();
        assert!(!a.exists(), "a landed task's copy goes");
        assert_eq!(sync(&folder, B, "Page").unwrap(), Synced::Clean);
        assert_eq!(read(b.join("api.js")), "api\n", "the next task syncs what landed before it");
        land(&folder, B, "Page").unwrap();
        assert_eq!((read(folder.join("api.js")), read(folder.join("page.js"))), ("api\n".into(), "page\n".into()));
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_conflict_waits_in_the_copy_for_its_agent_and_only_a_resolved_one_lands() {
        let folder = company("clash");
        let (a, b) = (prepare(&folder, A).unwrap(), prepare(&folder, B).unwrap());
        std::fs::write(a.join("app.js"), "one\nTWO\nthree\n").unwrap();
        std::fs::write(b.join("app.js"), "one\n2\nthree\n").unwrap();
        sync(&folder, A, "Upper").unwrap();
        land(&folder, A, "Upper").unwrap();
        assert_eq!(sync(&folder, B, "Digit").unwrap(), Synced::Conflicts { files: vec!["app.js".into()] });
        assert!(land(&folder, B, "Digit").unwrap_err().contains("conflicts"));
        assert_eq!(sync(&folder, B, "Digit").unwrap(), Synced::Conflicts { files: vec!["app.js".into()] }, "still marked: nothing resolved yet");
        std::fs::write(b.join("app.js"), "one\nTWO 2\nthree\n").unwrap();
        assert_eq!(sync(&folder, B, "Digit").unwrap(), Synced::Clean);
        land(&folder, B, "Digit").unwrap();
        assert_eq!(read(folder.join("app.js")), "one\nTWO 2\nthree\n");
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_discarded_task_keeps_its_work_on_its_branch() {
        let folder = company("keep");
        let a = prepare(&folder, A).unwrap();
        std::fs::write(a.join("draft.md"), "half\n").unwrap();
        discard(&folder, A, "Draft").unwrap();
        assert!(!a.exists());
        assert_eq!(git(&folder, &["show", &format!("{}:draft.md", branch_for(A))]).unwrap(), "half");
        assert!(!folder.join("draft.md").exists(), "nothing reached the folder");
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn only_task_ids_and_plain_titles_get_in() {
        assert!(checked(A, "API").is_ok());
        assert!(checked("../../etc", "x").is_err());
        assert_eq!(message("Fix it\u{7}\nmore"), "Fix it");
        assert_eq!(message("  "), "A task of the company");
    }
}
