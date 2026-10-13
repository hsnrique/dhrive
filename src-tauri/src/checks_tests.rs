use super::*;

fn project(name: &str, scripts: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("dhrive-checks-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("node_modules")).unwrap();
    std::fs::write(dir.join("package.json"), format!(r#"{{"name": "t", "scripts": {scripts}}}"#)).unwrap();
    dir
}

fn quiet() -> Reporter {
    Reporter::new("checks-test", |_| {})
}

#[test]
fn a_project_without_package_json_has_nothing_to_check() {
    let dir = std::env::temp_dir().join(format!("dhrive-checks-none-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(matches!(run(&dir, &[], "c0", &quiet()).unwrap(), Report::Skipped { .. }));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn only_documents_changed_is_skipped_but_code_is_checked() {
    let dir = project("docs", r#"{"lint": "echo fine"}"#);
    let git = |args: &[&str]| assert!(Command::new("git").arg("-C").arg(&dir).args(args).output().unwrap().status.success(), "{args:?}");
    git(&["init", "-q"]);
    git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start"]);
    std::fs::write(dir.join(".gitignore"), "node_modules\n").unwrap();
    git(&["add", "-A"]);
    git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base"]);
    std::fs::create_dir_all(dir.join("docs")).unwrap();
    std::fs::write(dir.join("docs/mission.md"), "# Mission").unwrap();
    assert!(matches!(run(&dir, &[], "c1", &quiet()).unwrap(), Report::Skipped { .. }), "documents only");
    std::fs::write(dir.join("page.tsx"), "export {}").unwrap();
    assert!(matches!(run(&dir, &[], "c1", &quiet()).unwrap(), Report::Ran { .. }), "code changed");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn each_script_present_runs_and_a_failure_keeps_what_it_said() {
    let dir = project("run", r#"{"lint": "echo lint is clean", "test": "printf '\u001b[31mexpected 2, got 3\u001b[0m\\n' && exit 1"}"#);
    let Report::Ran { checks, missing } = run(&dir, &[("DHRIVE_SEEN".into(), "yes".into())], "c2", &quiet()).unwrap() else { panic!("should run") };
    assert_eq!(checks.iter().map(|c| (c.name.as_str(), c.ok)).collect::<Vec<_>>(), [("lint", true), ("test", false)]);
    assert!(checks[1].tail.contains("expected 2, got 3") && !checks[1].tail.contains('\x1b'), "{:?}", checks[1].tail);
    assert_eq!(missing, ["typecheck", "build"]);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_company_environment_reaches_the_checks() {
    let dir = project("env", r#"{"lint": "test \"$DHRIVE_SEEN\" = yes"}"#);
    let Report::Ran { checks, .. } = run(&dir, &[("DHRIVE_SEEN".into(), "yes".into())], "c3", &quiet()).unwrap() else { panic!("should run") };
    assert!(checks[0].ok);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_stop_takes_a_running_check_down() {
    let dir = project("stop", r#"{"test": "sleep 30"}"#);
    crate::cancel::begin("c4");
    let stopper = std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(600));
        crate::cancel::stop("c4");
    });
    let started = Instant::now();
    assert_eq!(run(&dir, &[], "c4", &quiet()).unwrap_err(), "Stopped.");
    assert!(started.elapsed() < Duration::from_secs(10), "it didn't wait for the sleep");
    stopper.join().unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}
