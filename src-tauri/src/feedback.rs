use std::time::Duration;

use serde_json::{json, Value};

// What the owner tells the dhrive team from inside the app, anything at all or a tool the Tools menu
// should have. It goes to dhrive.app with the account's token, and the server writes it to the
// team's feedback inbox (the table the website's form and the admin page use) with the account's
// email, so the team can answer. The app holds no key for that inbox.

const MAX_TOOL: usize = 80;
const MAX_WHY: usize = 500;
const MAX_MESSAGE: usize = 4000;

fn suggestion(tool: &str, why: &str) -> Result<Value, String> {
    let (tool, why) = (tool.trim(), why.trim());
    if tool.is_empty() || tool.chars().count() > MAX_TOOL {
        return Err("Name the tool in a few words.".into());
    }
    if why.chars().count() > MAX_WHY {
        return Err(format!("Say what it's for in under {MAX_WHY} characters."));
    }
    let message = if why.is_empty() { format!("Tool suggestion: {tool}") } else { format!("Tool suggestion: {tool}\n\n{why}") };
    Ok(json!({ "message": message, "category": "idea" }))
}

// The version goes with it: the first thing the team needs when something broke.
fn note(message: &str, version: &str) -> Result<Value, String> {
    let message = message.trim();
    if message.is_empty() || message.chars().count() > MAX_MESSAGE {
        return Err(format!("Write it in up to {MAX_MESSAGE} characters."));
    }
    Ok(json!({ "message": format!("{message}\n\n(dhrive {version})"), "category": "other" }))
}

async fn send(body: Value) -> Result<(), String> {
    let (Some(server), Some(token)) = (crate::account::server(), crate::account::store::read_token()) else {
        return Err("Sign in to dhrive to send this.".into());
    };
    let response = crate::versions::client(Duration::from_secs(15))?
        .post(format!("{server}/api/app/feedback"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|_| "Couldn't reach the dhrive team. Check your connection and try again.")?;
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 => Err("Sign in again to send this.".into()),
        _ => Err("It didn't go through. Try again.".into()),
    }
}

#[tauri::command]
pub async fn suggest_tool(tool: String, why: String) -> Result<(), String> {
    send(suggestion(&tool, &why)?).await
}

#[tauri::command]
pub async fn send_feedback(app: tauri::AppHandle, message: String) -> Result<(), String> {
    send(note(&message, &app.package_info().version.to_string())?).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_suggestion_reads_as_an_idea() {
        let sent = suggestion("  Clerk ", "Sign-in for the SaaS").unwrap();
        assert_eq!(sent, json!({ "message": "Tool suggestion: Clerk\n\nSign-in for the SaaS", "category": "idea" }));
        assert_eq!(suggestion("Clerk", "").unwrap()["message"], "Tool suggestion: Clerk");
    }

    #[test]
    fn an_empty_or_overlong_suggestion_is_refused() {
        assert!(suggestion("   ", "").is_err());
        assert!(suggestion(&"x".repeat(MAX_TOOL + 1), "").is_err());
        assert!(suggestion("Clerk", &"y".repeat(MAX_WHY + 1)).is_err());
    }

    #[test]
    fn feedback_carries_the_version_and_no_email() {
        let sent = note("  The publish button hangs  ", "0.3.2").unwrap();
        assert_eq!(sent, json!({ "message": "The publish button hangs\n\n(dhrive 0.3.2)", "category": "other" }));
    }

    #[test]
    fn empty_or_overlong_feedback_is_refused() {
        assert!(note(" \n ", "0.3.2").is_err());
        assert!(note(&"z".repeat(MAX_MESSAGE + 1), "0.3.2").is_err());
        assert!(note(&"z".repeat(MAX_MESSAGE), "0.3.2").is_ok());
    }
}
