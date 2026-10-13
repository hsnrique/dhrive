import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Together } from "@/lib/api";

const bring = vi.fn(async (_project: string, _session: string, parts: { pane: string; title: string }[]): Promise<Together> => ({
  branch: "dhrive/s1s1s1s1",
  merges: parts.map((p, at) => ({ pane: p.pane, branch: `dhrive/${p.pane.slice(0, 8)}`, outcome: at === 1 ? "conflict" : "merged", files: at === 1 ? ["shared.ts"] : [] })),
}));
const openTogetherPullRequest = vi.fn(async (_project: string) => "https://github.com/o/r/pull/7");
vi.mock("@/lib/api", () => ({ bringPanesTogether: bring, openTogetherPullRequest }));

const { useTerminals } = await import("./terminals");
const { resolveTask, useTogether, workPanes } = await import("./together");

const S = "5e55e55e-0000";
const session = () => useTerminals.getState().sessions[0];
const gathering = () => useTogether.getState().bySession[S];

describe("bringing a session's panes together", () => {
  beforeEach(() => {
    bring.mockClear();
    useTogether.setState({ bySession: {} });
    useTerminals.setState({ sessions: [{ id: S, projectId: "p1", title: "t", createdAt: 0, updatedAt: 0, panes: [] }] });
    useTerminals.getState().launch(S, [
      { engine: "codex", model: "gpt-5.5", task: "a", title: "API" },
      { engine: "claude-code", model: "", task: "b", title: "UI" },
    ]);
    useTerminals.getState().add(S, "codex");
  });

  it("brings in only the panes with copies of their own, named by their subtasks", async () => {
    await useTogether.getState().bring(session());
    expect(bring).toHaveBeenCalledWith("p1", S, workPanes(session()).map((p) => ({ pane: p.id, title: p.title })));
    expect(bring.mock.calls[0][2].map((p) => p.title)).toEqual(["API", "UI"]);
    expect(gathering()).toMatchObject({ busy: false, error: null });
    expect(gathering().result?.merges.map((m) => m.outcome)).toEqual(["merged", "conflict"]);
  });

  it("opens a pane in the project folder to resolve a conflict, once, with the conflicting pane's CLI", async () => {
    await useTogether.getState().bring(session());
    const conflict = gathering().result!.merges[1];
    expect(useTogether.getState().openOnIt(session(), conflict)).toBe(true);
    const resolver = session().panes.find((p) => p.id === S)!;
    expect(resolver).toMatchObject({ engine: "claude-code", copy: false, task: resolveTask(conflict, "UI") });
    expect(resolver.task).toContain("shared.ts");
    expect(useTogether.getState().openOnIt(session())).toBe(false);
    expect(workPanes(session()).map((p) => p.id)).not.toContain(S);
  });

  it("keeps the pull request's link, and a failure's words", async () => {
    await useTogether.getState().pullRequest(session());
    expect(openTogetherPullRequest).toHaveBeenCalledWith("p1");
    expect(gathering().pullRequest).toBe("https://github.com/o/r/pull/7");
    bring.mockRejectedValueOnce(new Error("not a git repo"));
    await useTogether.getState().bring(session());
    expect(gathering()).toMatchObject({ busy: false, error: "Error: not a git repo" });
  });
});
