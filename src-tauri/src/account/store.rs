use std::path::Path;

use serde::{Deserialize, Serialize};

use super::Facts;
use crate::projects::write_atomic;

// What's kept about the account: the token in the Keychain (a file, in debug builds; see read_token),
// and the last facts dhrive.app gave (none of them secret) in account.json in the app's data folder,
// for the days the Mac is offline.

const FILE: &str = "account.json";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Saved {
    pub facts: Option<Facts>,
    pub checked_at: Option<u64>,
}

pub fn read(dir: &Path) -> Saved {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
}

pub fn write(dir: &Path, saved: &Saved) -> Result<(), String> {
    write_atomic(&dir.join(FILE), &serde_json::to_string_pretty(saved).map_err(|error| error.to_string())?)
}

// In the Keychain, or a file in debug builds (secrets.rs).
const TOKEN: &str = "account-token";

pub fn read_token() -> Option<String> {
    crate::secrets::read(TOKEN)
}

pub fn save_token(token: &str) -> Result<(), String> {
    crate::secrets::save(TOKEN, token).map_err(|error| format!("Couldn't keep your sign-in: {error}"))
}

pub fn forget_token() {
    crate::secrets::forget(TOKEN);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_was_saved_comes_back_and_anything_else_reads_as_nothing() {
        let dir = std::env::temp_dir().join(format!("dhrive-account-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read(&dir), Saved::default(), "no file yet");
        let saved = Saved { facts: Some(Facts { email: "a@b.c".into(), trial_ends_at: 5, subscription: None }), checked_at: Some(1) };
        write(&dir, &saved).unwrap();
        assert_eq!(read(&dir), saved);
        std::fs::write(dir.join(FILE), "not json").unwrap();
        assert_eq!(read(&dir), Saved::default());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
