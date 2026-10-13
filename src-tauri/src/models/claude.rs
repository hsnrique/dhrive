use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::ModelOption;
use crate::jsonl::JsonlChild;

const REQUEST_ID: &str = "dhrive-models";
const TIMEOUT: Duration = Duration::from_secs(20);

// Claude Code's SDK mode answers an initialize request with the models this install and account can
// use, the same list its own /model picker shows, so a new model is listed the day Claude Code ships
// it. --strict-mcp-config with no config keeps the owner's MCP servers from starting for this.
pub fn fetch(program: &Path) -> Result<Vec<ModelOption>, String> {
    let args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--strict-mcp-config"];
    let mut claude = JsonlChild::spawn(program, &args, TIMEOUT)?;
    claude.send(&json!({ "type": "control_request", "request_id": REQUEST_ID, "request": { "subtype": "initialize" } }))?;
    let answer = claude.wait_for(|m| m["type"] == "control_response" && m["response"]["request_id"] == REQUEST_ID)?;
    let models = parse(&answer);
    if models.is_empty() {
        return Err("Claude Code listed no models.".into());
    }
    Ok(models)
}

pub fn parse(answer: &Value) -> Vec<ModelOption> {
    let listed = answer["response"]["response"]["models"].as_array().cloned().unwrap_or_default();
    listed
        .iter()
        .filter_map(|model| {
            let value = model["value"].as_str()?;
            // "default" is Claude Code's own default, the same as passing no --model at all.
            let id = if value == "default" { "" } else { value };
            Some(ModelOption::new(id, model["displayName"].as_str().unwrap_or(value), model["description"].as_str()).with_efforts(super::words(&model["supportedEffortLevels"], None)))
        })
        .collect()
}

// Claude Code resolves these aliases to the newest model of each family; they stand in only when
// an older Claude Code can't list its models.
pub fn fallback() -> Vec<ModelOption> {
    vec![
        ModelOption::new("", "Default", None),
        ModelOption::new("opus", "Opus", None),
        ModelOption::new("sonnet", "Sonnet", None),
        ModelOption::new("haiku", "Haiku", None),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_every_model_with_default_as_no_flag() {
        let answer = json!({ "type": "control_response", "response": { "subtype": "success", "request_id": REQUEST_ID, "response": { "models": [
            { "value": "default", "displayName": "Default (recommended)", "description": "Use the default model (currently Opus 5.5)" },
            { "value": "claude-fable-5-1[1m]", "displayName": "Fable", "description": "Fable 5.1 · Most capable", "supportedEffortLevels": ["low", "max", "--bad"] },
            { "value": "haiku", "displayName": "Haiku" },
            { "displayName": "no value" }
        ]}}});
        let models = parse(&answer);
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["", "claude-fable-5-1[1m]", "haiku"]);
        assert_eq!(models[1], ModelOption::new("claude-fable-5-1[1m]", "Fable", Some("Fable 5.1 · Most capable")).with_efforts(vec!["low".into(), "max".into()]));
        assert_eq!(models[2].detail, None);
        assert!(models[2].efforts.is_empty(), "a model without levels takes none");
        assert!(parse(&json!({})).is_empty());
    }

    #[test]
    #[ignore = "starts the Claude Code installed on this Mac"]
    fn the_installed_claude_code_lists_its_models() {
        let models = fetch(&crate::engine::Engine::ClaudeCode.locate().unwrap()).unwrap();
        assert!(models.iter().any(|m| m.id.is_empty()) && models.iter().any(|m| m.id == "opus"), "{models:?}");
    }
}
