use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::git::git;

// A Terminals pane can work in a copy of its own: a git worktree of the project on a branch named
// after the pane, kept inside the project folder under .dhrive/ (hidden from git through
// .git/info/exclude, never a .gitignore the owner would see change), so two panes on one project
// never edit the same files and everything stays in the owner's folder. The webview only ever names the project and the pane; every
// path is worked out here.

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneCopy {
    // Where the pane's CLI starts: the project's own subfolder within the copy, for a project that
    // sits inside a bigger repo.
    pub folder: PathBuf,
    pub branch: String,
}

const HIDDEN: &str = ".dhrive/";

pub fn valid_pane(pane: &str) -> bool {
    (8..=40).contains(&pane.len()) && pane.chars().all(|c| c.is_ascii_hexdigit() || c == '-') && pane.starts_with(|c: char| c.is_ascii_hexdigit())
}

fn branch_for(pane: &str) -> String {
    format!("dhrive/{}", &pane[..8])
}

// A copy needs a commit to start from, so a project that isn't a repo yet (or has no commit) gets one:
// everything in the folder, minus what a .gitignore leaves out. Local only; nothing is pushed.
// ponytail: a folder with no .gitignore commits all of it (node_modules too); fine for the new
// projects this happens to, add a default .gitignore if big old folders start landing here.
pub(crate) fn ensure_repo(folder: &Path) -> Result<(), String> {
    if git(folder, &["rev-parse", "--show-toplevel"]).is_err() {
        git(folder, &["init", "-q", "-b", "main"]).map_err(|e| format!("Couldn't make the project a git repo: {e}"))?;
    }
    hide_copies(folder)?;
    if git(folder, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok() {
        return Ok(());
    }
    git(folder, &["add", "-A"])?;
    // Without a name and email set, git refuses to commit; dhrive signs this one first commit instead.
    let signed = git(folder, &["config", "user.email"]).is_ok();
    let who: &[&str] = if signed { &[] } else { &["-c", "user.name=dhrive", "-c", "user.email=dhrive@localhost"] };
    git(folder, &[who, &["commit", "-q", "--allow-empty", "-m", "Start"]].concat()).map_err(|e| format!("Couldn't make the project's first commit: {e}"))?;
    Ok(())
}

fn hide_copies(folder: &Path) -> Result<(), String> {
    let exclude = folder.join(git(folder, &["rev-parse", "--git-path", "info/exclude"])?);
    let listed = std::fs::read_to_string(&exclude).unwrap_or_default();
    if listed.lines().any(|line| line.trim() == HIDDEN) {
        return Ok(());
    }
    std::fs::create_dir_all(exclude.parent().ok_or("No place for git's exclude list.")?).map_err(|e| e.to_string())?;
    let line = if listed.is_empty() || listed.ends_with('\n') { format!("{HIDDEN}\n") } else { format!("\n{HIDDEN}\n") };
    std::fs::write(&exclude, listed + &line).map_err(|e| e.to_string())
}

fn checked_out_at(folder: &Path, branch: &str) -> Option<String> {
    let list = git(folder, &["worktree", "list", "--porcelain"]).ok()?;
    let mut path = None;
    for line in list.lines() {
        if let Some(at) = line.strip_prefix("worktree ") {
            path = Some(at.to_string());
        } else if line == format!("branch refs/heads/{branch}") {
            return path;
        }
    }
    None
}

// The copy at `copy` for project `folder`, made from the project's current commit the first time.
pub fn ensure(folder: &Path, copy: &Path, pane: &str) -> Result<PaneCopy, String> {
    ensure_repo(folder)?;
    let top = git(folder, &["rev-parse", "--show-toplevel"])?;
    let prefix = git(folder, &["rev-parse", "--show-prefix"])?;
    let branch = branch_for(pane);
    if !copy.join(".git").exists() {
        std::fs::create_dir_all(copy.parent().ok_or("No place for the copy.")?).map_err(|e| e.to_string())?;
        let target = copy.to_string_lossy().into_owned();
        let exists = git(folder, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok();
        // A pane from before the copies lived in the project keeps its work: its old copy moves in.
        if let Some(old) = exists.then(|| checked_out_at(folder, &branch)).flatten() {
            git(folder, &["worktree", "move", &old, &target])?;
            return Ok(PaneCopy { folder: copy.join(prefix), branch });
        }
        let args: Vec<&str> = if exists { vec!["worktree", "add", &target, &branch] } else { vec!["worktree", "add", "-b", &branch, &target, "HEAD"] };
        git(Path::new(&top), &args)?;
    }
    Ok(PaneCopy { folder: copy.join(prefix), branch })
}

// Removes the copy only when nothing in it is uncommitted (git refuses otherwise), and its branch
// only when that work is merged; an unmerged branch keeps the work for the owner to take.
pub fn remove(folder: &Path, copy: &Path, pane: &str) -> Result<(), String> {
    if !copy.exists() {
        return Ok(());
    }
    git(folder, &["worktree", "remove", &copy.to_string_lossy()]).map_err(|_| format!("The copy has changes that aren't committed, so it stays at {} (branch {}).", copy.display(), branch_for(pane)))?;
    let _ = git(folder, &["branch", "-d", &branch_for(pane)]);
    Ok(())
}

pub fn copy_dir(folder: &Path, pane: &str) -> Result<PathBuf, String> {
    if !valid_pane(pane) {
        return Err("That isn't a pane.".into());
    }
    Ok(folder.join(".dhrive").join(pane))
}

#[tauri::command]
pub async fn remove_pane_copy(app: tauri::AppHandle, project: String, pane: String) -> Result<(), String> {
    let folder = crate::terminal::project_folder(&app, &project)?;
    let copy = copy_dir(&folder, &pane)?;
    tauri::async_runtime::spawn_blocking(move || remove(&folder, &copy, &pane)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("dhrive-wt-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("repo/web")).unwrap();
        let repo = root.join("repo");
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git(&repo, args).unwrap();
        }
        std::fs::write(repo.join("web/app.js"), "one\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "first"]).unwrap();
        root
    }

    #[test]
    fn a_pane_gets_its_own_copy_on_its_own_branch_and_the_project_is_untouched() {
        let root = repo("copy");
        let (project, copy, pane) = (root.join("repo/web"), root.join("data/worktrees/1a2b3c4d-0000"), "1a2b3c4d-0000");
        let made = ensure(&project, &copy, pane).unwrap();
        assert_eq!(made.branch, "dhrive/1a2b3c4d");
        assert_eq!(made.folder, copy.join("web/"));
        std::fs::write(made.folder.join("app.js"), "two\n").unwrap();
        assert_eq!(std::fs::read_to_string(project.join("app.js")).unwrap(), "one\n");
        assert_eq!(ensure(&project, &copy, pane).unwrap(), made, "opening it again reuses it");

        let refused = remove(&project, &copy, pane).unwrap_err();
        assert!(refused.contains("aren't committed") && copy.exists(), "{refused}");
        git(&copy, &["checkout", "--", "."]).unwrap();
        remove(&project, &copy, pane).unwrap();
        assert!(!copy.exists());
        assert!(git(&project, &["rev-parse", "--verify", "--quiet", "refs/heads/dhrive/1a2b3c4d"]).is_err(), "nothing new on it, so the branch goes too");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unmerged_work_keeps_its_branch() {
        let root = repo("keep");
        let (project, copy, pane) = (root.join("repo"), root.join("data/worktrees/feedface-1111"), "feedface-1111");
        let made = ensure(&project, &copy, pane).unwrap();
        std::fs::write(made.folder.join("web/app.js"), "three\n").unwrap();
        git(&copy, &["commit", "-qam", "pane work"]).unwrap();
        remove(&project, &copy, pane).unwrap();
        assert!(git(&project, &["rev-parse", "--verify", "--quiet", "refs/heads/dhrive/feedface"]).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_folder_that_isnt_a_repo_becomes_one_with_its_files_in_the_first_commit() {
        let root = std::env::temp_dir().join(format!("dhrive-wt-bare-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let project = root.join("app");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("main.swift"), "print(1)\n").unwrap();
        let made = ensure(&project, &copy_dir(&project, "abcdef12-0000").unwrap(), "abcdef12-0000").unwrap();
        assert!(made.folder.starts_with(project.join(".dhrive")), "the copy lives in the project folder");
        assert_eq!(std::fs::read_to_string(made.folder.join("main.swift")).unwrap(), "print(1)\n");
        assert!(git(&project, &["status", "--porcelain"]).unwrap().is_empty(), "git doesn't see the copies");
        ensure(&project, &copy_dir(&project, "fedcba98-2222").unwrap(), "fedcba98-2222").unwrap();
        assert_eq!(std::fs::read_to_string(project.join(".git/info/exclude")).unwrap().matches(HIDDEN).count(), 1);
        let empty = root.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(ensure(&empty, &root.join("data/worktrees/abcdef12-1111"), "abcdef12-1111").is_ok(), "an empty folder starts from an empty commit");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_copy_from_before_moves_into_the_project_with_its_work() {
        let root = repo("move");
        let (project, pane) = (root.join("repo"), "0badcafe-3333");
        let old = ensure(&project, &root.join("data/worktrees").join(pane), pane).unwrap();
        std::fs::write(old.folder.join("web/app.js"), "kept\n").unwrap();
        let moved = ensure(&project, &copy_dir(&project, pane).unwrap(), pane).unwrap();
        assert_eq!(std::fs::read_to_string(moved.folder.join("web/app.js")).unwrap(), "kept\n");
        assert!(!root.join("data/worktrees").join(pane).exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_pane_ids_name_a_copy() {
        assert!(valid_pane("1a2b3c4d-5e6f-4a1b-9c2d-0e1f2a3b4c5d"));
        assert!(!valid_pane("../../etc") && !valid_pane("-1a2b3c4d") && !valid_pane("short"));
    }
}
