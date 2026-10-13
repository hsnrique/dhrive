import type { Engine } from "@/lib/api";

// The maestro's reply is a JSON array of subtasks; models wrap it in a fence or a sentence anyway,
// so the array is read from its first "[" to its last "]". Each subtask becomes a CLI's first
// prompt in a pane of its own, so anything that isn't a plain, bounded string is dropped.

export interface Part {
  id: string;
  title: string;
  engine: Engine;
  // The CLI's own default when empty; the owner picks one before the panes open.
  model: string;
  prompt: string;
}

export const MAX_PARTS = 6;
const MAX_TITLE = 80;
// What the backend takes as a task.
export const MAX_PROMPT = 20_000;

export const BY_NAME: Record<string, Engine> = { claude: "claude-code", "claude-code": "claude-code", codex: "codex", antigravity: "antigravity", agy: "antigravity" };

function arrayIn(output: string): unknown[] | null {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(output.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// A CLI the maestro named but the owner can't run here goes to the maestro's own CLI.
function partOf(item: unknown, usable: Engine[], fallback: Engine): Part | null {
  if (typeof item !== "object" || item === null) return null;
  const { title, cli, prompt } = item as Record<string, unknown>;
  const ask = text(prompt);
  if (!ask || ask.length > MAX_PROMPT) return null;
  const named = BY_NAME[text(cli).toLowerCase()];
  const engine = named && usable.includes(named) ? named : fallback;
  return { id: crypto.randomUUID(), title: text(title).slice(0, MAX_TITLE) || ask.slice(0, 40), engine, model: "", prompt: ask };
}

export function parseSplit(output: string, usable: Engine[], fallback: Engine): Part[] {
  return (arrayIn(output) ?? [])
    .map((item) => partOf(item, usable, fallback))
    .filter((part): part is Part => part !== null)
    .slice(0, MAX_PARTS);
}

// A saved subtask comes back only if it still looks like one.
export function savedParts(value: unknown): Part[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Part => ["id", "title", "engine", "model", "prompt"].every((key) => typeof (p as Record<string, unknown>)?.[key] === "string"))
    .slice(0, MAX_PARTS)
    .map(({ id, title, engine, model, prompt }) => ({ id, title, engine, model, prompt }));
}

// What the owner picked from the CLI's skills, MCP servers and plugins, said in the brief: the CLI
// loads all of them anyway, so picking one is asking for it, for the split and for the subtasks.
export interface Focus {
  kind: "skill" | "server" | "plugin";
  name: string;
}

const FOCUS_LABELS: Record<Focus["kind"], string> = { skill: "Skills", server: "MCP servers", plugin: "Plugins" };

export function withFocus(brief: string, focus: Focus[]): string {
  if (focus.length === 0) return brief;
  const lines = (Object.keys(FOCUS_LABELS) as Focus["kind"][])
    .map((kind) => [FOCUS_LABELS[kind], focus.filter((f) => f.kind === kind).map((f) => f.name)] as const)
    .filter(([, names]) => names.length > 0)
    .map(([label, names]) => `${label}: ${names.join(", ")}`);
  return `${brief.trim()}\n\nUse these where they help, and tell each subtask that should use one to use it by name:\n${lines.join("\n")}`;
}
