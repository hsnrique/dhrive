use std::io::Read;
use std::path::Path;

use serde::Serialize;

// A project file or folder as the side panel shows it: text (cut at a size a panel can hold), an
// image as a data URL (the only kind of image the page's CSP lets in), or just its size when it's
// neither. Folders list what's directly in them.

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileView {
    Text { text: String, truncated: bool },
    Image { data_url: String },
    Binary { bytes: u64 },
    Folder { entries: Vec<String> },
}

const MAX_TEXT: u64 = 1024 * 1024;
const MAX_IMAGE: u64 = 10 * 1024 * 1024;
const MAX_ENTRIES: usize = 500;
const IMAGES: &[(&str, &str)] = &[("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp"), ("svg", "image/svg+xml"), ("ico", "image/x-icon")];

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            out.push(if i <= chunk.len() { ABC[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

fn folder(path: &Path) -> std::io::Result<FileView> {
    let mut entries: Vec<String> = std::fs::read_dir(path)?
        .filter_map(Result::ok)
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.file_type().is_ok_and(|t| t.is_dir()) { format!("{name}/") } else { name }
        })
        .filter(|name| name != ".git/")
        .collect();
    // Folders first, then files, each alphabetically, as Finder lists them.
    entries.sort_by_key(|name| (!name.ends_with('/'), name.to_lowercase()));
    entries.truncate(MAX_ENTRIES);
    Ok(FileView::Folder { entries })
}

fn view(path: &Path) -> std::io::Result<FileView> {
    let meta = std::fs::metadata(path)?;
    if meta.is_dir() {
        return folder(path);
    }
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if let Some((_, mime)) = IMAGES.iter().find(|(ext, _)| *ext == extension) {
        if meta.len() <= MAX_IMAGE {
            return Ok(FileView::Image { data_url: format!("data:{mime};base64,{}", base64(&std::fs::read(path)?)) });
        }
    }
    let mut head = Vec::new();
    std::fs::File::open(path)?.take(MAX_TEXT).read_to_end(&mut head)?;
    // A NUL near the start is how git tells binary from text, too.
    if head.iter().take(8000).any(|b| *b == 0) {
        return Ok(FileView::Binary { bytes: meta.len() });
    }
    Ok(FileView::Text { text: String::from_utf8_lossy(&head).into_owned(), truncated: meta.len() > MAX_TEXT })
}

#[tauri::command]
pub async fn read_file(folder: String, path: String) -> Result<FileView, String> {
    let full = crate::files::resolve(&folder, &path)?;
    tauri::async_runtime::spawn_blocking(move || view(&full).map_err(|error| format!("Can't read {}: {error}", full.display())))
        .await
        .map_err(|error| format!("Reading stopped unexpectedly: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // One folder per test: tests run in parallel, and a shared one let a test see another's files.
    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-viewer-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        dir
    }

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    }

    #[test]
    fn text_images_binaries_and_folders_each_come_back_as_what_they_are() {
        let dir = scratch("kinds");
        std::fs::write(dir.join("README.md"), "# Title\n").unwrap();
        std::fs::write(dir.join("logo.png"), b"\x89PNG").unwrap();
        std::fs::write(dir.join("app.bin"), b"\x00\x01\x02").unwrap();
        assert_eq!(view(&dir.join("README.md")).unwrap(), FileView::Text { text: "# Title\n".into(), truncated: false });
        assert_eq!(view(&dir.join("logo.png")).unwrap(), FileView::Image { data_url: "data:image/png;base64,iVBORw==".into() });
        assert_eq!(view(&dir.join("app.bin")).unwrap(), FileView::Binary { bytes: 3 });
        assert_eq!(view(&dir).unwrap(), FileView::Folder { entries: vec!["src/".into(), "app.bin".into(), "logo.png".into(), "README.md".into()] });
    }

    #[test]
    fn a_long_file_is_cut_and_says_so() {
        let dir = scratch("long");
        std::fs::write(dir.join("big.log"), "x".repeat(MAX_TEXT as usize + 10)).unwrap();
        let FileView::Text { text, truncated } = view(&dir.join("big.log")).unwrap() else { panic!("text") };
        assert!(truncated && text.len() == MAX_TEXT as usize);
    }
}
