use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::projects::{data_dir, read_thread};

// Finding a conversation by what was said in it, not just its title: every request, plan and reply
// in dhrive's saved threads, matched regardless of case, newest conversations first. Titles, projects
// and the CLIs' own sessions are matched in the webview, which already has them.

const MAX_HITS: usize = 30;
const MAX_QUERY: usize = 200;
// Characters shown on each side of the match.
const AROUND: usize = 50;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    conversation_id: String,
    snippet: String,
}

// What was said in a thread, in order: the owner's messages, then each run's plan and reply.
fn texts(thread: &Value) -> Vec<&str> {
    let messages = thread["messages"].as_array().into_iter().flatten();
    messages.flat_map(|m| [&m["text"], &m["plan"]["output"], &m["code"]["output"]]).filter_map(Value::as_str).collect()
}

// The match with some words around it, on one line. The position is found in the lowercased text and
// used as a character position in the original.
// ponytail: the few characters whose lowercase is longer ('İ') shift the window a little; it only
// affects which words surround the match.
fn snippet(text: &str, query: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let at = lower.find(query)?;
    let start_char = lower[..at].chars().count();
    let chars: Vec<char> = text.chars().collect();
    let from = start_char.saturating_sub(AROUND);
    let to = (start_char + query.chars().count() + AROUND).min(chars.len());
    let window: String = chars[from.min(chars.len())..to].iter().collect();
    // Plans and replies are Markdown; its marks are noise in a one-line preview.
    let words = window.split_whitespace().map(|w| w.trim_start_matches('#').replace("**", "").replace('`', "")).filter(|w| !w.is_empty());
    let body = words.collect::<Vec<_>>().join(" ");
    Some(format!("{}{body}{}", if from > 0 { "…" } else { "" }, if to < chars.len() { "…" } else { "" }))
}

fn search(dir: &Path, query: &str) -> Result<Vec<Hit>, String> {
    let query = query.trim().to_lowercase();
    if query.chars().count() < 2 || query.len() > MAX_QUERY {
        return Ok(Vec::new());
    }
    let mut conversations = crate::conversations::list(dir)?;
    conversations.sort_by_key(|c| std::cmp::Reverse(c.updated_at));
    let hits = conversations.into_iter().filter_map(|c| {
        let thread = read_thread(dir, &c.id).ok()?;
        let snippet = texts(&thread).into_iter().find_map(|text| snippet(text, &query))?;
        Some(Hit { conversation_id: c.id, snippet })
    });
    Ok(hits.take(MAX_HITS).collect())
}

#[tauri::command]
pub async fn search_conversations(app: tauri::AppHandle, query: String) -> Result<Vec<Hit>, String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || search(&dir, &query)).await.map_err(|error| format!("The search stopped: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::write_thread;

    #[test]
    fn a_match_comes_with_the_words_around_it_on_one_line() {
        assert_eq!(snippet("Cache GET /products\nfor 60 seconds", "products").as_deref(), Some("Cache GET /products for 60 seconds"));
        let long = format!("{} retry with backoff {}", "a ".repeat(60), "b ".repeat(60));
        let found = snippet(&long, "backoff").unwrap();
        assert!(found.starts_with('…') && found.ends_with('…') && found.contains("retry with backoff"), "{found}");
        assert_eq!(snippet("Olá, TEMA escuro", "tema").as_deref(), Some("Olá, TEMA escuro"));
        assert_eq!(snippet("nothing here", "theme"), None);
        assert_eq!(snippet("## Plan\n1. **`src/theme.ts`**: add a toggle", "theme").as_deref(), Some("Plan 1. src/theme.ts: add a toggle"));
    }

    #[test]
    fn requests_plans_and_replies_are_searched_newest_conversation_first() {
        let dir = std::env::temp_dir().join(format!("dhrive-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("projects.json"), r#"[{"id":"pa","name":"a","folder":"/w","createdAt":1}]"#).unwrap();
        std::fs::write(dir.join("conversations.json"), r#"[{"id":"c1","projectId":"pa","title":"one","createdAt":1,"updatedAt":10},{"id":"c2","projectId":"pa","title":"two","createdAt":1,"updatedAt":20}]"#).unwrap();
        write_thread(&dir, "c1", &serde_json::json!({ "messages": [{ "role": "user", "text": "add a Webhook retry" }] })).unwrap();
        write_thread(&dir, "c2", &serde_json::json!({ "messages": [{ "role": "run", "plan": { "output": "1. retry failed webhooks" }, "code": { "output": "done" } }] })).unwrap();

        let ids = |q: &str| search(&dir, q).unwrap().into_iter().map(|h| h.conversation_id).collect::<Vec<_>>();
        assert_eq!(ids("webhook"), ["c2", "c1"]);
        assert_eq!(ids("DONE"), ["c2"]);
        assert!(ids("w").is_empty(), "one letter matches everything");
        assert!(ids("nowhere").is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
