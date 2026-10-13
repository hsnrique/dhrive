use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::git::git;
use crate::worktrees::{copy_dir, ensure_repo, valid_pane};

// Bringing a Terminals session's work together: each pane's copy has its work committed on its own
// branch, then every branch is merged into the project folder itself, so the result is where the
// owner works. A folder on its default branch moves to the session's own branch first, so the work
// can go to a pull request. A branch that conflicts is left out of the merge (it's aborted, so the
// folder stays clean) and named with its files, for the owner, or a CLI they pick, to resolve there.

const MAX_PARTS: usize = 6;
const MAX_TITLE: usize = 120;

#[derive(Deserialize)]
pub struct Part {
    pane: String,
    title: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Merged,
    // Its branch holds nothing the project doesn't have.
    NothingNew,
    Conflict,
    // The pane never had a copy (it ran in the project folder), so there's no branch to take.
    NoCopy,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Merge {
    pane: String,
    branch: String,
    outcome: Outcome,
    files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Together {
    branch: String,
    merges: Vec<Merge>,
}

// A commit message comes from the owner's subtask title: one line, bounded, no control characters.
fn message(title: &str) -> String {
    let line: String = title.lines().next().unwrap_or_default().chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect();
    if line.trim().is_empty() { "Work from a Terminals pane".into() } else { line.trim().to_string() }
}

// Whatever the pane's CLI left uncommitted goes on the pane's branch first, or the merge would miss it.
fn save_work(copy: &Path, title: &str) -> Result<(), String> {
    git(copy, &["add", "-A"])?;
    if git(copy, &["diff", "--cached", "--quiet"]).is_err() {
        git(copy, &["commit", "-q", "-m", &message(title)])?;
    }
    Ok(())
}

fn merge_one(target: &Path, branch: &str, title: &str) -> (Outcome, Vec<String>) {
    let before = git(target, &["rev-parse", "HEAD"]).unwrap_or_default();
    match git(target, &["merge", "--no-ff", "--no-edit", "-m", &format!("Bring in {}", message(title)), branch]) {
        Ok(_) if git(target, &["rev-parse", "HEAD"]).unwrap_or_default() == before => (Outcome::NothingNew, vec![]),
        Ok(_) => (Outcome::Merged, vec![]),
        Err(_) => {
            let files = git(target, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default().lines().map(str::to_string).collect();
            let _ = git(target, &["merge", "--abort"]);
            (Outcome::Conflict, files)
        }
    }
}

// The branch the panes are merged onto: the one checked out, or the session's when that's the default.
fn onto_branch(folder: &Path, session: &str) -> Result<String, String> {
    if !crate::git::on_default_branch(folder) {
        return git(folder, &["symbolic-ref", "--short", "HEAD"]);
    }
    let branch = format!("dhrive/{}", &session[..8]);
    let exists = git(folder, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok();
    git(folder, &if exists { vec!["switch", &branch] } else { vec!["switch", "-c", &branch] })?;
    Ok(branch)
}

pub fn bring_together(folder: &Path, session: &str, parts: &[(std::path::PathBuf, &str, &str)]) -> Result<Together, String> {
    ensure_repo(folder)?;
    // An aborted merge can't always give back uncommitted edits, so the owner's own stay out of it.
    if !git(folder, &["status", "--porcelain", "--untracked-files=no"])?.is_empty() {
        return Err("Commit or stash what's changed in the project first: the panes are merged into it.".into());
    }
    let branch = onto_branch(folder, session)?;
    let merges = parts
        .iter()
        .map(|(copy, pane, title)| {
            let branch = format!("dhrive/{}", &pane[..8]);
            if !copy.join(".git").exists() {
                return Ok(Merge { pane: pane.to_string(), branch, outcome: Outcome::NoCopy, files: vec![] });
            }
            save_work(copy, title)?;
            let (outcome, files) = merge_one(folder, &branch, title);
            Ok(Merge { pane: pane.to_string(), branch, outcome, files })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Together { branch, merges })
}

fn checked(session: &str, parts: &[Part]) -> Result<(), String> {
    if !valid_pane(session) || parts.is_empty() || parts.len() > MAX_PARTS || parts.iter().any(|p| !valid_pane(&p.pane) || p.pane == session) {
        return Err("Those aren't this session's panes.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn bring_panes_together(app: tauri::AppHandle, project: String, session: String, parts: Vec<Part>) -> Result<Together, String> {
    checked(&session, &parts)?;
    let folder = crate::terminal::project_folder(&app, &project)?;
    let copies = parts.iter().map(|p| Ok((copy_dir(&folder, &p.pane)?, p.pane.clone(), p.title.clone()))).collect::<Result<Vec<_>, String>>()?;
    tauri::async_runtime::spawn_blocking(move || {
        let parts: Vec<_> = copies.iter().map(|(copy, pane, title)| (copy.clone(), pane.as_str(), title.as_str())).collect();
        bring_together(&folder, &session, &parts)
    })
    .await
    .map_err(|e| e.to_string())?
}

// The project's branch the panes were brought onto, pushed and opened as a pull request with gh.
#[tauri::command]
pub async fn open_together_pull_request(app: tauri::AppHandle, project: String) -> Result<String, String> {
    let folder = crate::terminal::project_folder(&app, &project)?;
    tauri::async_runtime::spawn_blocking(move || crate::git::pull_request(&folder)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("dhrive-together-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("repo")).unwrap();
        let repo = root.join("repo");
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git(&repo, args).unwrap();
        }
        std::fs::write(repo.join("a.txt"), "a\n").unwrap();
        std::fs::write(repo.join("shared.txt"), "one\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "first"]).unwrap();
        root
    }

    #[test]
    fn every_pane_s_work_lands_in_the_project_on_the_session_s_branch_and_a_conflict_is_named_and_left_out() {
        let root = repo("all");
        let project = root.join("repo");
        let pane = |id: &'static str| (copy_dir(&project, id).unwrap(), id);
        let (api, ui, clash) = (pane("aaaaaaaa-1"), pane("bbbbbbbb-2"), pane("cccccccc-3"));
        for (copy, id) in [&api, &ui, &clash] {
            crate::worktrees::ensure(&project, copy, id).unwrap();
        }
        std::fs::write(api.0.join("api.txt"), "route\n").unwrap();
        std::fs::write(ui.0.join("shared.txt"), "two\n").unwrap();
        git(&ui.0, &["commit", "-qam", "ui commits on its own"]).unwrap();
        std::fs::write(clash.0.join("shared.txt"), "three\n").unwrap();

        let parts = [(api.0.clone(), api.1, "API route"), (ui.0.clone(), ui.1, "UI"), (clash.0.clone(), clash.1, "Clash\nsecond line")];
        std::fs::write(project.join("scratch.txt"), "the owner's own\n").unwrap();
        let together = bring_together(&project, "dddddddd-0", &parts).unwrap();

        assert_eq!(together.branch, "dhrive/dddddddd");
        assert_eq!(git(&project, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap(), "dhrive/dddddddd", "off main, onto the session's branch");
        let outcomes: Vec<_> = together.merges.iter().map(|m| (&m.outcome, m.files.clone())).collect();
        assert_eq!(outcomes, [(&Outcome::Merged, vec![]), (&Outcome::Merged, vec![]), (&Outcome::Conflict, vec!["shared.txt".to_string()])]);
        assert_eq!(std::fs::read_to_string(project.join("api.txt")).unwrap(), "route\n", "uncommitted pane work came along, into the folder");
        assert_eq!(std::fs::read_to_string(project.join("shared.txt")).unwrap(), "two\n");
        assert_eq!(git(&project, &["status", "--porcelain"]).unwrap(), "?? scratch.txt", "the conflict was aborted, the folder is clean");
        assert_eq!(git(&clash.0, &["log", "-1", "--format=%s"]).unwrap(), "Clash");

        let again = bring_together(&project, "dddddddd-0", &parts[..1]).unwrap();
        assert_eq!(again.merges[0].outcome, Outcome::NothingNew);
        std::fs::write(project.join("a.txt"), "edited by the owner\n").unwrap();
        assert!(bring_together(&project, "dddddddd-0", &parts[..1]).unwrap_err().contains("Commit or stash"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_pane_without_a_copy_has_nothing_to_bring() {
        let root = repo("none");
        let missing = root.join("repo/.dhrive/eeeeeeee-4");
        let together = bring_together(&root.join("repo"), "dddddddd-0", &[(missing, "eeeeeeee-4", "x")]).unwrap();
        assert_eq!(together.merges[0].outcome, Outcome::NoCopy);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_the_session_s_own_panes_and_plain_titles_go_in() {
        let part = |pane: &str| Part { pane: pane.into(), title: "t".into() };
        assert!(checked("dddddddd-0", &[part("aaaaaaaa-1")]).is_ok());
        assert!(checked("dddddddd-0", &[]).is_err());
        assert!(checked("dddddddd-0", &[part("../../x")]).is_err());
        assert!(checked("dddddddd-0", &[part("dddddddd-0")]).is_err());
        assert!(checked("nope", &[part("aaaaaaaa-1")]).is_err());
        assert_eq!(message("  \u{1b}[31mfix it\nmore"), "[31mfix it");
        assert_eq!(message(""), "Work from a Terminals pane");
    }
}
