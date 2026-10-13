use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::{listed, plugin_name, text, Connections, Item, Server, Status};
use crate::jsonl::JsonlChild;

const TIMEOUT: Duration = Duration::from_secs(25);
const MAX_PAGES: u64 = 5;

pub fn read(program: &Path, folder: &Path) -> Result<Connections, String> {
    let mut codex = JsonlChild::codex_in(program, folder, TIMEOUT)?;
    let cwds = json!([folder.to_string_lossy()]);
    let servers = all_servers(&mut codex)?;
    let skills = codex.call(10, "skills/list", json!({ "cwds": cwds })).unwrap_or_default();
    let plugins = codex.call(11, "plugin/installed", json!({ "cwds": cwds })).unwrap_or_default();
    let hooks = codex.call(12, "hooks/list", json!({ "cwds": cwds })).unwrap_or_default();
    Ok(parse(&servers, &skills, &plugins, &hooks))
}

// Asking for tools and sign-in only is enough to tell whether each server answers.
fn all_servers(codex: &mut JsonlChild) -> Result<Vec<Value>, String> {
    let mut servers = Vec::new();
    let mut cursor = Value::Null;
    for page in 1..=MAX_PAGES {
        let result = codex.call(page, "mcpServerStatus/list", json!({ "detail": "toolsAndAuthOnly", "cursor": cursor }))?;
        servers.extend(listed(&result["data"]).cloned());
        cursor = result["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    Ok(servers)
}

pub fn parse(servers: &[Value], skills: &Value, plugins: &Value, hooks: &Value) -> Connections {
    let per_folder = |answer: &Value, key: &str| listed(&answer["data"]).flat_map(|entry| listed(&entry[key])).cloned().collect::<Vec<_>>();
    Connections {
        servers: servers.iter().filter_map(server).collect(),
        skills: per_folder(skills, "skills").iter().filter_map(skill).collect(),
        plugins: listed(&plugins["marketplaces"]).flat_map(|m| listed(&m["plugins"]).filter(|p| p["installed"] == true).filter_map(|p| plugin(p, &m["name"]))).collect(),
        agents: Vec::new(),
        hooks: per_folder(hooks, "hooks").iter().filter_map(hook).collect(),
    }
}

// Outside a running thread Codex has no live state for its servers, so a server that listed its tools
// counts as connected, and one that couldn't as failed.
fn server(s: &Value) -> Option<Server> {
    let tools = s["tools"].as_object().map(|t| t.len());
    let error = text(&s["toolsError"]).map(str::to_string);
    let status = match (s["runtimeStatus"].as_str(), s["authStatus"].as_str()) {
        (Some("connected"), _) => Status::Connected,
        (Some("authenticationRequired"), _) | (None, Some("notLoggedIn")) => Status::NeedsAuth,
        (Some("failed" | "cancelled"), _) => Status::Failed,
        (Some("starting"), _) => Status::Connecting,
        (Some("disabled"), _) => Status::Disabled,
        _ if error.is_some() => Status::Failed,
        _ if tools.is_some_and(|n| n > 0) => Status::Connected,
        _ => Status::Configured,
    };
    let source = text(&s["pluginId"]).map(|id| format!("{} plugin", plugin_name(id)));
    Some(Server { name: s["name"].as_str()?.to_string(), status, source, tools: tools.filter(|n| *n > 0), error })
}

fn skill(s: &Value) -> Option<Item> {
    let name = text(&s["interface"]["displayName"]).or(text(&s["name"]))?;
    let detail = text(&s["interface"]["shortDescription"]).or(text(&s["shortDescription"])).or(text(&s["description"]));
    let source = text(&s["pluginId"]).map(|id| format!("{} plugin", plugin_name(id))).or_else(|| s["scope"].as_str().map(str::to_string));
    Some(Item::new(name, detail, source, s["enabled"] != false))
}

fn plugin(p: &Value, marketplace: &Value) -> Option<Item> {
    let name = text(&p["interface"]["displayName"]).or(text(&p["name"]))?;
    Some(Item::new(name, text(&p["localVersion"]).or(text(&p["version"])), marketplace.as_str().map(str::to_string), p["enabled"] != false))
}

fn hook(h: &Value) -> Option<Item> {
    let event = h["eventName"].as_str()?;
    let name = text(&h["matcher"]).map_or(event.to_string(), |m| format!("{event} ({m})"));
    let source = text(&h["pluginId"]).map(|id| format!("{} plugin", plugin_name(id))).or_else(|| h["source"].as_str().map(str::to_string));
    Some(Item::new(&name, text(&h["statusMessage"]).or(text(&h["command"])), source, h["enabled"] != false))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed from what Codex 0.159 answered.
    #[test]
    fn servers_skills_plugins_and_hooks_are_read() {
        let servers = [
            json!({ "name": "codex_apps", "authStatus": "bearerToken", "runtimeStatus": null, "pluginId": null, "tools": { "neon.create": {}, "neon.list": {} }, "toolsError": null }),
            json!({ "name": "code-review", "authStatus": "unsupported", "runtimeStatus": null, "pluginId": "code-review@openai-bundled", "tools": {}, "toolsError": null }),
            json!({ "name": "linear", "authStatus": "notLoggedIn", "runtimeStatus": null, "tools": {} }),
            json!({ "name": "broken", "authStatus": "unsupported", "tools": {}, "toolsError": "spawn failed" }),
        ];
        let skills = json!({ "data": [{ "cwd": "/w", "skills": [{ "name": "pdf:pdf", "description": "Long text.", "interface": { "displayName": "PDF", "shortDescription": "Read and make PDFs" }, "scope": "user", "enabled": true, "pluginId": "pdf@openai-primary-runtime" }] }] });
        let plugins = json!({ "marketplaces": [{ "name": "openai-bundled", "plugins": [{ "name": "browser", "installed": true, "enabled": true, "localVersion": "26.928" }, { "name": "other", "installed": false }] }] });
        let hooks = json!({ "data": [{ "cwd": "/w", "hooks": [{ "eventName": "preToolUse", "matcher": "shell", "source": "user", "enabled": true, "command": "./check.sh" }] }] });

        let read = parse(&servers, &skills, &plugins, &hooks);
        let states: Vec<_> = read.servers.iter().map(|s| (s.name.as_str(), s.status, s.tools)).collect();
        assert_eq!(states, [("codex_apps", Status::Connected, Some(2)), ("code-review", Status::Configured, None), ("linear", Status::NeedsAuth, None), ("broken", Status::Failed, None)]);
        assert_eq!(read.servers[1].source.as_deref(), Some("code-review plugin"));
        assert_eq!(read.skills, [Item::new("PDF", Some("Read and make PDFs"), Some("pdf plugin".into()), true)]);
        assert_eq!(read.plugins, [Item::new("browser", Some("26.928"), Some("openai-bundled".into()), true)]);
        assert_eq!(read.hooks, [Item::new("preToolUse (shell)", Some("./check.sh"), Some("user".into()), true)]);
    }

    #[test]
    #[ignore = "asks the Codex installed on this Mac"]
    fn the_installed_codex_says_whats_connected() {
        let read = read(&crate::engine::Engine::Codex.locate().unwrap(), &std::env::temp_dir()).unwrap();
        assert!(!read.plugins.is_empty() || !read.servers.is_empty(), "{read:?}");
    }
}
