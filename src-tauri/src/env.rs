use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::projects::{data_dir, now_millis, read_projects, valid_id};

// A company's environment variables: the keys and settings its code reads, kept in the Keychain as
// one item per company (secrets.rs), never in a file in the project, so they can't reach the repo.
// The names its `.env.example` lists show as missing until they're set. A removed one is held, so
// a slip can be taken back: nothing the owner typed is ever lost to one click.
// ponytail: one Keychain item per company, rewritten whole on each change; fine at a few dozen vars.

const MAX_VARS: usize = 100;
const MAX_NAME: usize = 128;
const MAX_VALUE: usize = 16 * 1024;
const KEPT_REMOVED: usize = 20;
const EXAMPLE: &str = ".env.example";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Var {
    name: String,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Removed {
    name: String,
    value: String,
    at: u64,
}

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
struct Vault {
    vars: Vec<Var>,
    removed: Vec<Removed>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    name: String,
    // The value's last four characters, for telling two keys apart; nothing for a short value.
    hint: String,
    // Built into the website (PUBLIC_PREFIXES), so anyone visiting it can read it.
    public: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvView {
    vars: Vec<Shown>,
    // Named in .env.example and not set yet.
    missing: Vec<String>,
    // Taken out lately and not set again, newest first, so they can be put back.
    removed: Vec<String>,
}

// What a shell and every framework accept as a variable name.
pub fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= MAX_NAME && chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// Set on every process dhrive starts for the company, so these would change how the Mac runs it
// (where programs are found, what gets loaded into them) rather than what the code reads.
const RESERVED: &[&str] = &["PATH", "HOME", "USER", "SHELL", "TMPDIR", "PWD", "TERM", "LANG"];

fn settable(name: &str) -> bool {
    valid_name(name) && !RESERVED.contains(&name) && !name.starts_with("DYLD_") && !name.starts_with("LD_")
}

fn set(vault: &mut Vault, name: &str, value: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("A name is letters, digits and underscores, starting with a letter.".into());
    }
    if !settable(name) {
        return Err(format!("{name} belongs to your Mac, not the company. Pick another name."));
    }
    if value.len() > MAX_VALUE || value.contains('\0') {
        return Err(format!("A value can be up to {} KB of text.", MAX_VALUE / 1024));
    }
    let full = vault.vars.len() >= MAX_VARS;
    match vault.vars.iter_mut().find(|v| v.name == name) {
        Some(var) => var.value = value.to_string(),
        None if full => return Err(format!("A company keeps up to {MAX_VARS} variables.")),
        None => vault.vars.push(Var { name: name.to_string(), value: value.to_string() }),
    }
    Ok(())
}

fn remove(vault: &mut Vault, name: &str, now: u64) -> Result<(), String> {
    let at = vault.vars.iter().position(|v| v.name == name).ok_or("That variable is already gone.")?;
    let Var { name, value } = vault.vars.remove(at);
    vault.removed.insert(0, Removed { name, value, at: now });
    vault.removed.truncate(KEPT_REMOVED);
    Ok(())
}

fn restore(vault: &mut Vault, name: &str) -> Result<(), String> {
    if vault.vars.iter().any(|v| v.name == name) {
        return Err(format!("{name} is set again already."));
    }
    let at = vault.removed.iter().position(|r| r.name == name).ok_or("There's nothing to put back under that name.")?;
    let Removed { name, value, .. } = vault.removed.remove(at);
    set(vault, &name, &value)
}

// The names a `.env.example` lists: `NAME=…` lines, with or without `export`, comments skipped.
fn expected(example: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in example.lines().map(str::trim).filter(|l| !l.starts_with('#')) {
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((name, _)) = line.split_once('=') else { continue };
        let name = name.trim();
        if settable(name) && !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
    }
    names
}

fn hint(value: &str) -> String {
    let count = value.chars().count();
    if count < 12 {
        return String::new();
    }
    value.chars().skip(count - 4).collect()
}

fn view(vault: &Vault, example: &str) -> EnvView {
    let set = |name: &str| vault.vars.iter().any(|v| v.name == name);
    let mut removed: Vec<String> = Vec::new();
    for r in vault.removed.iter().filter(|r| !set(&r.name)) {
        if !removed.contains(&r.name) {
            removed.push(r.name.clone());
        }
    }
    EnvView {
        vars: vault.vars.iter().map(|v| Shown { name: v.name.clone(), hint: hint(&v.value), public: is_public(&v.name) }).collect(),
        missing: expected(example).into_iter().filter(|n| !set(n)).collect(),
        removed,
    }
}

// One change at a time: two edits landing together would each rewrite the item from what it read.
fn lock() -> &'static Mutex<()> {
    static LOCK: Mutex<()> = Mutex::new(());
    &LOCK
}

fn item(project_id: &str) -> Result<String, String> {
    valid_id(project_id).then(|| format!("env-{project_id}")).ok_or_else(|| "That company is gone.".into())
}

// An item that can't be read is never treated as empty: writing over it would lose what's in it.
fn load(item: &str) -> Result<Vault, String> {
    match crate::secrets::read(item) {
        None => Ok(Vault::default()),
        Some(json) => serde_json::from_str(&json).map_err(|_| "The saved variables can't be read, so nothing was changed.".into()),
    }
}

fn folder_of(app: &tauri::AppHandle, project_id: &str) -> Result<String, String> {
    let projects = read_projects(&data_dir(app)?)?;
    projects.into_iter().find(|p| p.id == project_id).map(|p| p.folder).ok_or_else(|| "That company is gone.".into())
}

fn example_in(folder: &str) -> String {
    std::fs::read_to_string(Path::new(folder).join(EXAMPLE)).unwrap_or_default()
}

fn change(app: &tauri::AppHandle, project_id: &str, edit: impl FnOnce(&mut Vault) -> Result<(), String>) -> Result<EnvView, String> {
    let folder = folder_of(app, project_id)?;
    let item = item(project_id)?;
    let _held = lock().lock().map_err(|_| "Try that again.")?;
    let mut vault = load(&item)?;
    edit(&mut vault)?;
    let json = serde_json::to_string(&vault).map_err(|e| e.to_string())?;
    crate::secrets::save(&item, &json).map_err(|error| format!("Couldn't keep it: {error}"))?;
    Ok(view(&vault, &example_in(&folder)))
}

// Each framework's prefix for a value it bakes into what the browser downloads. A published site is
// built with these and nothing else, so no secret ever ships inside it.
const PUBLIC_PREFIXES: &[&str] = &["NEXT_PUBLIC_", "VITE_", "PUBLIC_", "REACT_APP_", "EXPO_PUBLIC_", "NUXT_PUBLIC_", "GATSBY_"];

pub(crate) type Vars = Vec<(String, String)>;

// What a process run for the company on this Mac gets: an agent's run, a terminal, the local site.
// A vault that can't be read gives nothing here; the Environment section says why.
pub(crate) fn of_project(project_id: &str) -> Vars {
    item(project_id).ok().and_then(|item| load(&item).ok()).map(|vault| vault.vars.into_iter().map(|v| (v.name, v.value)).collect()).unwrap_or_default()
}

// The same, for a run that knows its folder: the company whose folder it is.
pub(crate) fn of_folder(app: &tauri::AppHandle, folder: &Path) -> Vars {
    let folder = folder.to_string_lossy();
    let projects = data_dir(app).and_then(|dir| read_projects(&dir)).unwrap_or_default();
    projects.into_iter().find(|p| p.folder == folder).map(|p| of_project(&p.id)).unwrap_or_default()
}

fn is_public(name: &str) -> bool {
    PUBLIC_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

pub(crate) fn public(vars: Vars) -> Vars {
    vars.into_iter().filter(|(name, _)| is_public(name)).collect()
}

// Agents learn the names, never the values, and where a new one goes so the owner sees it missing.
pub(crate) fn prompt_note(vars: &Vars) -> String {
    let set = if vars.is_empty() {
        String::from("No environment variables are set for this company yet.")
    } else {
        let names: Vec<&str> = vars.iter().map(|(name, _)| name.as_str()).collect();
        format!("These environment variables are set for this company, in the process environment: {}. Read them from the environment where the code needs them.", names.join(", "))
    };
    format!("\n\n{set} Never print, log or commit a variable's value, and never write one to a file. When the code needs a new variable, add its name with an empty value to .env.example and say so: the owner sets it in dhrive.")
}

#[tauri::command]
pub fn env_view(app: tauri::AppHandle, project_id: String) -> Result<EnvView, String> {
    let folder = folder_of(&app, &project_id)?;
    Ok(view(&load(&item(&project_id)?)?, &example_in(&folder)))
}

#[tauri::command]
pub fn env_set(app: tauri::AppHandle, project_id: String, name: String, value: String) -> Result<EnvView, String> {
    change(&app, &project_id, |vault| set(vault, name.trim(), &value))
}

#[tauri::command]
pub fn env_remove(app: tauri::AppHandle, project_id: String, name: String) -> Result<EnvView, String> {
    change(&app, &project_id, |vault| remove(vault, &name, now_millis()))
}

#[tauri::command]
pub fn env_restore(app: tauri::AppHandle, project_id: String, name: String) -> Result<EnvView, String> {
    change(&app, &project_id, |vault| restore(vault, &name))
}

// The one way a value leaves the Keychain for the screen: the owner asked to see it.
#[tauri::command]
pub fn env_reveal(project_id: String, name: String) -> Result<String, String> {
    let vault = load(&item(&project_id)?)?;
    vault.vars.into_iter().find(|v| v.name == name).map(|v| v.value).ok_or_else(|| "That variable is gone.".into())
}

#[cfg(test)]
#[path = "env_tests.rs"]
mod tests;
