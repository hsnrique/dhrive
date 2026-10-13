import { describe, expect, it } from "vitest";

import type { Conversation, PastSession } from "@/lib/api";
import { isOpen, newConversationId, sessionSource, sidebarItems, titleFor } from "./conversations";

const conversation = (id: string, projectId: string, updatedAt: number, continues: string[] = []): Conversation => ({ id, projectId, title: id, createdAt: 0, updatedAt, continues });
const past = (id: string, updatedAt: number): PastSession => ({ engine: "claude-code", id, title: id, updatedAt, origin: "app", messages: 3 });

describe("conversations", () => {
  it("are named after the first line of the first request", () => {
    expect(titleFor("\n  add dark mode  \nand remember it")).toBe("add dark mode");
    expect([...titleFor("ç".repeat(100))]).toHaveLength(81);
    expect(titleFor("   ")).toBe("");
  });

  it("get ids the Rust side accepts as file names", () => {
    for (let i = 0; i < 20; i++) expect(newConversationId()).toMatch(/^[a-z0-9]{1,40}$/);
  });

  it("list with the CLIs' sessions newest first, without the ones already carried on, and only the project's own", () => {
    const own = [conversation("c1", "pa", 50, ["app-1"]), conversation("c2", "pa", 10), conversation("c3", "pb", 99)];
    const items = sidebarItems("pa", own, [past("app-1", 70), past("term-1", 30)]);
    expect(items.map((item) => (item.kind === "conversation" ? item.conversation.id : item.session.id))).toEqual(["c1", "term-1", "c2"]);
  });

  it("marks what the main view shows", () => {
    const [mine, session] = sidebarItems("pa", [conversation("c1", "pa", 5)], [past("app-1", 1)]);
    expect(isOpen(mine, { projectId: "pa", conversationId: "c1", from: null })).toBe(true);
    expect(isOpen(session, { projectId: "pa", conversationId: null, from: past("app-1", 1) })).toBe(true);
    expect(isOpen(session, { projectId: "pa", conversationId: "c1", from: past("app-1", 1) })).toBe(false);
    expect(isOpen(mine, null)).toBe(false);
  });

  it("say where a CLI session was had", () => {
    expect(sessionSource(past("a", 1))).toBe("the Claude app");
    expect(sessionSource({ ...past("a", 1), engine: "codex", origin: "terminal" })).toBe("the terminal");
    expect(sessionSource({ ...past("a", 1), engine: "codex", origin: "other" })).toBe("Codex");
  });
});
