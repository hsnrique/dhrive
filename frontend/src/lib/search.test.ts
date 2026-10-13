import { describe, expect, it } from "vitest";

import type { Conversation, PastSession, Project } from "@/lib/api";
import { localResults, marked, withHits } from "./search";

const projects: Project[] = [
  { id: "pa", name: "storefront", folder: "/w/storefront", createdAt: 0 },
  { id: "pb", name: "billing-api", folder: "/w/billing-api", createdAt: 0 },
];
const conv = (id: string, projectId: string, title: string, updatedAt: number, continues: string[] = []): Conversation => ({ id, projectId, title, createdAt: 0, updatedAt, continues });
const conversations = [conv("c1", "pa", "Add a dark mode toggle", 10), conv("c2", "pb", "Retry failed webhooks", 30, ["s1"]), conv("c3", "pa", "Cache the product API", 20)];
const session = (id: string, title: string): PastSession => ({ engine: "claude-code", id, title, updatedAt: 5, origin: "app", messages: 3 });
const past = { pa: [session("s2", "Why is checkout slow?")], pb: [session("s1", "Webhook retries (carried on)")] };
const keys = (results: { key: string }[]) => results.map((r) => r.key);

describe("⌘K", () => {
  it("shows the latest conversations when nothing is typed", () => {
    expect(keys(localResults("  ", projects, conversations, past))).toEqual(["c:c2", "c:c3", "c:c1"]);
  });

  it("finds projects first, then conversations newest first, then the CLIs' sessions not carried on", () => {
    expect(keys(localResults("STORE", projects, conversations, past))).toEqual(["p:pa"]);
    expect(keys(localResults("webhook", projects, conversations, past))).toEqual(["c:c2"]);
    expect(keys(localResults("o", projects, conversations, past))).toEqual(["p:pa", "c:c2", "c:c3", "c:c1", "s:s2"]);
  });

  it("adds what was said inside conversations: a snippet on one already found, the rest after", () => {
    const results = withHits(localResults("webhook", projects, conversations, past), [{ conversationId: "c1", snippet: "…ignore webhook noise…" }, { conversationId: "c2", snippet: "retry webhooks" }, { conversationId: "gone", snippet: "x" }], conversations, projects);
    expect(results.map((r) => [r.key, r.kind === "conversation" ? r.snippet : undefined])).toEqual([["c:c2", "retry webhooks"], ["c:c1", "…ignore webhook noise…"]]);
  });

  it("marks every match regardless of case, as plain text", () => {
    expect(marked("Retry webhooks, then WEBHOOKS again", "webhook")).toEqual([
      { text: "Retry ", match: false },
      { text: "webhook", match: true },
      { text: "s, then ", match: false },
      { text: "WEBHOOK", match: true },
      { text: "S again", match: false },
    ]);
    expect(marked("<b>x</b>", "")).toEqual([{ text: "<b>x</b>", match: false }]);
  });
});
