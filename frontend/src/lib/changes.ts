import type { Changes, FileChange } from "@/lib/api";

// Reading what a code step changed: the event the backend sends, the totals shown on the stage, and
// one file's diff as lines to draw.

const STATUSES: FileChange["status"][] = ["added", "modified", "deleted"];
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

function readFile(raw: unknown): FileChange | null {
  const f = raw as Partial<FileChange> | null;
  if (typeof f?.path !== "string" || !STATUSES.includes(f.status as FileChange["status"])) return null;
  return { path: f.path, status: f.status as FileChange["status"], additions: count(f.additions), deletions: count(f.deletions) };
}

export function readChanges(value: string): Changes | null {
  try {
    const raw = JSON.parse(value) as Partial<Changes> | null;
    if (typeof raw?.before !== "string" || typeof raw.after !== "string" || !Array.isArray(raw.files)) return null;
    const files = raw.files.map(readFile).filter((f): f is FileChange => f !== null);
    return files.length ? { before: raw.before, after: raw.after, files } : null;
  } catch {
    return null;
  }
}

export function totals(changes: Changes): { additions: number; deletions: number } {
  return changes.files.reduce((sum, f) => ({ additions: sum.additions + (f.additions ?? 0), deletions: sum.deletions + (f.deletions ?? 0) }), { additions: 0, deletions: 0 });
}

export type DiffLine = { kind: "add" | "remove" | "hunk" | "same"; text: string };

export const MAX_DIFF_LINES = 400;

// git's file header ("diff --git", "index", "---", "+++") says nothing the list row doesn't.
export function diffLines(diff: string, max = MAX_DIFF_LINES): { lines: DiffLine[]; cut: boolean } {
  const body = diff.split("\n").filter((line, i, all) => line !== "" || i < all.length - 1);
  const start = body.findIndex((line) => line.startsWith("@@") || line.startsWith("Binary files"));
  const lines = (start < 0 ? [] : body.slice(start)).map((text): DiffLine => {
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "remove", text };
    return { kind: "same", text };
  });
  return { lines: lines.slice(0, max), cut: lines.length > max };
}
