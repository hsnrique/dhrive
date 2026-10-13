use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// dhrive talks to the Ollama server the owner already runs, on its fixed local port. Codex's --oss
// mode reaches the same address, so what's listed here is what a run can use.
const BASE: &str = "http://127.0.0.1:11434";
// Ollama streams one short JSON object per line; anything this long is not Ollama.
const MAX_LINE: usize = 64 * 1024;

pub fn binary() -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .map(|dir| dir.join("ollama"))
        .chain([PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama")])
        .find(|candidate| candidate.is_file())
}

fn client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    // reqwest refuses to build without a TLS crypto provider, even for plain local HTTP, and the
    // updater only installs one when it first checks. Same provider, whoever gets here first.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let builder = reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(2));
    let builder = match timeout {
        Some(timeout) => builder.timeout(timeout),
        None => builder,
    };
    builder.build().map_err(|error| error.to_string())
}

async fn get(path: &str) -> Result<Value, String> {
    let response = client(Some(Duration::from_secs(5)))?.get(format!("{BASE}{path}")).send().await.map_err(|_| NOT_RUNNING.to_string())?;
    response.json().await.map_err(|error| format!("Ollama sent something unexpected: {error}"))
}

pub const NOT_RUNNING: &str = "Ollama isn't running. Open it and try again.";

pub async fn running() -> bool {
    get("/api/version").await.is_ok()
}

#[derive(Deserialize)]
struct Tag {
    name: String,
    // Older Ollama versions don't list capabilities; their models are offered rather than hidden.
    capabilities: Option<Vec<String>>,
}

// Installed models that can call tools, the only kind an agent loop can drive.
pub fn tool_models(tags: &Value) -> Vec<String> {
    let tags: Vec<Tag> = serde_json::from_value(tags["models"].clone()).unwrap_or_default();
    tags.into_iter()
        .filter(|tag| tag.capabilities.as_ref().is_none_or(|caps| caps.iter().any(|c| c == "tools")))
        .map(|tag| tag.name)
        .collect()
}

pub async fn installed() -> Result<Vec<String>, String> {
    Ok(tool_models(&get("/api/tags").await?))
}

// "qwen3.5" and "qwen3.5:latest" are the same model to Ollama.
pub fn same_model(a: &str, b: &str) -> bool {
    let full = |id: &str| if id.contains(':') { id.to_string() } else { format!("{id}:latest") };
    full(a) == full(b)
}

// The context Ollama actually gave a loaded model; None when nothing is loaded, since the owner
// may have changed the default in Ollama's settings and only a loaded model tells the truth.
pub async fn loaded_context() -> Option<u64> {
    let ps = get("/api/ps").await.ok()?;
    ps["models"].as_array()?.iter().filter_map(|model| model["context_length"].as_u64()).max()
}

// Codex's local mode downloads a missing model on its own, and a surprise 20 GB download is the
// wrong way to find out a name was mistyped. So a run only starts on a model already installed.
pub async fn require(model: Option<&str>) -> Result<(), String> {
    let model = model.ok_or("Pick an Ollama model first.")?;
    if installed().await?.iter().any(|name| same_model(name, model)) {
        return Ok(());
    }
    Err(format!("{model} isn't installed in Ollama. Install it from Ollama in the sidebar first."))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PullProgress {
    pub status: String,
    pub completed: u64,
    pub total: u64,
}

// Folds Ollama's per-layer pull lines into one progress for the whole model, and only reports when
// something visible changed (a new percent or a new phase), so the UI isn't flooded.
#[derive(Default)]
pub struct PullTracker {
    layers: HashMap<String, (u64, u64)>,
    shown: Option<(String, u64)>,
    pub done: bool,
}

impl PullTracker {
    pub fn apply(&mut self, line: &str) -> Result<Option<PullProgress>, String> {
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
            return Ok(None);
        };
        if let Some(error) = event["error"].as_str() {
            return Err(format!("Ollama couldn't download it: {error}"));
        }
        let status = match (event["digest"].as_str(), event["total"].as_u64()) {
            (Some(digest), Some(total)) => {
                self.layers.insert(digest.to_string(), (event["completed"].as_u64().unwrap_or(0), total));
                "downloading".to_string()
            }
            _ => event["status"].as_str().unwrap_or_default().to_string(),
        };
        self.done |= status == "success";
        let (completed, total) = self.layers.values().fold((0, 0), |(c, t), (layer_c, layer_t)| (c + layer_c, t + layer_t));
        let percent = (completed * 100).checked_div(total).unwrap_or(0);
        if self.shown.as_ref() == Some(&(status.clone(), percent)) {
            return Ok(None);
        }
        self.shown = Some((status.clone(), percent));
        Ok(Some(PullProgress { status, completed, total }))
    }
}

pub async fn pull(model: &str, stopped: impl Fn() -> bool, report: impl Fn(PullProgress)) -> Result<(), String> {
    let body = serde_json::json!({ "model": model, "stream": true });
    let mut response = client(None)?.post(format!("{BASE}/api/pull")).json(&body).send().await.map_err(|_| NOT_RUNNING.to_string())?;
    let mut tracker = PullTracker::default();
    let mut pending: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("The download stopped: {error}"))? {
        if stopped() {
            return Err("Stopped. Installing again picks up where it left off.".into());
        }
        pending.extend_from_slice(&chunk);
        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=end).collect();
            tracker.apply(&String::from_utf8_lossy(&line))?.into_iter().for_each(&report);
        }
        if pending.len() > MAX_LINE {
            return Err("Ollama sent something unexpected.".into());
        }
    }
    tracker.apply(&String::from_utf8_lossy(&pending))?.into_iter().for_each(&report);
    if tracker.done {
        Ok(())
    } else {
        Err("The download ended early. Installing again picks up where it left off.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_models_that_call_tools_are_offered() {
        let tags = serde_json::json!({ "models": [
            { "name": "qwen3.5:9b", "capabilities": ["completion", "tools"] },
            { "name": "embed:latest", "capabilities": ["embedding"] },
            { "name": "old:7b" }
        ]});
        assert_eq!(tool_models(&tags), ["qwen3.5:9b", "old:7b"]);
        assert!(tool_models(&serde_json::json!({ "models": "nope" })).is_empty());
    }

    #[test]
    fn a_bare_name_means_latest() {
        assert!(same_model("laguna-xs-2.1", "laguna-xs-2.1:latest"));
        assert!(!same_model("ornith:9b", "ornith:35b"));
    }

    #[test]
    fn pull_progress_sums_layers_and_skips_repeats() {
        let mut tracker = PullTracker::default();
        let first = tracker.apply(r#"{"status":"pulling manifest"}"#).unwrap().unwrap();
        assert_eq!(first.status, "pulling manifest");
        let big = tracker.apply(r#"{"status":"pulling a1","digest":"sha256:a1","total":900,"completed":450}"#).unwrap().unwrap();
        assert_eq!((big.completed, big.total), (450, 900));
        assert!(tracker.apply(r#"{"status":"pulling a1","digest":"sha256:a1","total":900,"completed":451}"#).unwrap().is_none());
        let both = tracker.apply(r#"{"status":"pulling b2","digest":"sha256:b2","total":100,"completed":100}"#).unwrap().unwrap();
        assert_eq!((both.completed, both.total), (551, 1000));
        assert!(!tracker.done);
        tracker.apply(r#"{"status":"success"}"#).unwrap();
        assert!(tracker.done);
    }

    #[test]
    #[ignore = "talks to the Ollama running on this Mac; pulls a model it already has, so nothing downloads"]
    fn lists_and_re_pulls_against_the_real_ollama() {
        let models = tauri::async_runtime::block_on(installed()).unwrap();
        let model = models.first().expect("at least one tool model installed").clone();
        let seen = std::sync::Mutex::new(Vec::new());
        tauri::async_runtime::block_on(pull(&model, || false, |p| seen.lock().unwrap().push(p.status))).unwrap();
        assert_eq!(seen.lock().unwrap().last().map(String::as_str), Some("success"));
        assert!(tauri::async_runtime::block_on(require(Some(&model))).is_ok());
        assert!(tauri::async_runtime::block_on(require(Some("not-a-model:1b"))).is_err());
    }

    #[test]
    fn a_pull_error_line_fails_the_pull() {
        let error = PullTracker::default().apply(r#"{"error":"pull model manifest: file does not exist"}"#).unwrap_err();
        assert!(error.contains("file does not exist"));
        assert!(PullTracker::default().apply("").unwrap().is_none());
    }
}
