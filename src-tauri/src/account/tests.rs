use std::io::{Read, Write};
use std::net::TcpStream;

use super::*;

const NOW: u64 = 1_800_000_000_000;

fn facts(trial_days_left: i64, subscription: Option<Subscription>) -> Facts {
    Facts { email: "dev@example.com".into(), trial_ends_at: (NOW as i64 + trial_days_left * DAY_MS as i64) as u64, subscription }
}

fn saved(facts: Facts, checked_days_ago: u64) -> Saved {
    Saved { facts: Some(facts), checked_at: Some(NOW - checked_days_ago * DAY_MS) }
}

const fn sub(renews_at: u64, canceling: bool) -> Subscription {
    Subscription { renews_at, canceling, plan: None }
}

#[test]
fn signed_out_until_signed_in_whatever_was_saved() {
    assert_eq!(decide(NOW, &saved(facts(9, None), 0), false, None), Status::SignedOut);
    assert_eq!(decide(NOW, &saved(facts(9, None), 0), true, Some(&Check::SignedOut)), Status::SignedOut, "the token stopped working");
}

#[test]
fn the_trial_counts_down_from_the_accounts_sign_up() {
    let email = "dev@example.com".to_string();
    assert_eq!(decide(NOW, &Saved::default(), true, Some(&Check::Facts(facts(14, None)))), Status::Trial { email: email.clone(), days_left: 14 });
    assert_eq!(decide(NOW - 1, &Saved::default(), true, Some(&Check::Facts(facts(0, None)))), Status::Trial { email: email.clone(), days_left: 1 }, "part of a day is a day");
    assert_eq!(decide(NOW, &Saved::default(), true, Some(&Check::Facts(facts(0, None)))), Status::Ended { email: Some(email), reason: TRIAL_OVER.into() });
}

#[test]
fn a_subscription_wins_over_the_trial() {
    let fresh = Check::Facts(facts(-30, Some(sub(NOW - 1, true))));
    assert!(matches!(decide(NOW, &Saved::default(), true, Some(&fresh)), Status::Subscribed { canceling: true, .. }), "dhrive.app just said it's live");
}

#[test]
fn offline_the_last_facts_count_for_a_week_and_no_longer() {
    let trial = saved(facts(3, None), 6);
    assert!(matches!(decide(NOW, &trial, true, Some(&Check::Offline)), Status::Trial { days_left: 3, .. }));
    assert!(matches!(decide(NOW, &trial, true, None), Status::Trial { .. }), "between checks");
    let stale = saved(facts(3, None), 7);
    assert_eq!(decide(NOW, &stale, true, Some(&Check::Offline)), Status::Ended { email: Some("dev@example.com".into()), reason: CANT_CHECK.into() });
    assert_eq!(decide(NOW, &Saved::default(), true, Some(&Check::Offline)), Status::Ended { email: None, reason: CANT_CHECK.into() }, "never heard back");
}

#[test]
fn a_remembered_subscription_past_its_date_counts_unless_it_was_ending() {
    let renewing = saved(facts(-30, Some(sub(NOW - DAY_MS, false))), 2);
    assert!(matches!(decide(NOW, &renewing, true, None), Status::Subscribed { .. }), "it most likely renewed");
    let ending = saved(facts(-30, Some(sub(NOW - DAY_MS, true))), 2);
    assert!(matches!(decide(NOW, &ending, true, None), Status::Ended { .. }));
    let ending_later = saved(facts(-30, Some(sub(NOW + DAY_MS, true))), 2);
    assert!(matches!(decide(NOW, &ending_later, true, None), Status::Subscribed { .. }));
}

#[test]
fn it_asks_every_minute_before_a_subscription_and_twice_a_day_after() {
    assert!(due(&Saved::default(), NOW), "never asked");
    let trial = Saved { facts: Some(facts(5, None)), checked_at: Some(NOW - 30_000) };
    assert!(!due(&trial, NOW) && due(&trial, NOW + 30_000));
    let subscribed = Saved { facts: Some(facts(-5, Some(sub(NOW + DAY_MS, false)))), checked_at: Some(NOW - RECHECK_MS) };
    assert!(!due(&subscribed, NOW) && due(&subscribed, NOW - RECHECK_MS + RECHECK_SUBSCRIBED_MS));
}

#[test]
fn only_dhrive_app_or_a_landing_on_this_mac_can_be_the_account_server() {
    for url in ["https://dhrive.app", "http://localhost:3201", "http://127.0.0.1:3201"] {
        assert!(allowed_server(url), "{url}");
    }
    for url in ["http://dhrive.app", "https://dhrive.app/", "https://dhrive.app/x", "https://", "http://localhost", "http://192.168.0.2:3000", "https://a.b?x", "ftp://dhrive.app"] {
        assert!(!allowed_server(url), "{url}");
    }
}

#[test]
fn the_status_the_app_reads_is_tagged_by_state() {
    let json = serde_json::to_value(Status::Trial { email: "a@b.c".into(), days_left: 3 }).unwrap();
    assert_eq!(json, serde_json::json!({ "state": "trial", "email": "a@b.c", "daysLeft": 3 }));
    assert_eq!(serde_json::to_value(Status::SignedOut).unwrap(), serde_json::json!({ "state": "signedOut" }));
}

fn send(port: u16, request_line: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    // The head in pieces, split mid-line, as a slow network or browser might send it.
    let (start, rest) = request_line.split_at(request_line.len() / 2);
    // The pause outlasts the wait's poll, so the first piece is all there is when the head is read.
    stream.write_all(start.as_bytes()).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(150));
    stream.write_all(format!("{rest}\r\nHost: 127.0.0.1\r\n\r\n").as_bytes()).unwrap();
    let mut reply = String::new();
    let _ = stream.read_to_string(&mut reply);
    reply
}

// The browser can knock with anything, in any order (favicons, old tabs, a wrong state) before the
// real callback; the wait takes the right code, and a cancel or a newer sign-in always ends it.
// One test, since the sign-in in progress is process-wide.
#[test]
fn the_wait_for_the_browser_takes_only_its_own_callback_and_can_always_be_ended() {
    let mut seed: u64 = 7;
    let mut next = move || {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        seed >> 33
    };
    for _ in 0..25 {
        let pending = signin::Pending::new().unwrap();
        let (port, state) = (pending.port, pending.state.clone());
        let generation = signin::begin();
        let waiting = std::thread::spawn(move || pending.wait(generation));
        for _ in 0..next() % 4 {
            let noise = ["GET /favicon.ico HTTP/1.1".to_string(), "GET /callback?code=x.y&state=wrong HTTP/1.1".to_string(), "GET / HTTP/1.1".to_string()];
            assert!(send(port, &noise[(next() % 3) as usize]).starts_with("HTTP/1.1 404"));
        }
        match next() % 3 {
            0 => {
                assert!(send(port, &format!("GET /callback?code=c0de.sig&state={state} HTTP/1.1")).contains("Signed in"));
                assert_eq!(waiting.join().unwrap().as_deref(), Ok("c0de.sig"));
            }
            1 => {
                signin::cancel();
                assert_eq!(waiting.join().unwrap(), Err("Sign-in cancelled.".into()));
            }
            _ => {
                signin::begin();
                assert!(waiting.join().unwrap().is_err(), "a newer sign-in ends this one");
            }
        }
    }
}
