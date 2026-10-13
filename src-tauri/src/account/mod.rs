mod api;
mod signin;
pub(crate) mod store;

use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;

use crate::projects::{data_dir, now_millis};
use store::Saved;

// Whether this Mac may start runs. dhrive asks for a sign-in on first open; the account has 14 free
// days from its sign-up, then needs a subscription, both as dhrive.app reports them (from Neon and
// Polar). The app keeps the facts it was last told: it asks again every 12 hours once subscribed,
// and every minute before that, so a new subscription unlocks as soon as the owner comes back.
// Offline, the last facts count for 7 days. A build made without an account server (every
// development build) is free and never asks.

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const RECHECK_SUBSCRIBED_MS: u64 = 12 * 60 * 60 * 1000;
const RECHECK_MS: u64 = 60 * 1000;
const GRACE_MS: u64 = 7 * DAY_MS;

const TRIAL_OVER: &str = "Your 14 free days are over.";
const CANT_CHECK: &str = "dhrive couldn't reach your account for a week. Connect to the internet and try again.";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    pub email: String,
    pub trial_ends_at: u64,
    pub subscription: Option<Subscription>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub renews_at: u64,
    pub canceling: bool,
    // "monthly" or "yearly"; absent in what older versions saved, and for a product dhrive.app doesn't name.
    #[serde(default)]
    pub plan: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Status {
    Free,
    SignedOut,
    Trial { email: String, days_left: u64 },
    Subscribed { email: String, renews_at: u64, canceling: bool, plan: Option<String> },
    Ended { email: Option<String>, reason: String },
}

// What dhrive.app said just now.
#[derive(Debug, Clone, PartialEq)]
pub enum Check {
    Facts(Facts),
    SignedOut,
    Offline,
}

// A subscription dhrive.app just reported is live. Remembered, one that's past its date still counts
// unless it was set to end: it most likely renewed while the app wasn't looking.
fn from_facts(facts: &Facts, now: u64, fresh: bool) -> Status {
    let email = facts.email.clone();
    if let Some(sub) = facts.subscription.as_ref().filter(|s| fresh || s.renews_at > now || !s.canceling) {
        return Status::Subscribed { email, renews_at: sub.renews_at, canceling: sub.canceling, plan: sub.plan.clone() };
    }
    if now < facts.trial_ends_at {
        return Status::Trial { email, days_left: (facts.trial_ends_at - now).div_ceil(DAY_MS) };
    }
    Status::Ended { email: Some(email), reason: TRIAL_OVER.into() }
}

// The whole rule, from what's saved and what dhrive.app just said (None when it wasn't asked).
pub fn decide(now: u64, saved: &Saved, signed_in: bool, check: Option<&Check>) -> Status {
    match check {
        _ if !signed_in => Status::SignedOut,
        Some(Check::SignedOut) => Status::SignedOut,
        Some(Check::Facts(facts)) => from_facts(facts, now, true),
        Some(Check::Offline) | None => match (&saved.facts, saved.checked_at) {
            (Some(facts), Some(at)) if now.saturating_sub(at) < GRACE_MS => from_facts(facts, now, false),
            (facts, _) => Status::Ended { email: facts.as_ref().map(|f| f.email.clone()), reason: CANT_CHECK.into() },
        },
    }
}

fn due(saved: &Saved, now: u64) -> bool {
    let subscribed = saved.facts.as_ref().is_some_and(|f| f.subscription.is_some());
    let every = if subscribed { RECHECK_SUBSCRIBED_MS } else { RECHECK_MS };
    saved.checked_at.is_none_or(|at| now.saturating_sub(at) >= every)
}

// dhrive.app unless a build names another (a landing running on this Mac, while working on it), so a
// plain `cargo tauri dev` signs in like a release does. A server that isn't one of those leaves the
// build free.
pub fn allowed_server(url: &str) -> bool {
    let origin = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://localhost:")).or_else(|| url.strip_prefix("http://127.0.0.1:"));
    origin.is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c)))
}

const ACCOUNTS: &str = "https://dhrive.app";

pub(crate) fn server() -> Option<&'static str> {
    Some(option_env!("DHRIVE_ACCOUNT_URL").unwrap_or(ACCOUNTS)).filter(|url| allowed_server(url))
}

pub(crate) async fn status(app: &tauri::AppHandle) -> Result<Status, String> {
    let Some(server) = server() else { return Ok(Status::Free) };
    let Some(token) = store::read_token() else { return Ok(Status::SignedOut) };
    let dir = data_dir(app)?;
    let now = now_millis();
    let mut saved = store::read(&dir);
    if !due(&saved, now) {
        return Ok(decide(now, &saved, true, None));
    }
    let (check, renewed) = api::me(server, &token).await;
    match &check {
        Check::Facts(facts) => (saved.facts, saved.checked_at) = (Some(facts.clone()), Some(now)),
        Check::SignedOut => {
            store::forget_token();
            saved = Saved::default();
        }
        Check::Offline => {}
    }
    if let Some(token) = renewed {
        store::save_token(&token)?;
    }
    store::write(&dir, &saved)?;
    Ok(decide(now, &saved, true, Some(&check)))
}

// Starting a run is where the account is enforced, not only shown.
pub(crate) async fn allow_runs(app: &tauri::AppHandle) -> Result<(), String> {
    match status(app).await? {
        Status::SignedOut => Err("Sign in to dhrive to start.".into()),
        Status::Ended { reason, .. } => Err(format!("{reason} Subscribe to keep going.")),
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn account_status(app: tauri::AppHandle) -> Result<Status, String> {
    status(&app).await
}

// Opens dhrive.app in the browser and waits there for the owner to sign in (or sign up).
#[tauri::command]
pub async fn sign_in(app: tauri::AppHandle) -> Result<Status, String> {
    let server = server().ok_or("This build of dhrive doesn't use accounts.")?;
    let pending = signin::Pending::new()?;
    let verifier = pending.verifier.clone();
    let url = format!("{server}/connect?port={}&state={}&challenge={}", pending.port, pending.state, pending.challenge);
    let generation = signin::begin();
    app.opener().open_url(url, None::<&str>).map_err(|error| format!("Couldn't open your browser: {error}"))?;
    let code = tauri::async_runtime::spawn_blocking(move || pending.wait(generation)).await.map_err(|error| error.to_string())??;
    store::save_token(&api::exchange(server, &code, &verifier).await?)?;
    store::write(&data_dir(&app)?, &Saved::default())?;
    status(&app).await
}

#[tauri::command]
pub fn cancel_sign_in() {
    signin::cancel();
}

#[tauri::command]
pub async fn sign_out(app: tauri::AppHandle) -> Result<Status, String> {
    store::forget_token();
    store::write(&data_dir(&app)?, &Saved::default())?;
    status(&app).await
}

#[cfg(test)]
mod tests;
