use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::{percent, PlanUsage, Window};
use crate::jsonl::JsonlChild;

const TIMEOUT: Duration = Duration::from_secs(15);

pub fn read(program: &Path) -> Result<PlanUsage, String> {
    let mut codex = JsonlChild::codex_in(program, &std::env::temp_dir(), TIMEOUT)?;
    let account = codex.call(1, "account/read", json!({}))?;
    // An account signed in with an API key has no plan windows, and Codex refuses the question.
    let limits = codex.call(2, "account/rateLimits/read", json!({ "excludeResetCreditDetails": true })).unwrap_or(Value::Null);
    Ok(parse(&account, &limits))
}

pub fn parse(account: &Value, limits: &Value) -> PlanUsage {
    let account = &account["account"];
    let plan = match account["type"].as_str() {
        Some("chatgpt") => account["planType"].as_str().map(|plan| format!("ChatGPT {}", capitalized(plan))),
        Some("apiKey") => Some("API key".into()),
        _ => None,
    };
    let mut windows = windows_of(&limits["rateLimits"], None);
    // Limits beyond the main one (a model with its own), named after it.
    for (id, other) in limits["rateLimitsByLimitId"].as_object().into_iter().flatten().filter(|(id, _)| *id != "codex") {
        windows.extend(windows_of(other, Some(other["limitName"].as_str().unwrap_or(id))));
    }
    PlanUsage { plan, account: account["email"].as_str().map(str::to_string), windows, shares: Vec::new(), notes: notes(limits) }
}

fn windows_of(limit: &Value, name: Option<&str>) -> Vec<Window> {
    let reached = limit["rateLimitReachedType"].is_string();
    ["primary", "secondary"]
        .iter()
        .filter_map(|key| {
            let window = &limit[*key];
            let label = span(window["windowDurationMins"].as_u64()?);
            let label = name.map_or(label.clone(), |name| format!("{label}, {name}"));
            Some(Window::new(label, percent(&window["usedPercent"])?, window["resetsAt"].as_u64(), reached))
        })
        .collect()
}

// Codex names its windows by length: 300 minutes is the 5-hour session, 10080 the week.
fn span(minutes: u64) -> String {
    match minutes {
        10_080 => "Week".into(),
        m if m < 24 * 60 => format!("Session ({} h)", m.div_ceil(60)),
        m => format!("{} days", m / (24 * 60)),
    }
}

fn notes(limits: &Value) -> Vec<String> {
    let credits = &limits["rateLimits"]["credits"];
    let mut notes = Vec::new();
    if credits["unlimited"] == true {
        notes.push("Unlimited credits".into());
    } else if credits["hasCredits"] == true {
        notes.push(format!("Credits: {}", credits["balance"].as_str().unwrap_or("some left")));
    }
    if let Some(resets) = limits["rateLimitResetCredits"]["availableCount"].as_u64().filter(|n| *n > 0) {
        notes.push(format!("{resets} limit reset{} available", if resets == 1 { "" } else { "s" }));
    }
    if limits["rateLimits"]["spendControlReached"] == true {
        notes.push("Spend limit reached".into());
    }
    notes
}

fn capitalized(word: &str) -> String {
    let mut chars = word.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed from what Codex 0.159 answered on a Plus account.
    fn answers() -> (Value, Value) {
        let account = json!({ "account": { "type": "chatgpt", "email": "dev@example.com", "planType": "plus" } });
        let main = json!({ "limitId": "codex", "primary": { "usedPercent": 12.6, "windowDurationMins": 300, "resetsAt": 1_790_725_201 }, "secondary": { "usedPercent": 0, "windowDurationMins": 10_080, "resetsAt": 1_791_210_133 }, "credits": { "hasCredits": false, "unlimited": false, "balance": "0" }, "rateLimitReachedType": null });
        let limits = json!({ "rateLimits": main, "rateLimitsByLimitId": { "codex": main }, "rateLimitResetCredits": { "availableCount": 2 } });
        (account, limits)
    }

    #[test]
    fn both_windows_and_what_else_the_plan_has_are_read() {
        let (account, limits) = answers();
        let read = parse(&account, &limits);
        assert_eq!((read.plan.as_deref(), read.account.as_deref()), (Some("ChatGPT Plus"), Some("dev@example.com")));
        assert_eq!(read.windows, [Window::new("Session (5 h)", 13, Some(1_790_725_201), false), Window::new("Week", 0, Some(1_791_210_133), false)]);
        assert_eq!(read.notes, ["2 limit resets available"]);
    }

    #[test]
    fn a_limit_of_its_own_is_named_and_a_reached_one_warns() {
        let (account, mut limits) = answers();
        limits["rateLimitsByLimitId"]["gpt-6-astra"] = json!({ "limitName": "GPT-6 Astra", "primary": { "usedPercent": 40, "windowDurationMins": 300 }, "rateLimitReachedType": "primary" });
        let read = parse(&account, &limits);
        assert_eq!(read.windows.last(), Some(&Window { label: "Session (5 h), GPT-6 Astra".into(), percent: 40, resets_at: None, warn: true }));
    }

    #[test]
    fn an_api_key_account_has_no_windows() {
        let read = parse(&json!({ "account": { "type": "apiKey" } }), &Value::Null);
        assert_eq!((read.plan.as_deref(), read.windows.len(), read.notes.len()), (Some("API key"), 0, 0));
    }

    #[test]
    fn window_lengths_read_as_people_say_them() {
        assert_eq!([span(300), span(10_080), span(1440 * 30), span(90)], ["Session (5 h)", "Week", "30 days", "Session (2 h)"]);
    }

    #[test]
    #[ignore = "asks the Codex installed on this Mac"]
    fn the_installed_codex_reports_its_plan() {
        let read = read(&crate::engine::Engine::Codex.locate().unwrap()).unwrap();
        assert!(read.plan.is_some(), "{read:?}");
    }
}
