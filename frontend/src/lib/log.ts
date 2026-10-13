import type { Choice } from "./flow";
import { parseDay, type Task } from "./day";

// A company's timeline: what it did (tasks done or failed, the site published, auto mode on and
// off) and what the owner and its agent said, in one list. The agent's reply may end with a fenced
// "tasks" block of work it thinks worth doing; that block becomes tasks the owner can add.

export type EntryKind = "owner" | "agent" | "done" | "failed" | "published" | "auto" | "build";

export interface Entry {
  id: string;
  at: number;
  kind: EntryKind;
  text: string;
  // A done or failed task.
  taskId?: string;
  // Where the site was published.
  url?: string;
  // What the agent suggests doing, and which of those the owner added.
  tasks?: Task[];
  added?: string[];
  // A failed build's output, for the task that fixes it.
  detail?: string;
}

export const MAX_ENTRIES = 300;
const MAX_SUGGESTED = 3;
const MAX_NEWS = 20;
const KINDS: EntryKind[] = ["owner", "agent", "done", "failed", "published", "auto", "build"];

export const entry = (kind: EntryKind, text: string, extra: Partial<Entry> = {}): Entry => ({ id: crypto.randomUUID(), at: Date.now(), kind, text, ...extra });

const BLOCK = /```tasks\s*\n?([\s\S]*?)```/;

export function parseReply(output: string, agent: Choice): { text: string; tasks: Task[] } {
  const block = output.match(BLOCK);
  if (!block) return { text: output.trim(), tasks: [] };
  return { text: output.replace(BLOCK, "").trim(), tasks: parseDay(block[1], agent).slice(0, MAX_SUGGESTED) };
}

const NEWS: Partial<Record<EntryKind, string>> = { done: "Done", failed: "Failed", published: "Published", auto: "Auto mode", build: "Build failed" };

// What happened since the agent last spoke, for its next turn; it keeps the rest in its own session.
export function news(entries: Entry[]): string {
  const since = entries.map((e) => e.kind).lastIndexOf("agent");
  const lines = entries.slice(since + 1).filter((e) => NEWS[e.kind]).slice(-MAX_NEWS).map((e) => `- ${NEWS[e.kind]}: ${e.text}`);
  return lines.length ? `What happened since we last spoke:\n${lines.join("\n")}` : "";
}

export function savedLog(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e): e is Entry => typeof e?.id === "string" && typeof e.at === "number" && KINDS.includes(e.kind) && typeof e.text === "string");
}
