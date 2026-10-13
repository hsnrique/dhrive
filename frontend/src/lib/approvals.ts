import type { Question } from "@/lib/api";

// Reading a permission question from the backend's event, and saying it the way a person would.

export function readQuestion(value: string): Question | null {
  try {
    const q = JSON.parse(value) as Partial<Question> | null;
    if (typeof q?.id !== "string" || typeof q.tool !== "string") return null;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return { id: q.id, tool: q.tool, detail: text(q.detail), description: text(q.description), rule: typeof q.rule === "string" && q.rule ? q.rule : null };
  } catch {
    return null;
  }
}

const VERBS: Record<string, string> = { Bash: "run", WebFetch: "open", WebSearch: "search for", Read: "read", Glob: "look through", Grep: "search", Edit: "edit", Write: "write", NotebookEdit: "edit" };

// "wants to run", "wants to open", or the tool's own name for anything else (an MCP tool).
export const asking = (q: Question) => (VERBS[q.tool] ? `wants to ${VERBS[q.tool]}` : `wants to use ${q.tool}`);

// "Bash(npm test:*)" as the owner reads it: "npm test…"; a bare tool name as it is.
export function ruleLabel(rule: string): string {
  const inside = /^[^(]+\((.*)\)$/.exec(rule)?.[1];
  if (!inside) return rule;
  return inside.replace(/^domain:/, "").replace(/(:\*| \*)$/, "…");
}
