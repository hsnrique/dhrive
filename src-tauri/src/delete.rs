use std::path::Path;
use std::process::Command;
use std::time::Duration;

use tauri::Manager;

use crate::versions::{client, refused, UNREACHABLE};

// Deleting a company takes all of it: its website comes down on dhrive's host (and the name is free
// again), its dev server stops, dhrive forgets it and its conversations, and its folder goes to the
// Trash, but only a folder dhrive founded under ~/dhrive; a folder the owner opened stays theirs.
// The website goes first, so a failure there leaves everything else as it was.

// Whether dhrive made this folder: founding puts every company directly under ~/dhrive.
fn founded_by_dhrive(folder: &Path, companies: &Path) -> bool {
    folder.parent().is_some_and(|parent| parent == companies)
}

// To the Trash, not gone: the owner can still take it back from there.
fn to_trash(folder: &Path) -> Result<(), String> {
    let moved = if Path::new("/usr/bin/trash").exists() {
        Command::new("/usr/bin/trash").arg(folder).status()
    } else {
        // macOS before 15 has no trash command; Finder moves it, asking once for permission to.
        Command::new("/usr/bin/osascript").args(["-e", "on run argv", "-e", "tell application \"Finder\" to delete (POSIX file (item 1 of argv) as alias)", "-e", "end run"]).arg(folder).status()
    };
    match moved {
        Ok(status) if status.success() => Ok(()),
        _ => Err(format!("Couldn't move {} to the Trash.", folder.display())),
    }
}

// A site never published, or not this account's, is as gone as one just deleted.
async fn take_down_site(folder: &Path) -> Result<(), String> {
    let host = crate::publish::host().ok_or("Publishing isn't set up in this build of dhrive.")?;
    let token = crate::account::store::read_token().ok_or("Sign in to dhrive to delete it, so its website comes down too.")?;
    let name = crate::publish::site_name(folder);
    let response = client(Duration::from_secs(30))?.delete(format!("{host}/api/sites/{name}")).bearer_auth(token).send().await.map_err(|_| UNREACHABLE)?;
    match response.status().as_u16() {
        200 | 404 => Ok(()),
        _ => Err(refused(response).await),
    }
}

#[tauri::command]
pub async fn delete_company(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let folder = crate::terminal::project_folder(&app, &id)?;
    take_down_site(&folder).await?;
    crate::site::stop(&folder);
    let companies = app.path().home_dir().map_err(|e| e.to_string())?.join(crate::founding::ROOT);
    if companies.canonicalize().is_ok_and(|companies| founded_by_dhrive(&folder, &companies)) {
        to_trash(&folder)?;
    }
    crate::projects::remove(&crate::projects::data_dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_folder_dhrive_founded_goes_to_the_trash() {
        let companies = Path::new("/Users/ana/dhrive");
        assert!(founded_by_dhrive(Path::new("/Users/ana/dhrive/acme"), companies));
        assert!(!founded_by_dhrive(Path::new("/Users/ana/dhrive"), companies));
        assert!(!founded_by_dhrive(Path::new("/Users/ana/dhrive/acme/web"), companies));
        assert!(!founded_by_dhrive(Path::new("/Users/ana/code/acme"), companies));
    }
}
