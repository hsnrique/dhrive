import type { DiffLine } from "@/lib/changes";

// The lines an edit removed and added, for watching it live: the common lines found by longest
// common subsequence, the rest marked. Past a size where that gets slow, it's all the old lines out
// and all the new ones in, which is still what happened.

const MAX_LINES = 400;

export interface LiveEdit {
  path: string;
  before: string;
  after: string;
}

const split = (text: string) => (text === "" ? [] : text.split("\n"));

export function editLines(before: string, after: string): DiffLine[] {
  const a = split(before);
  const b = split(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [...a.map((text): DiffLine => ({ kind: "remove", text: `-${text}` })), ...b.map((text): DiffLine => ({ kind: "add", text: `+${text}` }))];
  }
  const common: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  // Removals come before the additions that replace them, as in any diff.
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: ` ${a[i]}` });
      i++;
      j++;
    } else if (i < a.length && (j === b.length || common[i + 1][j] >= common[i][j + 1])) {
      lines.push({ kind: "remove", text: `-${a[i++]}` });
    } else {
      lines.push({ kind: "add", text: `+${b[j++]}` });
    }
  }
  return lines;
}

export function readEdit(value: string): LiveEdit | null {
  try {
    const e = JSON.parse(value) as Partial<LiveEdit> | null;
    return typeof e?.path === "string" && typeof e.before === "string" && typeof e.after === "string" ? { path: e.path, before: e.before, after: e.after } : null;
  } catch {
    return null;
  }
}
