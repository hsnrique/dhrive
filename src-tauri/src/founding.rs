use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::projects::{add, data_dir, Project};

// Starting a company from one sentence: a CLI names it and writes its brief from an empty folder of
// dhrive's own (so it reads nothing of the owner's), then the company gets a folder of its own under
// ~/dhrive, a git repo with COMPANY.md as its first commit, and a place in the project list.

pub(crate) const ROOT: &str = "dhrive";
const MAX_SLUG: usize = 40;

// A folder name from the company's name: lowercase letters, digits and dashes only.
pub(crate) fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out: String = out.trim_end_matches('-').chars().take(MAX_SLUG).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "company".into() } else { out }
}

// A folder that isn't taken yet: the slug, then the slug with -2, -3…
fn free_folder(root: &Path, slug: &str) -> PathBuf {
    (1..)
        .map(|n| if n == 1 { root.join(slug) } else { root.join(format!("{slug}-{n}")) })
        .find(|folder| !folder.exists())
        .expect("an unbounded range always finds a free name")
}

fn found(companies: &Path, projects: &Path, name: &str, brief: &str) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("A company needs a name of 1 to 80 characters.".into());
    }
    std::fs::create_dir_all(companies).map_err(|e| format!("Can't create {}: {e}", companies.display()))?;
    let folder = free_folder(companies, &slug(name));
    std::fs::create_dir(&folder).map_err(|e| format!("Can't create {}: {e}", folder.display()))?;
    crate::company::save(&folder, brief)?;
    crate::worktrees::ensure_repo(&folder)?;
    let project = add(projects, &folder.to_string_lossy())?;
    crate::projects::rename(projects, &project.id, name)
}

#[tauri::command]
pub fn founding_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?.join("founding");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn found_company(app: tauri::AppHandle, name: String, brief: String) -> Result<Project, String> {
    let home = app.path().home_dir().map_err(|e| format!("Can't find your home folder: {e}"))?;
    found(&home.join(ROOT), &data_dir(&app)?, &name, &brief)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_becomes_a_plain_folder_name() {
        assert_eq!(slug("planilha."), "planilha");
        assert_eq!(slug("  Step Skein: Monitors! "), "step-skein-monitors");
        assert_eq!(slug("Café ☕ Club"), "caf-club");
        assert_eq!(slug("../../etc"), "etc");
        assert_eq!(slug("☕"), "company");
        assert!(slug(&"a".repeat(90)).len() <= MAX_SLUG);
    }

    #[test]
    fn a_company_gets_its_own_repo_with_the_brief_and_a_place_in_the_list() {
        let root = std::env::temp_dir().join(format!("dhrive-found-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (companies, projects) = (root.join("companies"), root.join("data"));
        let first = found(&companies, &projects, "Step Skein", "# Step Skein\n\n## Product\n\nMonitors.").unwrap();
        assert!(first.folder.ends_with("step-skein"));
        assert_eq!(std::fs::read_to_string(Path::new(&first.folder).join("COMPANY.md")).unwrap(), "# Step Skein\n\n## Product\n\nMonitors.\n");
        assert_eq!(crate::git::git(Path::new(&first.folder), &["log", "-1", "--format=%s"]).unwrap(), "Start");
        let second = found(&companies, &projects, "Step Skein", "x").unwrap();
        assert!(second.folder.ends_with("step-skein-2"), "never into a folder that exists");
        let listed = crate::projects::read_projects(&projects).unwrap();
        assert_eq!(listed.iter().map(|p| serde_json::to_value(p).unwrap()["name"].clone()).collect::<Vec<_>>(), ["Step Skein", "Step Skein"]);
        assert!(found(&companies, &projects, "  ", "x").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
