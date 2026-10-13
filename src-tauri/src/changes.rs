use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

// What a code step changed, seen through git. The working tree is recorded as a git tree before and
// after the step, through a throwaway index so the owner's own staging is never touched, and the two
// trees are compared. Undo writes back each file's "before" version, but only where the file still
// holds what the step left, so nothing edited since is ever overwritten.
// ponytail: git repos only; a folder without git shows no changes. Each snapshot hashes every file
// git doesn't ignore into the repo's objects, so a large untracked build folder costs time and disk
// until `git gc`; ignoring it fixes that.

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    path: String,
    status: Status,
    // None for binary files, which have no lines to count.
    additions: Option<u32>,
    deletions: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    before: String,
    after: String,
    files: Vec<FileChange>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Undo {
    restored: Vec<String>,
    // Changed again after the step, so left as they are.
    kept: Vec<String>,
}

const MAX_DIFF: usize = 400_000;

fn git(root: &Path) -> Command {
    let mut command = Command::new("git");
    // No prompts, and no optional locks the owner's own git could end up waiting on.
    command.arg("-C").arg(root).env("GIT_TERMINAL_PROMPT", "0").env("GIT_OPTIONAL_LOCKS", "0");
    command
}

fn bytes(command: &mut Command) -> Option<Vec<u8>> {
    let output = command.output().ok()?;
    output.status.success().then_some(output.stdout)
}

fn text(command: &mut Command) -> Option<String> {
    String::from_utf8(bytes(command)?).ok().map(|out| out.trim_end().to_string())
}

fn root(folder: &Path) -> Option<PathBuf> {
    let top = text(git(folder).args(["rev-parse", "--show-toplevel"]))?;
    Path::new(&top).canonicalize().ok()
}

fn temp_index() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!("dhrive-index-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)))
}

// The company's own records (.company/, records.rs) are dhrive's, not the step's: left out, so a step
// never lists them as its work and undoing one never takes back a task or the timeline.
const NOT_THE_STEP: &[&str] = &["add", "-A", "--", ".", ":(glob,exclude)**/.company/**"];

// The index is seeded from the repo's own so `git add` only rehashes what changed; a seed git can't
// use (a split index, say) falls back to an empty one.
fn write_tree(root: &Path) -> Option<String> {
    let own = text(git(root).args(["rev-parse", "--git-path", "index"])).map(|p| root.join(p));
    for seed in [own, None] {
        let index = temp_index();
        if let Some(seed) = &seed {
            let _ = std::fs::copy(seed, &index);
        }
        let tree = bytes(git(root).env("GIT_INDEX_FILE", &index).args(NOT_THE_STEP)).and_then(|_| text(git(root).env("GIT_INDEX_FILE", &index).arg("write-tree")));
        let _ = std::fs::remove_file(&index);
        if tree.is_some() {
            return tree;
        }
    }
    None
}

pub fn snapshot(folder: &Path) -> Option<String> {
    write_tree(&root(folder)?)
}

fn nul_fields(out: &[u8]) -> Vec<String> {
    out.split(|b| *b == 0).filter(|f| !f.is_empty()).map(|f| String::from_utf8_lossy(f).into_owned()).collect()
}

fn compare(root: &Path, before: &str, after: &str) -> Option<Vec<FileChange>> {
    let diff = |kind: &str| bytes(git(root).args(["diff", kind, "-z", "--no-renames", "--no-ext-diff", before, after]));
    let names = nul_fields(&diff("--name-status")?);
    let counts: Vec<(Option<u32>, Option<u32>)> = nul_fields(&diff("--numstat")?)
        .iter()
        .map(|line| {
            let mut parts = line.splitn(3, '\t');
            (parts.next().and_then(|n| n.parse().ok()), parts.next().and_then(|n| n.parse().ok()))
        })
        .collect();
    let files = names.chunks(2).zip(counts).filter_map(|(pair, (additions, deletions))| {
        let status = match pair.first()?.as_str() {
            "A" => Status::Added,
            "D" => Status::Deleted,
            _ => Status::Modified,
        };
        Some(FileChange { path: pair.get(1)?.clone(), status, additions, deletions })
    });
    Some(files.collect())
}

// What the step changed, measured against the snapshot taken before it; None when nothing did.
pub fn since(folder: &Path, before: &str) -> Option<Changes> {
    let root = root(folder)?;
    let after = write_tree(&root)?;
    let files = compare(&root, before, &after)?;
    (!files.is_empty()).then(|| Changes { before: before.to_string(), after, files })
}

// Tree ids and paths come back from the webview; a tree id is only ever hex, and a path is a plain
// relative one inside the repo.
fn valid_tree(id: &str) -> bool {
    matches!(id.len(), 40 | 64) && id.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub(crate) fn valid_path(path: &str) -> bool {
    !path.is_empty() && path.len() <= 4096 && !path.starts_with('-') && Path::new(path).components().all(|c| matches!(c, Component::Normal(_)))
}

fn checked(folder: &str, before: &str, after: &str) -> Result<PathBuf, String> {
    if !valid_tree(before) || !valid_tree(after) {
        return Err("Those changes aren't ones dhrive recorded.".into());
    }
    root(Path::new(folder)).ok_or_else(|| "That folder isn't a git repository anymore.".to_string())
}

fn blob(root: &Path, tree: &str, path: &str) -> Option<String> {
    text(git(root).args(["rev-parse", "--verify", "--quiet", &format!("{tree}:{path}")]))
}

fn current_blob(root: &Path, path: &str) -> Option<String> {
    let full = root.join(path);
    let meta = std::fs::symlink_metadata(&full).ok()?;
    if meta.is_dir() {
        return None;
    }
    text(git(root).args(["hash-object", "--", path]))
}

// Never writes through a link out of the repo: the file's folder must resolve inside it.
fn inside(root: &Path, full: &Path) -> bool {
    full.parent().and_then(|parent| parent.canonicalize().ok()).is_some_and(|parent| parent.starts_with(root))
}

fn restore(root: &Path, before: &str, path: &str) -> Option<()> {
    let full = root.join(path);
    std::fs::create_dir_all(full.parent()?).ok()?;
    if !inside(root, &full) {
        return None;
    }
    // --filters gives the file as it sits on disk (line endings, LFS), not as git stores it.
    let content = bytes(git(root).args(["cat-file", "--filters", &format!("{before}:{path}")]))?;
    std::fs::write(&full, content).ok()
}

fn remove(root: &Path, path: &str) -> Option<()> {
    let full = root.join(path);
    inside(root, &full).then(|| std::fs::remove_file(&full).ok()).flatten()
}

fn undo(root: &Path, before: &str, after: &str) -> Option<Undo> {
    let mut files = compare(root, before, after)?;
    // Removals first, so a folder the step turned into a link is gone before anything is written there.
    files.sort_by_key(|file| file.status != Status::Added);
    let mut undo = Undo::default();
    for file in files {
        let untouched = current_blob(root, &file.path) == blob(root, after, &file.path);
        let done = untouched && if file.status == Status::Added { remove(root, &file.path) } else { restore(root, before, &file.path) }.is_some();
        if done { &mut undo.restored } else { &mut undo.kept }.push(file.path);
    }
    Some(undo)
}

#[tauri::command]
pub async fn file_diff(folder: String, before: String, after: String, path: String) -> Result<String, String> {
    let root = checked(&folder, &before, &after)?;
    if !valid_path(&path) {
        return Err("That isn't a file in this project.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let out = bytes(git(&root).args(["diff", "--no-color", "--no-ext-diff", &before, &after, "--", &format!(":(literal){path}")])).ok_or("git couldn't show that diff.")?;
        let mut diff = String::from_utf8_lossy(&out).into_owned();
        if diff.len() > MAX_DIFF {
            let cut = (0..=MAX_DIFF).rev().find(|i| diff.is_char_boundary(*i)).unwrap_or(0);
            diff.truncate(cut);
        }
        Ok(diff)
    })
    .await
    .map_err(|error| format!("The diff stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn undo_changes(folder: String, before: String, after: String) -> Result<Undo, String> {
    let root = checked(&folder, &before, &after)?;
    tauri::async_runtime::spawn_blocking(move || undo(&root, &before, &after).ok_or_else(|| "git couldn't read those changes anymore.".to_string()))
        .await
        .map_err(|error| format!("Undo stopped unexpectedly: {error}"))?
}

#[cfg(test)]
#[path = "changes_tests.rs"]
mod tests;
