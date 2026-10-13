use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::versions::{call, client, refused, Call, UNREACHABLE};

// A company's own domains on dhrive's site host: add one, check whether its DNS points there yet,
// remove it. The host answers each with the site's domains and the DNS records to set; going live can
// wait on a certificate for up to a minute, so these calls wait longer than the others.

const WAIT: Duration = Duration::from_secs(90);

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct Connected {
    domain: String,
    live: bool,
    // For the domain just added or checked, what its DNS still lacks, said the way to fix it.
    #[serde(default)]
    waiting: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct Record {
    kind: String,
    value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SiteDomains {
    domains: Vec<Connected>,
    records: Vec<Record>,
}

// The typed domain goes in as one path segment, escaped; the host decides whether it's a domain.
fn url(host: &str, name: &str, rest: &[&str]) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(host).map_err(|e| e.to_string())?;
    url.path_segments_mut().map_err(|_| "dhrive's site host address is wrong in this build.")?.extend(["api", "sites", name, "domains"]).extend(rest);
    Ok(url)
}

async fn answer(response: reqwest::Response) -> Result<SiteDomains, String> {
    match response.status().as_u16() {
        200 => response.json().await.map_err(|_| "The site host answered oddly. Try again.".into()),
        _ => Err(refused(response).await),
    }
}

#[tauri::command]
pub async fn site_domains(app: tauri::AppHandle, project: String) -> Result<SiteDomains, String> {
    let Call { host, name, token } = call(&app, &project)?;
    answer(client(WAIT)?.get(url(host, &name, &[])?).bearer_auth(token).send().await.map_err(|_| UNREACHABLE)?).await
}

#[tauri::command]
pub async fn add_site_domain(app: tauri::AppHandle, project: String, domain: String) -> Result<SiteDomains, String> {
    let Call { host, name, token } = call(&app, &project)?;
    let body = serde_json::json!({ "domain": domain.chars().take(260).collect::<String>() });
    answer(client(WAIT)?.post(url(host, &name, &[])?).bearer_auth(token).json(&body).send().await.map_err(|_| UNREACHABLE)?).await
}

#[tauri::command]
pub async fn check_site_domain(app: tauri::AppHandle, project: String, domain: String) -> Result<SiteDomains, String> {
    let Call { host, name, token } = call(&app, &project)?;
    answer(client(WAIT)?.post(url(host, &name, &[&domain, "check"])?).bearer_auth(token).send().await.map_err(|_| UNREACHABLE)?).await
}

#[tauri::command]
pub async fn remove_site_domain(app: tauri::AppHandle, project: String, domain: String) -> Result<SiteDomains, String> {
    let Call { host, name, token } = call(&app, &project)?;
    answer(client(WAIT)?.delete(url(host, &name, &[&domain])?).bearer_auth(token).send().await.map_err(|_| UNREACHABLE)?).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_a_domain_still_lacks_comes_through_and_an_older_host_s_answer_still_reads() {
        let said: SiteDomains = serde_json::from_str(r#"{"domains": [{"domain": "acme.com", "live": false, "waiting": ["There's no TXT record at _dhrive.acme.com yet."]}, {"domain": "www.acme.com", "live": true}], "records": []}"#).unwrap();
        assert_eq!(said.domains[0].waiting, ["There's no TXT record at _dhrive.acme.com yet."]);
        assert!(said.domains[1].waiting.is_empty());
    }

    #[test]
    fn a_typed_domain_stays_one_escaped_segment() {
        assert_eq!(url("https://dhrive.site", "acme", &["www.acme.com", "check"]).unwrap().as_str(), "https://dhrive.site/api/sites/acme/domains/www.acme.com/check");
        assert_eq!(url("https://dhrive.site", "acme", &["../../x?y"]).unwrap().as_str(), "https://dhrive.site/api/sites/acme/domains/..%2F..%2Fx%3Fy");
    }
}
