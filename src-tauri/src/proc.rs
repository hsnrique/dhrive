use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::CommandExt;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::progress::Reporter;

pub struct StreamOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

// Transforms a raw output line into what the live log should show — `None` hides the line
// (e.g. agent stream-json noise) while it's still captured in the buffer for parsing.
pub type LineMap = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

// Takes the child's stdin right after it starts, for a CLI that is spoken to while it runs.
pub type Feed = Box<dyn FnOnce(ChildStdin) + Send>;

#[cfg(test)]
fn passthrough() -> LineMap {
    Arc::new(|line: &str| Some(line.to_string()))
}

// A CLI's own diagnostics ("2026-10-08T14:15:54.149Z ERROR rmcp::transport::worker: ...") are for
// its developers, not the owner watching the run: they stay in the buffer a failure is read from,
// but not in the live log.
fn internal(line: &str) -> bool {
    let mut words = line.split_whitespace();
    let stamped = words.next().is_some_and(|w| w.len() >= 20 && w.as_bytes()[4] == b'-' && w.contains('T') && w.ends_with('Z'));
    stamped && words.next().is_some_and(|level| ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"].contains(&level))
}

fn plain() -> LineMap {
    Arc::new(|line: &str| (!internal(line)).then(|| line.to_string()))
}

// Hard cap so a stuck CLI can never leave the UI "running" forever — it's killed and reported as
// failed. Long enough for a real coding task; the user can stop sooner.
const MAX_RUN: Duration = Duration::from_secs(60 * 60);

// Trailing-output window after the child exits. A CLI can leave a grandchild alive — e.g. a dev
// server it started — holding the inherited pipe open, so the drain threads would block on EOF
// forever. We return as
// soon as the child itself exits, waiting only this long to flush any final lines.
const DRAIN_GRACE: Duration = Duration::from_millis(750);

pub fn run_streaming(
    mut command: Command,
    reporter: Arc<Reporter>,
    log_line: LineMap,
    feed: Option<Feed>,
) -> std::io::Result<StreamOutput> {
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.stdin(if feed.is_some() { Stdio::piped() } else { Stdio::null() });
    // Own process group so a stop can kill the child plus everything it spawns.
    command.process_group(0);
    let mut child = command.spawn()?;
    if let (Some(feed), Some(stdin)) = (feed, child.stdin.take()) {
        feed(stdin);
    }
    let pid = child.id();
    let run_id = reporter.run_id().to_string();
    crate::cancel::register(&run_id, pid);

    let out_buffer = Arc::new(Mutex::new(String::new()));
    let err_buffer = Arc::new(Mutex::new(String::new()));
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    // Drain both pipes on their own threads so a full pipe buffer never deadlocks the child.
    // stdout may be agent stream-json (humanized by `log_line`); stderr is plain — pass it through.
    let (done_tx, done_rx) = mpsc::channel();
    drain(stdout, reporter.clone(), out_buffer.clone(), done_tx.clone(), log_line);
    drain(stderr, reporter.clone(), err_buffer.clone(), done_tx, plain());

    let deadline = Instant::now() + MAX_RUN;
    let (success, timed_out) = loop {
        match child.try_wait()? {
            Some(status) => break (status.success(), false),
            None => {
                if Instant::now() >= deadline {
                    // process_group(0) → pgid == pid; kill the whole group, then reap.
                    let _ = Command::new("/bin/kill").arg("-9").arg(format!("-{pid}")).status();
                    let _ = child.wait();
                    break (false, true);
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    };
    wait_for_drains(&done_rx);
    crate::cancel::unregister(&run_id, pid);

    let mut stderr = clone_string(&err_buffer);
    if timed_out {
        stderr.push_str("\ndhrive: this step ran past 60 minutes and was stopped.");
    }
    Ok(StreamOutput {
        success,
        stdout: clone_string(&out_buffer),
        stderr,
    })
}

fn wait_for_drains(done: &mpsc::Receiver<()>) {
    let deadline = Instant::now() + DRAIN_GRACE;
    let mut finished = 0;
    while finished < 2 {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match done.recv_timeout(remaining) {
            Ok(()) => finished += 1,
            Err(_) => break,
        }
    }
}

// Even after filtering, output can arrive in tight bursts. Coalesce shown lines and flush at
// most every `LOG_FLUSH_INTERVAL` (or once a batch reaches `LOG_BATCH_BYTES`), so the live log
// can never drown the webview in one-event-per-line IPC traffic and freeze the UI.
const LOG_BATCH_BYTES: usize = 4096;
const LOG_FLUSH_INTERVAL: Duration = Duration::from_millis(100);

fn drain<R: Read + Send + 'static>(
    reader: R,
    reporter: Arc<Reporter>,
    buffer: Arc<Mutex<String>>,
    done: mpsc::Sender<()>,
    log_line: LineMap,
) {
    thread::spawn(move || {
        let mut batch = String::new();
        let mut last_flush = Instant::now();
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(shown) = log_line(&line) {
                if !batch.is_empty() {
                    batch.push('\n');
                }
                batch.push_str(&shown);
                if batch.len() >= LOG_BATCH_BYTES || last_flush.elapsed() >= LOG_FLUSH_INTERVAL {
                    reporter.log(batch.as_str());
                    batch.clear();
                    last_flush = Instant::now();
                }
            }
            // The raw line is always kept for parsing, even when hidden from the live log.
            if let Ok(mut buffer) = buffer.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
        if !batch.is_empty() {
            reporter.log(batch.as_str());
        }
        let _ = done.send(());
    });
}

fn clone_string(buffer: &Arc<Mutex<String>>) -> String {
    buffer.lock().map(|guard| guard.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cli_s_own_diagnostics_stay_out_of_the_live_log() {
        assert!(internal("2026-10-08T14:15:54.149102Z ERROR rmcp::transport::worker: worker quit"));
        assert!(internal("2026-10-08T14:15:54Z  WARN codex_core::mcp: slow"));
        assert!(!internal("Approval mode overridden because the current folder is not trusted."));
        assert!(!internal("2026-10-08 was a good day"));
        assert_eq!(plain()("ERROR: the build failed").as_deref(), Some("ERROR: the build failed"));
    }

    #[test]
    fn streams_lines_and_captures_stdout() {
        let shown = Arc::new(Mutex::new(String::new()));
        let sink = shown.clone();
        let reporter = Arc::new(Reporter::new("test", move |progress| {
            if let crate::progress::Progress::Log(line) = progress {
                sink.lock().unwrap().push_str(&line);
            }
        }));

        let mut command = Command::new("printf");
        command.arg("alpha\nbeta\n");
        let output = run_streaming(command, reporter, passthrough(), None).unwrap();

        assert!(output.success);
        assert!(output.stdout.contains("alpha"));
        assert!(output.stdout.contains("beta"));
        // Both lines reach the live log (coalesced into one or more batched events).
        let shown = shown.lock().unwrap();
        assert!(shown.contains("alpha") && shown.contains("beta"));
    }

    #[test]
    fn a_fed_child_reads_what_is_written_to_it() {
        use std::io::Write;
        let reporter = Arc::new(Reporter::new("test-feed", |_| {}));
        let feed: Feed = Box::new(|mut stdin| {
            writeln!(stdin, "hello from dhrive").unwrap();
        });
        let output = run_streaming(Command::new("cat"), reporter, passthrough(), Some(feed)).unwrap();
        assert_eq!(output.stdout, "hello from dhrive\n");
    }
}
