use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::ModelOption;
use crate::jsonl::JsonlChild;

const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PAGES: u64 = 10;

// Codex's app-server (the protocol its IDE extensions use) lists the models the signed-in account can
// use right now, including ones released after this dhrive was built.
pub fn fetch(program: &Path) -> Result<Vec<ModelOption>, String> {
    let mut codex = JsonlChild::codex_in(program, &std::env::temp_dir(), TIMEOUT)?;
    let mut listed = Vec::new();
    let mut cursor = Value::Null;
    for page in 1..=MAX_PAGES {
        let params = if cursor.is_null() { json!({}) } else { json!({ "cursor": cursor }) };
        let result = codex.call(page, "model/list", params)?;
        listed.extend(result["data"].as_array().cloned().unwrap_or_default());
        cursor = result["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    let models = parse(&listed);
    if models.len() <= 1 {
        return Err("Codex listed no models.".into());
    }
    Ok(models)
}

// Visible models, led by the "no --model" choice, named after the model Codex currently defaults to.
pub fn parse(listed: &[Value]) -> Vec<ModelOption> {
    let visible: Vec<&Value> = listed.iter().filter(|m| m["hidden"] != true && m["id"].is_string()).collect();
    let current = visible.iter().find(|m| m["isDefault"] == true).and_then(|m| m["displayName"].as_str());
    let efforts = |m: &Value| super::words(&m["supportedReasoningEfforts"], Some("reasoningEffort"));
    let default_efforts = visible.iter().find(|m| m["isDefault"] == true).map(|m| efforts(m)).unwrap_or_default();
    let default = ModelOption::new("", "Default", Some(&current.map_or("Codex's default".to_string(), |name| format!("Codex's default, now {name}")))).with_efforts(default_efforts);
    let models = visible.iter().map(|m| {
        let id = m["id"].as_str().unwrap_or_default();
        ModelOption::new(id, m["displayName"].as_str().unwrap_or(id), m["description"].as_str()).with_efforts(efforts(m))
    });
    std::iter::once(default).chain(models).collect()
}

#[derive(Deserialize)]
struct CodexCache {
    models: Vec<CachedModel>,
}

#[derive(Deserialize)]
struct CachedModel {
    slug: String,
    display_name: Option<String>,
    visibility: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Value,
}

// The app-server is marked experimental, so the models cache Codex writes on every run stays as the
// fallback; the models it doesn't hide are the ones its own picker shows.
pub fn from_cache_json(cache_json: &str) -> Vec<ModelOption> {
    let Ok(cache) = serde_json::from_str::<CodexCache>(cache_json) else {
        return Vec::new();
    };
    let models = cache
        .models
        .into_iter()
        .filter(|model| model.visibility.as_deref() != Some("hide"))
        .map(|model| ModelOption::new(&model.slug, model.display_name.as_deref().unwrap_or(&model.slug), None).with_efforts(super::words(&model.supported_reasoning_levels, Some("effort"))));
    std::iter::once(ModelOption::new("", "Default", Some("Codex's default"))).chain(models).collect()
}

fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
}

pub fn from_cache() -> Vec<ModelOption> {
    codex_home().and_then(|home| std::fs::read_to_string(home.join("models_cache.json")).ok()).map(|json| from_cache_json(&json)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_visible_models_after_a_default_named_for_the_current_one() {
        let listed = [
            json!({ "id": "gpt-6-astra", "displayName": "GPT-6-Astra", "description": "Frontier intelligence.", "hidden": false, "isDefault": true, "supportedReasoningEfforts": [{ "reasoningEffort": "low", "description": "Fast" }, { "reasoningEffort": "xhigh" }] }),
            json!({ "id": "gpt-secret", "displayName": "Secret", "hidden": true }),
            json!({ "id": "gpt-5.5" }),
        ];
        let models = parse(&listed);
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["", "gpt-6-astra", "gpt-5.5"]);
        assert_eq!(models[0].detail.as_deref(), Some("Codex's default, now GPT-6-Astra"));
        assert_eq!(models[2].label, "gpt-5.5");
        assert_eq!(models[1].efforts, ["low", "xhigh"]);
        assert_eq!(models[0].efforts, models[1].efforts, "the default takes what the model behind it takes");
        assert!(models[2].efforts.is_empty());
    }

    #[test]
    fn the_cache_lists_visible_models_and_survives_garbage() {
        let cache = r#"{"fetched_at":"x","models":[
            {"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]},
            {"slug":"gpt-reserve","display_name":"GPT-Reserve","visibility":"hide"},
            {"slug":"gpt-5.5"}
        ]}"#;
        let models = from_cache_json(cache);
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["", "gpt-6-astra", "gpt-5.5"]);
        assert_eq!(models[1].efforts, ["low", "high"]);
        assert!(from_cache_json("not json").is_empty());
        assert!(from_cache_json(r#"{"models": "nope"}"#).is_empty());
    }

    #[test]
    #[ignore = "starts the Codex installed on this Mac"]
    fn the_installed_codex_lists_its_models() {
        let models = fetch(&crate::engine::Engine::Codex.locate().unwrap()).unwrap();
        assert!(models.len() > 1, "{models:?}");
    }
}
