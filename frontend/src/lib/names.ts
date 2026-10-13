import type { Cli, Engine, ModelOption } from "@/lib/api";

const ALIASES: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

// What a model is called on screen: the name its CLI reported, Claude's aliases capitalized until
// Claude Code has answered, anything typed by hand as typed, and the CLI's default when nothing was picked.
export function modelName(model: string, options: ModelOption[] = []): string {
  if (!model) return "Default";
  return options.find((option) => option.id === model)?.label ?? ALIASES[model] ?? model;
}

const CLI_LABELS: Record<Engine, string> = { "claude-code": "Claude Code", codex: "Codex", antigravity: "Antigravity", ollama: "Ollama" };

// The CLIs that tell dhrive their plan usage, how full a session is and what they have connected.
// Antigravity and local models say none of it, so they get no meter, hover card or CLI screen.
export const reportsDetails = (engine: Engine) => engine === "claude-code" || engine === "codex";

export function cliLabel(engine: Engine, clis: Cli[]): string {
  return clis.find((cli) => cli.engine === engine)?.label ?? CLI_LABELS[engine];
}

// An effort level as the CLI names it ("xhigh"), as a person would read it.
const EFFORT_LABELS: Record<string, string> = { xhigh: "Extra high" };
export const effortLabel = (effort: string) => EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);

// Download and disk sizes in decimal GB, as Finder and Ollama show them.
export const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 1e10 ? 1 : 0)} GB`;

// /Users/ana/Code/app → ~/Code/app, so paths fit a header without losing where they are.
export function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
