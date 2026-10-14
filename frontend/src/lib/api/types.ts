// Mirrors the Rust types the backend commands take and return (serde camelCase).

export type Engine = "claude-code" | "codex" | "antigravity" | "ollama";
export type Step = "plan" | "code";

export interface Cli {
  engine: Engine;
  label: string;
  installed: boolean;
  docsUrl: string;
  version: string | null;
  // The version it had before, when it updated since dhrive last looked.
  updatedFrom: string | null;
  // Flags dhrive relies on that this version no longer lists.
  missing: string[];
}

// An empty id is the CLI's own default (no --model).
export interface ModelOption {
  id: string;
  label: string;
  detail: string | null;
  // The effort levels this model takes, as its CLI names them; none when it can't be set.
  efforts?: string[];
}

export interface Usage {
  inputTokens: number;
  // The part of inputTokens served from the provider's prompt cache.
  cachedTokens: number;
  outputTokens: number;
  totalCostUsd: number | null;
  numTurns: number;
  model: string | null;
}

export interface Project {
  id: string;
  name: string;
  folder: string;
  createdAt: number;
  // Tool rules always allowed here ("Bash(npm test:*)"), kept by dhrive.
  allowed?: string[];
}

// A tool call Claude Code wants to make and needs the owner's OK for. `rule` is what "always" would
// allow in this project.
export interface Question {
  id: string;
  tool: string;
  detail: string;
  description: string;
  rule: string | null;
}

// A company's environment as the screen sees it: names and the last four characters, never a value.
export interface EnvView {
  // `public`: built into the website, so anyone visiting it can read it.
  vars: { name: string; hint: string; public: boolean }[];
  missing: string[];
  removed: string[];
}

// What dhrive's own checks found after a company task (checks.rs): skipped when there was nothing to
// check, else each check that ran and the scripts package.json is missing.
export type CheckReport = { kind: "skipped"; why: string } | { kind: "ran"; checks: { name: string; ok: boolean; tail: string }[]; missing: string[] };

export interface StepRequest {
  runId: string;
  folder: string;
  // A chat runs like a plan (read-only) with its own brief, and so does the maestro's split.
  step: Step | "chat" | "split" | "company" | "day" | "found" | "talk" | "commit";
  engine: Engine;
  model: string;
  // How hard the model thinks, one of its CLI's levels; the CLI's default when absent.
  effort?: string;
  task: string;
  plan?: string;
  resume?: string;
  // Absolute paths of the files the owner attached.
  attachments?: string[];
  // The conversation's own instructions; the backend adds the ones for every project.
  instructions?: string;
  // A company task with Ask first off: it runs on its own, asking nobody, with MCP tools only if `mcp`.
  unattended?: boolean;
  mcp?: boolean;
}

// A project file or folder as the side panel shows it.
export type FileView =
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "image"; dataUrl: string }
  | { kind: "binary"; bytes: number }
  | { kind: "folder"; entries: string[] };

export interface Attachment {
  path: string;
  name: string;
  image: boolean;
}

export interface StepResult {
  output: string;
  usage: Usage | null;
  sessionId: string | null;
  // The planner asked questions instead of planning.
  needsAnswers: boolean;
  // What the CLI refused to let the model do ("Bash: npm install"); Claude reports it, Codex doesn't.
  blocked?: string[];
}

export interface ProgressEvent {
  runId: string;
  // "session" carries the CLI's conversation id the moment it starts, instead of text to show.
  kind: "phase" | "log" | "session" | "changes" | "approval" | "edit";
  value: string;
}

// What a code step changed, between two git trees recorded before and after it. Counts are null for
// binary files.
export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number | null;
  deletions: number | null;
}

export interface Changes {
  before: string;
  after: string;
  files: FileChange[];
}

// Whether this Mac may start runs: a build without accounts (free), no sign-in yet, the account's 14
// free days, a live subscription, or neither anymore (ended, with why). Times are milliseconds since
// the epoch.
export type AccountStatus =
  | { state: "free" }
  | { state: "signedOut" }
  | { state: "trial"; email: string; daysLeft: number }
  | { state: "subscribed"; email: string; renewsAt: number; canceling: boolean; plan: "monthly" | "yearly" | null }
  | { state: "ended"; email: string | null; reason: string };

// Where a project's git stands, for committing a step: the branch (null when HEAD isn't on one),
// whether it's the default branch, and whether a pull request can be opened from here.
export interface GitInfo {
  branch: string | null;
  onDefault: boolean;
  canPush: boolean;
  gh: boolean;
}

export interface Committed {
  sha: string;
  branch: string | null;
}

// Kept files were edited again after the step, so undo left them as they were.
export interface Undo {
  restored: string[];
  kept: string[];
}

// One of the plan's windows as its CLI reports it: the percent used and when it resets, in seconds
// since the epoch. `warn` is the CLI saying it's getting close, or past 90%.
export interface UsageWindow {
  label: string;
  percent: number;
  resetsAt: number | null;
  warn: boolean;
}

// A CLI account's plan and how much of it is used, asked of the CLI when the owner looks. `shares`
// is where this week's usage went ("Claude Code", "Chats").
export interface PlanUsage {
  plan: string | null;
  account: string | null;
  windows: UsageWindow[];
  shares: { label: string; percent: number }[];
  notes: string[];
}

// Everything a CLI brings to a run in a project, as the CLI reports it. Only names, states and short
// descriptions; server configs stay in the backend.
export type ServerStatus = "connected" | "needs-auth" | "failed" | "connecting" | "disabled" | "configured";

export interface McpServer {
  name: string;
  status: ServerStatus;
  source: string | null;
  tools: number | null;
  error: string | null;
}

export interface Connected {
  name: string;
  detail: string | null;
  source: string | null;
  on: boolean;
}

export interface Connections {
  servers: McpServer[];
  skills: Connected[];
  plugins: Connected[];
  agents: Connected[];
  hooks: Connected[];
}

export type Fit = "good" | "tight" | "too-big" | "no-disk";

export interface LocalModel {
  id: string;
  label: string;
  bytes: number;
  fit: Fit;
  installed: boolean;
}

export interface LocalScan {
  machine: { chip: string; memoryBytes: number; freeDiskBytes: number };
  ollama: "missing" | "stopped" | "running";
  codex: boolean;
  // The context Ollama gave a loaded model; null until one is loaded.
  context: number | null;
  models: LocalModel[];
}

export interface PullEvent {
  model: string;
  status: string;
  completed: number;
  total: number;
}

// One of a project's conversations in dhrive; its thread is saved under the same id. `continues`
// holds the CLI sessions (Claude app, terminal, Codex) it carried on, so they aren't listed twice.
export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  continues: string[];
}

// How full a CLI session is, in tokens. `parts` says what fills it (Claude Code only), largest first;
// `autoCompactAt` is where the CLI compacts on its own, when it does and says so.
export interface ContextUsage {
  used: number;
  max: number;
  parts: { name: string; tokens: number }[];
  autoCompactAt: number | null;
}

// A conversation's session with one CLI, and the model it last ran with (Claude's window depends on it).
export interface SessionRef {
  engine: Engine;
  session: string;
  folder: string;
  model?: string;
}

// A conversation whose saved requests, plans or replies contain what the owner searched for.
export interface SearchHit {
  conversationId: string;
  snippet: string;
}

// A conversation the owner already had with a CLI in this folder, read from the CLI's own records.
export interface PastSession {
  engine: Engine;
  id: string;
  title: string;
  updatedAt: number;
  origin: "app" | "terminal" | "dhrive" | "other";
  messages: number;
}

// A Terminals session's panes brought together on one branch (together.rs).
export interface Together {
  branch: string;
  merges: { pane: string; branch: string; outcome: "merged" | "nothing-new" | "conflict" | "no-copy"; files: string[] }[];
}
