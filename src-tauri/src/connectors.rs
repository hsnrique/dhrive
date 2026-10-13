use std::path::Path;

use serde::Serialize;

// The tools a company can connect from its toolbar, each through its own official CLI and agent
// skills: one script per tool installs the CLI if it's missing, signs in through the browser and adds
// the skills to the project, for Claude Code, Codex and Antigravity alike. It runs in a terminal the
// owner watches (terminal.rs), where any question a sign-in asks gets answered. Only these scripts
// ever run: the webview names a connector, never a command. Versions are pinned and move with dhrive.
// GitHub isn't here: the toolbar's GitHub button already connects it through gh.

// `group` puts it with its kind in the menu; `site` is the tool's own home page.
#[derive(Debug, Serialize, PartialEq)]
pub struct Connector {
    id: &'static str,
    name: &'static str,
    what: &'static str,
    group: &'static str,
    site: &'static str,
}

const CATALOG: &[Connector] = &[
    Connector { id: "supabase", name: "Supabase", what: "Database, sign-in and storage", group: "Code and data", site: "https://supabase.com" },
    Connector { id: "neon", name: "Neon", what: "Serverless Postgres", group: "Code and data", site: "https://neon.com" },
    Connector { id: "firecrawl", name: "Firecrawl", what: "Web pages as data for the agents", group: "Code and data", site: "https://www.firecrawl.dev" },
    Connector { id: "stripe", name: "Stripe", what: "Payments and subscriptions", group: "Payments", site: "https://stripe.com" },
    Connector { id: "polar", name: "Polar", what: "Payments, subscriptions and license keys", group: "Payments", site: "https://polar.sh" },
    Connector { id: "posthog", name: "PostHog", what: "What people do on the product", group: "Users", site: "https://posthog.com" },
    Connector { id: "resend", name: "Resend", what: "Email to the people who use it", group: "Users", site: "https://resend.com" },
    Connector { id: "sentry", name: "Sentry", what: "Errors people run into", group: "Users", site: "https://sentry.io" },
];

// Copied into the project (not linked), so the skills go to GitHub with the rest of the company.
fn skills(repo: &str) -> String {
    format!("npx -y skills@1.7.1 add {repo} --skill '*' -a claude-code codex antigravity -y --copy")
}

// Homebrew when the Mac has it, npm's global install otherwise.
fn install(bin: &str, brew: &str, npm: &str) -> String {
    format!("command -v {bin} >/dev/null || {{ if command -v brew >/dev/null; then brew install {brew}; else npm install -g {npm}; fi; }}")
}

fn steps(id: &str) -> Option<Vec<String>> {
    let steps = match id {
        // Supabase's npm package refuses a global install: without Homebrew it runs through npx.
        "supabase" => vec![
            "command -v supabase >/dev/null || { if command -v brew >/dev/null; then brew install supabase/tap/supabase; else supabase() { npx -y supabase@2.120.0 \"$@\"; }; fi; }".into(),
            "supabase projects list >/dev/null 2>&1 || supabase login".into(),
            skills("supabase/agent-skills"),
        ],
        // Stripe's own setup puts its plugin and skills into every agent it finds.
        "stripe" => vec![install("stripe", "stripe/stripe-cli/stripe", "@stripe/cli@1.53.1"), "stripe config --list 2>/dev/null | grep -q api_key || stripe login".into(), "stripe agent setup --yes".into()],
        "polar" => vec!["command -v polar >/dev/null || npm install -g @polar-sh/cli@2.0.2".into(), "polar auth whoami >/dev/null 2>&1 || polar auth login".into()],
        // PostHog's wizard signs in, installs its SDK into the site and configures it.
        "posthog" => vec!["npx -y @posthog/wizard@2.81.1".into(), skills("PostHog/skills")],
        "resend" => vec!["command -v resend >/dev/null || npm install -g resend-cli@2.23.0".into(), "resend whoami >/dev/null 2>&1 || resend login".into(), skills("resend/resend-skills")],
        "sentry" => vec![install("sentry-cli", "getsentry/tools/sentry-cli", "@sentry/cli@3.8.0"), "sentry-cli organizations list >/dev/null 2>&1 || sentry-cli login".into(), skills("getsentry/sentry-for-ai")],
        // Neon's and Firecrawl's own setups sign in and add their skills themselves.
        "neon" => vec!["npx -y neonctl@8.3.1 init".into()],
        "firecrawl" => vec!["npx -y firecrawl-cli@1.26.3 init --all --browser".into()],
        _ => return None,
    };
    Some(steps)
}

fn name_of(id: &str) -> Option<&'static str> {
    CATALOG.iter().find(|c| c.id == id).map(|c| c.name)
}

// The whole script for zsh -lc: it stops at the first step that fails, so the terminal's last words
// are the error, and ends saying it's done.
pub(crate) fn script(id: &str) -> Option<String> {
    let name = name_of(id)?;
    let body = steps(id)?.join("\n");
    Some(format!("set -e\necho 'Connecting {name}…'\n{body}\necho\necho '{name} is connected. You can close this.'\n"))
}

// What the company's agents are told on every step, from the record the app keeps of what was
// connected (.company/connectors.json): the skills are in the project already, this says to use them.
pub(crate) fn prompt_note(folder: &Path) -> String {
    let connected = crate::records::read(folder, "connectors").ok().flatten();
    let names: Vec<&str> = connected.as_ref().and_then(|v| v.as_object()).map(|ids| ids.keys().filter_map(|id| name_of(id)).collect()).unwrap_or_default();
    if names.is_empty() {
        return String::new();
    }
    format!("\n\nTools connected to this company: {}. Their CLIs are signed in on this Mac and their skills are in this project; use them for what they do, following their skills.", names.join(", "))
}

#[tauri::command]
pub fn connectors() -> &'static [Connector] {
    CATALOG
}

#[tauri::command]
pub async fn connector_open(app: tauri::AppHandle, id: String, connector: String, project: String, cols: u16, rows: u16) -> Result<(), String> {
    let script = script(&connector).ok_or("dhrive doesn't know that tool.")?;
    let folder = crate::terminal::project_folder(&app, &project)?;
    crate::terminal::open_script(app, &id, &script, &folder, cols, rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listed_tool_has_a_script_and_nothing_else_does() {
        for connector in CATALOG {
            let script = script(connector.id).unwrap();
            assert!(script.starts_with("set -e\n") && script.contains(&format!("{} is connected", connector.name)), "{}", connector.id);
        }
        assert_eq!(script("rm -rf ~"), None);
        assert_eq!(script("github"), None, "GitHub connects from its own button");
    }

    #[test]
    fn every_tool_links_to_its_own_site_and_sits_with_its_kind() {
        for connector in CATALOG {
            assert!(connector.site.starts_with("https://") && !connector.site.contains("dhrive"), "{}", connector.id);
        }
        let groups: Vec<&str> = CATALOG.iter().map(|c| c.group).collect();
        let mut seen: Vec<&str> = Vec::new();
        for group in groups {
            if seen.last() != Some(&group) {
                assert!(!seen.contains(&group), "{group} is split in the menu");
                seen.push(group);
            }
        }
    }

    #[test]
    fn every_package_is_pinned() {
        for connector in CATALOG {
            for step in steps(connector.id).unwrap() {
                for word in step.split_whitespace().filter(|w| w.contains('@') && !w.starts_with("\"$@")) {
                    let version = word.rsplit('@').next().unwrap();
                    assert!(version.chars().next().is_some_and(|c| c.is_ascii_digit()), "{word} in {} isn't pinned", connector.id);
                }
            }
        }
    }

    #[test]
    fn agents_hear_only_about_tools_that_were_connected() {
        let dir = std::env::temp_dir().join(format!("dhrive-connectors-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(prompt_note(&dir), "");
        crate::records::save(&dir, "connectors", &serde_json::json!({ "supabase": { "at": 1 }, "stripe": { "at": 2 }, "made-up": { "at": 3 } })).unwrap();
        let note = prompt_note(&dir);
        assert!(note.contains("Supabase") && note.contains("Stripe") && !note.contains("made-up"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
