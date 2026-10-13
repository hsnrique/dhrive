import type { Conversation, PastSession } from "@/lib/api";

// What a project's list in the sidebar holds: dhrive's own conversations, and the sessions the
// owner had with a CLI in that folder and hasn't carried on here yet.

export type Item = { kind: "conversation"; conversation: Conversation; at: number } | { kind: "past"; session: PastSession; at: number };

// What the main view shows: a conversation, or a new one in a project that starts with its first
// request, optionally carrying on one of the CLIs' earlier sessions.
export interface Open {
  projectId: string;
  conversationId: string | null;
  from: PastSession | null;
}

// Where a conversation's unsent text is kept, including a new one's before its first request.
export const draftKeyOf = (open: Open) => open.conversationId ?? `new:${open.projectId}:${open.from?.id ?? ""}`;

// A new conversation's instructions wait under its draft key until the first request creates it.
export const instructionsKeyOf = (open: Open) => `instructions:${draftKeyOf(open)}`;

const MAX_TITLE = 80;

// A conversation is named after the first line of its first request.
export function titleFor(task: string): string {
  const line = task.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  const chars = [...line];
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE).join("").trimEnd()}…` : line;
}

// Ids become file names on the Rust side, which takes only lowercase letters and digits.
export const newConversationId = () => `c${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;

export function sidebarItems(projectId: string, conversations: Conversation[], past: PastSession[]): Item[] {
  const own = conversations.filter((c) => c.projectId === projectId);
  const carried = new Set(own.flatMap((c) => c.continues));
  const items: Item[] = [
    ...own.map((conversation) => ({ kind: "conversation" as const, conversation, at: conversation.updatedAt })),
    ...past.filter((s) => !carried.has(s.id)).map((session) => ({ kind: "past" as const, session, at: session.updatedAt })),
  ];
  return items.sort((a, b) => b.at - a.at);
}

export function isOpen(item: Item, open: Open | null): boolean {
  if (item.kind === "conversation") return open?.conversationId === item.conversation.id;
  return open !== null && open.conversationId === null && open.from?.id === item.session.id;
}

// Where a CLI session was had, as a sentence would put it: "the Claude app", "the terminal".
export function sessionSource(session: PastSession): string {
  const cli = session.engine === "codex" ? "Codex" : "Claude";
  if (session.origin === "app") return `the ${cli} app`;
  if (session.origin === "terminal") return "the terminal";
  return cli === "Claude" ? "Claude Code" : "Codex";
}
