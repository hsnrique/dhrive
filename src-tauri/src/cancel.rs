use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

// Tracks the live child process group(s) per run so a running step can be stopped. Children are
// spawned as process-group leaders (see proc.rs), so killing `-pid` takes down the CLI plus
// everything it spawned (test runners, dev servers, …).
fn running() -> &'static Mutex<HashMap<String, HashSet<u32>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, HashSet<u32>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn register(run_id: &str, pid: u32) {
    if let Ok(mut map) = running().lock() {
        map.entry(run_id.to_string()).or_default().insert(pid);
    }
}

pub fn unregister(run_id: &str, pid: u32) {
    if let Ok(mut map) = running().lock() {
        if let Some(pids) = map.get_mut(run_id) {
            pids.remove(&pid);
        }
    }
}

// Cleared when a run starts so a stale stop never aborts the next run.
pub fn begin(run_id: &str) {
    if let Ok(mut set) = cancelled().lock() {
        set.remove(run_id);
    }
}

pub fn is_cancelled(run_id: &str) -> bool {
    cancelled().lock().map(|set| set.contains(run_id)).unwrap_or(false)
}

pub fn stop(run_id: &str) {
    if let Ok(mut set) = cancelled().lock() {
        set.insert(run_id.to_string());
    }
    let pids: Vec<u32> = running()
        .lock()
        .ok()
        .and_then(|map| map.get(run_id).map(|pids| pids.iter().copied().collect()))
        .unwrap_or_default();
    for pid in pids {
        // Negative pid → signal the whole process group.
        let _ = Command::new("/bin/kill").arg("-9").arg(format!("-{pid}")).status();
    }
}

#[tauri::command]
pub fn stop_run(run_id: String) {
    stop(&run_id);
}
