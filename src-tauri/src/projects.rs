use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

// A project is a folder the owner opened in dhrive. The list lives in projects.json under the app's
// data dir, and each of its conversations (conversations.rs) in threads/<id>.json; removing a
// project puts it and its conversations away (deleted.rs) and never touches the folder itself
// (deleting a company, delete.rs, decides about that).

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub(crate) id: String,
    name: String,
    pub(crate) folder: String,
    pub(crate) created_at: u64,
    // Tool rules the owner chose "always allow" for here ("Bash(npm test:*)"). They live in dhrive,
    // never in the project's own .claude settings.
    #[serde(default)]
    pub(crate) allowed: Vec<String>,
}

const MAX_NAME: usize = 80;
// A long thread of plans and summaries is still text; anything past this is a bug, not a chat.
const MAX_THREAD_BYTES: usize = 20 * 1024 * 1024;

pub(crate) fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| format!("Can't find dhrive's data folder: {error}"))
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// Ids are generated here and only ever become file names, so anything else is refused outright.
pub(crate) fn valid_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn new_id(taken: &[Project]) -> String {
    let mut stamp = now_millis();
    loop {
        let id = format!("p{stamp:x}");
        if !taken.iter().any(|p| p.id == id) {
            return id;
        }
        stamp += 1;
    }
}

pub(crate) fn read_projects(dir: &Path) -> Result<Vec<Project>, String> {
    crate::lists::read_list(&dir.join("projects.json"), "project list").map(Option::unwrap_or_default)
}

// Write to a sibling temp file, flushed to the disk, then rename over the target, so a crash or a
// power cut mid-write never leaves a half-written file behind.
pub(crate) fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("No folder to save into.")?;
    std::fs::create_dir_all(parent).map_err(|error| format!("Can't create {}: {error}", parent.display()))?;
    let temp = path.with_extension("tmp");
    let mut file = std::fs::File::create(&temp).map_err(|error| format!("Can't save: {error}"))?;
    file.write_all(contents.as_bytes()).and_then(|_| file.sync_all()).map_err(|error| format!("Can't save: {error}"))?;
    std::fs::rename(&temp, path).map_err(|error| format!("Can't save: {error}"))
}

pub(crate) fn write_projects(dir: &Path, projects: &[Project]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(projects).map_err(|error| error.to_string())?;
    crate::lists::write_list(&dir.join("projects.json"), &json)
}

pub(crate) fn add(dir: &Path, folder: &str) -> Result<Project, String> {
    let folder = Path::new(folder).canonicalize().map_err(|_| "That folder doesn't exist anymore.".to_string())?;
    if !folder.is_dir() {
        return Err("Pick a folder, not a file.".into());
    }
    let mut projects = read_projects(dir)?;
    let folder_text = folder.to_string_lossy().into_owned();
    if let Some(existing) = projects.iter().find(|p| p.folder == folder_text) {
        return Ok(existing.clone());
    }
    let name = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| folder_text.clone());
    let project = Project { id: new_id(&projects), name, folder: folder_text, created_at: now_millis(), allowed: Vec::new() };
    projects.insert(0, project.clone());
    write_projects(dir, &projects)?;
    Ok(project)
}

pub(crate) fn rename(dir: &Path, id: &str, name: &str) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(format!("Names can be 1 to {MAX_NAME} characters."));
    }
    let mut projects = read_projects(dir)?;
    let project = projects.iter_mut().find(|p| p.id == id).ok_or("That project is gone.")?;
    project.name = name.to_string();
    let renamed = project.clone();
    write_projects(dir, &projects)?;
    Ok(renamed)
}

// The project's own id also names the one thread it had before conversations, left behind when it
// was empty and never became a conversation.
pub(crate) fn remove(dir: &Path, id: &str) -> Result<(), String> {
    crate::conversations::forget_project(dir, id)?;
    let (gone, kept): (Vec<_>, Vec<_>) = read_projects(dir)?.into_iter().partition(|p| p.id == id);
    crate::deleted::note(dir, "project", &gone)?;
    write_projects(dir, &kept)?;
    crate::deleted::put_away_thread(dir, id)
}

pub(crate) fn thread_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Unknown conversation.".into());
    }
    Ok(dir.join("threads").join(format!("{id}.json")))
}

pub(crate) fn read_thread(dir: &Path, id: &str) -> Result<Value, String> {
    match std::fs::read_to_string(thread_path(dir, id)?) {
        Ok(json) => serde_json::from_str(&json).map_err(|error| format!("This conversation is damaged: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({ "messages": [], "sessions": {} })),
        Err(error) => Err(format!("Can't read the conversation: {error}")),
    }
}

pub(crate) fn write_thread(dir: &Path, id: &str, thread: &Value) -> Result<(), String> {
    if !thread.is_object() {
        return Err("A conversation must be an object.".into());
    }
    let json = serde_json::to_string(thread).map_err(|error| error.to_string())?;
    if json.len() > MAX_THREAD_BYTES {
        return Err("This conversation grew too large to save.".into());
    }
    write_atomic(&thread_path(dir, id)?, &json)
}

#[tauri::command]
pub fn list_projects(app: tauri::AppHandle) -> Result<Vec<Project>, String> {
    read_projects(&data_dir(&app)?)
}

#[tauri::command]
pub fn add_project(app: tauri::AppHandle, folder: String) -> Result<Project, String> {
    add(&data_dir(&app)?, &folder)
}

#[tauri::command]
pub fn rename_project(app: tauri::AppHandle, id: String, name: String) -> Result<Project, String> {
    rename(&data_dir(&app)?, &id, &name)
}

#[tauri::command]
pub fn load_thread(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    read_thread(&data_dir(&app)?, &id)
}

#[tauri::command]
pub fn save_thread(app: tauri::AppHandle, id: String, thread: Value) -> Result<(), String> {
    write_thread(&data_dir(&app)?, &id, &thread)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn adding_a_folder_twice_opens_the_same_project() {
        let (data, folder) = (scratch("data-add"), scratch("folder-add"));
        let first = add(&data, folder.to_str().unwrap()).unwrap();
        let again = add(&data, folder.to_str().unwrap()).unwrap();
        assert_eq!(first, again);
        assert_eq!(read_projects(&data).unwrap().len(), 1);
        assert!(first.name.starts_with("dhrive-folder-add"));
        assert!(add(&data, "/definitely/not/here").is_err());
    }

    #[test]
    fn projects_rename_and_remove_without_touching_the_folder() {
        let (data, folder) = (scratch("data-edit"), scratch("folder-edit"));
        let project = add(&data, folder.to_str().unwrap()).unwrap();
        assert_eq!(rename(&data, &project.id, "  Storefront ").unwrap().name, "Storefront");
        assert!(rename(&data, &project.id, "   ").is_err());
        write_thread(&data, &project.id, &serde_json::json!({ "messages": [1] })).unwrap();

        remove(&data, &project.id).unwrap();

        assert!(read_projects(&data).unwrap().is_empty());
        assert_eq!(read_thread(&data, &project.id).unwrap()["messages"], serde_json::json!([]));
        assert!(folder.is_dir());
        assert!(data.join(format!("deleted/threads/{}.json", project.id)).exists(), "its thread is put away, not erased");
        assert!(std::fs::read_to_string(data.join("deleted/listed.jsonl")).unwrap().contains("\"kind\":\"project\""));
    }

    #[test]
    fn a_damaged_list_is_set_aside_and_the_one_before_it_read() {
        let (data, one, two, three) = (scratch("data-damaged"), scratch("folder-one"), scratch("folder-two"), scratch("folder-three"));
        let first = add(&data, one.to_str().unwrap()).unwrap();
        add(&data, two.to_str().unwrap()).unwrap();
        std::fs::write(data.join("projects.json"), "[{\"id\": ").unwrap();

        assert_eq!(read_projects(&data).unwrap(), [first], "the list before the last save");
        let aside: Vec<_> = std::fs::read_dir(&data).unwrap().filter_map(Result::ok).filter(|e| e.file_name().to_string_lossy().starts_with("projects.damaged-")).collect();
        assert_eq!(std::fs::read_to_string(aside[0].path()).unwrap(), "[{\"id\": ", "the damaged one is kept as it was");
        add(&data, three.to_str().unwrap()).unwrap();
        assert_eq!(read_projects(&data).unwrap().len(), 2);

        let lone = scratch("data-lone");
        std::fs::write(lone.join("projects.json"), "nope").unwrap();
        assert!(read_projects(&lone).unwrap_err().contains("damaged"));
        assert!(add(&lone, one.to_str().unwrap()).is_err(), "never saved over");
        assert_eq!(std::fs::read_to_string(lone.join("projects.json")).unwrap(), "nope");
    }

    #[test]
    fn threads_round_trip_and_ids_cannot_escape_the_data_folder() {
        let data = scratch("data-thread");
        let thread = serde_json::json!({ "messages": [{ "id": "m1", "text": "add dark mode" }], "sessions": { "claude-code": "s1" } });
        write_thread(&data, "p1a2b", &thread).unwrap();
        assert_eq!(read_thread(&data, "p1a2b").unwrap(), thread);
        for bad in ["../etc", "P1", "a/b", "", &"a".repeat(41)] {
            assert!(write_thread(&data, bad, &thread).is_err(), "{bad}");
        }
        assert!(write_thread(&data, "p1", &serde_json::json!([])).is_err());
    }
}
