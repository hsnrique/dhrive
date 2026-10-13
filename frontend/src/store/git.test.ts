import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyThread, newRequest, updateStage, type RunMessage, type Thread } from "@/lib/thread";

vi.mock("@/lib/api", () => ({
  saveThread: vi.fn(async () => undefined),
  commitStep: vi.fn(async (_folder: string, _paths: string[], _message: string, branch: string | null) => ({ sha: "a1b2c3d", branch: branch ?? "main" })),
  openPullRequest: vi.fn(async () => "https://github.com/o/r/pull/7"),
}));

const api = await import("@/lib/api");
const { useApp } = await import("./app");
const { useConversations } = await import("./conversations");
const { commitStep, openPr } = await import("./git");

const changes = { before: "a".repeat(40), after: "b".repeat(40), files: [{ path: "src/theme.ts", status: "added" as const, additions: 3, deletions: 0 }, { path: "old.css", status: "deleted" as const, additions: 0, deletions: 9 }] };
const code = (id: string) => (useApp.getState().threads.c1.messages.find((m) => m.id === id) as RunMessage).code;

function setUp(extra: Partial<RunMessage["code"]> = {}): string {
  const [user, run] = newRequest("add a theme", null, { engine: "codex", model: "" }, 1, () => crypto.randomUUID());
  const thread: Thread = updateStage({ ...emptyThread(), messages: [user, run] }, run.id, "code", { status: "done", changes, ...extra });
  useApp.setState({ projects: [{ id: "pa", name: "a", folder: "/a", createdAt: 0 }], threads: { c1: thread } });
  useConversations.setState({ conversations: [{ id: "c1", projectId: "pa", title: "a", createdAt: 0, updatedAt: 0, continues: [] }] });
  return run.id;
}

describe("finishing a step with git", () => {
  beforeEach(() => vi.mocked(api.commitStep).mockClear());

  it("commits exactly the step's files, keeps the commit on the step, then adds the pull request", async () => {
    const id = setUp();
    await commitStep("c1", id, "Add a theme", "dhrive/add-a-theme");
    expect(api.commitStep).toHaveBeenCalledWith("/a", ["src/theme.ts", "old.css"], "Add a theme", "dhrive/add-a-theme");
    expect(code(id).committed).toEqual({ sha: "a1b2c3d", branch: "dhrive/add-a-theme" });
    expect(await openPr("c1", id)).toBe("https://github.com/o/r/pull/7");
    expect(code(id).committed?.pr).toBe("https://github.com/o/r/pull/7");
  });

  it("a step already committed or undone isn't committed again", async () => {
    await commitStep("c1", setUp({ committed: { sha: "old", branch: "main" } }), "x", null);
    await commitStep("c1", setUp({ undone: { restored: ["src/theme.ts"], kept: [] } }), "x", null);
    expect(api.commitStep).not.toHaveBeenCalled();
  });
});
