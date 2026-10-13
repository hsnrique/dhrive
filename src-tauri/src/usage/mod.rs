mod claude;
mod codex;

use serde::Serialize;
use serde_json::Value;

use crate::engine::Engine;

// How much of the owner's plan each CLI's account has used, asked of the CLI the moment the owner
// looks, without a model call: Claude Code answers /usage over its SDK protocol, Codex its app-server.
// Both protocols are marked experimental, so every field is read loosely and one that's missing is
// simply not shown.

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanUsage {
    plan: Option<String>,
    account: Option<String>,
    windows: Vec<Window>,
    // Where this week's usage went, by surface ("Claude Code", "Chats").
    shares: Vec<Share>,
    notes: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    label: String,
    percent: u32,
    // Seconds since the epoch.
    resets_at: Option<u64>,
    // The CLI says it's getting close, or it's past 90%.
    warn: bool,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Share {
    label: String,
    percent: u32,
}

impl Window {
    fn new(label: impl Into<String>, percent: u32, resets_at: Option<u64>, flagged: bool) -> Self {
        Self { label: label.into(), percent, resets_at, warn: flagged || percent >= 90 }
    }
}

fn percent(value: &Value) -> Option<u32> {
    value.as_f64().filter(|p| p.is_finite()).map(|p| p.clamp(0.0, 100.0).round() as u32)
}

#[tauri::command]
pub async fn plan_usage(engine: Engine) -> Result<PlanUsage, String> {
    if engine == Engine::Ollama {
        return Err("Ollama runs on this Mac, with no plan to use up.".into());
    }
    if engine == Engine::Antigravity {
        return Err("Antigravity doesn't share its plan usage with other apps yet. Run /usage in agy to see it.".into());
    }
    let program = engine.locate().ok_or_else(|| format!("{} isn't installed.", engine.label()))?;
    tauri::async_runtime::spawn_blocking(move || match engine {
        Engine::ClaudeCode => claude::read(&program),
        _ => codex::read(&program),
    })
    .await
    .map_err(|error| format!("Couldn't read the plan usage: {error}"))?
}
