mod claude;
mod codex;

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::engine::Engine;

// Everything a CLI brings to a run in a project, as the CLI itself reports it: its MCP servers and
// whether each one is connected, skills, plugins, subagents and hooks. Asked fresh each time, from
// the project's folder, since a project can add its own. Only names, states and short descriptions
// cross over; server configs (URLs, headers, commands) stay behind.

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Connections {
    servers: Vec<Server>,
    skills: Vec<Item>,
    plugins: Vec<Item>,
    agents: Vec<Item>,
    hooks: Vec<Item>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Connected,
    NeedsAuth,
    Failed,
    Connecting,
    Disabled,
    // Set up, but the CLI didn't say more (Codex outside a thread, for a server it hasn't started).
    Configured,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Server {
    name: String,
    status: Status,
    source: Option<String>,
    tools: Option<usize>,
    error: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Item {
    name: String,
    detail: Option<String>,
    source: Option<String>,
    on: bool,
}

const MAX_ITEMS: usize = 500;
const MAX_DETAIL: usize = 160;

impl Item {
    fn new(name: &str, detail: Option<&str>, source: Option<String>, on: bool) -> Self {
        Self { name: name.to_string(), detail: detail.and_then(short), source, on }
    }
}

// The first line of a description, cut to a glance.
fn short(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(match line.char_indices().nth(MAX_DETAIL) {
        Some((cut, _)) => format!("{}…", line[..cut].trim_end()),
        None => line.to_string(),
    })
}

fn text(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| !s.trim().is_empty())
}

// "github@claude-plugins-official" is the github plugin from that marketplace.
fn plugin_name(id: &str) -> &str {
    id.split('@').next().unwrap_or(id)
}

fn listed(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten().take(MAX_ITEMS)
}

#[tauri::command]
pub async fn list_connections(engine: Engine, folder: String) -> Result<Connections, String> {
    if engine == Engine::Ollama {
        return Err("Ollama runs without MCP servers or skills.".into());
    }
    // ponytail: `agy mcp list` and `agy plugin list` print for people, not programs; read them once
    // Antigravity has a JSON form.
    if engine == Engine::Antigravity {
        return Err("Antigravity doesn't share what it has connected with other apps yet. Run agy mcp list to see it.".into());
    }
    // No project: what the CLI has everywhere, away from any project's own additions.
    let folder = match folder.as_str() {
        "" => std::env::temp_dir(),
        folder => Path::new(folder).canonicalize().ok().filter(|f| f.is_dir()).ok_or("That project folder isn't there anymore.")?,
    };
    let program = engine.locate().ok_or_else(|| format!("{} isn't installed.", engine.label()))?;
    tauri::async_runtime::spawn_blocking(move || match engine {
        Engine::ClaudeCode => claude::read(&program, &folder),
        _ => codex::read(&program, &folder),
    })
    .await
    .map_err(|error| format!("Couldn't ask what's connected: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptions_are_cut_to_their_first_line() {
        assert_eq!(short("\n  Review code.\nMore here.").as_deref(), Some("Review code."));
        assert_eq!(short(&"é".repeat(200)).map(|s| s.chars().count()), Some(MAX_DETAIL + 1));
        assert_eq!(short("  \n "), None);
    }
}
