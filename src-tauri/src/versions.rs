use std::time::Duration;

use serde::{Deserialize, Serialize};

// A company's published versions, as dhrive's site host keeps them: the last ten publishes, which one
// is live, and putting an earlier one back. Same host and account token as publishing.

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct Release {
    at: u64,
    live: bool,
}

#[derive(Deserialize)]
struct Releases {
    releases: Vec<Release>,
}

pub(crate) struct Call {
    pub host: &'static str,
    pub name: String,
    pub token: String,
}

pub(crate) fn call(app: &tauri::AppHandle, project: &str) -> Result<Call, String> {
    let host = crate::publish::host().ok_or("Publishing isn't set up in this build of dhrive.")?;
    let token = crate::account::store::read_token().ok_or("Sign in to dhrive to see your website's versions.")?;
    let folder = crate::terminal::project_folder(app, project)?;
    Ok(Call { host, name: crate::publish::site_name(&folder), token })
}

pub(crate) fn client(wait: Duration) -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().timeout(wait).build().map_err(|e| e.to_string())
}

const QUICK: Duration = Duration::from_secs(20);
pub(crate) const UNREACHABLE: &str = "Couldn't reach dhrive's site host. Check your connection and try again.";

// What the host said when it refused, kept short; a site never published has no versions yet.
pub(crate) async fn refused(response: reqwest::Response) -> String {
    let said: serde_json::Value = response.json().await.unwrap_or_default();
    said["error"].as_str().unwrap_or("The site host didn't answer as expected. Try again.").chars().take(300).collect()
}

async fn releases_of(Call { host, name, token }: &Call) -> Result<Vec<Release>, String> {
    let response = client(QUICK)?.get(format!("{host}/api/sites/{name}/releases")).bearer_auth(token).send().await.map_err(|_| UNREACHABLE)?;
    match response.status().as_u16() {
        200 => Ok(response.json::<Releases>().await.map_err(|_| "The site host answered oddly. Try again.")?.releases),
        404 => Ok(Vec::new()),
        _ => Err(refused(response).await),
    }
}

#[tauri::command]
pub async fn site_releases(app: tauri::AppHandle, project: String) -> Result<Vec<Release>, String> {
    releases_of(&call(&app, &project)?).await
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Live {
    url: String,
    at: u64,
}

// Where the host serves a site: its name under the host's own domain, as a publish answers.
fn site_url(host: &str, name: &str) -> Option<String> {
    let host = reqwest::Url::parse(host).ok().filter(|url| url.scheme() == "https")?;
    Some(format!("https://{name}.{}", host.host_str()?))
}

// Whether the company's site is live, and since when, as the host knows it. The app asks each time a
// company opens instead of trusting what one webview remembered: an install that never published it
// (the release beside a development build, a second Mac, cleared storage) must show it the same.
#[tauri::command]
pub async fn site_published(app: tauri::AppHandle, project: String) -> Result<Option<Live>, String> {
    let call = call(&app, &project)?;
    match releases_of(&call).await?.into_iter().find(|release| release.live) {
        None => Ok(None),
        Some(release) => Ok(Some(Live { url: site_url(call.host, &call.name).ok_or("This build's site host has no public address.")?, at: release.at })),
    }
}

#[tauri::command]
pub async fn make_release_live(app: tauri::AppHandle, project: String, at: u64) -> Result<(), String> {
    let Call { host, name, token } = call(&app, &project)?;
    let response = client(QUICK)?.post(format!("{host}/api/sites/{name}/releases/{at}")).bearer_auth(token).send().await.map_err(|_| UNREACHABLE)?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(refused(response).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_live_site_is_served_under_the_host_s_domain() {
        assert_eq!(site_url("https://dhrive.site", "pageparcel").as_deref(), Some("https://pageparcel.dhrive.site"));
        assert_eq!(site_url("http://127.0.0.1:8787", "acme"), None, "a host on this Mac has no public address");
    }

    #[test]
    fn the_host_s_list_reads_as_releases() {
        let read: Releases = serde_json::from_str(r#"{"releases": [{"at": 1791400000000, "live": true}, {"at": 1791300000000, "live": false}]}"#).unwrap();
        assert_eq!(read.releases, [Release { at: 1_791_400_000_000, live: true }, Release { at: 1_791_300_000_000, live: false }]);
    }
}
