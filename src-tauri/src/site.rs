use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};

use serde::Serialize;

// A company's website, run on this Mac the way Xcode runs an app: Play starts the project's own
// `dev` script, Stop ends it, the whole process group, so the dev server's workers go too. A Next.js
// server is bound to 127.0.0.1; nothing here is reachable from the network. All of them end with
// dhrive.

const MAX_LINES: usize = 40;

struct Site {
    child: Child,
    log: Arc<Mutex<VecDeque<String>>>,
}

static SITES: LazyLock<Mutex<HashMap<String, Site>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteState {
    // The project has a web app to run: a package.json with a dev script.
    app: bool,
    running: bool,
    // Where it answers, once its server has said so.
    port: Option<u16>,
    // Its last lines, for the owner to see what it's doing or why it stopped.
    log: Vec<String>,
}

fn dev_script(folder: &Path) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(folder.join("package.json")).ok()?).ok()?;
    json["scripts"]["dev"].as_str().map(str::to_string)
}

// The command for the project's dev script, installing first if it never was. A fixed string: nothing
// from the project reaches the shell but its own scripts, run by npm.
fn command_for(folder: &Path, script: &str) -> Command {
    let bind = if script.contains("next") { " -- --hostname 127.0.0.1" } else { "" };
    let install = if folder.join("node_modules").is_dir() { "" } else { "npm install && " };
    let mut command = Command::new("/bin/sh");
    command.args(["-c", &format!("{install}exec npm run dev{bind}")]).current_dir(folder);
    command
}

// "  - Local:  http://localhost:3000" → 3000; the first local address the server prints.
fn port_in(lines: &VecDeque<String>) -> Option<u16> {
    lines.iter().find_map(|line| {
        ["://localhost:", "://127.0.0.1:"].iter().find_map(|host| {
            let rest = &line[line.find(host)? + host.len()..];
            rest.chars().take_while(char::is_ascii_digit).collect::<String>().parse().ok()
        })
    })
}

fn keep(pipe: impl Read + Send + 'static, log: Arc<Mutex<VecDeque<String>>>) {
    std::thread::spawn(move || {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let mut log = log.lock().unwrap_or_else(|e| e.into_inner());
            log.push_back(line);
            if log.len() > MAX_LINES {
                log.pop_front();
            }
        }
    });
}

fn start(folder: &Path, env: &[(String, String)]) -> Result<(), String> {
    let key = folder.to_string_lossy().into_owned();
    let mut sites = SITES.lock().map_err(|_| "The website runner is unavailable.")?;
    if sites.get_mut(&key).is_some_and(|site| matches!(site.child.try_wait(), Ok(None))) {
        return Ok(());
    }
    let script = dev_script(folder).ok_or("This company has no website to run yet.")?;
    let mut command = command_for(folder, &script);
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).envs(env.iter().map(|(name, value)| (name, value))).env("FORCE_COLOR", "0").spawn().map_err(|e| format!("Couldn't start the website: {e}"))?;
    let log = Arc::new(Mutex::new(VecDeque::new()));
    keep(child.stdout.take().expect("piped"), log.clone());
    keep(child.stderr.take().expect("piped"), log.clone());
    sites.insert(key, Site { child, log });
    Ok(())
}

// A polite stop first, so the server can let go of its port; anything still there after a few
// seconds is killed.
fn end(site: &mut Site) {
    let group = format!("-{}", site.child.id());
    let _ = Command::new("/bin/kill").args(["-TERM", &group]).status();
    for _ in 0..30 {
        if !matches!(site.child.try_wait(), Ok(None)) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = Command::new("/bin/kill").args(["-KILL", &group]).status();
    let _ = site.child.wait();
}

pub(crate) fn stop(folder: &Path) {
    if let Some(mut site) = SITES.lock().ok().and_then(|mut sites| sites.remove(&*folder.to_string_lossy())) {
        end(&mut site);
    }
}

fn state(folder: &Path) -> SiteState {
    let app = dev_script(folder).is_some();
    let mut sites = SITES.lock().unwrap_or_else(|e| e.into_inner());
    let Some(site) = sites.get_mut(&*folder.to_string_lossy()) else {
        return SiteState { app, running: false, port: None, log: Vec::new() };
    };
    let running = matches!(site.child.try_wait(), Ok(None));
    let lines = site.log.lock().unwrap_or_else(|e| e.into_inner()).clone();
    SiteState { app, running, port: if running { port_in(&lines) } else { None }, log: lines.into_iter().rev().take(6).rev().collect() }
}

pub fn stop_all() {
    if let Ok(mut sites) = SITES.lock() {
        sites.values_mut().for_each(end);
        sites.clear();
    }
}

#[tauri::command]
pub fn site_state(app: tauri::AppHandle, project: String) -> Result<SiteState, String> {
    Ok(state(&crate::terminal::project_folder(&app, &project)?))
}

#[tauri::command]
pub fn run_site(app: tauri::AppHandle, project: String) -> Result<(), String> {
    start(&crate::terminal::project_folder(&app, &project)?, &crate::env::of_project(&project))
}

#[tauri::command]
pub fn stop_site(app: tauri::AppHandle, project: String) -> Result<(), String> {
    stop(&crate::terminal::project_folder(&app, &project)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_port_comes_from_the_first_local_address_the_server_prints() {
        let lines: VecDeque<String> = ["   ▲ Next.js 16.4.0", "   - Local:        http://localhost:3001", "   - Network:      http://192.168.0.4:3001"].map(String::from).into();
        assert_eq!(port_in(&lines), Some(3001));
        assert_eq!(port_in(&["ready on http://127.0.0.1:5173/".to_string()].into()), Some(5173));
        assert_eq!(port_in(&["compiling…".to_string()].into()), None);
    }

    #[test]
    fn play_runs_the_projects_dev_script_and_stop_ends_it() {
        let dir = std::env::temp_dir().join(format!("dhrive-site-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        assert!(!state(&dir).app && start(&dir, &[]).is_err(), "nothing to run yet");
        std::fs::write(dir.join("package.json"), r#"{"scripts": {"dev": "echo ready on http://localhost:4567 && sleep 30"}}"#).unwrap();
        start(&dir, &[]).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while state(&dir).port.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let running = state(&dir);
        assert!(running.app && running.running && running.port == Some(4567), "{running:?}");
        stop(&dir);
        assert_eq!(state(&dir), SiteState { app: true, running: false, port: None, log: Vec::new() });
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_a_next_server_is_told_where_to_bind_and_a_fresh_one_installs_first() {
        let dir = std::env::temp_dir().join(format!("dhrive-site-cmd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let args = |script: &str| command_for(&dir, script).get_args().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
        assert_eq!(args("next dev"), ["-c", "npm install && exec npm run dev -- --hostname 127.0.0.1"]);
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        assert_eq!(args("vite"), ["-c", "exec npm run dev"]);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
