mod catalog;
pub mod ollama;

use std::process::Command;

use serde::Serialize;
use tauri::Emitter;

use catalog::{Fit, CATALOG};

// Open-weight models on the owner's own Mac: what the machine can hold, what Ollama already has,
// and one-click installs through Ollama's local API.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    chip: String,
    memory_bytes: u64,
    free_disk_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    id: &'static str,
    label: &'static str,
    bytes: u64,
    fit: Fit,
    installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OllamaState {
    Missing,
    Stopped,
    Running,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalScan {
    machine: Machine,
    ollama: OllamaState,
    codex: bool,
    context: Option<u64>,
    models: Vec<LocalModel>,
}

fn sysctl(key: &str) -> String {
    Command::new("/usr/sbin/sysctl")
        .args(["-n", key])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_default()
}

// `df -kP` prints a header, then "filesystem blocks used available capacity mount" in KiB.
fn parse_df(out: &str) -> Option<u64> {
    let available = out.lines().nth(1)?.split_whitespace().nth(3)?;
    available.parse::<u64>().ok().map(|kib| kib * 1024)
}

fn free_disk() -> u64 {
    let home = std::env::var_os("HOME").unwrap_or_else(|| "/".into());
    Command::new("/bin/df").arg("-kP").arg(home).output().ok().and_then(|out| parse_df(&String::from_utf8_lossy(&out.stdout))).unwrap_or(0)
}

fn machine() -> Machine {
    Machine { chip: sysctl("machdep.cpu.brand_string"), memory_bytes: sysctl("hw.memsize").parse().unwrap_or(0), free_disk_bytes: free_disk() }
}

fn models(machine: &Machine, installed: &[String]) -> Vec<LocalModel> {
    CATALOG
        .iter()
        .map(|entry| {
            let installed = installed.iter().any(|name| ollama::same_model(name, entry.id));
            // An installed model is already on disk, so free space no longer decides whether it fits.
            let disk = if installed { u64::MAX } else { machine.free_disk_bytes };
            LocalModel { id: entry.id, label: entry.label, bytes: entry.bytes, fit: catalog::fit(entry.bytes, machine.memory_bytes, disk), installed }
        })
        .collect()
}

#[tauri::command]
pub async fn scan_local() -> LocalScan {
    let machine = machine();
    let running = ollama::running().await;
    let ollama = match (running, ollama::binary()) {
        (true, _) => OllamaState::Running,
        (false, Some(_)) => OllamaState::Stopped,
        (false, None) => OllamaState::Missing,
    };
    let installed = if running { ollama::installed().await.unwrap_or_default() } else { Vec::new() };
    let context = if running { ollama::loaded_context().await } else { None };
    LocalScan { models: models(&machine, &installed), machine, ollama, codex: crate::engine::Engine::Codex.locate().is_some(), context }
}

pub const PULL_EVENT: &str = "dhrive-pull";

#[derive(Serialize, Clone)]
struct PullEvent {
    model: String,
    #[serde(flatten)]
    progress: ollama::PullProgress,
}

// Stopped through the same stop_run as a step, under a key no step run id can take.
fn stop_key(model: &str) -> String {
    format!("pull:{model}")
}

#[tauri::command]
pub async fn pull_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    let model = model.trim().to_string();
    if !crate::flow::valid_model(&model) {
        return Err("That isn't a model name Ollama uses.".into());
    }
    let key = stop_key(&model);
    crate::cancel::begin(&key);
    let report = |progress| {
        let _ = app.emit(PULL_EVENT, PullEvent { model: model.clone(), progress });
    };
    ollama::pull(&model, || crate::cancel::is_cancelled(&key), report).await
}

#[tauri::command]
pub fn start_ollama() -> Result<(), String> {
    let status = Command::new("/usr/bin/open").args(["-a", "Ollama"]).status().map_err(|error| error.to_string())?;
    status.success().then_some(()).ok_or_else(|| "Couldn't open Ollama.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_available_space_from_df() {
        let out = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 482797652 244318540 214985344 54% /System/Volumes/Data\n";
        assert_eq!(parse_df(out), Some(214_985_344 * 1024));
        assert_eq!(parse_df("garbage"), None);
    }

    #[test]
    fn installed_models_are_marked_and_never_blocked_by_disk() {
        let machine = Machine { chip: "Apple M5".into(), memory_bytes: 16 << 30, free_disk_bytes: 0 };
        let listed = models(&machine, &["qwen3.5:9b".to_string()]);
        let qwen = listed.iter().find(|m| m.id == "qwen3.5:9b").unwrap();
        assert!(qwen.installed && qwen.fit == Fit::Good);
        assert!(listed.iter().filter(|m| !m.installed).all(|m| m.fit == Fit::NoDisk));
    }
}
