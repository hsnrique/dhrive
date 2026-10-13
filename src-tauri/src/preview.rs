use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::process::Command;

// The dev servers a project is running: the ports this Mac listens on locally whose process was
// started from inside the project's folder (`npm run dev` in its terminal, or a step that ran it).
// lsof answers both questions, so the browser tab finds the right port without being told.

const MAX_PORTS: usize = 8;

fn lsof(args: &[&str]) -> String {
    Command::new("/usr/sbin/lsof").args(args).output().map(|out| String::from_utf8_lossy(&out.stdout).into_owned()).unwrap_or_default()
}

// `lsof -F pn` prints a "p<pid>" line, then one "n<name>" line per file of that process.
fn by_process(output: &str) -> HashMap<u32, Vec<String>> {
    let mut found: HashMap<u32, Vec<String>> = HashMap::new();
    let mut pid = None;
    for line in output.lines() {
        match line.split_at_checked(1) {
            Some(("p", id)) => pid = id.parse().ok(),
            Some(("n", name)) => {
                if let Some(pid) = pid {
                    found.entry(pid).or_default().push(name.to_string());
                }
            }
            _ => {}
        }
    }
    found
}

// "127.0.0.1:3000", "*:5173", "[::1]:8080" → the port, for addresses a browser here can reach.
fn local_port(address: &str) -> Option<u16> {
    let (host, port) = address.rsplit_once(':')?;
    ["*", "127.0.0.1", "localhost", "[::1]", "[::]"].contains(&host).then(|| port.parse().ok()).flatten()
}

fn ports_in(listening: &HashMap<u32, Vec<String>>, cwds: &HashMap<u32, Vec<String>>, folder: &Path) -> Vec<u16> {
    let inside = |pid: &u32| cwds.get(pid).into_iter().flatten().any(|cwd| Path::new(cwd).starts_with(folder));
    let ports: BTreeSet<u16> = listening.iter().filter(|(pid, _)| inside(pid)).flat_map(|(_, names)| names.iter().filter_map(|n| local_port(n))).collect();
    ports.into_iter().take(MAX_PORTS).collect()
}

#[tauri::command]
pub async fn dev_servers(folder: String) -> Result<Vec<u16>, String> {
    let folder = Path::new(&folder).canonicalize().ok().filter(|f| f.is_dir()).ok_or("That project folder isn't there anymore.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let listening = by_process(&lsof(&["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]));
        if listening.is_empty() {
            return Vec::new();
        }
        let pids = listening.keys().map(u32::to_string).collect::<Vec<_>>().join(",");
        let cwds = by_process(&lsof(&["-a", "-d", "cwd", "-p", &pids, "-Fpn"]));
        ports_in(&listening, &cwds, &folder)
    })
    .await
    .map_err(|error| format!("Couldn't look for dev servers: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_ports_of_processes_started_in_the_project_count() {
        let listening = by_process("p10\nf9\nn*:5173\nf10\nn[::1]:5173\np11\nf3\nn127.0.0.1:3000\np12\nf4\nn192.168.0.4:8080\np13\nf4\nn*:7000\n");
        let cwds = by_process("p10\nfcwd\nn/Users/ana/shop/web\np11\nfcwd\nn/Users/ana/shop\np12\nfcwd\nn/Users/ana/shop\np13\nfcwd\nn/Users/ana/shopping\n");
        assert_eq!(ports_in(&listening, &cwds, Path::new("/Users/ana/shop")), [3000, 5173]);
        assert!(ports_in(&listening, &cwds, Path::new("/Users/ana/blog")).is_empty());
    }

    #[test]
    fn reads_the_port_of_reachable_addresses_only() {
        assert_eq!(local_port("*:5173"), Some(5173));
        assert_eq!(local_port("[::1]:8080"), Some(8080));
        assert_eq!(local_port("10.0.0.2:3000"), None);
        assert_eq!(local_port("garbage"), None);
    }
}
