use super::*;

fn repo(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dhrive-changes-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    assert!(Command::new("git").args(["init", "-q"]).current_dir(&dir).status().unwrap().success());
    std::fs::write(dir.join(".gitignore"), ".env\n").unwrap();
    std::fs::write(dir.join("theme.ts"), "export const theme = 'light';\n").unwrap();
    std::fs::write(dir.join("old.ts"), "gone soon\n").unwrap();
    dir.canonicalize().unwrap()
}

fn status(dir: &Path) -> String {
    String::from_utf8(Command::new("git").args(["status", "--porcelain"]).current_dir(dir).output().unwrap().stdout).unwrap()
}

fn step(dir: &Path) {
    std::fs::write(dir.join("theme.ts"), "export const theme = 'dark';\nexport const auto = true;\n").unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/toggle.ts"), "toggle\n").unwrap();
    std::fs::remove_file(dir.join("old.ts")).unwrap();
    std::fs::write(dir.join(".env"), "SECRET=1\n").unwrap();
}

#[test]
fn a_folder_without_git_has_no_snapshot() {
    let dir = std::env::temp_dir().join(format!("dhrive-changes-plain-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(snapshot(&dir), None);
}

#[test]
fn lists_what_the_step_changed_without_touching_the_owners_staging() {
    let dir = repo("list");
    let owner = status(&dir);
    let before = snapshot(&dir).unwrap();
    assert!(since(&dir, &before).is_none(), "nothing changed yet");
    step(&dir);

    let changes = since(&dir, &before).unwrap();
    let summary: Vec<_> = changes.files.iter().map(|f| (f.path.as_str(), f.status, f.additions, f.deletions)).collect();
    assert_eq!(summary, [("old.ts", Status::Deleted, Some(0), Some(1)), ("src/toggle.ts", Status::Added, Some(1), Some(0)), ("theme.ts", Status::Modified, Some(2), Some(1))]);
    assert_ne!(status(&dir), owner, "the step's files show up for the owner");
    assert!(!status(&dir).contains("A "), "nothing was staged in the owner's index");
}

#[test]
fn shows_one_files_diff_and_refuses_what_it_did_not_record() {
    let dir = repo("diff");
    let before = snapshot(&dir).unwrap();
    step(&dir);
    let after = since(&dir, &before).unwrap().after;
    let folder = dir.to_string_lossy().into_owned();

    let diff = tauri::async_runtime::block_on(file_diff(folder.clone(), before.clone(), after.clone(), "theme.ts".into())).unwrap();
    assert!(diff.contains("+export const theme = 'dark';") && diff.contains("-export const theme = 'light';"));
    assert!(tauri::async_runtime::block_on(file_diff(folder.clone(), before.clone(), after.clone(), "../etc/passwd".into())).is_err());
    assert!(tauri::async_runtime::block_on(file_diff(folder, "HEAD".into(), after, "theme.ts".into())).is_err());
}

#[test]
fn undo_puts_back_what_the_step_changed_and_keeps_what_was_edited_since() {
    let dir = repo("undo");
    let before = snapshot(&dir).unwrap();
    step(&dir);
    let after = since(&dir, &before).unwrap().after;
    std::fs::write(dir.join("src/toggle.ts"), "the owner kept working on this\n").unwrap();

    let undone = undo(&dir, &before, &after).unwrap();
    assert_eq!(undone, Undo { restored: vec!["old.ts".into(), "theme.ts".into()], kept: vec!["src/toggle.ts".into()] });
    assert_eq!(std::fs::read_to_string(dir.join("theme.ts")).unwrap(), "export const theme = 'light';\n");
    assert_eq!(std::fs::read_to_string(dir.join("old.ts")).unwrap(), "gone soon\n");
    assert!(dir.join(".env").exists(), "ignored files are never part of it");
}

#[test]
fn undo_removes_what_the_step_added() {
    let dir = repo("added");
    let before = snapshot(&dir).unwrap();
    std::fs::write(dir.join("new.ts"), "new\n").unwrap();
    let after = since(&dir, &before).unwrap().after;
    assert_eq!(undo(&dir, &before, &after).unwrap().restored, ["new.ts"]);
    assert!(!dir.join("new.ts").exists());
}

#[test]
fn the_companys_records_are_never_the_steps_work_nor_undone() {
    let dir = repo("records");
    std::fs::create_dir_all(dir.join(".company")).unwrap();
    std::fs::write(dir.join(".company/tasks.json"), "[]").unwrap();
    let before = snapshot(&dir).unwrap();
    std::fs::write(dir.join("new.ts"), "new\n").unwrap();
    std::fs::write(dir.join(".company/tasks.json"), "[{\"id\":\"done\"}]").unwrap();
    std::fs::write(dir.join(".company/log.json"), "[]").unwrap();
    let changes = since(&dir, &before).unwrap();
    assert_eq!(changes.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["new.ts"]);
    assert_eq!(undo(&dir, &before, &changes.after).unwrap().restored, ["new.ts"]);
    assert_eq!(std::fs::read_to_string(dir.join(".company/tasks.json")).unwrap(), "[{\"id\":\"done\"}]");
    assert!(dir.join(".company/log.json").exists());
}

#[test]
fn paths_and_tree_ids_from_the_webview_are_checked() {
    assert!(valid_tree(&"a".repeat(40)) && valid_tree(&"0f".repeat(32)));
    for bad in ["HEAD", "main", &"A".repeat(40), &"a".repeat(39)] {
        assert!(!valid_tree(bad), "{bad}");
    }
    assert!(valid_path("src/theme.ts"));
    for bad in ["", "/etc/passwd", "../x", "a/../../x", "-p", "./x"] {
        assert!(!valid_path(bad), "{bad}");
    }
}
