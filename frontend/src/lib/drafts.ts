import { readSaved, save } from "@/lib/storage";

// What the owner was typing in each conversation, so switching away and back keeps it, even across
// a restart. Only the most recent ones are kept.

const KEY = "drafts";
const MAX_DRAFTS = 50;

function all(): Record<string, string> {
  const saved = readSaved(KEY);
  return saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, string>) : {};
}

export function readDraft(key: string): string {
  const draft = all()[key];
  return typeof draft === "string" ? draft : "";
}

export function writeDraft(key: string, text: string) {
  const { [key]: _old, ...rest } = all();
  const next = text.trim() ? { ...rest, [key]: text } : rest;
  const keys = Object.keys(next);
  save(KEY, Object.fromEntries(keys.slice(Math.max(0, keys.length - MAX_DRAFTS)).map((k) => [k, next[k]])));
}
