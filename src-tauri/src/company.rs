use std::path::Path;

use crate::projects::write_atomic;

// A project run as a company keeps its brief in COMPANY.md at the project's root: the owner's own
// file, in their repo, read by every CLI that works there (and by people). dhrive only reads and
// writes it whole; what goes in it is the owner's.

const FILE: &str = "COMPANY.md";
pub const MAX_BRIEF: usize = 20_000;

// Text from the webview that lands in the owner's repo: a size limit, and no control characters but
// line breaks and tabs.
fn checked(text: &str) -> Result<String, String> {
    if text.chars().count() > MAX_BRIEF {
        return Err(format!("The company brief can be up to {MAX_BRIEF} characters."));
    }
    let clean: String = text.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect();
    Ok(format!("{}\n", clean.trim()))
}

// The brief, or "" while there is none. A file that is there but can't be read (another encoding, no
// permission) is an error: read as empty, the next save would write over the owner's own file.
fn read(folder: &Path) -> Result<String, String> {
    match std::fs::read_to_string(folder.join(FILE)) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("COMPANY.md is there but can't be read ({error}), so dhrive won't write over it. Fix the file, then try again.")),
    }
}

pub(crate) fn save(folder: &Path, text: &str) -> Result<(), String> {
    write_atomic(&folder.join(FILE), &checked(text)?)
}

#[tauri::command]
pub fn read_company(app: tauri::AppHandle, project: String) -> Result<String, String> {
    read(&crate::terminal::project_folder(&app, &project)?)
}

#[tauri::command]
pub fn save_company(app: tauri::AppHandle, project: String, text: String) -> Result<(), String> {
    save(&crate::terminal::project_folder(&app, &project)?, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_brief_round_trips_through_company_md_cleaned() {
        let dir = std::env::temp_dir().join(format!("dhrive-company-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read(&dir).unwrap(), "", "no brief yet");
        save(&dir, "  ## Product\u{7}\nA budget app.\u{0}  \n").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(FILE)).unwrap(), "## Product\nA budget app.\n");
        assert!(save(&dir, &"x".repeat(MAX_BRIEF + 1)).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_brief_that_cant_be_read_is_an_error_not_an_empty_brief() {
        let dir = std::env::temp_dir().join(format!("dhrive-company-latin1-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), b"## Produto\nCaf\xe9 para todos\n").unwrap();
        assert!(read(&dir).unwrap_err().contains("won't write over it"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
