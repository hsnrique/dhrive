use std::path::Path;

use crate::projects::{data_dir, read_projects, write_projects, Project};

// The tool rules the owner chose "always allow" for in a project, kept with the project in dhrive's
// own list and handed to Claude Code as allowed tools on every run there.

const MAX_RULES: usize = 100;

fn set_rule(dir: &Path, id: &str, rule: &str, allowed: bool) -> Result<Project, String> {
    if allowed && !crate::approvals::valid_rule(rule) {
        return Err("That isn't a rule dhrive can keep.".into());
    }
    let mut projects = read_projects(dir)?;
    let project = projects.iter_mut().find(|p| p.id == id).ok_or("That project is gone.")?;
    project.allowed.retain(|r| r != rule);
    if allowed {
        if project.allowed.len() >= MAX_RULES {
            return Err(format!("A project keeps up to {MAX_RULES} rules."));
        }
        project.allowed.push(rule.to_string());
    }
    let changed = project.clone();
    write_projects(dir, &projects)?;
    Ok(changed)
}

// The rules for the project at this folder, re-checked since the file can be edited by hand.
pub(crate) fn rules_for(app: &tauri::AppHandle, folder: &Path) -> Vec<String> {
    let folder = folder.to_string_lossy();
    let projects = data_dir(app).and_then(|dir| read_projects(&dir)).unwrap_or_default();
    projects.into_iter().find(|p| p.folder == folder).map(|p| p.allowed).unwrap_or_default().into_iter().filter(|r| crate::approvals::valid_rule(r)).collect()
}

#[tauri::command]
pub fn allow_in_project(app: tauri::AppHandle, id: String, rule: String) -> Result<Project, String> {
    set_rule(&data_dir(&app)?, &id, &rule, true)
}

#[tauri::command]
pub fn disallow_in_project(app: tauri::AppHandle, id: String, rule: String) -> Result<Project, String> {
    set_rule(&data_dir(&app)?, &id, &rule, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::add;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dhrive-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn always_allowed_rules_are_kept_once_checked_and_can_be_taken_back() {
        let (data, folder) = (scratch("data-rules"), scratch("folder-rules"));
        let project = add(&data, folder.to_str().unwrap()).unwrap();
        set_rule(&data, &project.id, "Bash(npm test:*)", true).unwrap();
        let twice = set_rule(&data, &project.id, "Bash(npm test:*)", true).unwrap();
        assert_eq!(twice.allowed, ["Bash(npm test:*)"]);
        assert!(set_rule(&data, &project.id, "Bash", true).is_err(), "never every command");
        assert!(set_rule(&data, &project.id, "Bash(npm test:*)", false).unwrap().allowed.is_empty());
        let old = r#"[{"id":"p1","name":"a","folder":"/a","createdAt":1}]"#;
        std::fs::write(data.join("projects.json"), old).unwrap();
        assert!(read_projects(&data).unwrap()[0].allowed.is_empty(), "lists from before rules still load");
    }

}
