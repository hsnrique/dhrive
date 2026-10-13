use std::path::Path;

use crate::projects::{data_dir, write_atomic};

// The owner's own instructions for every agent dhrive runs: an AGENTS.md of their own that applies in
// every project, plus what a conversation adds for itself. They reach the CLI as system instructions
// (Claude Code's --append-system-prompt, Codex's developer_instructions), so a project without an
// AGENTS.md or CLAUDE.md still gets them, and a resumed session doesn't hear them again with every
// message.

const FILE: &str = "instructions.md";
pub const MAX_INSTRUCTIONS: usize = 20_000;

const FOR_EVERY_PROJECT: &str = "The owner keeps these instructions in dhrive for every project. Follow them; where this \
project's own AGENTS.md or CLAUDE.md says otherwise, the project's file wins.";
const FOR_THIS_CONVERSATION: &str = "The owner added these instructions for this conversation. They win over any other \
instructions about the same thing.";

// Text from the webview that becomes a CLI argument (and, for Codex, a TOML string): a size limit, and
// no control characters but line breaks and tabs.
pub fn checked(text: &str) -> Result<String, String> {
    if text.chars().count() > MAX_INSTRUCTIONS {
        return Err(format!("Instructions can be up to {MAX_INSTRUCTIONS} characters."));
    }
    Ok(text.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect::<String>().trim().to_string())
}

// What a run hands the CLI, or None when the owner has written nothing anywhere. It always starts
// with a sentence of dhrive's own, so it can never be read as a flag.
pub fn combined(every_project: &str, this_conversation: &str) -> Option<String> {
    let parts: Vec<String> = [(FOR_EVERY_PROJECT, every_project), (FOR_THIS_CONVERSATION, this_conversation)]
        .into_iter()
        .filter(|(_, text)| !text.trim().is_empty())
        .map(|(header, text)| format!("{header}\n\n{}", text.trim()))
        .collect();
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

fn read(dir: &Path) -> String {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|text| checked(&text).ok()).unwrap_or_default()
}

pub fn for_run(app: &tauri::AppHandle, this_conversation: &str) -> Option<String> {
    let every_project = data_dir(app).map(|dir| read(&dir)).unwrap_or_default();
    combined(&every_project, this_conversation)
}

#[tauri::command]
pub fn read_instructions(app: tauri::AppHandle) -> Result<String, String> {
    Ok(read(&data_dir(&app)?))
}

#[tauri::command]
pub fn save_instructions(app: tauri::AppHandle, text: String) -> Result<(), String> {
    write_atomic(&data_dir(&app)?.join(FILE), &checked(&text)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_written_means_nothing_is_passed() {
        assert_eq!(combined("", "  \n "), None);
    }

    #[test]
    fn each_layer_says_where_it_comes_from_and_what_wins() {
        let both = combined("- Answer in Portuguese\n", "Keep it short.").unwrap();
        assert_eq!(both, format!("{FOR_EVERY_PROJECT}\n\n- Answer in Portuguese\n\n{FOR_THIS_CONVERSATION}\n\nKeep it short."));
        assert!(combined("", "-rf").unwrap().starts_with("The owner"), "never looks like a flag");
        assert!(!combined("Run the tests.", "").unwrap().contains(FOR_THIS_CONVERSATION));
    }

    #[test]
    fn control_characters_and_oversized_text_are_refused_or_dropped() {
        assert_eq!(checked("a\u{7f}b\u{0}\n\tc  ").unwrap(), "ab\n\tc");
        assert!(checked(&"x".repeat(MAX_INSTRUCTIONS + 1)).is_err());
    }

    #[test]
    fn the_file_is_read_back_checked() {
        let dir = std::env::temp_dir().join(format!("dhrive-instructions-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read(&dir), "", "missing file");
        std::fs::write(dir.join(FILE), "Use pnpm.\u{7}\n").unwrap();
        assert_eq!(read(&dir), "Use pnpm.");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
