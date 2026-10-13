use std::process::{Child, Command};
use std::sync::Mutex;

// While a company works in auto mode the Mac mustn't sleep under it. macOS's own caffeinate holds
// that, tied to this app's pid with -w, so it lets go by itself if dhrive quits or crashes.

static AWAKE: Mutex<Option<Child>> = Mutex::new(None);

fn hold(on: bool, held: &mut Option<Child>) -> Result<(), String> {
    let alive = held.as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None)));
    if on && !alive {
        let child = Command::new("/usr/bin/caffeinate").args(["-i", "-w", &std::process::id().to_string()]).spawn().map_err(|e| format!("Couldn't keep the Mac awake: {e}"))?;
        *held = Some(child);
    } else if !on {
        if let Some(mut child) = held.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn keep_awake(on: bool) -> Result<(), String> {
    let mut held = AWAKE.lock().map_err(|_| "Couldn't keep the Mac awake.".to_string())?;
    hold(on, &mut held)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holding_twice_keeps_one_caffeinate_and_letting_go_ends_it() {
        let mut held = None;
        hold(true, &mut held).unwrap();
        let pid = held.as_ref().unwrap().id();
        hold(true, &mut held).unwrap();
        assert_eq!(held.as_ref().unwrap().id(), pid);
        hold(false, &mut held).unwrap();
        assert!(held.is_none());
    }
}
