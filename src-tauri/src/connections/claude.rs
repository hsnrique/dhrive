use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::{listed, plugin_name, text, Connections, Item, Server, Status};
use crate::jsonl::JsonlChild;

const TIMEOUT: Duration = Duration::from_secs(25);
// MCP servers connect in the background after start; asking until none is still connecting, or this
// long, gives each one its real state.
const SETTLE: Duration = Duration::from_secs(10);
// The owner's hooks still get listed with this, they just don't run for a question about them.
const ARGS: [&str; 8] = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--settings", r#"{"disableAllHooks":true}"#];

pub fn read(program: &Path, folder: &Path) -> Result<Connections, String> {
    let mut claude = JsonlChild::spawn_in(program, &ARGS, folder, TIMEOUT)?;
    let init = claude.control("dhrive-init", json!({ "subtype": "initialize" }))?;
    let skills = claude.control("dhrive-skills", json!({ "subtype": "get_skills_dialog" })).unwrap_or_default();
    let hooks = claude.control("dhrive-hooks", json!({ "subtype": "get_hooks_listing" })).unwrap_or_default();
    let servers = settled_servers(&mut claude)?;
    Ok(parse(&init, &skills, &hooks, &servers, &installed_plugins(program, folder)))
}

fn settled_servers(claude: &mut JsonlChild) -> Result<Value, String> {
    let until = Instant::now() + SETTLE;
    for attempt in 0.. {
        let status = claude.control(&format!("dhrive-mcp-{attempt}"), json!({ "subtype": "mcp_status" }))?;
        if !listed(&status["mcpServers"]).any(|s| s["status"] == "pending") || Instant::now() >= until {
            return Ok(status);
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    unreachable!("the loop returns once time is up")
}

// `claude plugin list` knows what's installed, including plugins that bring nothing on their own.
fn installed_plugins(program: &Path, folder: &Path) -> Value {
    let output = Command::new(program).args(["plugin", "list", "--json"]).current_dir(folder).output();
    output.ok().and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or_default()
}

pub fn parse(init: &Value, skills: &Value, hooks: &Value, servers: &Value, plugins: &Value) -> Connections {
    Connections {
        servers: listed(&servers["mcpServers"]).filter_map(server).collect(),
        skills: listed(&skills["skills"]).filter_map(skill).collect(),
        plugins: listed(plugins).filter_map(|p| Some(Item::new(plugin_name(p["id"].as_str()?), text(&p["version"]).filter(|v| *v != "unknown"), p["scope"].as_str().map(str::to_string), p["enabled"] != false))).collect(),
        agents: listed(&init["agents"]).filter_map(|a| Some(Item::new(a["name"].as_str()?, text(&a["description"]), None, true))).collect(),
        hooks: listed(&hooks["hooks"]).filter_map(hook).collect(),
    }
}

// "plugin:engineering:slack" is the slack server of the engineering plugin; "claude.ai Canva" is a
// connector from the owner's claude.ai account.
fn server(s: &Value) -> Option<Server> {
    let full = s["name"].as_str()?;
    let (name, source) = if let Some(rest) = full.strip_prefix("plugin:") {
        let (plugin, name) = rest.split_once(':').unwrap_or(("", rest));
        (name, Some(format!("{plugin} plugin")))
    } else if let Some(name) = full.strip_prefix("claude.ai ") {
        (name, Some("claude.ai".to_string()))
    } else {
        (full, s["scope"].as_str().map(str::to_string))
    };
    let status = match s["status"].as_str() {
        Some("connected") => Status::Connected,
        Some("needs-auth") => Status::NeedsAuth,
        Some("failed") => Status::Failed,
        Some("pending") => Status::Connecting,
        Some("disabled") => Status::Disabled,
        _ => Status::Configured,
    };
    let tools = s["tools"].as_array().map(Vec::len);
    Some(Server { name: name.to_string(), status, source, tools, error: text(&s["error"]).map(str::to_string) })
}

fn skill(s: &Value) -> Option<Item> {
    let name = s["name"].as_str()?;
    let source = match s["source"].as_str() {
        Some("plugin") => name.split_once(':').map(|(plugin, _)| format!("{plugin} plugin")),
        other => other.map(str::to_string),
    };
    Some(Item::new(text(&s["display_name"]).unwrap_or(name), text(&s["description"]), source, s["state"] != "off"))
}

fn hook(h: &Value) -> Option<Item> {
    let event = h["event"].as_str()?;
    let name = match text(&h["matcher"]) {
        Some(matcher) => format!("{event} ({matcher})"),
        None => event.to_string(),
    };
    let source = text(&h["pluginName"]).map(|p| format!("{} plugin", plugin_name(p))).or_else(|| text(&h["sourceLabel"]).map(str::to_string));
    Some(Item::new(&name, text(&h["displayText"]).or(text(&h["commandText"])), source, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed from what Claude Code 2.1.284 answered.
    #[test]
    fn servers_skills_plugins_agents_and_hooks_are_read_without_their_config() {
        let servers = json!({ "mcpServers": [
            { "name": "plugin:engineering:slack", "status": "needs-auth", "config": { "type": "http", "url": "https://mcp.slack.com/mcp", "oauth": { "clientId": "1601" } }, "scope": "dynamic", "source": "plugin" },
            { "name": "claude.ai Canva", "status": "connected", "config": { "type": "claudeai-proxy" }, "tools": [{ "name": "a" }, { "name": "b" }], "source": "claudeai" },
            { "name": "plugin:sales:gmail", "status": "failed", "error": "No URL configured for this server", "source": "plugin" },
            { "name": "postgres", "status": "pending", "scope": "project" }
        ]});
        let skills = json!({ "skills": [
            { "name": "anthropic-skills:pdf", "display_name": "pdf", "description": "Use this skill whenever\nthe user wants a PDF.", "source": "claude.ai sync", "state": "on" },
            { "name": "brand-voice:discover-brand", "display_name": "brand-voice:discover-brand", "description": "Discovery.", "source": "plugin", "state": "off" }
        ]});
        let hooks = json!({ "hooks": [{ "event": "SessionStart", "matcher": "startup|resume", "pluginName": "ponytail@synced", "displayText": "Loading ponytail mode...", "commandText": "node x.js" }] });
        let plugins = json!([{ "id": "github@claude-plugins-official", "version": "unknown", "scope": "user", "enabled": true, "mcpServers": { "github": { "headers": { "Authorization": "Bearer ${TOKEN}" } } } }, { "id": "sales@synced", "version": "2.0.1", "scope": "synced", "enabled": false }]);
        let init = json!({ "agents": [{ "name": "Explore", "description": "Read-only search agent." }] });

        let read = parse(&init, &skills, &hooks, &servers, &plugins);
        assert_eq!(read.servers, [
            Server { name: "slack".into(), status: Status::NeedsAuth, source: Some("engineering plugin".into()), tools: None, error: None },
            Server { name: "Canva".into(), status: Status::Connected, source: Some("claude.ai".into()), tools: Some(2), error: None },
            Server { name: "gmail".into(), status: Status::Failed, source: Some("sales plugin".into()), tools: None, error: Some("No URL configured for this server".into()) },
            Server { name: "postgres".into(), status: Status::Connecting, source: Some("project".into()), tools: None, error: None },
        ]);
        assert_eq!(read.skills, [
            Item::new("pdf", Some("Use this skill whenever"), Some("claude.ai sync".into()), true),
            Item::new("brand-voice:discover-brand", Some("Discovery."), Some("brand-voice plugin".into()), false),
        ]);
        assert_eq!(read.plugins, [Item::new("github", None, Some("user".into()), true), Item::new("sales", Some("2.0.1"), Some("synced".into()), false)]);
        assert_eq!(read.agents, [Item::new("Explore", Some("Read-only search agent."), None, true)]);
        assert_eq!(read.hooks, [Item::new("SessionStart (startup|resume)", Some("Loading ponytail mode..."), Some("ponytail plugin".into()), true)]);
        assert!(!serde_json::to_string(&read).unwrap().contains("Bearer"), "configs never cross over");
    }

    #[test]
    fn nothing_answered_is_nothing_listed() {
        assert_eq!(parse(&Value::Null, &Value::Null, &Value::Null, &Value::Null, &Value::Null), Connections::default());
    }

    #[test]
    #[ignore = "asks the Claude Code installed on this Mac"]
    fn the_installed_claude_code_says_whats_connected() {
        let read = read(&crate::engine::Engine::ClaudeCode.locate().unwrap(), &std::env::temp_dir()).unwrap();
        assert!(!read.agents.is_empty(), "{read:?}");
        assert!(read.servers.iter().all(|s| s.status != Status::Connecting), "{:?}", read.servers);
    }
}
