import { beforeEach, describe, expect, it } from "vitest";

import { columnsFor, MAX_PANES, NEW_TITLE, restored, useTerminals } from "./terminals";

const t = () => useTerminals.getState();
const panesOf = (id: string) => t().sessions.find((s) => s.id === id)!.panes;

describe("terminals sessions", () => {
  beforeEach(() => useTerminals.setState({ sessions: [], openId: null }));

  it("keeps each project's sessions, newest first, with panes up to the limit", () => {
    const first = t().create("p1");
    const second = t().create("p2");
    expect(t().sessions.map((s) => [s.id, s.projectId, s.title])).toEqual([[second, "p2", NEW_TITLE], [first, "p1", NEW_TITLE]]);
    for (let i = 0; i < MAX_PANES + 2; i++) t().add(first, "claude-code");
    expect(panesOf(first)).toHaveLength(MAX_PANES);
    expect(panesOf(second)).toHaveLength(0);
  });

  it("restarts only the pane that changed, and closes panes and sessions", () => {
    const id = t().create("p1");
    t().add(id, "claude-code");
    t().add(id, "codex");
    const [one, two] = panesOf(id);
    t().change(one.id, { engine: "antigravity" });
    t().change(one.id, { copy: true });
    expect(panesOf(id)[0]).toMatchObject({ engine: "antigravity", copy: true, run: 2 });
    expect(panesOf(id)[1]).toEqual(two);
    t().restart(two.id);
    expect(panesOf(id)[1].run).toBe(1);
    t().remove(one.id);
    expect(panesOf(id).map((p) => p.id)).toEqual([two.id]);
    useTerminals.setState({ openId: id });
    t().drop(id);
    expect(t()).toMatchObject({ sessions: [], openId: null });
  });

  it("opens the maestro's subtasks as panes in copies of their own, each sending its task once", () => {
    const id = t().create("p1");
    t().add(id, "claude-code");
    expect(t().launch(id, [{ engine: "codex", model: "gpt-5.5", task: "add the route", title: "API" }, { engine: "claude-code", model: "", task: "add the page", title: "UI" }])).toBe(true);
    const [, route, page] = panesOf(id);
    expect(route).toMatchObject({ engine: "codex", model: "gpt-5.5", copy: true, task: "add the route", title: "API" });
    expect(page).toMatchObject({ engine: "claude-code", copy: true, task: "add the page" });
    t().started(route.id);
    expect(panesOf(id)[1].task).toBeNull();
    expect(panesOf(id)[2].task).toBe("add the page");
    const many = Array.from({ length: MAX_PANES - 2 }, () => ({ engine: "codex" as const, model: "", task: "x", title: "x" }));
    expect(t().launch(id, many)).toBe(false);
    expect(panesOf(id)).toHaveLength(3);
  });

  it("forgets a pane's model when its CLI changes", () => {
    const id = t().create("p1");
    t().launch(id, [{ engine: "codex", model: "gpt-5.5", task: "x", title: "x" }]);
    expect(t().launch(id, [{ engine: "codex", model: "", task: "", title: "", id: panesOf(id)[0].id }])).toBe(false);
    const [pane] = panesOf(id);
    t().change(pane.id, { model: "gpt-6" });
    expect(panesOf(id)[0].model).toBe("gpt-6");
    t().change(pane.id, { engine: "claude-code" });
    expect(panesOf(id)[0]).toMatchObject({ engine: "claude-code", model: "" });
  });

  it("renames to trimmed text and ignores a blank name", () => {
    const id = t().create("p1");
    t().rename(id, "  checkout split ");
    t().rename(id, "   ");
    expect(t().sessions[0].title).toBe("checkout split");
  });

  it("restores saved sessions, dropping what isn't a session or a pane", () => {
    const saved = [{ id: "s1", projectId: "p1", title: "", createdAt: 1, updatedAt: 2, panes: [{ id: "a", engine: "codex", copy: true }, { nope: 1 }] }, { id: "s2" }, null];
    expect(restored(saved, null)).toEqual([{ id: "s1", projectId: "p1", title: NEW_TITLE, createdAt: 1, updatedAt: 2, panes: [{ id: "a", engine: "codex", model: "", copy: true, task: null, title: "", run: 0 }] }]);
  });

  it("turns the old single grid into one session per project, leaving out panes without one", () => {
    const old = [{ id: "a", projectId: "p1", engine: "codex" }, { id: "b", projectId: "p2", engine: "claude-code", copy: true }, { id: "c", projectId: "p1", engine: "antigravity" }, { id: "d", projectId: null, engine: "codex" }];
    const sessions = restored(null, old);
    expect(sessions.map((s) => [s.projectId, s.panes.map((p) => p.id)])).toEqual([["p1", ["a", "c"]], ["p2", ["b"]]]);
  });

  it("lays panes out side by side up to three, then in a 2×2, then three across", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(columnsFor)).toEqual([1, 1, 2, 3, 2, 3, 3]);
  });
});
