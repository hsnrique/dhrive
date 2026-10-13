use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;

use crate::projects::{now_millis, write_atomic};

// dhrive's own lists (projects, conversations) are what every screen starts from, so each keeps the
// version it replaces beside it as .bak. A list that's ever damaged is set aside, never saved over,
// and that version put back in its place.

fn backup(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".bak");
    PathBuf::from(name)
}

pub(crate) fn write_list(path: &Path, contents: &str) -> Result<(), String> {
    let _ = std::fs::remove_file(backup(path));
    // A first save has nothing to keep.
    let _ = std::fs::hard_link(path, backup(path));
    write_atomic(path, contents)
}

pub(crate) fn read_list<T: DeserializeOwned>(path: &Path, what: &str) -> Result<Option<T>, String> {
    let json = match std::fs::read_to_string(path) {
        Ok(json) => json,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Can't read the {what}: {error}")),
    };
    match serde_json::from_str(&json) {
        Ok(list) => Ok(Some(list)),
        Err(error) => earlier(path, what, error),
    }
}

fn earlier<T: DeserializeOwned>(path: &Path, what: &str, error: serde_json::Error) -> Result<Option<T>, String> {
    let json = std::fs::read_to_string(backup(path)).unwrap_or_default();
    let Ok(before) = serde_json::from_str(&json) else {
        return Err(format!("dhrive's {what} is damaged: {error}"));
    };
    let aside = path.with_extension(format!("damaged-{}", now_millis()));
    std::fs::rename(path, aside).map_err(|e| format!("dhrive's {what} is damaged and can't be set aside: {e}"))?;
    write_atomic(path, &json)?;
    Ok(Some(before))
}
