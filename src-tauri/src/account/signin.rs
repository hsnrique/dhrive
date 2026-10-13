use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::digest::{digest, SHA256};
use ring::rand::{SecureRandom, SystemRandom};

// The browser half of signing in, as RFC 8252 describes for native apps: dhrive listens on a random
// port of 127.0.0.1, opens dhrive.app/connect, and waits for the browser to come back with a code.
// PKCE binds that code to a verifier only this process knows. One sign-in waits at a time: starting
// another, or cancelling, ends the one before.

const WAIT: Duration = Duration::from_secs(5 * 60);
const POLL: Duration = Duration::from_millis(100);
const MAX_HEAD: usize = 16 * 1024;

static CURRENT: AtomicU64 = AtomicU64::new(0);

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>dhrive</title><body style=\"margin:0;display:grid;place-items:center;min-height:100vh;background:#0c0c0c;color:#f2f2f2;font:16px -apple-system,system-ui,sans-serif\"><p>Signed in. You can close this tab and go back to dhrive.</p>";

pub struct Pending {
    listener: TcpListener,
    pub port: u16,
    pub state: String,
    pub verifier: String,
    pub challenge: String,
}

fn random(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    SystemRandom::new().fill(&mut buffer).map_err(|_| "Couldn't make a random sign-in code.".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

pub fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(digest(&SHA256, verifier.as_bytes()))
}

pub fn begin() -> u64 {
    CURRENT.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn cancel() {
    CURRENT.fetch_add(1, Ordering::SeqCst);
}

impl Pending {
    pub fn new() -> Result<Self, String> {
        let failed = |error: std::io::Error| format!("Couldn't wait for the browser: {error}");
        let listener = TcpListener::bind("127.0.0.1:0").map_err(failed)?;
        listener.set_nonblocking(true).map_err(failed)?;
        let port = listener.local_addr().map_err(failed)?.port();
        let verifier = random(32)?;
        Ok(Self { listener, port, state: random(16)?, challenge: challenge_of(&verifier), verifier })
    }

    // Blocks until the browser brings the code back, five minutes pass, or another sign-in starts.
    pub fn wait(self, generation: u64) -> Result<String, String> {
        let deadline = Instant::now() + WAIT;
        while CURRENT.load(Ordering::SeqCst) == generation {
            if Instant::now() > deadline {
                return Err("Signing in took too long. Try again.".into());
            }
            match self.listener.accept() {
                Ok((stream, _)) => {
                    if let Some(code) = answer(stream, &self.state) {
                        return Ok(code);
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => std::thread::sleep(POLL),
                Err(error) => return Err(format!("Couldn't wait for the browser: {error}")),
            }
        }
        Err("Sign-in cancelled.".into())
    }
}

// One request from the browser: the callback carrying our state gets a page saying it's done and
// hands its code over; anything else (a favicon, an old tab) is turned away and the wait goes on.
fn answer(mut stream: TcpStream, state: &str) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let head = read_head(&mut stream)?;
    let code = head.lines().next().and_then(|line| callback_code(line, state));
    let (status, body) = if code.is_some() { ("200 OK", DONE_PAGE) } else { ("404 Not Found", "") };
    let headers = "Content-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close";
    let _ = write!(stream, "HTTP/1.1 {status}\r\n{headers}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
    code
}

// The whole request head, up to the blank line, however many packets it came in. Answering after
// only the first read would close the socket with the rest unread, which the OS turns into a reset
// that can drop the answer before the browser sees it.
fn read_head(stream: &mut TcpStream) -> Option<String> {
    let mut head = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") && head.len() < MAX_HEAD {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        head.extend_from_slice(&chunk[..read]);
    }
    String::from_utf8(head).ok()
}

// "GET /callback?code=…&state=… HTTP/1.1" → the code, when the state is ours and the code is the
// shape dhrive.app makes (base64url parts joined by a dot).
pub fn callback_code(request_line: &str, state: &str) -> Option<String> {
    let query = request_line.strip_prefix("GET /callback?")?.split(' ').next()?;
    let value = |name: &str| query.split('&').find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='));
    let code = value("code").filter(|c| !c.is_empty() && c.len() <= 2048 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)))?;
    (value("state")? == state).then(|| code.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_callback_gives_its_code_only_with_our_state() {
        assert_eq!(callback_code("GET /callback?code=ab.cd&state=s1 HTTP/1.1", "s1").as_deref(), Some("ab.cd"));
        assert_eq!(callback_code("GET /callback?state=s1&code=ab.cd HTTP/1.1", "s1").as_deref(), Some("ab.cd"), "any order");
        for line in ["GET /callback?code=ab.cd&state=s2 HTTP/1.1", "GET /callback?code=ab.cd HTTP/1.1", "GET /favicon.ico HTTP/1.1", "POST /callback?code=ab.cd&state=s1 HTTP/1.1", "GET /callback?code=<script>&state=s1 HTTP/1.1", "GET /callback?code=&state=s1 HTTP/1.1", "GET /callback?xcode=ab&state=s1 HTTP/1.1"] {
            assert_eq!(callback_code(line, "s1"), None, "{line}");
        }
    }

    #[test]
    fn the_verifier_is_random_and_the_challenge_is_its_sha256() {
        let pending = Pending::new().unwrap();
        assert_eq!((pending.verifier.len(), pending.state.len(), pending.challenge.len()), (43, 22, 43));
        assert_ne!(pending.verifier, Pending::new().unwrap().verifier);
        // RFC 7636, appendix B.
        assert_eq!(challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
