// What dhrive keeps secret for the owner, by name: the account token and each company's environment.
// A signed release build keeps them in the Keychain. A debug build is a new unsigned binary on every
// `cargo tauri dev`, and the Keychain asks for the login password whenever a binary it doesn't know
// reads an item, so debug builds keep each one in a file only this Mac user can read.

#[cfg(not(debug_assertions))]
use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

pub const SERVICE: &str = "com.cyostech.dhrive";

#[cfg(not(debug_assertions))]
pub fn read(name: &str) -> Option<String> {
    get_generic_password(SERVICE, name).ok().and_then(|bytes| String::from_utf8(bytes).ok())
}

#[cfg(not(debug_assertions))]
pub fn save(name: &str, value: &str) -> Result<(), String> {
    set_generic_password(SERVICE, name, value.as_bytes()).map_err(|error| format!("the Keychain refused it: {error}"))
}

#[cfg(not(debug_assertions))]
pub fn forget(name: &str) {
    let _ = delete_generic_password(SERVICE, name);
}

#[cfg(debug_assertions)]
pub fn read(name: &str) -> Option<String> {
    dev::read(&dev::file(name)?)
}

#[cfg(debug_assertions)]
pub fn save(name: &str, value: &str) -> Result<(), String> {
    dev::save(&dev::file(name).ok_or("can't find your home folder")?, value)
}

#[cfg(debug_assertions)]
pub fn forget(name: &str) {
    let _ = dev::file(name).map(std::fs::remove_file);
}

#[cfg(debug_assertions)]
mod dev {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::{Path, PathBuf};

    pub fn file(name: &str) -> Option<PathBuf> {
        Some(PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support").join(super::SERVICE).join(format!("dev-{name}")))
    }

    pub fn read(file: &Path) -> Option<String> {
        std::fs::read_to_string(file).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
    }

    // Created readable by this user alone, before the value is written into it.
    pub fn save(file: &Path, value: &str) -> Result<(), String> {
        let _ = std::fs::remove_file(file);
        std::fs::create_dir_all(file.parent().ok_or("no folder to keep it in")?).map_err(|e| e.to_string())?;
        let mut kept = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(file).map_err(|e| e.to_string())?;
        kept.write_all(value.as_bytes()).map_err(|e| e.to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_debug_build_keeps_it_where_only_its_user_reads_it() {
            use std::os::unix::fs::PermissionsExt;
            let file = std::env::temp_dir().join(format!("dhrive-dev-secret-{}", std::process::id())).join("secret");
            assert_eq!(read(&file), None);
            save(&file, "first").unwrap();
            save(&file, "second").unwrap();
            assert_eq!(read(&file).as_deref(), Some("second"));
            assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
            std::fs::remove_dir_all(file.parent().unwrap()).unwrap();
        }

        #[test]
        fn the_account_token_keeps_the_file_it_always_had() {
            assert!(file("account-token").unwrap().ends_with("com.cyostech.dhrive/dev-account-token"));
        }
    }
}
