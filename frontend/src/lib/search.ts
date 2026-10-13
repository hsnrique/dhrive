import type { Conversation, PastSession, Project, SearchHit } from "@/lib/api";
import { sidebarItems } from "@/lib/conversations";

// What ⌘K finds: projects by name, conversations by title and, from the backend, by what was said in
// them, and the CLIs' own sessions by title. With nothing typed, the latest conversations, to jump
// back to one.

export type Result =
  | { kind: "project"; key: string; project: Project }
  | { kind: "conversation"; key: string; conversation: Conversation; project: string; snippet?: string }
  | { kind: "past"; key: string; session: PastSession; projectId: string; project: string };

const RECENT = 8;
const MAX_RESULTS = 30;

const has = (text: string, query: string) => text.toLowerCase().includes(query);

export function localResults(query: string, projects: Project[], conversations: Conversation[], past: Record<string, PastSession[]>): Result[] {
  const q = query.trim().toLowerCase();
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const conversation = (c: Conversation): Result => ({ kind: "conversation", key: `c:${c.id}`, conversation: c, project: projectName(c.projectId) });
  const byRecent = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!q) return byRecent.slice(0, RECENT).map(conversation);
  const sessions = projects.flatMap((p) =>
    sidebarItems(p.id, conversations, past[p.id] ?? []).flatMap((item): Result[] =>
      item.kind === "past" && has(item.session.title, q) ? [{ kind: "past", key: `s:${item.session.id}`, session: item.session, projectId: p.id, project: p.name }] : [],
    ),
  );
  return [
    ...projects.filter((p) => has(p.name, q)).map((project): Result => ({ kind: "project", key: `p:${project.id}`, project })),
    ...byRecent.filter((c) => has(c.title, q)).map(conversation),
    ...sessions,
  ].slice(0, MAX_RESULTS);
}

// The backend's matches inside conversations: a snippet on one already found by its title, or a new
// result after the others.
export function withHits(results: Result[], hits: SearchHit[], conversations: Conversation[], projects: Project[]): Result[] {
  const snippets = new Map(hits.map((h) => [h.conversationId, h.snippet]));
  const shown = results.map((r) => (r.kind === "conversation" && snippets.has(r.conversation.id) ? { ...r, snippet: snippets.get(r.conversation.id) } : r));
  const found = new Set(results.filter((r) => r.kind === "conversation").map((r) => r.key));
  const extra = hits.flatMap((hit): Result[] => {
    const c = conversations.find((x) => x.id === hit.conversationId);
    if (!c || found.has(`c:${c.id}`)) return [];
    return [{ kind: "conversation", key: `c:${c.id}`, conversation: c, project: projects.find((p) => p.id === c.projectId)?.name ?? "", snippet: hit.snippet }];
  });
  return [...shown, ...extra].slice(0, MAX_RESULTS);
}

// A text split around every match of the query, so the matches can be marked without any HTML.
export function marked(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(q); at >= 0 && lower.length === text.length; at = lower.indexOf(q, at + q.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + q.length), match: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
