use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::{percent, PlanUsage, Share, Window};
use crate::jsonl::JsonlChild;

const TIMEOUT: Duration = Duration::from_secs(15);
// Only the account is asked about, so the owner's MCP servers and hooks stay off for it.
const ARGS: [&str; 9] = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--settings", r#"{"disableAllHooks":true}"#];

pub fn read(program: &Path) -> Result<PlanUsage, String> {
    let mut claude = JsonlChild::spawn(program, &ARGS, TIMEOUT)?;
    let account = claude.control("dhrive-account", json!({ "subtype": "initialize" }))?;
    // The behaviors section means reading every transcript of the week; only the limits are wanted.
    let usage = claude.control("dhrive-usage", json!({ "subtype": "get_usage", "skip_behaviors": true }))?;
    Ok(parse(&account, &usage))
}

pub fn parse(init: &Value, usage: &Value) -> PlanUsage {
    let account = &init["account"];
    let limits = &usage["rate_limits"];
    let mut notes = Vec::new();
    if usage["rate_limits_available"] == false {
        notes.push("No plan limits: this account is billed by use".into());
    }
    notes.extend(extra_usage(limits));
    PlanUsage {
        plan: account["subscriptionType"].as_str().map(str::to_string),
        account: account["email"].as_str().map(str::to_string),
        windows: windows(limits),
        shares: shares(&limits["seven_day_breakdown"]),
        notes,
    }
}

// The list /usage itself shows; the older named windows stand in when it's missing.
fn windows(limits: &Value) -> Vec<Window> {
    let listed: Vec<Window> = limits["limits"].as_array().into_iter().flatten().filter_map(listed_window).collect();
    if !listed.is_empty() {
        return listed;
    }
    [("five_hour", "Session (5 h)"), ("seven_day", "Week, all models")]
        .into_iter()
        .filter_map(|(key, label)| Some(Window::new(label, percent(&limits[key]["utilization"])?, limits[key]["resets_at"].as_str().and_then(epoch_seconds), false)))
        .collect()
}

fn listed_window(limit: &Value) -> Option<Window> {
    let kind = limit["kind"].as_str()?;
    let label = match kind {
        "session" => "Session (5 h)".to_string(),
        "weekly_all" => "Week, all models".to_string(),
        "weekly_scoped" => format!("Week, {}", limit["scope"]["model"]["display_name"].as_str().or(limit["scope"]["surface"].as_str()).unwrap_or("one model")),
        other => other.replace('_', " "),
    };
    let flagged = limit["severity"].as_str().is_some_and(|s| s != "normal");
    Some(Window::new(label, percent(&limit["percent"])?, limit["resets_at"].as_str().and_then(epoch_seconds), flagged))
}

fn shares(breakdown: &Value) -> Vec<Share> {
    let rows = breakdown["rows"].as_array().into_iter().flatten();
    rows.filter_map(|row| Some(Share { label: row["display_name"].as_str()?.to_string(), percent: percent(&row["percent"]).filter(|p| *p > 0)? })).collect()
}

// Credits that carry on past the plan's limits, in the account's currency.
fn extra_usage(limits: &Value) -> Option<String> {
    let spend = &limits["spend"];
    if limits["extra_usage"]["is_enabled"] != true && spend["enabled"] != true {
        return limits["extra_usage"].is_object().then(|| "Extra usage off".to_string());
    }
    let money = |amount: &Value| Some(amount["amount_minor"].as_f64()? / 10f64.powi(amount["exponent"].as_i64().unwrap_or(2) as i32));
    let currency = spend["used"]["currency"].as_str().unwrap_or("USD");
    Some(match (money(&spend["used"]), money(&spend["limit"])) {
        (Some(used), Some(limit)) => format!("Extra usage on: {used:.2} of {limit:.2} {currency}"),
        (Some(used), None) => format!("Extra usage on: {used:.2} {currency} used"),
        _ => "Extra usage on".to_string(),
    })
}

// "2026-09-30T01:59:59.921487+00:00" as seconds since the epoch; days counted with Howard Hinnant's
// days-from-civil, so no date crate is needed for one field.
fn epoch_seconds(iso: &str) -> Option<u64> {
    let (date, time) = iso.split_once('T')?;
    let numbers = |text: &str, sep: char| text.split(sep).map(|n| n.parse::<i64>().ok()).collect::<Option<Vec<_>>>();
    let [year, month, day] = numbers(date, '-')?[..] else { return None };
    let [hour, minute, second] = numbers(time.get(..8)?, ':')?[..] else { return None };
    let zone = time[8..].trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let offset = match zone {
        "" | "Z" => 0,
        zone => {
            let [h, m] = numbers(zone.get(1..)?, ':')?[..] else { return None };
            if zone.starts_with('-') { -(h * 3600 + m * 60) } else { h * 3600 + m * 60 }
        }
    };
    let y = if month <= 2 { year - 1 } else { year };
    let (era, yoe) = (y.div_euclid(400), y.rem_euclid(400));
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    u64::try_from(days * 86_400 + hour * 3600 + minute * 60 + second - offset).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed from what Claude Code 2.1.284 answered on a Max account.
    fn answers() -> (Value, Value) {
        let init = json!({ "account": { "email": "dev@example.com", "subscriptionType": "Claude Max", "apiProvider": "firstParty" } });
        let usage = json!({ "subscription_type": "max", "rate_limits_available": true, "rate_limits": {
            "five_hour": { "utilization": 1, "resets_at": "2026-09-30T01:59:59.921487+00:00" },
            "extra_usage": { "is_enabled": false },
            "limits": [
                { "kind": "session", "percent": 1, "severity": "normal", "resets_at": "2026-09-30T01:59:59.921487+00:00", "scope": null },
                { "kind": "weekly_all", "percent": 9.4, "severity": "normal", "resets_at": "2026-10-06T12:59:59+00:00", "scope": null },
                { "kind": "weekly_scoped", "percent": 2, "severity": "warning", "resets_at": "2026-10-06T12:59:59+00:00", "scope": { "model": { "id": null, "display_name": "Fable" } } }
            ],
            "spend": { "used": { "amount_minor": 0, "currency": "USD", "exponent": 2 }, "limit": null, "enabled": false },
            "seven_day_breakdown": { "rows": [{ "display_name": "Claude Code", "percent": 100 }, { "display_name": "Chats", "percent": 0 }] }
        }});
        (init, usage)
    }

    #[test]
    fn every_limit_usage_shows_is_read_with_its_reset() {
        let (init, usage) = answers();
        let read = parse(&init, &usage);
        assert_eq!((read.plan.as_deref(), read.account.as_deref()), (Some("Claude Max"), Some("dev@example.com")));
        assert_eq!(read.windows, [
            Window::new("Session (5 h)", 1, Some(1_790_733_599), false),
            Window::new("Week, all models", 9, Some(1_791_291_599), false),
            Window { label: "Week, Fable".into(), percent: 2, resets_at: Some(1_791_291_599), warn: true },
        ]);
        assert_eq!(read.shares, [Share { label: "Claude Code".into(), percent: 100 }], "a surface that used nothing isn't listed");
        assert_eq!(read.notes, ["Extra usage off"]);
    }

    #[test]
    fn the_named_windows_stand_in_for_an_older_list() {
        let (init, mut usage) = answers();
        usage["rate_limits"]["limits"] = json!(null);
        assert_eq!(parse(&init, &usage).windows, [Window::new("Session (5 h)", 1, Some(1_790_733_599), false)]);
    }

    #[test]
    fn extra_usage_in_use_says_how_much() {
        let (init, mut usage) = answers();
        usage["rate_limits"]["spend"] = json!({ "enabled": true, "used": { "amount_minor": 1250, "currency": "USD", "exponent": 2 }, "limit": { "amount_minor": 5000, "exponent": 2 } });
        assert_eq!(parse(&init, &usage).notes, ["Extra usage on: 12.50 of 50.00 USD"]);
    }

    #[test]
    fn an_account_billed_by_use_has_no_windows_and_says_so() {
        let read = parse(&json!({ "account": { "apiProvider": "firstParty" } }), &json!({ "rate_limits_available": false, "rate_limits": null }));
        assert!(read.windows.is_empty() && read.plan.is_none());
        assert_eq!(read.notes, ["No plan limits: this account is billed by use"]);
    }

    #[test]
    fn iso_times_become_epoch_seconds_in_any_zone() {
        assert_eq!(epoch_seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(epoch_seconds("2024-02-29T23:59:59Z"), Some(1_709_251_199));
        assert_eq!(epoch_seconds("2026-10-06T09:59:59-03:00"), Some(1_791_291_599));
        for bad in ["", "2026-10-06", "2026-10-06T9:59", "soon", "2026-1Ö-06T09:59:59Z"] {
            assert_eq!(epoch_seconds(bad), None, "{bad}");
        }
    }

    #[test]
    #[ignore = "asks the Claude Code installed on this Mac"]
    fn the_installed_claude_code_reports_its_plan() {
        let read = read(&crate::engine::Engine::ClaudeCode.locate().unwrap()).unwrap();
        assert!(read.plan.is_some(), "{read:?}");
    }
}
