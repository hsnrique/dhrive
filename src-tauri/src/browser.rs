use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

// The browser tab's page, as a native webview laid over the panel's slot in dhrive's window. An
// iframe can't do it: a project with a strict CSP (frame-ancestors 'none') refuses to be framed, and
// a native webview isn't a frame. It only ever shows this Mac's own dev servers and a company's own
// published site (https://<name>.dhrive.site), and as a page outside dhrive's origin it gets no
// access to dhrive's commands.

const LABEL: &str = "preview";
const LOCAL_HOSTS: [&str; 2] = ["localhost", "127.0.0.1"];

fn local(url: &Url) -> bool {
    url.scheme() == "http" && url.host_str().is_some_and(|host| LOCAL_HOSTS.contains(&host)) && url.port().is_some()
}

// One label in front of the sites host, over https: a site dhrive itself serves.
fn published(url: &Url, sites: Option<&str>) -> bool {
    let root = sites.and_then(|s| Url::parse(s).ok()).and_then(|u| u.host_str().map(str::to_string));
    let label = root.and_then(|root| url.host_str()?.strip_suffix(&format!(".{root}")).map(str::to_string));
    url.scheme() == "https" && url.port().is_none() && label.is_some_and(|l| !l.is_empty() && !l.contains('.'))
}

fn shown(url: &Url) -> bool {
    local(url) || published(url, crate::publish::host())
}

fn checked(url: &str) -> Result<Url, String> {
    Url::parse(url).ok().filter(shown).ok_or_else(|| "Only a page this Mac serves, like localhost:3000, or the company's own site.".into())
}

#[derive(serde::Deserialize, Clone, Copy)]
pub struct Slot {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Slot {
    fn sane(self) -> Result<Self, String> {
        let finite = [self.x, self.y, self.width, self.height].iter().all(|v| v.is_finite() && v.abs() < 100_000.0);
        (finite && self.width >= 0.0 && self.height >= 0.0).then_some(self).ok_or_else(|| "That isn't a place on screen.".into())
    }
}

// The page last asked for, kept here rather than read back from the webview: asking WebKit for the
// URL of a webview with none yet (still loading, or a load that failed) panics inside wry, and a
// panic on the main thread takes the whole app down.
static ASKED: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

// Whether `url` is a different page from the one last asked for, remembering it either way.
fn asks_anew(url: &Url) -> bool {
    let Ok(mut asked) = ASKED.lock() else { return true };
    let anew = asked.as_deref() != Some(url.as_str());
    *asked = Some(url.to_string());
    anew
}

fn place(webview: &tauri::Webview, slot: Slot) -> Result<(), String> {
    webview.set_position(LogicalPosition::new(slot.x, slot.y)).map_err(|e| e.to_string())?;
    webview.set_size(LogicalSize::new(slot.width, slot.height)).map_err(|e| e.to_string())
}

// Shows `url` in the slot, making the webview the first time. A link to anywhere else stays in the
// owner's browser instead.
#[tauri::command]
pub fn preview_show(app: tauri::AppHandle, url: String, slot: Slot) -> Result<(), String> {
    let (url, slot) = (checked(&url)?, slot.sane()?);
    if let Some(webview) = app.get_webview(LABEL) {
        if asks_anew(&url) {
            webview.navigate(url).map_err(|e| e.to_string())?;
        }
        place(&webview, slot)?;
        return webview.show().map_err(|e| e.to_string());
    }
    let window = app.get_window("main").ok_or("dhrive's window isn't open.")?;
    asks_anew(&url);
    let opener = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url)).on_navigation(move |to| {
        if shown(to) || to.scheme() == "about" {
            return true;
        }
        let _ = tauri_plugin_opener::OpenerExt::opener(&opener).open_url(to.as_str(), None::<&str>);
        false
    });
    window.add_child(builder, LogicalPosition::new(slot.x, slot.y), LogicalSize::new(slot.width, slot.height)).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_place(app: tauri::AppHandle, slot: Slot) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => place(&webview, slot.sane()?),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn preview_hide(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview(LABEL).map_or(Ok(()), |webview| webview.hide().map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn preview_reload(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview(LABEL).map_or(Ok(()), |webview| webview.reload().map_err(|e| e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_asked_for_again_only_when_it_changes() {
        let (a, b) = (Url::parse("http://localhost:3000/").unwrap(), Url::parse("http://localhost:5173/").unwrap());
        asks_anew(&a);
        assert!(!asks_anew(&a));
        assert!(asks_anew(&b));
        assert!(asks_anew(&a));
    }

    #[test]
    fn only_local_dev_servers_are_shown() {
        assert!(checked("http://localhost:3000/shop").is_ok());
        assert!(checked("http://127.0.0.1:5173/").is_ok());
        for url in ["http://localhost/", "https://localhost:3000/", "http://example.com:3000/", "file:///etc/passwd", "javascript:alert(1)", "http://localhost.evil.test:3000/"] {
            assert!(checked(url).is_err(), "{url}");
        }
    }

    #[test]
    fn a_companys_own_site_on_the_host_is_shown_and_nothing_near_it() {
        let sites = Some("https://dhrive.site");
        assert!(published(&Url::parse("https://acme.dhrive.site/pricing").unwrap(), sites));
        for url in ["https://dhrive.site/", "https://a.b.dhrive.site/", "http://acme.dhrive.site/", "https://acme.dhrive.site:8443/", "https://acme.dhrive.site.evil.test/", "https://evildhrive.site/"] {
            assert!(!published(&Url::parse(url).unwrap(), sites), "{url}");
        }
        assert!(!published(&Url::parse("https://acme.dhrive.site/").unwrap(), None), "a build without publishing");
    }

    #[test]
    fn a_slot_must_be_somewhere_on_screen() {
        assert!(Slot { x: 600.0, y: 90.0, width: 460.0, height: 700.0 }.sane().is_ok());
        assert!(Slot { x: f64::NAN, y: 0.0, width: 1.0, height: 1.0 }.sane().is_err());
        assert!(Slot { x: 0.0, y: 0.0, width: -5.0, height: 1.0 }.sane().is_err());
    }
}
