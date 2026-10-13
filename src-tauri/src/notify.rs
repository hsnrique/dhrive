use tauri_plugin_notification::NotificationExt;

// A request that finished while the owner was in another window, told through macOS notifications.
// The webview decides when; this only shows it, with the text cut to what a banner can hold.

const MAX_CHARS: usize = 200;

fn cut(text: &str) -> String {
    text.chars().take(MAX_CHARS).collect()
}

#[tauri::command]
pub fn notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification().builder().title(cut(&title)).body(cut(&body)).show().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_text_is_cut_on_a_character_boundary() {
        assert_eq!(cut(&"ç".repeat(300)).chars().count(), MAX_CHARS);
        assert_eq!(cut("Done."), "Done.");
    }
}
