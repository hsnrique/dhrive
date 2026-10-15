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
    // There, but not something dhrive can read: too big, not a plain file, another encoding. Never
    // "missing": a missing document gets written, and writing this one would replace the owner's.
    unreadable: bool,
}

// Some(text) when it's written, None when it isn't, Err when it's there but can't be read.
fn read_one(folder: &Path, file: &str) -> Result<Option<String>, ()> {
    let path = folder.join(file);
    let Ok(meta) = std::fs::symlink_metadata(&path) else { return Ok(None) };
    if !meta.is_file() || meta.len() > MAX_DOCUMENT {
        return Err(());
    }
    let text = std::fs::read_to_string(path).map_err(|_| ())?;
    Ok(Some(text).filter(|text| !text.trim().is_empty()))
}

fn read_all(folder: &Path) -> Vec<Document> {
    DOCUMENTS
        .iter()
        .map(|(id, file)| match read_one(folder, file) {
            Ok(text) => Document { id, text, unreadable: false },
            Err(()) => Document { id, text: None, unreadable: true },
        })
        .collect()
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
        assert!(docs[1..].iter().all(|d| d.text.is_none() && !d.unreadable));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_document_that_cant_be_read_is_never_missing() {
        let dir = std::env::temp_dir().join(format!("dhrive-documents-odd-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("docs/roadmap.md")).unwrap();
        std::fs::write(dir.join("docs/mission.md"), b"Miss\xe3o").unwrap();
        std::fs::write(dir.join("docs/design-guide.md"), "x".repeat(MAX_DOCUMENT as usize + 1)).unwrap();
        let docs = read_all(&dir);
        assert_eq!(docs.iter().map(|d| d.unreadable).collect::<Vec<_>>(), [true, true, true, false], "another encoding, a folder, too big; the last isn't there");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
