import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepRequest } from "@/lib/api";
import { emptyThread, type RunMessage } from "@/lib/thread";

// Each runStep stays pending until the test ends it, so what runs side by side is plain to see.
const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();

vi.mock("@/lib/api", () => ({
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  stopRun: vi.fn(async (runId: string) => pending.get(runId)?.reject(new Error("killed"))),
  saveThread: vi.fn(async () => undefined),
  saveConversation: vi.fn(async (conversation: unknown) => conversation),
  contextUsage: vi.fn(async () => ({ used: 1000, max: 200_000, parts: [], autoCompactAt: null })),
  devServers: vi.fn(async () => []),
  listFiles: vi.fn(async () => []),
  notify: vi.fn(async () => undefined),
}));
vi.stubGlobal("document", { hasFocus: () => true });

const { useApp } = await import("./app");
const { useConversations } = await import("./conversations");
const { send, stop } = await import("./runs");
const { setPhase, useLive } = await import("./live");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const steps = () => [...pending.values()].map((call) => `${call.request.folder} ${call.request.step}`).sort();
const codeOf = (id: string) => useApp.getState().threads[id].messages.filter((m): m is RunMessage => m.role === "run").pop()!.code;

// Runs left going hold their project's turn, so each test ends them all first.
async function settleAll() {
  for (let round = 0; round < 50 && pending.size > 0; round++) {
    for (const [runId, call] of [...pending]) {
      pending.delete(runId);
      call.reject(new Error("test ended"));
    }
    await flush();
  }
}

// Three conversations in project a, one in project b.
beforeEach(async () => {
  await settleAll();
  const projects = [{ id: "pa", name: "a", folder: "/a", createdAt: 0 }, { id: "pb", name: "b", folder: "/b", createdAt: 0 }];
  const conversation = (id: string, projectId: string) => ({ id, projectId, title: id, createdAt: 0, updatedAt: 0, continues: [] });
  useConversations.setState({ conversations: [conversation("a1", "pa"), conversation("a2", "pa"), conversation("a3", "pa"), conversation("b1", "pb")] });
  useApp.setState({ projects, threads: { a1: emptyThread(), a2: emptyThread(), a3: emptyThread(), b1: emptyThread() }, choices: { plan: null, code: { engine: "codex", model: "" } }, mode: "code", errors: [] });
});

describe("code steps in the same project", () => {
  it("take turns, while other projects and chats run alongside", async () => {
    void send("a1", "add dark mode");
    void send("a2", "fix the footer");
    void send("b1", "add search");
    await flush();
    expect(steps()).toEqual(["/a code", "/b code"]);
    expect(useLive.getState().runs[codeOf("a2").runId!]?.phase).toMatch(/Waiting for other work in this project/);
    useApp.setState({ mode: "chat", choices: { plan: { engine: "claude-code", model: "" }, code: { engine: "codex", model: "" } } });
    void send("a3", "why is checkout slow?");
    await flush();
    expect(steps(), "a chat only reads, so it never waits").toEqual(["/a chat", "/a code", "/b code"]);
    const [runId, call] = [...pending].find(([, c]) => c.request.task === "add dark mode")!;
    pending.delete(runId);
    setPhase(runId, "Editing");
    call.resolve({ output: "done", usage: null, sessionId: null, needsAnswers: false });
    await flush();
    expect(useLive.getState().runs[runId], "a settled step leaves nothing live behind").toBeUndefined();
    expect([...pending.values()].map((c) => c.request.task).sort()).toEqual(["add search", "fix the footer", "why is checkout slow?"]);
  });

  it("a code step stopped while it waits never starts", async () => {
    void send("a1", "add dark mode");
    void send("a2", "fix the footer");
    await flush();
    stop("a2");
    expect(codeOf("a2").status).toBe("stopped");
    const [runId, call] = [...pending][0];
    pending.delete(runId);
    call.resolve({ output: "done", usage: null, sessionId: null, needsAnswers: false });
    await flush();
    await flush();
    expect(pending.size).toBe(0);
    expect(codeOf("a2").status).toBe("stopped");
  });
});
