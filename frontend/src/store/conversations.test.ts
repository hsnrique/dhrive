import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PastSession, StepRequest } from "@/lib/api";
import { instructionsKeyOf, sidebarItems } from "@/lib/conversations";
import { readDraft, writeDraft } from "@/lib/drafts";

const APP_SESSION: PastSession = { engine: "claude-code", id: "3d6f467d-9732", title: "Modo TDAH no Mac", updatedAt: 90, origin: "app", messages: 195 };
const TERMINAL: PastSession = { engine: "codex", id: "019a-term", title: "Why is checkout slow?", updatedAt: 40, origin: "terminal", messages: 12 };
const requests: StepRequest[] = [];

// Each compaction stays pending until the test ends it.
const compacted: ((value: unknown) => void)[] = [];

vi.mock("@/lib/api", () => ({
  listConversations: vi.fn(async () => []),
  listSessions: vi.fn(async (folders: string[]) => Object.fromEntries(folders.map((f) => [f, f === "/work/tedhet" ? [APP_SESSION, TERMINAL] : []]))),
  loadThread: vi.fn(async () => ({ messages: [], sessions: {} })),
  saveThread: vi.fn(async () => undefined),
  contextUsage: vi.fn(async () => ({ used: 1000, max: 200_000, parts: [], autoCompactAt: null })),
  compactSession: vi.fn(() => new Promise((resolve) => compacted.push(resolve))),
  saveConversation: vi.fn(async (conversation: { title: string }) => ({ ...conversation, title: conversation.title.slice(0, 80) })),
  removeConversation: vi.fn(async () => undefined),
  deleteCompany: vi.fn(async () => undefined),
  runStep: vi.fn((request: StepRequest) => {
    requests.push(request);
    return new Promise(() => {});
  }),
}));

// Drafts (a new conversation's text and instructions) are kept in localStorage.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) });

const { useApp } = await import("./app");
const { useConversations } = await import("./conversations");
const { send } = await import("./runs");

const PROJECTS = [
  { id: "pa", name: "tedhet", folder: "/work/tedhet", createdAt: 0 },
  { id: "pb", name: "mesa34", folder: "/work/mesa34", createdAt: 0 },
];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const store = () => useConversations.getState();
const listed = (projectId: string) => sidebarItems(projectId, store().conversations, store().past[projectId] ?? []);

beforeEach(async () => {
  requests.length = 0;
  storage.clear();
  useApp.setState({ projects: PROJECTS, threads: {}, mode: "chat", choices: { plan: { engine: "claude-code", model: "opus" }, code: { engine: "codex", model: "" } }, errors: [] });
  useConversations.setState({ conversations: [], past: {}, open: null });
  await store().load();
});

describe("conversations", () => {
  it("instructions written before the first request go with the new conversation and reach its runs", async () => {
    store().startNew("pb");
    const draft = instructionsKeyOf(store().open!);
    writeDraft(draft, "Answer in Portuguese.");
    const id = store().begin("add a pricing page")!;
    expect(readDraft(draft), "the draft is used up").toBe("");
    void send(id, "add a pricing page");
    await flush();
    expect(useApp.getState().threads[id].instructions).toBe("Answer in Portuguese.");
    expect(requests[requests.length - 1]).toMatchObject({ instructions: "Answer in Portuguese." });

    store().startNew("pb");
    const plain = store().begin("another")!;
    expect(useApp.getState().threads[plain].instructions).toBeUndefined();
  });

  it("read each project's CLI sessions under that project", () => {
    expect(store().past).toEqual({ pa: [APP_SESSION, TERMINAL], pb: [] });
  });

  it("a CLI session taken off the list stays off when the sessions are read again, and closes if open", async () => {
    store().startNew("pa", TERMINAL);
    store().hidePast("pa", TERMINAL.id);
    expect(store().past.pa).toEqual([APP_SESSION]);
    expect(store().open).toBeNull();
    await store().loadPast();
    expect(store().past.pa).toEqual([APP_SESSION]);
  });

  it("a project lands on its latest session, and continuing it resumes that session under its name", async () => {
    store().openLatest("pa");
    expect(store().open).toEqual({ projectId: "pa", conversationId: null, from: APP_SESSION });

    const id = store().begin("onde paramos?")!;
    void send(id, "onde paramos?");
    await flush();
    expect(store().conversations[0]).toMatchObject({ id, projectId: "pa", title: "Modo TDAH no Mac", continues: [APP_SESSION.id] });
    expect(requests[requests.length - 1]).toMatchObject({ step: "chat", resume: APP_SESSION.id, folder: "/work/tedhet" });
    expect(listed("pa").map((item) => (item.kind === "past" ? item.session.id : item.conversation.id))).toEqual([id, TERMINAL.id]);
  });

  it("a new conversation is named after its first request and starts with no session", async () => {
    store().startNew("pb");
    expect(store().conversations).toEqual([]);
    const id = store().begin("\n add a pricing page\nwith three tiers")!;
    expect(store().begin("again")).toBe(id);
    void send(id, "add a pricing page");
    await flush();
    expect(store().conversations).toMatchObject([{ id, title: "add a pricing page", continues: [] }]);
    expect(requests[requests.length - 1]?.resume).toBeUndefined();
  });

  it("opening a session that a conversation already carries on opens that conversation", () => {
    store().startNew("pa", APP_SESSION);
    const id = store().begin("oi")!;
    store().startNew("pb");
    store().startNew("pa", APP_SESSION);
    expect(store().open).toEqual({ projectId: "pa", conversationId: id, from: null });
    expect(store().conversations).toHaveLength(1);
  });

  it("a rename shows at once and settles on the name the backend kept", async () => {
    store().startNew("pb");
    const id = store().begin("first request")!;
    store().rename(id, "x".repeat(100));
    expect(store().conversations[0].title).toHaveLength(100);
    await flush();
    expect(store().conversations[0].title).toHaveLength(80);
  });

  it("deleting the open conversation goes back to a new one, and the session it carried on is listed again", async () => {
    store().startNew("pa", APP_SESSION);
    const id = store().begin("oi")!;
    const { removeConversation } = await import("@/lib/api");
    vi.mocked(removeConversation).mockClear();
    await Promise.all([store().remove(id), store().remove(id)]);
    expect(removeConversation, "a double click deletes once").toHaveBeenCalledTimes(1);
    expect(store().open).toEqual({ projectId: "pa", conversationId: null, from: null });
    expect(useApp.getState().threads[id]).toBeUndefined();
    expect(listed("pa").map((item) => item.kind === "past" && item.session.id)).toEqual([APP_SESSION.id, TERMINAL.id]);
  });

  it("deleting a project drops its conversations and closes it", async () => {
    store().startNew("pa");
    store().begin("x");
    await store().deleteProject("pa");
    expect(store()).toMatchObject({ conversations: [], open: null, past: { pb: [] } });
    expect(useApp.getState().projects.map((p) => p.id)).toEqual(["pb"]);
    expect(useApp.getState().threads).toEqual({});
  });

  it("stay consistent through any order of opening, starting, sending and deleting", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = prng(seed);
      const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
      useConversations.setState({ conversations: [], open: null });
      useApp.setState({ threads: {} });
      for (let op = 0; op < 25; op++) {
        const project = pick(PROJECTS).id;
        const action = pick(["latest", "new", "past", "begin", "begin", "show", "remove"]);
        if (action === "latest") store().openLatest(project);
        if (action === "new") store().startNew(project);
        if (action === "past") store().startNew("pa", pick([APP_SESSION, TERMINAL]));
        if (action === "begin") store().begin(`task ${op}`);
        const some = store().conversations.length ? pick(store().conversations).id : null;
        if (action === "show" && some) void store().show(some);
        if (action === "remove" && some) await store().remove(some);
        await flush();
        const { conversations, open } = store();
        for (const c of conversations) expect(useApp.getState().threads[c.id], `seed ${seed}: every conversation has its thread`).toBeDefined();
        if (open?.conversationId) expect(conversations.some((c) => c.id === open.conversationId), `seed ${seed}: open points at a conversation`).toBe(true);
        const carried = conversations.flatMap((c) => c.continues);
        expect(new Set(carried).size, `seed ${seed}: a session is carried on once`).toBe(carried.length);
        for (const p of PROJECTS) {
          const shown = listed(p.id).flatMap((item) => (item.kind === "past" ? [item.session.id] : []));
          expect(shown.filter((sid) => carried.includes(sid)), `seed ${seed}: carried sessions aren't listed twice`).toEqual([]);
        }
      }
    }
  });
});
