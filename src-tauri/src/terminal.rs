use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use base64::Engine as _;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::Emitter;

use crate::engine::Engine;

// Terminals mode: each pane is the CLI's own interactive screen (Claude Code, Codex, agy) in a
// pseudo-terminal inside a project's folder, drawn by xterm.js. dhrive only carries bytes both
// ways; the CLI keeps its own sign-in, permissions and commands.

const EVENT: &str = "dhrive-terminal";
const MAX_SESSIONS: usize = 12;
const MAX_INPUT: usize = 64 * 1024;
const MAX_ID: usize = 64;

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Output {
    // The bytes as base64: a chunk can end inside a UTF-8 character, which xterm puts back together.
    Data { data: String },
    Exit { code: u32 },
}

#[derive(Serialize, Clone)]
struct Event {
    id: String,
    #[serde(flatten)]
    output: Output,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols: cols.clamp(2, 1000), rows: rows.clamp(2, 500), pixel_width: 0, pixel_height: 0 }
}

// Starts `program` in `folder` on a new pseudo-terminal, with the company's environment (env.rs),
// and passes everything it prints to `sink`, then its exit, from a reader thread. The session is
// kept under `id` until it ends.
#[allow(clippy::too_many_arguments)]
fn open(id: &str, program: &Path, args: &[String], folder: &Path, env: &[(String, String)], cols: u16, rows: u16, sink: impl Fn(Output) + Send + 'static) -> Result<(), String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| format!("Couldn't open a terminal: {e}"))?;
    let mut command = CommandBuilder::new(program);
    command.args(args);
    command.cwd(folder);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    for (name, value) in env {
        command.env(name, value);
    }
    for (name, value) in [crate::sessions::TERMINALS_CLAUDE, crate::sessions::TERMINALS_CODEX] {
        command.env(name, value);
    }
    let child = pair.slave.spawn_command(command).map_err(|e| format!("Couldn't start {}: {e}", program.display()))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    sessions().lock().map_err(|_| "Terminals are unavailable.")?.insert(id.to_string(), Session { writer, master: pair.master, child });
    let id = id.to_string();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        while let Ok(read @ 1..) = reader.read(&mut buffer) {
            sink(Output::Data { data: base64::engine::general_purpose::STANDARD.encode(&buffer[..read]) });
        }
        let ended = sessions().lock().ok().and_then(|mut all| all.remove(&id));
        let code = ended.and_then(|mut s| s.child.wait().ok()).map_or(1, |status| status.exit_code());
        sink(Output::Exit { code });
    });
    Ok(())
}

fn with_session<T>(id: &str, act: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
    let mut all = sessions().lock().map_err(|_| "Terminals are unavailable.")?;
    act(all.get_mut(id).ok_or("That terminal has ended.")?)
}

fn close(id: &str) {
    if let Some(mut session) = sessions().lock().ok().and_then(|mut all| all.remove(id)) {
        let _ = session.child.kill();
    }
}

fn valid_id(id: &str) -> bool {
    (1..=MAX_ID).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

// A project the owner added, by its id; the webview never names a folder.
pub(crate) fn project_folder(app: &tauri::AppHandle, project: &str) -> Result<std::path::PathBuf, String> {
    let projects = crate::projects::read_projects(&crate::projects::data_dir(app)?)?;
    let folder = projects.iter().find(|p| p.id == project).map(|p| p.folder.clone()).ok_or("That project isn't in dhrive anymore.")?;
    Path::new(&folder).canonicalize().ok().filter(|f| f.is_dir()).ok_or_else(|| "That project folder isn't there anymore.".into())
}

// Only a project the owner added, and only a CLI with a screen of its own: local models have none.
// With `copy`, the CLI starts in the pane's own worktree of the project (worktrees.rs), and the
// answer names its branch.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn terminal_open(app: tauri::AppHandle, id: String, engine: Engine, project: String, copy: Option<String>, model: Option<String>, task: Option<String>, cols: u16, rows: u16) -> Result<Option<String>, String> {
    if !valid_id(&id) {
        return Err("That isn't a terminal id.".into());
    }
    if engine == Engine::Ollama {
        return Err("Ollama has no terminal of its own.".into());
    }
    let args = crate::pane_launch::args(engine, model.as_deref(), task.as_deref())?;
    let mut folder = project_folder(&app, &project)?;
    let mut branch = None;
    if let Some(pane) = copy {
        let dir = crate::worktrees::copy_dir(&folder, &pane)?;
        let made = tauri::async_runtime::spawn_blocking(move || crate::worktrees::ensure(&folder, &dir, &pane)).await.map_err(|e| e.to_string())??;
        (folder, branch) = (made.folder, Some(made.branch));
    }
    let program = engine.locate().ok_or_else(|| format!("{} isn't installed.", engine.label()))?;
    start(app, &id, &program, &args, &folder, &crate::env::of_project(&project), cols, rows)?;
    Ok(branch)
}

// A pane's session, replacing any it had, with its output going to the webview under its id.
#[allow(clippy::too_many_arguments)]
fn start(app: tauri::AppHandle, id: &str, program: &Path, args: &[String], folder: &Path, env: &[(String, String)], cols: u16, rows: u16) -> Result<(), String> {
    close(id);
    if sessions().lock().map_err(|_| "Terminals are unavailable.")?.len() >= MAX_SESSIONS {
        return Err(format!("Up to {MAX_SESSIONS} terminals can run at once."));
    }
    let event_id = id.to_string();
    open(id, program, args, folder, env, cols, rows, move |output| {
        let _ = app.emit(EVENT, Event { id: event_id.clone(), output });
    })
}

// A script of dhrive's own (connectors.rs) in the owner's login shell, so it finds what they've
// installed; never anything the webview wrote.
pub(crate) fn open_script(app: tauri::AppHandle, id: &str, script: &str, folder: &Path, cols: u16, rows: u16) -> Result<(), String> {
    if !valid_id(id) {
        return Err("That isn't a terminal id.".into());
    }
    let shell = std::env::var("SHELL").ok().filter(|s| s.ends_with("zsh") || s.ends_with("bash")).unwrap_or_else(|| "/bin/zsh".into());
    start(app, id, Path::new(&shell), &["-lc".to_string(), script.to_string()], folder, &[], cols, rows)
}

#[tauri::command]
pub fn terminal_write(id: String, data: String) -> Result<(), String> {
    if data.len() > MAX_INPUT {
        return Err("That's too much to type at once.".into());
    }
    with_session(&id, |s| s.writer.write_all(data.as_bytes()).and_then(|_| s.writer.flush()).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    with_session(&id, |s| s.master.resize(size(cols, rows)).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn terminal_close(id: String) {
    close(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    fn decoded(outputs: &[Output]) -> String {
        let bytes: Vec<u8> = outputs.iter().filter_map(|o| match o {
            Output::Data { data } => base64::engine::general_purpose::STANDARD.decode(data).ok(),
            Output::Exit { .. } => None,
        }).flatten().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    // A real pseudo-terminal: what's typed reaches the program, what it prints comes back, and its
    // exit is reported once it ends.
    #[test]
    fn a_program_in_a_terminal_reads_what_is_typed_and_its_output_comes_back() {
        let script = std::env::temp_dir().join(format!("dhrive-pty-{}.sh", std::process::id()));
        std::fs::write(&script, "#!/bin/sh\nprintf 'ready\\n'\nread answer\nprintf 'got %s in %s with %s\\n' \"$answer\" \"$(basename \"$PWD\")\" \"$DHRIVE_TEST_VAR\"\nexit 3\n").unwrap();
        std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let (tx, rx) = mpsc::channel();
        let sink = Arc::new(Mutex::new(tx));
        open("test-pty", &script, &[], &std::env::temp_dir(), &[("DHRIVE_TEST_VAR".into(), "kept".into())], 80, 24, move |o| { let _ = sink.lock().unwrap().send(o); }).unwrap();
        let mut seen = Vec::new();
        while !decoded(&seen).contains("ready") {
            seen.push(rx.recv_timeout(Duration::from_secs(5)).unwrap());
        }
        terminal_resize("test-pty".into(), 120, 40).unwrap();
        terminal_write("test-pty".into(), "dhrive\r".into()).unwrap();
        loop {
            let output = rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let exited = matches!(output, Output::Exit { .. });
            seen.push(output);
            if exited {
                break;
            }
        }
        std::fs::remove_file(&script).unwrap();
        let tmp = std::env::temp_dir().canonicalize().unwrap();
        assert!(decoded(&seen).contains(&format!("got dhrive in {} with kept", tmp.file_name().unwrap().to_string_lossy())), "{}", decoded(&seen));
        assert_eq!(seen.last(), Some(&Output::Exit { code: 3 }));
        assert!(terminal_write("test-pty".into(), "x".into()).is_err(), "an ended terminal takes no input");
    }

    // Each installed CLI draws its own screen in a terminal. Nothing is typed, so no model is asked.
    #[test]
    #[ignore = "starts the real CLIs installed on this Mac"]
    fn every_installed_cli_draws_its_screen_in_a_terminal() {
        for engine in [Engine::ClaudeCode, Engine::Codex, Engine::Antigravity] {
            let Some(program) = engine.locate() else { continue };
            let (tx, rx) = mpsc::channel();
            let sink = Arc::new(Mutex::new(tx));
            let id = format!("live-{engine:?}");
            open(&id, &program, &[], &std::env::temp_dir(), &[], 100, 30, move |o| { let _ = sink.lock().unwrap().send(o); }).unwrap();
            let mut seen = Vec::new();
            while let Ok(output) = rx.recv_timeout(Duration::from_secs(8)) {
                seen.push(output);
                if decoded(&seen).len() > 400 {
                    break;
                }
            }
            close(&id);
            let screen = decoded(&seen);
            assert!(screen.contains("\x1b["), "{engine:?} drew nothing: {screen:?}");
            println!("{engine:?}: {} bytes, e.g. {:?}", screen.len(), screen.chars().filter(|c| c.is_ascii_alphabetic() || *c == ' ').collect::<String>().split_whitespace().take(12).collect::<Vec<_>>());
        }
    }

    #[test]
    fn only_plain_ids_and_sane_sizes_get_through() {
        assert!(valid_id("pane-1a2b") && !valid_id("") && !valid_id("../x") && !valid_id(&"a".repeat(65)));
        assert_eq!((size(0, 9999).cols, size(0, 9999).rows), (2, 500));
        assert!(terminal_write("nope".into(), "x".repeat(MAX_INPUT + 1)).is_err());
    }
}
