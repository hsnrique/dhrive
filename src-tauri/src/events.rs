use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;

use crate::progress::{Progress, Reporter};

pub const PROGRESS_EVENT: &str = "dhrive-progress";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    run_id: String,
    kind: &'static str,
    value: String,
}

pub fn make_reporter(app: &tauri::AppHandle, run_id: String) -> Arc<Reporter> {
    let app = app.clone();
    let emit_id = run_id.clone();
    Arc::new(Reporter::new(run_id, move |progress: Progress| {
        let (kind, value) = match progress {
            Progress::Phase(value) => ("phase", value),
            Progress::Log(value) => ("log", value),
            Progress::Session(value) => ("session", value),
            Progress::Changes(value) => ("changes", value),
            Progress::Approval(value) => ("approval", value),
            Progress::Edit(value) => ("edit", value),
        };
        let _ = app.emit(PROGRESS_EVENT, &ProgressEvent { run_id: emit_id.clone(), kind, value });
    }))
}
