use std::path::Path;

use serde::Serialize;

// A company's documents live in its repo under docs/, written by its agent as tasks and read by
// every agent after. dhrive only reads them, and only these files: the list is fixed here, so no
// path ever comes from the webview.

const DOCUMENTS: [(&str, &str); 4] = [
    ("mission", "docs/mission.md"),
    ("roadmap", "docs/roadmap.md"),
    ("design-guide", "docs/design-guide.md"),
    ("market-research", "docs/market-research.md"),
];
const MAX_DOCUMENT: u64 = 200_000;

#[derive(Serialize, Debug, PartialEq)]
pub struct Document {
    id: &'static str,
    // None until it's written.
    text: Option<String>,
}

fn read_one(folder: &Path, file: &str) -> Option<String> {
    let path = folder.join(file);
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_DOCUMENT {
        return None;
    }
    std::fs::read_to_string(path).ok().filter(|text| !text.trim().is_empty())
}

fn read_all(folder: &Path) -> Vec<Document> {
    DOCUMENTS.iter().map(|(id, file)| Document { id, text: read_one(folder, file) }).collect()
}

#[tauri::command]
pub fn read_documents(app: tauri::AppHandle, project: String) -> Result<Vec<Document>, String> {
    Ok(read_all(&crate::terminal::project_folder(&app, &project)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_known_documents_are_read_and_empty_ones_count_as_missing() {
        let dir = std::env::temp_dir().join(format!("dhrive-documents-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("docs")).unwrap();
        std::fs::write(dir.join("docs/mission.md"), "# Mission\nHelp.").unwrap();
        std::fs::write(dir.join("docs/roadmap.md"), "  \n").unwrap();
        std::fs::write(dir.join("docs/secrets.md"), "nope").unwrap();
        let docs = read_all(&dir);
        assert_eq!(docs.iter().map(|d| d.id).collect::<Vec<_>>(), ["mission", "roadmap", "design-guide", "market-research"]);
        assert_eq!(docs[0].text.as_deref(), Some("# Mission\nHelp."));
        assert!(docs[1..].iter().all(|d| d.text.is_none()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
