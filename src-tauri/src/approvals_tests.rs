use super::*;
use std::sync::Arc;

// The shape Claude Code 2.1 sends, taken from a real run.
const REQUEST: &str = r#"{"type":"control_request","request_id":"e7927809-7d6e","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"echo hello > probe.txt","description":"Write hello"},"description":"Write \"hello\" to probe.txt","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"echo hello *"}],"behavior":"allow","destination":"localSettings"},{"type":"addDirectories","directories":["/tmp/x"],"destination":"session"}],"tool_use_id":"toolu_1"}}"#;

#[test]
fn a_permission_request_becomes_a_question_with_the_suggested_rule() {
    let q = question(REQUEST).unwrap();
    assert_eq!((q.id.as_str(), q.tool.as_str(), q.detail.as_str()), ("e7927809-7d6e", "Bash", "echo hello > probe.txt"));
    assert_eq!(q.rule.as_deref(), Some("Bash(echo hello *)"));
    assert!(question(r#"{"type":"assistant"}"#).is_none());
    assert!(question(r#"{"type":"control_request","request":{"subtype":"initialize"},"x":"can_use_tool"}"#).is_none());
}

#[test]
fn allow_once_always_and_deny_answer_in_claude_codes_terms() {
    let q = question(REQUEST).unwrap();
    let once = response(&q, Decision::Allow { always: false });
    assert_eq!(once["response"]["request_id"], "e7927809-7d6e");
    assert_eq!(once["response"]["response"]["behavior"], "allow");
    assert_eq!(once["response"]["response"]["updatedInput"]["command"], "echo hello > probe.txt");
    assert!(once["response"]["response"].get("updatedPermissions").is_none());

    let always = response(&q, Decision::Allow { always: true });
    let added = &always["response"]["response"]["updatedPermissions"][0];
    assert_eq!((added["destination"].as_str(), added["rules"][0]["ruleContent"].as_str()), (Some("session"), Some("echo hello *")), "never the owner's settings");

    assert_eq!(response(&q, Decision::Deny)["response"]["response"]["behavior"], "deny");
}

#[test]
fn project_rules_name_a_tool_and_never_every_command() {
    for good in ["Bash(npm test:*)", "WebFetch(domain:docs.stripe.com)", "WebSearch", "mcp__linear__create_issue", "Bash(echo hello *)"] {
        assert!(valid_rule(good), "{good}");
    }
    for bad in ["Bash", "Bash()", "Bash(a,b)", "Bash(x", "-Bash(x)", "Bash(a\nb)", "Ba sh(x)", &format!("Bash({})", "x".repeat(300))] {
        assert!(!valid_rule(bad), "{bad}");
    }
}

#[test]
fn the_run_waits_for_the_owners_answer() {
    let reporter = Arc::new(Reporter::new("approve-run", |_| {}));
    let q = question(&REQUEST.replace("e7927809-7d6e", "q-answer")).unwrap();
    let asking = std::thread::spawn({
        let reporter = reporter.clone();
        move || ask(&reporter, &q)
    });
    while answer_approval("q-answer".into(), true, true).is_err() {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(asking.join().unwrap(), Decision::Allow { always: true });
    assert!(answer_approval("q-answer".into(), true, false).is_err(), "answered once");
}

#[test]
fn a_stopped_run_stops_waiting_and_denies() {
    let reporter = Reporter::new("approve-stop", |_| {});
    crate::cancel::begin("approve-stop");
    let q = question(&REQUEST.replace("e7927809-7d6e", "q-stop")).unwrap();
    let stopper = std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(50));
        crate::cancel::stop("approve-stop");
    });
    assert_eq!(ask(&reporter, &q), Decision::Deny);
    stopper.join().unwrap();
}
