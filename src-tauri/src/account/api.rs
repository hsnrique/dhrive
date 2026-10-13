use std::time::Duration;

use serde_json::{json, Value};

use super::{Check, Facts, Subscription};

// dhrive.app's two answers for the app: a token for the code the browser brought back, and the
// account's facts for a token. The token is the only credential, sent as a bearer and kept in the
// Keychain.

fn client() -> Result<reqwest::Client, String> {
    // reqwest needs a TLS crypto provider; the updater and the Ollama client install the same one.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().timeout(Duration::from_secs(12)).build().map_err(|error| error.to_string())
}

// The codes and tokens dhrive.app makes: base64url parts joined by dots.
fn token_shaped(value: &str) -> bool {
    !value.is_empty() && value.len() <= 4096 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

pub async fn exchange(server: &str, code: &str, verifier: &str) -> Result<String, String> {
    let offline = "Couldn't reach dhrive.app. Check your connection and try again.";
    let response = client()?.post(format!("{server}/api/app/token")).json(&json!({ "code": code, "verifier": verifier })).send().await.map_err(|_| offline)?;
    let ok = response.status().is_success();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    match body["token"].as_str() {
        Some(token) if ok && token_shaped(token) => Ok(token.to_string()),
        _ => Err(body["error"].as_str().unwrap_or("Signing in didn't finish. Try again.").chars().take(200).collect()),
    }
}

// What dhrive.app said about the account, and the renewed token it hands back with it.
pub async fn me(server: &str, token: &str) -> (Check, Option<String>) {
    let Ok(client) = client() else { return (Check::Offline, None) };
    let Ok(response) = client.get(format!("{server}/api/app/me")).bearer_auth(token).send().await else { return (Check::Offline, None) };
    match response.status().as_u16() {
        401 => (Check::SignedOut, None),
        200 => match response.json::<Value>().await.ok().as_ref().and_then(read_me) {
            Some((facts, renewed)) => (Check::Facts(facts), renewed),
            None => (Check::Offline, None),
        },
        _ => (Check::Offline, None),
    }
}

pub fn read_me(body: &Value) -> Option<(Facts, Option<String>)> {
    let subscription = match &body["subscription"] {
        Value::Null => None,
        sub => Some(Subscription {
            renews_at: sub["renewsAt"].as_u64()?,
            canceling: sub["canceling"].as_bool().unwrap_or(false),
            plan: sub["plan"].as_str().filter(|p| ["monthly", "yearly"].contains(p)).map(str::to_string),
        }),
    };
    let facts = Facts { email: body["email"].as_str()?.to_string(), trial_ends_at: body["trialEndsAt"].as_u64()?, subscription };
    Some((facts, body["token"].as_str().filter(|t| token_shaped(t)).map(str::to_string)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answer_becomes_facts_and_a_renewed_token() {
        let body = json!({ "email": "dev@example.com", "trialEndsAt": 1_790_000_000_000u64, "subscription": { "renewsAt": 1_800_000_000_000u64, "canceling": true, "plan": "yearly" }, "token": "a.b" });
        let (facts, token) = read_me(&body).unwrap();
        assert_eq!(facts, Facts { email: "dev@example.com".into(), trial_ends_at: 1_790_000_000_000, subscription: Some(Subscription { renews_at: 1_800_000_000_000, canceling: true, plan: Some("yearly".into()) }) });
        assert_eq!(token.as_deref(), Some("a.b"));
        let (facts, token) = read_me(&json!({ "email": "dev@example.com", "trialEndsAt": 1, "subscription": null, "token": "<not a token>" })).unwrap();
        assert_eq!((facts.subscription, token), (None, None));
    }

    #[test]
    fn an_answer_missing_what_matters_is_not_trusted() {
        assert!(read_me(&json!({ "trialEndsAt": 1, "subscription": null })).is_none());
        assert!(read_me(&json!({ "email": "a@b.c", "trialEndsAt": "soon", "subscription": null })).is_none());
        assert!(read_me(&json!({ "email": "a@b.c", "trialEndsAt": 1, "subscription": { "canceling": false } })).is_none());
    }
}
