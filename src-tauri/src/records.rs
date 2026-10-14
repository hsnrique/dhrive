use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::projects::write_atomic;

// A company's own records, its tasks, its timeline, its website's settings and the tools connected
// to it, as files in .company/ beside COMPANY.md.
// They travel with the folder (to the Trash, to GitHub, to a new Mac) instead of living in the
// webview's storage, which has a quota and fails without a word. What a record outgrows is appended
// to its archive, never dropped. Not .dhrive/: that one holds the panes' copies and git ignores it,
// and these must be committed with the rest.

pub(crate) const FOLDER: &str = ".company";
const NAMES: &[&str] = &["tasks", "log", "site", "connectors", "agent", "army"];
// A record holds the recent part only; past this it's a bug, not a busy company.
const MAX_BYTES: usize = 20 * 1024 * 1024;

// Only the names above ever become file names.
fn path(folder: &Path, name: &str, ending: &str) -> Result<PathBuf, String> {
    if !NAMES.contains(&name) {
        return Err("Unknown record.".into());
    }
    Ok(folder.join(FOLDER).join(format!("{name}{ending}")))
}

pub(crate) fn read(folder: &Path, name: &str) -> Result<Option<Value>, String> {
    match std::fs::read_to_string(path(folder, name, ".json")?) {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|error| format!("The company's {name} file is damaged: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Can't read the company's {name}: {error}")),
    }
}

// Pretty, so a backup's history shows what changed line by line.
pub(crate) fn save(folder: &Path, name: &str, value: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    if json.len() > MAX_BYTES {
        return Err(format!("The company's {name} grew too large to save."));
    }
    write_atomic(&path(folder, name, ".json")?, &json)
}

// One JSON line per item, on disk before the record that let them go is saved.
pub(crate) fn archive(folder: &Path, name: &str, items: &[Value]) -> Result<(), String> {
    let path = path(folder, name, "-archive.jsonl")?;
    if items.is_empty() {
        return Ok(());
    }
    let lines = items.iter().map(|item| serde_json::to_string(item).map(|line| line + "\n")).collect::<Result<String, _>>().map_err(|error| error.to_string())?;
    if lines.len() > MAX_BYTES {
        return Err(format!("Too much of the company's {name} to archive at once."));
    }
    std::fs::create_dir_all(path.parent().ok_or("No folder to archive into.")?).map_err(|error| format!("Can't archive: {error}"))?;
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|error| format!("Can't archive: {error}"))?;
    file.write_all(lines.as_bytes()).and_then(|_| file.sync_all()).map_err(|error| format!("Can't archive: {error}"))
}

#[tauri::command]
pub fn read_company_record(app: tauri::AppHandle, project: String, name: String) -> Result<Option<Value>, String> {
    read(&crate::terminal::project_folder(&app, &project)?, &name)
}

#[tauri::command]
pub fn save_company_record(app: tauri::AppHandle, project: String, name: String, value: Value) -> Result<(), String> {
    save(&crate::terminal::project_folder(&app, &project)?, &name, &value)
}

#[tauri::command]
pub fn archive_company_record(app: tauri::AppHandle, project: String, name: String, items: Vec<Value>) -> Result<(), String> {
    archive(&crate::terminal::project_folder(&app, &project)?, &name, &items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-records-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_record_round_trips_and_its_archive_only_grows() {
        let dir = scratch("round");
        assert_eq!(read(&dir, "tasks").unwrap(), None, "nothing saved yet");
        save(&dir, "tasks", &json!({ "tasks": [{ "id": "a" }] })).unwrap();
        assert_eq!(read(&dir, "tasks").unwrap(), Some(json!({ "tasks": [{ "id": "a" }] })));
        archive(&dir, "tasks", &[json!({ "id": "old1" })]).unwrap();
        archive(&dir, "tasks", &[json!({ "id": "old2" }), json!({ "id": "old3" })]).unwrap();
        archive(&dir, "tasks", &[]).unwrap();
        let archived = std::fs::read_to_string(dir.join(".company/tasks-archive.jsonl")).unwrap();
        assert_eq!(archived, "{\"id\":\"old1\"}\n{\"id\":\"old2\"}\n{\"id\":\"old3\"}\n");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_known_records_and_a_damaged_one_is_never_read_as_empty() {
        let dir = scratch("names");
        for bad in ["../projects", "notes", "", "tasks/../../x"] {
            assert!(read(&dir, bad).is_err() && save(&dir, bad, &json!({})).is_err() && archive(&dir, bad, &[json!(1)]).is_err(), "{bad}");
        }
        std::fs::create_dir_all(dir.join(".company")).unwrap();
        std::fs::write(dir.join(".company/log.json"), "{ half").unwrap();
        assert!(read(&dir, "log").unwrap_err().contains("damaged"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
