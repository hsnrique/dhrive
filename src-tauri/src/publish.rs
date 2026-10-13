use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

// Putting a company's website on the web, at <name>.dhrive.site: build its static export on this
// Mac, pack the out/ folder, and hand it to dhrive's site host with the account token the app
// already keeps. The name is the company's folder name; the host gives it to whoever publishes it
// first.

const BUILD_LIMIT: Duration = Duration::from_secs(600);
const MAX_UPLOAD: usize = 50 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct Published {
    url: String,
}

// dhrive's own site host unless a build says otherwise (a host on this Mac, while working on it), so
// a plain `cargo tauri dev` publishes like a release. Whose site it is, the host decides from the
// account token, so a development build can't publish anything its owner couldn't.
const SITES: &str = "https://dhrive.site";

fn host_from(set: Option<&'static str>) -> Option<&'static str> {
    Some(set.unwrap_or(SITES)).filter(|url| crate::account::allowed_server(url))
}

pub(crate) fn host() -> Option<&'static str> {
    host_from(option_env!("DHRIVE_SITES_URL"))
}

// Enough of the end of a failed build for its agent to see the real error, not just the summary.
const TAIL_LINES: usize = 60;

fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(TAIL_LINES)..].join("\n")
}

// The first line of every failed build's message, which the app recognizes to offer a fix.
pub(crate) const DIDNT_BUILD: &str = "The website didn't build:";

// The project's own build script; a static export writes out/. Its output goes to a file, not a
// pipe: nothing reads a pipe while the build runs, and a chatty build would fill one and hang. It
// gets the company's public variables only (env::public): what's built goes to every visitor.
fn build(folder: &Path, env: &[(String, String)]) -> Result<(), String> {
    let install = if folder.join("node_modules").is_dir() { "" } else { "npm install && " };
    // One file per build: two companies can build at once.
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let log_path = std::env::temp_dir().join(format!("dhrive-build-{}-{stamp}.log", std::process::id()));
    let log = std::fs::File::create(&log_path).map_err(|e| format!("Couldn't build the website: {e}"))?;
    let mut child = Command::new("/bin/sh")
        .args(["-c", &format!("{install}npm run build 2>&1")])
        .current_dir(folder)
        .envs(env.iter().map(|(name, value)| (name, value)))
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Couldn't build the website: {e}"))?;
    let started = Instant::now();
    while child.try_wait().map_err(|e| e.to_string())?.is_none() {
        if started.elapsed() > BUILD_LIMIT {
            let _ = child.kill();
            return Err("Building the website took over 10 minutes and was stopped.".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let said = std::fs::read(&log_path).map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).unwrap_or_default();
    let _ = std::fs::remove_file(&log_path);
    if !status.success() {
        return Err(format!("{DIDNT_BUILD}\n{}", tail(&said)));
    }
    exported(folder)
}

fn exported(folder: &Path) -> Result<(), String> {
    if !folder.join("out/index.html").is_file() {
        return Err(format!("{DIDNT_BUILD}\nThe build didn't write a static site: next.config needs output: \"export\"."));
    }
    Ok(())
}

fn pack(folder: &Path) -> Result<Vec<u8>, String> {
    let out = folder.join("out");
    exported(folder)?;
    let packed = Command::new("/usr/bin/tar").args(["-C"]).arg(&out).args(["-czf", "-", "."]).output().map_err(|e| e.to_string())?;
    if !packed.status.success() {
        return Err("Couldn't pack the website.".into());
    }
    if packed.stdout.len() > MAX_UPLOAD {
        return Err("The website is over 50 MB packed, more than a site can be.".into());
    }
    Ok(packed.stdout)
}

async fn upload(host: &str, name: &str, token: &str, body: Vec<u8>) -> Result<String, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
    let response = client.post(format!("{host}/api/sites/{name}")).bearer_auth(token).body(body).send().await.map_err(|_| "Couldn't reach dhrive's site host. Check your connection and try again.")?;
    let ok = response.status().is_success();
    let said: serde_json::Value = response.json().await.unwrap_or_default();
    match said["url"].as_str() {
        Some(url) if ok && url.starts_with("https://") => Ok(url.to_string()),
        _ => Err(said["error"].as_str().unwrap_or("The site host didn't take the website. Try again.").chars().take(300).collect()),
    }
}

// Building alone, before publishing, so whatever breaks the build shows up while there's time to fix
// it, not at the moment of going live.
#[tauri::command]
pub async fn build_site(app: tauri::AppHandle, project: String) -> Result<(), String> {
    let folder = crate::terminal::project_folder(&app, &project)?;
    let env = crate::env::public(crate::env::of_project(&project));
    tauri::async_runtime::spawn_blocking(move || build(&folder, &env)).await.map_err(|e| e.to_string())?
}

// The name a company's site lives under: its folder's.
pub(crate) fn site_name(folder: &Path) -> String {
    crate::founding::slug(&folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

#[tauri::command]
pub async fn publish_site(app: tauri::AppHandle, project: String) -> Result<Published, String> {
    let host = host().ok_or("Publishing isn't set up in this build of dhrive.")?;
    let token = crate::account::store::read_token().ok_or("Sign in to dhrive to publish.")?;
    let folder = crate::terminal::project_folder(&app, &project)?;
    let name = site_name(&folder);
    let env = crate::env::public(crate::env::of_project(&project));
    let packed = tauri::async_runtime::spawn_blocking(move || build(&folder, &env).and_then(|_| pack(&folder))).await.map_err(|e| e.to_string())??;
    Ok(Published { url: upload(host, &name, &token, packed).await? })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishing_goes_to_dhrive_s_host_unless_a_build_names_another() {
        assert_eq!(host_from(None), Some("https://dhrive.site"));
        assert_eq!(host_from(Some("http://localhost:8080")), Some("http://localhost:8080"));
        assert_eq!(host_from(Some("ftp://elsewhere")), None);
    }

    #[test]
    fn a_build_that_writes_no_static_site_says_how_to_fix_it() {
        let dir = std::env::temp_dir().join(format!("dhrive-publish-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts": {"build": "echo built"}}"#).unwrap();
        let missing = build(&dir, &[]).unwrap_err();
        assert!(missing.starts_with(DIDNT_BUILD) && missing.contains("output: \"export\""));
        std::fs::create_dir_all(dir.join("out")).unwrap();
        std::fs::write(dir.join("out/index.html"), "<h1>hi</h1>").unwrap();
        // Far more output than a pipe holds: the build still finishes.
        std::fs::write(dir.join("package.json"), r#"{"scripts": {"build": "yes building | head -c 400000"}}"#).unwrap();
        build(&dir, &[]).unwrap();
        let packed = pack(&dir).unwrap();
        assert_eq!(&packed[..2], &[0x1f, 0x8b], "gzip");
        std::fs::write(dir.join("package.json"), r#"{"scripts": {"build": "printf %s \"$NEXT_PUBLIC_GREETING\" > out/index.html"}}"#).unwrap();
        build(&dir, &[("NEXT_PUBLIC_GREETING".into(), "hello".into())]).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("out/index.html")).unwrap(), "hello", "the build reads what it was given");
        std::fs::write(dir.join("package.json"), r#"{"scripts": {"build": "echo Type error in page.tsx && exit 1"}}"#).unwrap();
        assert!(build(&dir, &[]).unwrap_err().contains("Type error in page.tsx"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
