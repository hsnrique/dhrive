use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Progress {
    Phase(String),
    Log(String),
    // The CLI's conversation id, sent the moment the CLI names it, so a run that fails or is
    // stopped still leaves its conversation behind to continue.
    Session(String),
    // What a code step changed in the project, as JSON (changes::Changes), sent whether or not the
    // step finished, since a stopped or failed step can leave edits behind too.
    Changes(String),
    // A tool call waiting on the owner's OK, as JSON (approvals::Question).
    Approval(String),
    // A file edit Claude just made, as JSON {path, before, after}, shown live and never saved.
    Edit(String),
}

// Where a running step reports what it's doing. `run_id` is also the key a stop uses (cancel.rs).
pub struct Reporter {
    sink: Box<dyn Fn(Progress) + Send + Sync>,
    run_id: String,
}

impl Reporter {
    pub fn new(run_id: impl Into<String>, sink: impl Fn(Progress) + Send + Sync + 'static) -> Self {
        Self { sink: Box::new(sink), run_id: run_id.into() }
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn phase(&self, label: impl Into<String>) {
        (self.sink)(Progress::Phase(label.into()));
    }

    pub fn log(&self, line: impl Into<String>) {
        (self.sink)(Progress::Log(line.into()));
    }

    pub fn session(&self, id: impl Into<String>) {
        (self.sink)(Progress::Session(id.into()));
    }

    pub fn changes(&self, json: impl Into<String>) {
        (self.sink)(Progress::Changes(json.into()));
    }

    pub fn approval(&self, json: impl Into<String>) {
        (self.sink)(Progress::Approval(json.into()));
    }

    pub fn edit(&self, json: impl Into<String>) {
        (self.sink)(Progress::Edit(json.into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn reporter_forwards_phase_and_log() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let reporter = Reporter::new("test", move |progress| sink.lock().unwrap().push(progress));

        reporter.phase("planning");
        reporter.log("a line");
        reporter.session("s-1");
        reporter.changes("{}");
        reporter.approval("{}");
        reporter.edit("{}");

        assert_eq!(events.lock().unwrap().len(), 6);
    }
}
