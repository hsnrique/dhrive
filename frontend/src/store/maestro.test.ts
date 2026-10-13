import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepRequest } from "@/lib/api";

// Each split stays pending until the test settles it, so a stop can land before the reply.
const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();

vi.mock("@/lib/api", () => ({
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  stopRun: vi.fn(async (runId: string) => pending.get(runId)?.reject(new Error("killed"))),
}));

const { useApp } = await import("./app");
const { useTerminals } = await import("./terminals");
const { EMPTY, savedDrafts, useMaestro } = await import("./maestro");

const S = "s1";
const maestro = () => useMaestro.getState();
const draft = () => maestro().bySession[S] ?? EMPTY;
const only = () => [...pending.values()].pop()!;
const reply = (output: string) => only().resolve({ output, usage: null, sessionId: null, needsAnswers: false, blocked: [] });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a session's maestro", () => {
  beforeEach(() => {
    pending.clear();
    useApp.setState({ projects: [{ id: "p1", name: "shop", folder: "/shop", createdAt: 0 }] });
    useTerminals.setState({ sessions: [{ id: S, projectId: "p1", title: "Terminals", createdAt: 0, updatedAt: 0, panes: [] }] });
    useMaestro.setState({ bySession: { [S]: { ...EMPTY, engine: "codex", brief: "add dark mode" } } });
  });

  it("asks the chosen CLI to split the brief in the session's project and keeps the subtasks for review", async () => {
    const done = maestro().split(S, ["claude-code", "codex"]);
    expect(only().request).toMatchObject({ folder: "/shop", step: "split", engine: "codex", task: "add dark mode" });
    expect(draft().runId).not.toBeNull();
    reply('[{"title":"Toggle","cli":"claude","prompt":"Add a toggle"},{"title":"Theme","cli":"codex","prompt":"Add the tokens"}]');
    await done;
    expect(draft().runId).toBeNull();
    expect(draft().parts.map((p) => [p.title, p.engine])).toEqual([["Toggle", "claude-code"], ["Theme", "codex"]]);
    const [first, second] = draft().parts;
    maestro().edit(S, first.id, { engine: "codex", prompt: "Add a toggle to the header" });
    maestro().drop(S, second.id);
    expect(draft().parts).toEqual([{ ...first, engine: "codex", prompt: "Add a toggle to the header" }]);
    expect(maestro().bySession.other).toBeUndefined();
    expect(useTerminals.getState().sessions[0].title).toBe("add dark mode");
  });

  it("opens the approved subtasks as panes at work, and closes itself", async () => {
    const done = maestro().split(S, ["codex"]);
    reply('[{"title":"API","cli":"codex","prompt":"Add the route"},{"title":"UI","cli":"codex","prompt":"Add the page"}]');
    await done;
    maestro().edit(S, draft().parts[0].id, { model: "gpt-5.5" });
    maestro().set(S, { open: true });
    expect(maestro().run(S)).toBe(true);
    expect(useTerminals.getState().sessions[0].panes.map((p) => [p.engine, p.model, p.task, p.copy])).toEqual([["codex", "gpt-5.5", "Add the route", true], ["codex", "", "Add the page", true]]);
    // The split stays, marked as run, until the owner clears it.
    expect(draft()).toMatchObject({ open: false, brief: "add dark mode", engine: "codex" });
    expect(draft().parts).toHaveLength(2);
    expect(draft().ranAt).not.toBeNull();
    maestro().clear(S);
    expect(draft()).toMatchObject({ parts: [], brief: "", ranAt: null });
  });

  it("asks for the picked skills and servers, and keeps every session's maestro but the forgotten ones", async () => {
    maestro().set(S, { focus: [{ kind: "skill", name: "tdd" }] });
    void maestro().split(S, ["codex"]);
    expect(only().request.task).toContain("Skills: tdd");
    maestro().forget(S);
    expect(maestro().bySession[S]).toBeUndefined();
  });

  it("brings back saved maestros without anything in flight", () => {
    const saved = savedDrafts({ s1: { engine: "codex", brief: "b", focus: [{ kind: "skill", name: "x" }, { kind: "nope", name: 1 }], parts: [{ id: "a", title: "t", engine: "codex", model: "", prompt: "p" }], ranAt: 5, runId: "r", open: true } });
    expect(saved.s1).toMatchObject({ open: false, runId: null, engine: "codex", brief: "b", focus: [{ kind: "skill", name: "x" }], ranAt: 5 });
    expect(saved.s1.parts).toHaveLength(1);
    expect(savedDrafts(null)).toEqual({});
  });

  it("splits with the first usable CLI until the owner picks one, and keeps a name the owner gave", async () => {
    useTerminals.getState().rename(S, "checkout");
    maestro().set(S, { engine: null });
    void maestro().split(S, ["antigravity", "codex"]);
    expect(only().request.engine).toBe("antigravity");
    expect(useTerminals.getState().sessions[0].title).toBe("checkout");
  });

  it("says so when the reply holds no subtasks, and when the CLI fails", async () => {
    let done = maestro().split(S, ["codex"]);
    reply("I would rather not.");
    await done;
    expect(draft().error).toMatch(/didn't return any subtasks/);
    done = maestro().split(S, ["codex"]);
    only().reject(new Error("Codex is not signed in"));
    await done;
    expect(draft()).toMatchObject({ runId: null, error: "Error: Codex is not signed in" });
  });

  it("drops a stopped split's reply, and runs nothing without a brief or a project", async () => {
    const done = maestro().split(S, ["codex"]);
    maestro().stop(S);
    await done;
    await settle();
    expect(draft()).toMatchObject({ runId: null, parts: [], error: null });
    maestro().set(S, { brief: "   " });
    await maestro().split(S, ["codex"]);
    maestro().set("orphan", { brief: "x" });
    await maestro().split("orphan", ["codex"]);
    expect(pending.size).toBe(1);
  });
});
