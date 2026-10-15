import { describe, expect, it } from "vitest";

import { aheadOfQueue, needsOwner, unfinished, upNext } from "./attention";
import type { Task } from "./day";

const task = (id: string, status: Task["status"], runId: string | null = null): Task => ({ id, title: id, area: "code", engine: "claude-code", model: "", prompt: id, status, runId, result: "" });
const asking = (ids: string[]) => (runId: string) => ids.includes(runId);

describe("what waits on the owner", () => {
  it("sees a tool call on any running task, not only the first, and counts them", () => {
    const army = [task("a", "running", "r1"), task("b", "running", "r2"), task("c", "running", "r3")];
    expect(needsOwner(army, asking([]), false)).toBeNull();
    expect(needsOwner(army, asking(["r3"]), false)).toBe("A task needs your OK");
    expect(needsOwner(army, asking(["r2", "r3"]), false)).toBe("2 tasks need your OK");
  });

  it("counts suggestions only while Ask first holds them for an OK, after any tool call", () => {
    const day = [task("s1", "suggested"), task("s2", "suggested")];
    expect(needsOwner(day, asking([]), false)).toBeNull();
    expect(needsOwner(day, asking([]), true)).toBe("2 suggestions wait for your OK");
    expect(needsOwner([...day, task("a", "running", "r1")], asking(["r1"]), true)).toBe("A task needs your OK");
  });

  it("puts what asks first, then what runs, then what waits, so the cap never hides it", () => {
    const tasks = [task("p1", "planned"), task("p2", "planned"), task("p3", "planned"), task("p4", "planned"), task("run", "running", "r1"), task("asks", "running", "r2"), task("done", "done")];
    expect(upNext(tasks, asking(["r2"])).map((t) => t.id)).toEqual(["asks", "run", "p1", "p2", "p3", "p4"]);
  });

  it("keeps what failed or was stopped apart, and a retry ahead of what waits", () => {
    const tasks = [task("ok", "done"), task("bad", "failed"), task("halted", "stopped"), task("p1", "planned"), task("p2", "planned")];
    expect(unfinished(tasks).map((t) => t.id)).toEqual(["bad", "halted"]);
    expect(aheadOfQueue(tasks.filter((t) => t.id !== "bad"), task("bad", "planned")).map((t) => t.id)).toEqual(["ok", "halted", "bad", "p1", "p2"]);
    expect(aheadOfQueue([task("ok", "done")], task("bad", "planned")).map((t) => t.id), "with nothing waiting, it simply goes last").toEqual(["ok", "bad"]);
  });
});
