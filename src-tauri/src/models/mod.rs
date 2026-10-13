mod antigravity;
mod claude;
mod codex;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::engine::Engine;

// The models each CLI offers, as the CLI itself reports them, so a model it ships tomorrow shows up
// in dhrive without a dhrive release. An empty id means "the CLI's own default" (no --model).

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModelOption {
    id: String,
    label: String,
    detail: Option<String>,
    // The effort levels the CLI says this model takes, in its own words and order; none when it
    // can't be set.
    efforts: Vec<String>,
}

impl ModelOption {
    pub fn new(id: &str, label: &str, detail: Option<&str>) -> Self {
        Self { id: id.into(), label: label.into(), detail: detail.map(str::to_string), efforts: Vec::new() }
    }

    pub fn with_efforts(self, efforts: Vec<String>) -> Self {
        Self { efforts, ..self }
    }
}

// The words found under `key` in each item of a list, or the items themselves when they're words.
pub(crate) fn words(list: &serde_json::Value, key: Option<&str>) -> Vec<String> {
    let items = list.as_array().map(Vec::as_slice).unwrap_or_default();
    items.iter().filter_map(|item| key.map_or(item, |k| &item[k]).as_str()).filter(|w| crate::flow::valid_effort(w)).map(str::to_string).collect()
}

// Asking a CLI takes about a second, so an answer is reused while that CLI's version stays the same,
// and for ten minutes at most: accounts and server-side lists change without a CLI update.
const FRESH_FOR: Duration = Duration::from_secs(10 * 60);

struct Listed {
    version: Option<String>,
    at: Instant,
    models: Vec<ModelOption>,
}

fn listed() -> &'static Mutex<HashMap<Engine, Listed>> {
    static LISTED: OnceLock<Mutex<HashMap<Engine, Listed>>> = OnceLock::new();
    LISTED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fresh(entry: &Listed, version: &Option<String>, now: Instant) -> bool {
    &entry.version == version && now.duration_since(entry.at) < FRESH_FOR
}

fn ask(engine: Engine) -> Vec<ModelOption> {
    let Some(program) = engine.locate() else {
        return Vec::new();
    };
    match engine {
        Engine::ClaudeCode => claude::fetch(&program).unwrap_or_else(|_| claude::fallback()),
        Engine::Codex => codex::fetch(&program).unwrap_or_else(|_| codex::from_cache()),
        Engine::Antigravity => antigravity::fetch(&program).unwrap_or_default(),
        Engine::Ollama => Vec::new(),
    }
}

fn cached_or_asked(engine: Engine) -> Vec<ModelOption> {
    let version = crate::clis::version(engine);
    if let Some(entry) = listed().lock().ok().and_then(|map| map.get(&engine).filter(|e| fresh(e, &version, Instant::now())).map(|e| e.models.clone())) {
        return entry;
    }
    let models = ask(engine);
    if let Ok(mut map) = listed().lock() {
        map.insert(engine, Listed { version, at: Instant::now(), models: models.clone() });
    }
    models
}

#[tauri::command]
pub async fn list_models(engine: Engine) -> Vec<ModelOption> {
    match engine {
        // Ollama answers from its local server in milliseconds, so it's asked every time. Its own
        // names ("qwen3.5:9b") are what the owner sees in its app, so they stay as-is.
        Engine::Ollama => crate::local::ollama::installed().await.unwrap_or_default().iter().map(|name| ModelOption::new(name, name, None)).collect(),
        _ => tauri::async_runtime::spawn_blocking(move || cached_or_asked(engine)).await.unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_cli_version_or_an_old_answer_asks_again() {
        let now = Instant::now();
        let entry = Listed { version: Some("2.1.284".into()), at: now, models: Vec::new() };
        assert!(fresh(&entry, &Some("2.1.284".into()), now + Duration::from_secs(60)));
        assert!(!fresh(&entry, &Some("2.1.290".into()), now));
        assert!(!fresh(&entry, &Some("2.1.284".into()), now + FRESH_FOR));
    }

    #[test]
    fn the_fallback_still_offers_every_claude_family() {
        let ids: Vec<String> = claude::fallback().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["", "opus", "sonnet", "haiku"]);
    }
}
