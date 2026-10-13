use std::thread;
use std::time::{Duration, Instant};

// AI providers flake: overloads, rate limits, 5xx, and network blips are transient and worth a
// retry instead of failing the whole step. Auth/setup failures and the run timeout are decided by
// the caller before this is consulted, so they never reach here.
pub const MAX_ATTEMPTS: u32 = 3;

const TRANSIENT_MARKERS: &[&str] = &[
    "overloaded",
    "overload",
    "rate limit",
    "rate_limit",
    "ratelimit",
    "too many requests",
    "429",
    "529",
    "service unavailable",
    "bad gateway",
    "internal server error",
    "server error",
    "temporarily unavailable",
    "try again later",
    "please try again",
    "timed out",
    "request timeout",
    "deadline exceeded",
    "connection reset",
    "econnreset",
    "connection error",
    "network error",
    "socket hang up",
    "eai_again",
    "fetch failed",
];

pub fn is_transient_failure(output: &str) -> bool {
    let lower = output.to_lowercase();
    TRANSIENT_MARKERS.iter().any(|marker| lower.contains(marker))
}

// Exponential backoff: 3s, 6s, 12s, … capped at 48s. `attempt` is 1-based and only consulted when
// another attempt will follow.
pub fn backoff_delay(attempt: u32) -> Duration {
    let shift = attempt.saturating_sub(1).min(4);
    Duration::from_secs(3u64 << shift)
}

// Sleep for `total`, but bail early (returning false) the moment the run is stopped,
// so a stop during backoff is honored promptly instead of waiting out the whole delay.
pub fn sleep_unless_cancelled(run_id: &str, total: Duration) -> bool {
    let deadline = Instant::now() + total;
    loop {
        if crate::cancel::is_cancelled(run_id) {
            return false;
        }
        let now = Instant::now();
        if now >= deadline {
            return true;
        }
        thread::sleep((deadline - now).min(Duration::from_millis(100)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_provider_hiccups_are_detected() {
        for case in [
            "Error: Overloaded (529)",
            "API error: 429 too many requests",
            "503 Service Unavailable",
            "request timed out after 60s",
            "fetch failed: ECONNRESET",
            "Internal Server Error",
            "the model is temporarily unavailable, please try again later",
        ] {
            assert!(is_transient_failure(case), "should be transient: {case}");
        }
    }

    #[test]
    fn real_terminal_failures_are_not_transient() {
        for case in [
            "error: cannot find type 'Foo' in scope",
            "Please log in to continue",
            "dhrive: this step ran past 60 minutes and was stopped.",
            "Compilation failed: missing 'func' keyword",
        ] {
            assert!(!is_transient_failure(case), "should not be transient: {case}");
        }
    }

    #[test]
    fn backoff_grows_then_caps() {
        assert_eq!(backoff_delay(1), Duration::from_secs(3));
        assert_eq!(backoff_delay(2), Duration::from_secs(6));
        assert_eq!(backoff_delay(3), Duration::from_secs(12));
        assert!(backoff_delay(2) > backoff_delay(1));
        assert!(backoff_delay(50) <= Duration::from_secs(48));
    }

    #[test]
    fn sleep_bails_immediately_when_cancelled() {
        let run = "retry-backoff-cancel-test";
        crate::cancel::stop(run);
        let started = Instant::now();
        let completed = sleep_unless_cancelled(run, Duration::from_secs(10));
        assert!(!completed, "should report it did not finish the wait");
        assert!(started.elapsed() < Duration::from_secs(1), "should bail promptly");
        crate::cancel::begin(run);
    }

    #[test]
    fn sleep_completes_a_short_uncancelled_wait() {
        let run = "retry-backoff-complete-test";
        crate::cancel::begin(run);
        assert!(sleep_unless_cancelled(run, Duration::from_millis(50)));
    }
}
