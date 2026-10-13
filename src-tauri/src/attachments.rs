use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::projects::data_dir;

// Files the owner hands a step: images pasted into the composer, saved under the app's data dir,
// and files picked or dropped from anywhere on the Mac. A step names every one in its prompt, which
// is how Claude reads them; Codex also gets the images as images. Pasted images are kept for good:
// they're the owner's, and a conversation shows them for as long as it's there.

const MAX_FILES: usize = 10;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
const IMAGES: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const FOLDER: &str = "attachments";

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

pub fn is_image(path: &Path) -> bool {
    IMAGES.contains(&extension(path).as_str())
}

// Paths come from the webview: each must be an existing file, not a folder, and not huge.
pub fn checked(paths: &[String]) -> Result<Vec<PathBuf>, String> {
    if paths.len() > MAX_FILES {
        return Err(format!("Attach up to {MAX_FILES} files at a time."));
    }
    paths
        .iter()
        .map(|path| {
            let file = Path::new(path).canonicalize().map_err(|_| format!("{path} isn't there anymore."))?;
            let meta = std::fs::metadata(&file).map_err(|error| error.to_string())?;
            if !meta.is_file() {
                return Err(format!("{path} is a folder; mention it with @ instead."));
            }
            if meta.len() > MAX_BYTES {
                return Err(format!("{path} is over {} MB.", MAX_BYTES / 1024 / 1024));
            }
            Ok(file)
        })
        .collect()
}

pub fn prompt_note(files: &[PathBuf]) -> String {
    if files.is_empty() {
        return String::new();
    }
    let list: Vec<String> = files.iter().map(|f| format!("- {}", f.display())).collect();
    format!("\n\nFiles the owner attached (read each one):\n{}", list.join("\n"))
}

fn save(folder: &Path, bytes: &[u8], kind: &str) -> Result<PathBuf, String> {
    if !IMAGES.contains(&kind) {
        return Err("Only images can be pasted.".into());
    }
    if bytes.is_empty() || bytes.len() as u64 > MAX_BYTES {
        return Err(format!("Pasted images can be up to {} MB.", MAX_BYTES / 1024 / 1024));
    }
    std::fs::create_dir_all(folder).map_err(|error| format!("Can't save the image: {error}"))?;
    let stamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let path = folder.join(format!("pasted-{stamp:x}.{kind}"));
    std::fs::write(&path, bytes).map_err(|error| format!("Can't save the image: {error}"))?;
    Ok(path)
}

// The image comes as the raw request body, so a screenshot isn't blown up into a JSON number array;
// its kind (png, jpeg…) comes in a header.
#[tauri::command]
pub fn save_attachment(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Send the image as raw bytes.".into());
    };
    let kind = request.headers().get("x-kind").and_then(|v| v.to_str().ok()).unwrap_or_default().to_ascii_lowercase();
    save(&data_dir(&app)?.join(FOLDER), bytes, &kind).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn pick_files(app: tauri::AppHandle) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_files()).await.ok().flatten().unwrap_or_default();
    picked.into_iter().filter_map(|file| file.into_path().ok()).map(|path| path.to_string_lossy().into_owned()).collect()
}

// Shows an attachment in Finder, which never runs anything, whatever the file is.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    let file = Path::new(&path).canonicalize().map_err(|_| "That file isn't there anymore.".to_string())?;
    tauri_plugin_opener::reveal_item_in_dir(file).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-attach-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn attached_paths_must_be_files_that_exist() {
        let dir = scratch("check");
        std::fs::write(dir.join("spec.pdf"), b"%PDF").unwrap();
        let file = dir.join("spec.pdf").to_string_lossy().into_owned();
        assert_eq!(checked(std::slice::from_ref(&file)).unwrap(), [dir.join("spec.pdf").canonicalize().unwrap()]);
        assert!(checked(&[dir.to_string_lossy().into_owned()]).unwrap_err().contains("folder"));
        assert!(checked(&["/definitely/not/here.png".into()]).is_err());
        assert!(checked(&vec![file; MAX_FILES + 1]).is_err());
    }

    #[test]
    fn the_prompt_names_every_attachment_and_images_are_told_apart() {
        let files = [PathBuf::from("/a/shot.PNG"), PathBuf::from("/a/spec.pdf")];
        assert_eq!(prompt_note(&files), "\n\nFiles the owner attached (read each one):\n- /a/shot.PNG\n- /a/spec.pdf");
        assert_eq!(prompt_note(&[]), "");
        assert!(is_image(&files[0]) && !is_image(&files[1]));
    }

    #[test]
    fn pasting_saves_only_images() {
        let dir = scratch("save");
        let saved = save(&dir, b"\x89PNG", "png").unwrap();
        assert!(saved.starts_with(&dir) && saved.extension().unwrap() == "png");
        assert!(save(&dir, b"#!/bin/sh", "sh").is_err());
        assert!(save(&dir, b"", "png").is_err());
    }
}
