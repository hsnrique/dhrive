use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::ModelOption;

const TIMEOUT: Duration = Duration::from_secs(20);

// `agy models` asks Google for the models this account can use, one "id<TAB>name" per line.
pub fn fetch(program: &Path) -> Result<Vec<ModelOption>, String> {
    let models = parse(&listing(program)?);
    if models.len() <= 1 {
        return Err("Antigravity listed no models.".into());
    }
    Ok(models)
}

fn listing(program: &Path) -> Result<String, String> {
    let mut child = Command::new(program).arg("models").current_dir(std::env::temp_dir()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|error| format!("Couldn't start agy: {error}"))?;
    let mut stdout = child.stdout.take().ok_or("agy gave no output.")?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    while child.try_wait().map_err(|error| error.to_string())?.is_none() {
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Antigravity took too long to list its models.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    reader.join().map_err(|_| "Couldn't read agy's answer.".to_string())
}

// The "no --model" choice first, then every listed model; anything else it prints (a "Fetching…"
// line, a notice) has no tab and is skipped.
pub fn parse(listing: &str) -> Vec<ModelOption> {
    let listed = listing.lines().filter_map(|line| line.split_once('\t')).map(|(id, name)| (id.trim(), name.trim())).filter(|(id, _)| crate::flow::valid_model(id));
    std::iter::once(ModelOption::new("", "Default", Some("Antigravity's default"))).chain(listed.map(|(id, name)| ModelOption::new(id, if name.is_empty() { id } else { name }, None))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_each_model_after_the_default() {
        let models = parse("Fetching available models...\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n");
        assert_eq!(models[0], ModelOption::new("", "Default", Some("Antigravity's default")));
        assert_eq!(models[1], ModelOption::new("gemini-3.1-pro-high", "Gemini 3.1 Pro (High)", None));
        assert_eq!(models.len(), 3);
    }

    #[test]
    fn an_id_a_model_never_has_is_dropped() {
        assert_eq!(parse("--yolo\tSneaky\n").len(), 1);
    }

    #[test]
    #[ignore = "asks the real Antigravity, signed in"]
    fn the_installed_antigravity_lists_its_models() {
        let models = fetch(&crate::engine::Engine::Antigravity.locate().unwrap()).unwrap();
        assert!(models.len() > 1, "{models:?}");
    }
}
