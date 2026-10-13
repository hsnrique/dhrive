use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::deleted::{note, put_away_thread};
use crate::lists::{read_list, write_list};
use crate::projects::{data_dir, read_projects, read_thread, valid_id, Project};

// A project holds conversations, each one a thread (threads/<id>.json) with its own CLI sessions.
// The list lives in conversations.json. A conversation that carried on a session from the Claude
// app, the terminal or Codex names it, so that session isn't listed again beside it.

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub(crate) id: String,
    project_id: String,
    title: String,
    created_at: u64,
    pub(crate) updated_at: u64,
    #[serde(default)]
    continues: Vec<String>,
}

const FILE: &str = "conversations.json";
const MAX_CONTINUES: usize = 8;

fn read_all(dir: &Path) -> Result<Option<Vec<Conversation>>, String> {
    read_list(&dir.join(FILE), "conversation list")
}

fn write_all(dir: &Path, conversations: &[Conversation]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(conversations).map_err(|error| error.to_string())?;
    write_list(&dir.join(FILE), &json)
}

pub(crate) fn list(dir: &Path) -> Result<Vec<Conversation>, String> {
    if let Some(conversations) = read_all(dir)? {
        return Ok(conversations);
    }
    let migrated = read_projects(dir)?.iter().filter_map(|project| first_conversation(dir, project)).collect::<Vec<_>>();
    write_all(dir, &migrated)?;
    Ok(migrated)
}

// Before conversations, each project had one thread saved under the project's own id. It becomes the
// project's first conversation and keeps that id, so its file stays where it is. One that went on
// with a session from the Claude app, the terminal or Codex takes that session's name, as a new
// conversation carrying one does, since that session is no longer listed on its own.
fn first_conversation(dir: &Path, project: &Project) -> Option<Conversation> {
    let thread = read_thread(dir, &project.id).ok()?;
    let messages = thread["messages"].as_array()?;
    let first = messages.iter().find(|m| m["role"] == "user")?["text"].as_str()?;
    let updated_at = messages.iter().filter_map(|m| m["at"].as_u64()).max().unwrap_or(project.created_at);
    let continues: Vec<String> = thread["sessions"].as_object().map(|s| s.values().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    let title = crate::sessions::title_in(&project.folder, &continues).unwrap_or_else(|| first.to_string());
    let conversation = Conversation { id: project.id.clone(), project_id: project.id.clone(), title, created_at: project.created_at, updated_at, continues };
    checked(conversation, std::slice::from_ref(project)).ok()
}

// Everything here came from the webview, and the ids become file names and CLI arguments.
fn checked(mut conversation: Conversation, projects: &[Project]) -> Result<Conversation, String> {
    if !valid_id(&conversation.id) {
        return Err("Unknown conversation.".into());
    }
    if !projects.iter().any(|p| p.id == conversation.project_id) {
        return Err("That project is gone.".into());
    }
    conversation.title = crate::sessions::title_of(&conversation.title);
    if conversation.title.is_empty() {
        return Err("A conversation needs a title.".into());
    }
    conversation.continues.retain(|id| crate::flow::valid_session(id));
    conversation.continues.truncate(MAX_CONTINUES);
    Ok(conversation)
}

fn save(dir: &Path, conversation: Conversation) -> Result<Conversation, String> {
    let conversation = checked(conversation, &read_projects(dir)?)?;
    let mut conversations = list(dir)?;
    match conversations.iter_mut().find(|c| c.id == conversation.id) {
        Some(existing) => *existing = conversation.clone(),
        None => conversations.insert(0, conversation.clone()),
    }
    write_all(dir, &conversations)?;
    Ok(conversation)
}

// Noted first, then dropped from the list, then the threads put away: a crash anywhere leaves a
// conversation listed twice, never gone.
fn put_away(dir: &Path, gone: impl Fn(&Conversation) -> bool) -> Result<(), String> {
    let (gone, kept): (Vec<_>, Vec<_>) = list(dir)?.into_iter().partition(gone);
    note(dir, "conversation", &gone)?;
    write_all(dir, &kept)?;
    gone.iter().try_for_each(|c| put_away_thread(dir, &c.id))
}

fn remove(dir: &Path, id: &str) -> Result<(), String> {
    put_away(dir, |c| c.id == id)?;
    // A thread left from before conversations, under an id the list never had.
    put_away_thread(dir, id)
}

pub(crate) fn forget_project(dir: &Path, project_id: &str) -> Result<(), String> {
    put_away(dir, |c| c.project_id == project_id)
}

#[tauri::command]
pub fn list_conversations(app: tauri::AppHandle) -> Result<Vec<Conversation>, String> {
    list(&data_dir(&app)?)
}

#[tauri::command]
pub fn save_conversation(app: tauri::AppHandle, conversation: Conversation) -> Result<Conversation, String> {
    save(&data_dir(&app)?, conversation)
}

#[tauri::command]
pub fn remove_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    remove(&data_dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::write_thread;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-conv-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn with_projects(dir: &Path, ids: &[&str]) {
        let projects: Vec<Value> = ids.iter().map(|id| serde_json::json!({ "id": id, "name": id, "folder": "/work", "createdAt": 5 })).collect();
        std::fs::write(dir.join("projects.json"), serde_json::to_string(&projects).unwrap()).unwrap();
    }

    fn conversation(id: &str, project_id: &str) -> Conversation {
        Conversation { id: id.into(), project_id: project_id.into(), title: "add dark mode".into(), created_at: 1, updated_at: 2, continues: vec![] }
    }

    #[test]
    fn each_projects_old_thread_becomes_its_first_conversation_once() {
        let dir = scratch("migrate");
        with_projects(&dir, &["pa", "pb"]);
        let thread = serde_json::json!({ "messages": [{ "role": "user", "text": "\n  Loguei, pode seguir\nmore", "at": 40 }, { "role": "run" }, { "role": "user", "text": "e agora?", "at": 70 }], "sessions": { "claude-code": "3d6f467d-9732", "codex": "--bad" } });
        write_thread(&dir, "pa", &thread).unwrap();

        let migrated = list(&dir).unwrap();
        assert_eq!(migrated, [Conversation { id: "pa".into(), project_id: "pa".into(), title: "Loguei, pode seguir".into(), created_at: 5, updated_at: 70, continues: vec!["3d6f467d-9732".into()] }]);

        remove(&dir, "pa").unwrap();
        assert!(list(&dir).unwrap().is_empty(), "migration runs only once");
        assert_eq!(read_thread(&dir, "pa").unwrap()["messages"], serde_json::json!([]));
    }

    #[test]
    #[ignore = "migrates the copy of a real data folder named by DHRIVE_DATA_COPY"]
    fn migrates_a_copy_of_real_data() {
        let dir = std::path::PathBuf::from(std::env::var("DHRIVE_DATA_COPY").expect("DHRIVE_DATA_COPY"));
        for c in list(&dir).unwrap() {
            eprintln!("{} project {} continues {:?}  {}", c.id, c.project_id, c.continues, c.title);
        }
    }

    #[test]
    fn saving_checks_what_the_webview_sent() {
        let dir = scratch("save");
        with_projects(&dir, &["pa"]);
        assert!(save(&dir, conversation("../x", "pa")).is_err());
        assert!(save(&dir, conversation("c1", "gone")).is_err());
        assert!(save(&dir, Conversation { title: "  ".into(), ..conversation("c1", "pa") }).is_err());

        let saved = save(&dir, Conversation { title: "x".repeat(200), continues: vec!["ok-1".into(), "--fork-session".into()], ..conversation("c1", "pa") }).unwrap();
        assert!(saved.title.ends_with('…') && saved.title.chars().count() <= 81);
        assert_eq!(saved.continues, ["ok-1"]);
    }

    #[test]
    fn saving_again_updates_in_place_and_new_ones_come_first() {
        let dir = scratch("upsert");
        with_projects(&dir, &["pa"]);
        save(&dir, conversation("c1", "pa")).unwrap();
        save(&dir, conversation("c2", "pa")).unwrap();
        save(&dir, Conversation { updated_at: 9, ..conversation("c1", "pa") }).unwrap();
        let ids: Vec<_> = list(&dir).unwrap().into_iter().map(|c| (c.id, c.updated_at)).collect();
        assert_eq!(ids, [("c2".to_string(), 2), ("c1".to_string(), 9)]);
    }

    #[test]
    fn forgetting_a_project_puts_away_only_its_conversations() {
        let dir = scratch("forget");
        with_projects(&dir, &["pa", "pb"]);
        for (id, project) in [("c1", "pa"), ("c2", "pb"), ("c3", "pb")] {
            save(&dir, conversation(id, project)).unwrap();
            write_thread(&dir, id, &serde_json::json!({ "messages": [id] })).unwrap();
        }
        forget_project(&dir, "pa").unwrap();
        remove(&dir, "c3").unwrap();
        assert_eq!(list(&dir).unwrap().iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["c2"]);
        assert_eq!(read_thread(&dir, "c1").unwrap()["messages"], serde_json::json!([]));
        assert_eq!(read_thread(&dir, "c2").unwrap()["messages"], serde_json::json!(["c2"]));
        for id in ["c1", "c3"] {
            let kept = std::fs::read_to_string(dir.join(format!("deleted/threads/{id}.json"))).unwrap();
            assert!(kept.contains(&format!("[\"{id}\"]")), "{id} is put away, not erased");
        }
        let listed = std::fs::read_to_string(dir.join("deleted/listed.jsonl")).unwrap();
        assert!(listed.contains("\"id\":\"c1\"") && listed.contains("\"id\":\"c3\"") && !listed.contains("\"id\":\"c2\""), "{listed}");
    }
}
