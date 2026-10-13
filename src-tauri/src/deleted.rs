use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::projects::{now_millis, thread_path};

// What the owner deletes in dhrive is put away, never erased. What listed it (a conversation's title
// and project, a project's folder) is appended to deleted/listed.jsonl first, then a conversation's
// thread moves to deleted/threads/, so both can be brought back. The app never removes anything here.

const FOLDER: &str = "deleted";

#[derive(Serialize)]
struct Note<'a, T: Serialize> {
    at: u64,
    kind: &'a str,
    item: &'a T,
}

// Flushed to disk before the caller drops the item from its list.
pub(crate) fn note<T: Serialize>(dir: &Path, kind: &str, items: &[T]) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let at = now_millis();
    let lines = items.iter().map(|item| serde_json::to_string(&Note { at, kind, item }).map(|line| line + "\n")).collect::<Result<String, _>>().map_err(|error| error.to_string())?;
    let folder = dir.join(FOLDER);
    std::fs::create_dir_all(&folder).map_err(|error| format!("Can't put it away: {error}"))?;
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(folder.join("listed.jsonl")).map_err(|error| format!("Can't put it away: {error}"))?;
    file.write_all(lines.as_bytes()).and_then(|_| file.sync_all()).map_err(|error| format!("Can't put it away: {error}"))
}

// A conversation that never had a thread saved has nothing to move.
pub(crate) fn put_away_thread(dir: &Path, id: &str) -> Result<(), String> {
    let thread = thread_path(dir, id)?;
    if !thread.exists() {
        return Ok(());
    }
    let shelf = dir.join(FOLDER).join("threads");
    std::fs::create_dir_all(&shelf).map_err(|error| format!("Can't put the conversation away: {error}"))?;
    std::fs::rename(&thread, shelf.join(format!("{id}.json"))).map_err(|error| format!("Can't put the conversation away: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::write_thread;

    #[test]
    fn a_deleted_conversation_is_noted_and_its_thread_kept() {
        let dir = std::env::temp_dir().join(format!("dhrive-deleted-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write_thread(&dir, "c1", &serde_json::json!({ "messages": ["kept"] })).unwrap();
        note(&dir, "conversation", &[serde_json::json!({ "id": "c1", "title": "Pricing" })]).unwrap();
        note::<serde_json::Value>(&dir, "conversation", &[]).unwrap();
        put_away_thread(&dir, "c1").unwrap();
        put_away_thread(&dir, "never").unwrap();

        assert!(!thread_path(&dir, "c1").unwrap().exists());
        assert_eq!(std::fs::read_to_string(dir.join("deleted/threads/c1.json")).unwrap(), "{\"messages\":[\"kept\"]}");
        let listed = std::fs::read_to_string(dir.join("deleted/listed.jsonl")).unwrap();
        assert!(listed.lines().count() == 1 && listed.contains("\"kind\":\"conversation\",\"item\":{\"id\":\"c1\",\"title\":\"Pricing\"}"), "{listed}");
        assert!(put_away_thread(&dir, "../x").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
