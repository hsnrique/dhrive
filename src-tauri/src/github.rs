use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::Emitter;

use crate::git::{git, run, NETWORK};

// A company's code on GitHub through gh, the owner's own GitHub CLI: dhrive never sees a token, gh
// keeps it. Where things stand (gh there or not, signed in as whom, the repo, what isn't saved yet),
// putting the company on GitHub as a private repo, and saving its work there since.

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubState {
    gh: bool,
    account: Option<String>,
    repo: Option<String>,
    changes: usize,
}

// Who gh is signed in as: a GitHub login, or nothing when it isn't (or isn't reachable).
fn login(said: &str) -> Option<String> {
    let name = said.trim();
    (!name.is_empty() && name.len() <= 39 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then(|| name.to_string())
}

// The repo's web address from its origin, when origin is on GitHub.
fn repo_url(remote: &str) -> Option<String> {
    let path = remote.trim().strip_prefix("https://github.com/").or_else(|| remote.trim().strip_prefix("git@github.com:"))?;
    let path = path.trim_end_matches(".git").trim_end_matches('/');
    (path.split('/').count() == 2 && path.split('/').all(|p| !p.is_empty())).then(|| format!("https://github.com/{path}"))
}

fn gh_installed() -> bool {
    crate::engine::find_on_path("gh", &std::env::var_os("PATH").unwrap_or_default()).is_some()
}

fn state(folder: &Path) -> GitHubState {
    let gh = gh_installed();
    // Asking GitHub who this is, rather than reading gh's status text, which moves between versions.
    let account = gh.then(|| run(folder, "gh", &["api", "user", "--jq", ".login"], NETWORK).ok()).flatten().and_then(|said| login(&said));
    let repo = git(folder, &["remote", "get-url", "origin"]).ok().and_then(|remote| repo_url(&remote));
    // What saving would send: secrets are never sent, so they don't count.
    let changes = git(folder, &["status", "--porcelain"]).map(|s| s.lines().filter(|l| !secret(l.get(3..).unwrap_or(""))).count()).unwrap_or(0);
    GitHubState { gh, account, repo, changes }
}

// Never a secret into the repo: env files other than the example stay out, whatever .gitignore says.
fn secret(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    (name.starts_with(".env") && name != ".env.example") || name.ends_with(".pem") || name.ends_with(".key") || name == "id_rsa" || name == "id_ed25519"
}

// Stages everything but secrets and commits it; nothing to commit is fine.
fn save_locally(folder: &Path, message: &str) -> Result<(), String> {
    git(folder, &["add", "-A"])?;
    let staged = git(folder, &["diff", "--cached", "--name-only"])?;
    for path in staged.lines().filter(|p| secret(p)) {
        git(folder, &["rm", "--cached", "--quiet", "--", path])?;
    }
    if git(folder, &["diff", "--cached", "--quiet"]).is_ok() {
        return Ok(());
    }
    git(folder, &["commit", "--quiet", "-m", message]).map(|_| ())
}

// What the owner wrote, or the plain line when they didn't; git takes the rest as written.
const DEFAULT_MESSAGE: &str = "Save from dhrive";
const MAX_MESSAGE: usize = 4000;

fn message_or_default(message: Option<&str>) -> String {
    let written = message.map(str::trim).filter(|m| !m.is_empty()).unwrap_or(DEFAULT_MESSAGE);
    written.chars().take(MAX_MESSAGE).collect()
}

// What saving would commit, for a CLI to write the message from: the files, then the diff, cut to
// a size a prompt can carry. Secrets never appear; the company's records are counted but not shown,
// being the app's bookkeeping, not the work.
const MAX_DIFF: usize = 12_000;
const NOT_SHOWN: &[&str] = &[":(exclude,glob)**/.env*", ":(exclude,glob)**/*.pem", ":(exclude,glob)**/*.key", ":(exclude,glob).company/**"];

fn pending(folder: &Path) -> Result<String, String> {
    let status = git(folder, &["status", "--porcelain"])?;
    let files: Vec<&str> = status.lines().filter(|l| !secret(l.get(3..).unwrap_or(""))).collect();
    if files.is_empty() {
        return Ok(String::new());
    }
    let mut diff_args = vec!["diff", "HEAD", "--", "."];
    diff_args.extend(NOT_SHOWN);
    // A folder with no commit yet has no HEAD to compare with: the file list says it all.
    let diff = git(folder, &diff_args).unwrap_or_default();
    let cut: String = diff.chars().take(MAX_DIFF).collect();
    let more = if diff.chars().count() > MAX_DIFF { "\n[the rest of the diff is cut]" } else { "" };
    Ok(format!("Files (git status):\n{}\n\nDiff:\n{cut}{more}", files.join("\n")))
}

fn put_on(folder: &Path, name: &str, message: Option<&str>) -> Result<String, String> {
    save_locally(folder, &message_or_default(message))?;
    // git pushes with gh's sign-in; a no-op when gh already set that up.
    let _ = run(folder, "gh", &["auth", "setup-git"], NETWORK);
    if let Some(repo) = git(folder, &["remote", "get-url", "origin"]).ok().and_then(|r| repo_url(&r)) {
        run(folder, "git", &["push", "--quiet", "-u", "origin", "HEAD"], NETWORK)?;
        return Ok(repo);
    }
    run(folder, "gh", &["repo", "create", name, "--private", "--source", ".", "--remote", "origin", "--push"], NETWORK)?;
    git(folder, &["remote", "get-url", "origin"]).ok().and_then(|r| repo_url(&r)).ok_or_else(|| "GitHub made the repo but dhrive couldn't find it. Check github.com.".into())
}

// "! First copy your one-time code: 1A2B-3C4D" is the code the owner types on github.com.
fn code_in(line: &str) -> Option<String> {
    let code = line.split("one-time code:").nth(1)?.trim();
    let shaped = code.len() == 9 && code.as_bytes()[4] == b'-' && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    shaped.then(|| code.to_string())
}

// gh's own browser sign-in: it hands out a one-time code, which goes to the app to show, opens
// github.com/login/device, and finishes once the owner approves there. The token stays with gh.
fn sign_in(app: &tauri::AppHandle) -> Result<(), String> {
    let mut child = Command::new("gh")
        .args(["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--skip-ssh-key"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start GitHub's sign-in: {e}"))?;
    let mut stdin = child.stdin.take();
    let stderr = child.stderr.take().ok_or("Couldn't read GitHub's sign-in.")?;
    // gh gives up by itself when the code expires (15 minutes), which ends this loop.
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        if let Some(code) = code_in(&line) {
            let _ = app.emit("dhrive-github-code", code);
            // Enter: gh opens the browser at the page that takes the code.
            if let Some(mut input) = stdin.take() {
                let _ = input.write_all(b"\n");
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| "GitHub's sign-in didn't finish. Try again.".into())
}

#[tauri::command]
pub async fn github_sign_in(app: tauri::AppHandle) -> Result<(), String> {
    if !gh_installed() {
        return Err("Install GitHub's command line tool first: cli.github.com".into());
    }
    tauri::async_runtime::spawn_blocking(move || sign_in(&app)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_state(app: tauri::AppHandle, project: String) -> Result<GitHubState, String> {
    let folder = crate::terminal::project_folder(&app, &project)?;
    tauri::async_runtime::spawn_blocking(move || state(&folder)).await.map_err(|e| e.to_string())
}

// Puts the company on GitHub the first time (a private repo named after it) and saves its work there
// every time after: whatever changed is committed, then pushed.
#[tauri::command]
pub async fn save_to_github(app: tauri::AppHandle, project: String, message: Option<String>) -> Result<String, String> {
    let folder = crate::terminal::project_folder(&app, &project)?;
    let name = crate::publish::site_name(&folder);
    tauri::async_runtime::spawn_blocking(move || put_on(&folder, &name, message.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pending_changes(app: tauri::AppHandle, project: String) -> Result<String, String> {
    let folder = crate::terminal::project_folder(&app, &project)?;
    tauri::async_runtime::spawn_blocking(move || pending(&folder)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gh_says_who_is_signed_in_and_origin_says_which_repo() {
        assert_eq!(login("hsnrique\n").as_deref(), Some("hsnrique"));
        assert_eq!(login("You are not logged into any GitHub hosts."), None);
        assert_eq!(repo_url("https://github.com/ana/acme.git\n").as_deref(), Some("https://github.com/ana/acme"));
        assert_eq!(repo_url("git@github.com:ana/acme.git").as_deref(), Some("https://github.com/ana/acme"));
        assert_eq!(repo_url("https://gitlab.com/ana/acme.git"), None);
        assert_eq!(repo_url("https://github.com/ana"), None);
    }

    #[test]
    fn the_one_time_code_is_read_from_what_gh_prints() {
        assert_eq!(code_in("! First copy your one-time code: 1A2B-3C4D").as_deref(), Some("1A2B-3C4D"));
        assert_eq!(code_in("Press Enter to open github.com in your browser..."), None);
        assert_eq!(code_in("one-time code: nope"), None);
    }

    #[test]
    fn saving_commits_everything_but_secrets() {
        let dir = std::env::temp_dir().join(format!("dhrive-github-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git(&dir, args).unwrap();
        }
        for (file, body) in [("page.tsx", "x"), (".env", "KEY=1"), (".env.example", "KEY="), ("server.pem", "-")] {
            std::fs::write(dir.join(file), body).unwrap();
        }
        save_locally(&dir, "Save from dhrive").unwrap();
        let committed = git(&dir, &["ls-files"]).unwrap();
        assert_eq!(committed.lines().collect::<Vec<_>>(), [".env.example", "page.tsx"]);
        save_locally(&dir, "Save from dhrive").unwrap();
        assert_eq!(git(&dir, &["rev-list", "--count", "HEAD"]).unwrap(), "1", "nothing new, no empty commit");
        assert_eq!(state(&dir).changes, 0, "the secrets stay out, and don't count as unsaved");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_owner_s_message_is_used_and_an_empty_one_falls_back() {
        assert_eq!(message_or_default(Some("  Add the pricing page \n")), "Add the pricing page");
        assert_eq!(message_or_default(Some("   ")), DEFAULT_MESSAGE);
        assert_eq!(message_or_default(None), DEFAULT_MESSAGE);
        assert_eq!(message_or_default(Some(&"x".repeat(9000))).len(), MAX_MESSAGE);
    }

    #[test]
    fn pending_changes_show_the_work_but_never_a_secret_or_the_records() {
        let dir = std::env::temp_dir().join(format!("dhrive-github-pending-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".company")).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git(&dir, args).unwrap();
        }
        std::fs::write(dir.join("page.tsx"), "old").unwrap();
        std::fs::write(dir.join(".company/tasks.json"), "[]").unwrap();
        save_locally(&dir, "first").unwrap();
        assert_eq!(pending(&dir).unwrap(), "", "nothing changed, nothing to describe");
        std::fs::write(dir.join("page.tsx"), "new headline").unwrap();
        std::fs::write(dir.join(".company/tasks.json"), "[{\"title\": \"secret-ish bookkeeping\"}]").unwrap();
        std::fs::write(dir.join(".env"), "STRIPE_KEY=sk_live_123").unwrap();
        let said = pending(&dir).unwrap();
        assert!(said.contains("page.tsx") && said.contains("new headline"));
        assert!(said.contains(".company/tasks.json") && !said.contains("bookkeeping"), "records listed, not shown");
        assert!(!said.contains("sk_live") && !said.contains(".env"), "a secret never reaches the prompt");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
