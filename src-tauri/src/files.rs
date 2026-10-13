use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

// A project's files, for @-mentions in the composer and for recognizing the paths a model writes.
// In a git repo it is what git sees (tracked, plus untracked that isn't ignored); elsewhere a walk
// that skips hidden and dependency folders. Opening one never runs anything: a folder, an app or
// anything executable is shown in Finder instead of opened.

const MAX_FILES: usize = 20_000;
const SKIP: &[&str] = &["node_modules", "target", "dist", "build", "vendor", "Pods", "DerivedData"];
const LAUNCHERS: &[&str] = &["app", "command", "tool", "sh", "zsh", "bash", "csh", "fish", "terminal", "term", "scpt", "applescript", "workflow", "action", "pkg", "mpkg", "dmg", "jar", "webloc", "inetloc", "fileloc", "url", "shortcut", "prefpane", "kext", "plugin"];

fn from_git(folder: &Path) -> Option<Vec<String>> {
    let output = Command::new("git").arg("-C").arg(folder).args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).env("GIT_OPTIONAL_LOCKS", "0").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let mut files: Vec<String> = output.stdout.split(|b| *b == 0).filter(|f| !f.is_empty()).map(|f| String::from_utf8_lossy(f).into_owned()).collect();
    // A tracked file deleted from disk is still listed by git until the deletion is staged.
    files.retain(|f| folder.join(f).exists());
    Some(files)
}

fn walk(folder: &Path) -> Vec<String> {
    let mut files = Vec::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        for entry in std::fs::read_dir(folder.join(&relative)).into_iter().flatten().filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || files.len() >= MAX_FILES {
                continue;
            }
            let path = relative.join(&name);
            match entry.file_type() {
                Ok(kind) if kind.is_dir() && !SKIP.contains(&name.as_str()) => pending.push(path),
                Ok(kind) if kind.is_file() => files.push(path.to_string_lossy().into_owned()),
                _ => {}
            }
        }
    }
    files
}

fn list(folder: &Path) -> Vec<String> {
    let mut files = from_git(folder).unwrap_or_else(|| walk(folder));
    files.sort();
    files.truncate(MAX_FILES);
    files
}

fn runs_something(path: &Path) -> bool {
    let executable = std::fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    executable || LAUNCHERS.contains(&extension.as_str())
}

// The path comes from the webview (a mention the owner or a model wrote): a plain relative path that
// must resolve inside the project.
pub(crate) fn resolve(folder: &str, path: &str) -> Result<PathBuf, String> {
    let root = Path::new(folder).canonicalize().map_err(|_| "That project folder isn't there anymore.".to_string())?;
    let path = path.trim_end_matches('/');
    // The project folder itself, for the side panel's top level.
    if path.is_empty() {
        return Ok(root);
    }
    if !crate::changes::valid_path(path) {
        return Err("That isn't a path in this project.".into());
    }
    let full = root.join(path).canonicalize().map_err(|_| format!("{path} isn't there anymore."))?;
    full.starts_with(&root).then_some(full).ok_or_else(|| "That path leads out of the project.".into())
}

#[tauri::command]
pub async fn list_files(folder: String) -> Result<Vec<String>, String> {
    let folder = Path::new(&folder).canonicalize().map_err(|_| "That project folder isn't there anymore.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || list(&folder)).await.map_err(|error| format!("Couldn't list the files: {error}"))
}

#[tauri::command]
pub fn open_file(folder: String, path: String) -> Result<(), String> {
    let full = resolve(&folder, &path)?;
    let result = if full.is_dir() || runs_something(&full) { tauri_plugin_opener::reveal_item_in_dir(&full) } else { tauri_plugin_opener::open_path(&full, None::<&str>) };
    result.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, git: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["src/components", "node_modules/react", ".git-like"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        for file in ["src/theme.ts", "src/components/Header.tsx", "node_modules/react/index.js", ".env", "README.md"] {
            std::fs::write(dir.join(file), "x").unwrap();
        }
        if git {
            assert!(Command::new("git").args(["init", "-q"]).current_dir(&dir).status().unwrap().success());
            std::fs::write(dir.join(".gitignore"), "node_modules\n.env\n").unwrap();
        }
        dir.canonicalize().unwrap()
    }

    #[test]
    fn a_git_project_lists_what_git_sees() {
        let dir = project("git", true);
        assert_eq!(list(&dir), [".gitignore", "README.md", "src/components/Header.tsx", "src/theme.ts"]);
    }

    #[test]
    fn a_plain_folder_skips_hidden_and_dependency_folders() {
        let dir = project("plain", false);
        assert_eq!(list(&dir), ["README.md", "src/components/Header.tsx", "src/theme.ts"]);
    }

    #[test]
    fn only_paths_inside_the_project_resolve() {
        let dir = project("resolve", false);
        let folder = dir.to_string_lossy().into_owned();
        assert_eq!(resolve(&folder, "src/theme.ts").unwrap(), dir.join("src/theme.ts"));
        assert_eq!(resolve(&folder, "src/").unwrap(), dir.join("src"));
        std::os::unix::fs::symlink("/etc", dir.join("etc-link")).unwrap();
        assert_eq!(resolve(&folder, "").unwrap(), dir, "the project itself");
        for bad in ["../x", "/etc/hosts", "etc-link/hosts", "missing.ts"] {
            assert!(resolve(&folder, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn scripts_apps_and_executables_are_never_opened() {
        let dir = project("launch", false);
        for name in ["deploy.command", "Tool.app", "run.sh"] {
            std::fs::write(dir.join(name), "x").unwrap();
            assert!(runs_something(&dir.join(name)), "{name}");
        }
        std::fs::write(dir.join("bin-tool"), "x").unwrap();
        std::fs::set_permissions(dir.join("bin-tool"), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(runs_something(&dir.join("bin-tool")));
        assert!(!runs_something(&dir.join("src/theme.ts")));
    }
}
