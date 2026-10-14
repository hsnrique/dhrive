mod antigravity;
mod claude_stdin;
mod cli;
mod codex;
pub mod command;
pub mod parse;
mod retry;
mod stream;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::progress::Reporter;

// The AI CLIs dhrive can drive. Each one brings its own sign-in and billing, so dhrive never
// holds an API key. Ollama runs open-weight models on this Mac through Codex's own local mode.
// Antigravity is Google's agent CLI (`agy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Engine {
    ClaudeCode,
    Codex,
    Antigravity,
    Ollama,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    // The part of input_tokens the provider served from its prompt cache: far cheaper, and what tells a
    // run that re-reads the same context from one that keeps sending new text.
    pub cached_tokens: u64,
    pub output_tokens: u64,
    // None when the CLI doesn't report a price (Codex), so it's never mistaken for free.
    pub total_cost_usd: Option<f64>,
    pub num_turns: u32,
    // The model the CLI actually ran, when it says (the requested one may be its default).
    pub model: Option<String>,
}

impl Usage {
    pub fn merge(self, other: Usage) -> Usage {
        let total_cost_usd = match (self.total_cost_usd, other.total_cost_usd) {
            (Some(a), Some(b)) => Some(a + b),
            (a, b) => a.or(b),
        };
        Usage {
            input_tokens: self.input_tokens + other.input_tokens,
            cached_tokens: self.cached_tokens + other.cached_tokens,
            output_tokens: self.output_tokens + other.output_tokens,
            total_cost_usd,
            num_turns: self.num_turns + other.num_turns,
            model: self.model.or(other.model),
        }
    }
}

pub struct AgentRun {
    pub summary: String,
    // The CLI's own conversation id (Claude session, Codex thread), so the next step can resume it.
    pub session_id: Option<String>,
    pub usage: Option<Usage>,
    // What the CLI refused to let the model do in this step ("Bash: npm install"), when it says.
    pub blocked: Vec<String>,
}

// What one run asks of its CLI: the prompt, whether it may only read, the CLI conversation to
// continue, and images to hand the model (Codex takes them as images; Claude reads the files).
// Who watches a code step. The owner, by default: anything Claude Code isn't allowed is put to them
// (approvals.rs). A company task with Ask first off runs on its own: Claude Code asks nobody
// (bypassPermissions), and the owner chose whether MCP tools, which can act in their name outside
// this computer (send, post, pay), are there at all.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Watch {
    #[default]
    Owner,
    Alone { mcp: bool },
}

#[derive(Clone, Copy)]
pub struct Task<'a> {
    pub prompt: &'a str,
    pub read_only: bool,
    pub resume: Option<&'a str>,
    pub images: &'a [PathBuf],
    // Tool rules the owner allowed for good in this project.
    pub allow: &'a [String],
    // The owner's instructions from dhrive (instructions.rs), given to the CLI as system instructions.
    pub instructions: Option<&'a str>,
    // The company's environment (env.rs), set on the CLI's process for the code it runs.
    pub env: &'a [(String, String)],
    pub watch: Watch,
}

// Which CLI to run and, optionally, which model within it and how hard it thinks. Blank means "the
// CLI's own default", so the UI can send "" without forcing something the owner didn't pick.
#[derive(Clone)]
pub struct Agent {
    pub engine: Engine,
    pub model: Option<String>,
    pub effort: Option<String>,
}

fn picked(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Agent {
    pub fn new(engine: Engine, model: Option<String>) -> Self {
        Self { engine, model: picked(model), effort: None }
    }

    pub fn with_effort(self, effort: Option<String>) -> Self {
        Self { effort: picked(effort), ..self }
    }
}

impl Engine {
    // Claude Code stays first so it's the default when installed.
    pub const ALL: [Engine; 4] = [Engine::ClaudeCode, Engine::Codex, Engine::Antigravity, Engine::Ollama];

    pub fn binary(self) -> &'static str {
        match self {
            Engine::ClaudeCode => "claude",
            Engine::Codex | Engine::Ollama => "codex",
            Engine::Antigravity => "agy",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Engine::ClaudeCode => "Claude Code",
            Engine::Codex => "Codex",
            Engine::Antigravity => "Antigravity",
            Engine::Ollama => "Ollama",
        }
    }

    pub fn docs_url(self) -> &'static str {
        match self {
            Engine::ClaudeCode => "https://docs.claude.com/en/docs/claude-code/setup",
            Engine::Codex => "https://developers.openai.com/codex/cli/",
            Engine::Antigravity => "https://antigravity.google/docs/cli/reference",
            Engine::Ollama => "https://ollama.com/download",
        }
    }

    // Apps that ship the CLI without putting it on PATH: the ChatGPT and Codex desktop apps both
    // carry a working codex.
    fn bundled(self) -> &'static [&'static str] {
        match self {
            Engine::ClaudeCode | Engine::Antigravity => &[],
            Engine::Codex | Engine::Ollama => &[
                "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
                "/Applications/ChatGPT.app/Contents/Resources/codex",
                "/Applications/Codex.app/Contents/Resources/codex",
            ],
        }
    }

    // Ollama needs both halves: its server for the model, and Codex for the agent loop.
    pub fn installed(self) -> bool {
        self.locate().is_some() && (self != Engine::Ollama || crate::local::ollama::binary().is_some())
    }

    pub fn locate(self) -> Option<PathBuf> {
        let path = std::env::var_os("PATH").unwrap_or_default();
        find_on_path(self.binary(), &path).or_else(|| self.bundled().iter().map(PathBuf::from).find(|p| p.is_file()))
    }
}

pub(crate) fn find_on_path(binary: &str, path: &std::ffi::OsStr) -> Option<PathBuf> {
    std::env::split_paths(path).map(|dir| dir.join(binary)).find(|candidate| candidate.is_file())
}

pub fn run_agent(agent: &Agent, workspace: &Path, task: &Task, reporter: &Arc<Reporter>) -> Result<AgentRun, String> {
    // ponytail: local models never resume; a 4k-64k window can't carry a conversation. Add it when
    // local contexts grow.
    if agent.engine == Engine::Ollama {
        return cli::run(agent, workspace, &Task { resume: None, ..*task }, reporter).map(|run| AgentRun { session_id: None, ..run });
    }
    cli::run(agent, workspace, task, reporter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_binary_in_the_first_path_dir_that_has_it() {
        let root = std::env::temp_dir().join(format!("dhrive-path-{}", std::process::id()));
        let (empty, tools) = (root.join("empty"), root.join("tools"));
        std::fs::create_dir_all(&empty).unwrap();
        std::fs::create_dir_all(&tools).unwrap();
        std::fs::write(tools.join("claude"), "").unwrap();
        let path = std::env::join_paths([&empty, &tools]).unwrap();

        assert_eq!(find_on_path("claude", &path), Some(tools.join("claude")));
        assert_eq!(find_on_path("codex", &path), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_blank_model_means_the_cli_default() {
        assert_eq!(Agent::new(Engine::Codex, Some("  ".into())).model, None);
        assert_eq!(Agent::new(Engine::Codex, Some(" gpt-6-astra ".into())).model.as_deref(), Some("gpt-6-astra"));
    }
}
