// Typed wrappers for every backend command. Args use camelCase (Tauri maps them to the Rust
// params). invoke rejects with the backend's Err(String); callers show it, never swallow it.

import { invoke } from "@tauri-apps/api/core";

import type { Thread } from "@/lib/thread";
import type { AccountStatus, Changes, CheckReport, Cli, Committed, Connections, ContextUsage, Conversation, Engine, EnvView, FileView, GitInfo, LocalScan, ModelOption, PastSession, PlanUsage, Project, SearchHit, SessionRef, StepRequest, StepResult, Together, Undo } from "./types";

export const restartApp = () => invoke<void>("restart_app");
export const listClis = () => invoke<Cli[]>("list_clis");
export const listModels = (engine: Engine) => invoke<ModelOption[]>("list_models", { engine });
export const accountStatus = () => invoke<AccountStatus>("account_status");
// Opens dhrive.app in the browser and resolves once the owner has signed in there.
export const signIn = () => invoke<AccountStatus>("sign_in");
export const cancelSignIn = () => invoke<void>("cancel_sign_in");
export const signOut = () => invoke<AccountStatus>("sign_out");
export const planUsage = (engine: Engine) => invoke<PlanUsage>("plan_usage", { engine });
// What a CLI has connected, as seen from a project's folder ("" for none).
export const listConnections = (engine: Engine, folder: string) => invoke<Connections>("list_connections", { engine, folder });
// The owner's instructions for every agent in every project, kept in the app's data folder.
export const readInstructions = () => invoke<string>("read_instructions");
// A project's company brief, its COMPANY.md, read and written whole.
export const readCompany = (project: string) => invoke<string>("read_company", { project });
export const saveCompany = (project: string, text: string) => invoke<void>("save_company", { project, text });
// A company's documents under docs/, each null until its agent writes it.
export type RecordName = "tasks" | "log" | "site" | "connectors" | "agent" | "army";
export const readCompanyRecord = (project: string, name: RecordName) => invoke<unknown>("read_company_record", { project, name });
export const saveCompanyRecord = (project: string, name: RecordName, value: unknown) => invoke<void>("save_company_record", { project, name, value });
export const archiveCompanyRecord = (project: string, name: RecordName, items: unknown[]) => invoke<void>("archive_company_record", { project, name, items });
// `unreadable`: the file is there but dhrive can't read it (too big, another encoding); never "missing".
export const readDocuments = (project: string) => invoke<{ id: string; text: string | null; unreadable?: boolean }[]>("read_documents", { project });
// A company's published versions on dhrive's site host, newest first, and putting one back live.
export const siteReleases = (project: string) => invoke<{ at: number; live: boolean }[]>("site_releases", { project });
export const sitePublished = (project: string) => invoke<{ url: string; at: number } | null>("site_published", { project });
export const makeReleaseLive = (project: string, at: number) => invoke<void>("make_release_live", { project, at });
// Builds the website on this Mac without publishing it; a failed build says why.
export const buildSite = (project: string) => invoke<void>("build_site", { project });
// A company's own domains on the site host, with the DNS records that point one there and prove it's
// the site's (an A record at the host, a TXT at _dhrive naming the site).
export interface SiteDomains {
  // `waiting`: for the domain just added or checked, what its DNS still lacks, a line each.
  domains: { domain: string; live: boolean; waiting?: string[] }[];
  records: { kind: string; value: string | null }[];
}
export const siteDomains = (project: string) => invoke<SiteDomains>("site_domains", { project });
export const addSiteDomain = (project: string, domain: string) => invoke<SiteDomains>("add_site_domain", { project, domain });
export const checkSiteDomain = (project: string, domain: string) => invoke<SiteDomains>("check_site_domain", { project, domain });
export const removeSiteDomain = (project: string, domain: string) => invoke<SiteDomains>("remove_site_domain", { project, domain });
// A company's code on GitHub through the owner's gh: where it stands, saving it there (a private repo
// the first time), and gh's browser sign-in, whose one-time code arrives as "dhrive-github-code".
export interface GitHubState {
  gh: boolean;
  account: string | null;
  repo: string | null;
  changes: number;
}
export const githubState = (project: string) => invoke<GitHubState>("github_state", { project });
export const saveToGithub = (project: string, message?: string) => invoke<string>("save_to_github", { project, message: message ?? null });
export const pendingChanges = (project: string) => invoke<string>("pending_changes", { project });
export const githubSignIn = () => invoke<void>("github_sign_in");
// Keeps the Mac from sleeping while any company works in auto mode.
export const keepAwake = (on: boolean) => invoke<void>("keep_awake", { on });
// A company's website, run on this Mac like an app: Play, Stop, and what it's doing.
export interface SiteState {
  app: boolean;
  running: boolean;
  port: number | null;
  log: string[];
}
export const siteState = (project: string) => invoke<SiteState>("site_state", { project });
export const runSite = (project: string) => invoke<void>("run_site", { project });
export const stopSite = (project: string) => invoke<void>("stop_site", { project });
// Builds the static export and puts it at <name>.dhrive.site; the answer is its address.
export const publishSite = (project: string) => invoke<{ url: string }>("publish_site", { project });
// Founding: an empty folder of dhrive's own for the CLI that names the company, then the company's own.
export const foundingDir = () => invoke<string>("founding_dir");
export const foundCompany = (name: string, brief: string) => invoke<Project>("found_company", { name, brief });
export const saveInstructions = (text: string) => invoke<void>("save_instructions", { text });
export const pickFolder = () => invoke<string | null>("pick_folder");
export const pickFiles = () => invoke<string[]>("pick_files");
export const revealFile = (path: string) => invoke<void>("reveal_file", { path });
// A project's files as paths from its root, and opening one of them (never running it).
export const listFiles = (folder: string) => invoke<string[]>("list_files", { folder });
export const openFile = (folder: string, path: string) => invoke<void>("open_file", { folder, path });
export const readFile = (folder: string, path: string) => invoke<FileView>("read_file", { folder, path });
// With `copy` (the pane's id), the CLI runs in the pane's own worktree; the answer is its branch.
// A task is the CLI's first message; only a pane in its own copy (`copy`) may carry one.
export interface Connector {
  id: string;
  name: string;
  what: string;
  // Its kind, which the menu groups by, and its own home page.
  group: string;
  site: string;
}
export const connectors = () => invoke<Connector[]>("connectors");
// A connector's setup in a terminal: installs its CLI, signs in, adds its skills (connectors.rs).
export const connectorOpen = (id: string, connector: string, project: string, cols: number, rows: number) => invoke<null>("connector_open", { id, connector, project, cols, rows });
// A tool the owner wishes were in the menu, to the dhrive team (suggest.rs).
export const suggestTool = (tool: string, why: string) => invoke<null>("suggest_tool", { tool, why });
export const sendFeedback = (message: string) => invoke<null>("send_feedback", { message });
// In the company's folder, or in an army task's copy (army.rs) when `task` is given.
export const runChecks = (project: string, runId: string, task?: string) => invoke<CheckReport>("run_checks", { project, runId, task: task ?? null });
export type Synced = { kind: "clean" } | { kind: "conflicts"; files: string[] };
// An army task's copy of the company: made, synced with the company's latest, landed, or put away.
export const armyPrepare = (project: string, task: string) => invoke<string>("army_prepare", { project, task });
export const armySync = (project: string, task: string, title: string) => invoke<Synced>("army_sync", { project, task, title });
export const armyLand = (project: string, task: string, title: string) => invoke<void>("army_land", { project, task, title });
export type ArmyChanges = { files: string[]; diff: string };
export const armyChanges = (project: string, task: string, title: string) => invoke<ArmyChanges>("army_changes", { project, task, title });
export const armyDiscard = (project: string, task: string, title: string) => invoke<void>("army_discard", { project, task, title });
export const envView = (projectId: string) => invoke<EnvView>("env_view", { projectId });
export const envSet = (projectId: string, name: string, value: string) => invoke<EnvView>("env_set", { projectId, name, value });
export const envRemove = (projectId: string, name: string) => invoke<EnvView>("env_remove", { projectId, name });
export const envRestore = (projectId: string, name: string) => invoke<EnvView>("env_restore", { projectId, name });
export const envReveal = (projectId: string, name: string) => invoke<string>("env_reveal", { projectId, name });
export const terminalOpen = (id: string, engine: Engine, project: string, copy: string | null, model: string, task: string | null, cols: number, rows: number) =>
  invoke<string | null>("terminal_open", { id, engine, project, copy, model: model || null, task, cols, rows });
export const bringPanesTogether = (project: string, session: string, parts: { pane: string; title: string }[]) => invoke<Together>("bring_panes_together", { project, session, parts });
export const openTogetherPullRequest = (project: string) => invoke<string>("open_together_pull_request", { project });
export const removePaneCopy = (project: string, pane: string) => invoke<void>("remove_pane_copy", { project, pane });
export const terminalWrite = (id: string, data: string) => invoke<void>("terminal_write", { id, data });
export const terminalResize = (id: string, cols: number, rows: number) => invoke<void>("terminal_resize", { id, cols, rows });
export const terminalClose = (id: string) => invoke<void>("terminal_close", { id });
export const devServers = (folder: string) => invoke<number[]>("dev_servers", { folder });
export interface Slot {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const previewShow = (url: string, slot: Slot) => invoke<void>("preview_show", { url, slot });
export const previewPlace = (slot: Slot) => invoke<void>("preview_place", { slot });
export const previewHide = () => invoke<void>("preview_hide");
export const previewReload = () => invoke<void>("preview_reload");
export const notify = (title: string, body: string) => invoke<void>("notify", { title, body });
// The image goes as the raw body, and its kind (png, jpg…) in a header.
export const saveAttachment = (bytes: Uint8Array, kind: string) => invoke<string>("save_attachment", bytes, { headers: { "x-kind": kind } });
export const runStep = (request: StepRequest) => invoke<StepResult>("run_step", { request });
export const stopRun = (runId: string) => invoke<void>("stop_run", { runId });
export const fileDiff = (folder: string, changes: Changes, path: string) => invoke<string>("file_diff", { folder, before: changes.before, after: changes.after, path });
// Committing the files a step changed, optionally on a new branch, and opening a pull request with gh.
export const gitInfo = (folder: string) => invoke<GitInfo>("git_info", { folder });
export const commitStep = (folder: string, paths: string[], message: string, branch: string | null) => invoke<Committed>("commit_step", { folder, paths, message, branch });
export const openPullRequest = (folder: string) => invoke<string>("open_pull_request", { folder });
export const undoChanges = (folder: string, changes: Changes) => invoke<Undo>("undo_changes", { folder, before: changes.before, after: changes.after });

export const listProjects = () => invoke<Project[]>("list_projects");
export const addProject = (folder: string) => invoke<Project>("add_project", { folder });
export const renameProject = (id: string, name: string) => invoke<Project>("rename_project", { id, name });
// Its website on dhrive.site, its folder if dhrive founded it (to the Trash), and dhrive's record of it.
export const deleteCompany = (id: string) => invoke<void>("delete_company", { id });
export const allowInProject = (id: string, rule: string) => invoke<Project>("allow_in_project", { id, rule });
export const disallowInProject = (id: string, rule: string) => invoke<Project>("disallow_in_project", { id, rule });
export const answerApproval = (id: string, allow: boolean, always: boolean) => invoke<void>("answer_approval", { id, allow, always });
export const loadThread = (id: string) => invoke<Thread>("load_thread", { id });
// Keyed by folder, each folder's sessions newest first.
export const listSessions = (folders: string[]) => invoke<Record<string, PastSession[]>>("list_sessions", { folders });
export const listConversations = () => invoke<Conversation[]>("list_conversations");
export const saveConversation = (conversation: Conversation) => invoke<Conversation>("save_conversation", { conversation });
export const removeConversation = (id: string) => invoke<void>("remove_conversation", { id });
// How full a conversation's CLI session is, and making room in it (null when the CLI only says on
// its next turn).
export const contextUsage = (session: SessionRef) => invoke<ContextUsage>("context_usage", { session });
export const compactSession = (session: SessionRef) => invoke<ContextUsage | null>("compact_session", { session });
export const searchConversations = (query: string) => invoke<SearchHit[]>("search_conversations", { query });
export const saveThread = (id: string, thread: Thread) => invoke<void>("save_thread", { id, thread });

export const scanLocal = () => invoke<LocalScan>("scan_local");
export const pullModel = (model: string) => invoke<void>("pull_model", { model });
export const startOllama = () => invoke<void>("start_ollama");
// A pull is stopped like a step, under its own key.
export const stopPull = (model: string) => invoke<void>("stop_run", { runId: `pull:${model}` });
