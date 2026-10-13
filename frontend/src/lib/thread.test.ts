import { describe, expect, it } from "vitest";

import { activeRun, approved, awaitingReview, emptyThread, interruptStale, newRequest, nextUp, sessionFor, toReview, updateStage, withRunChanges, withRunSession, withSession, type RunMessage, type Thread } from "./thread";

let counter = 0;
const makeId = () => `m${++counter}`;
const opus = { engine: "claude-code" as const, model: "opus" };
const sonnet = { engine: "claude-code" as const, model: "sonnet" };

function threadWithRequest(plan = true): [Thread, string] {
  const [user, run] = newRequest("add dark mode", plan ? opus : null, sonnet, 1, makeId);
  return [{ ...emptyThread(), messages: [user, run] }, run.id];
}

describe("thread", () => {
  it("a request waits on both stages, or only on code when planning is off", () => {
    const [thread, id] = threadWithRequest();
    expect(activeRun(thread)).toMatchObject({ step: "plan", message: { id } });
    const [codeOnly] = threadWithRequest(false);
    expect(activeRun(codeOnly)?.step).toBe("code");
  });

  it("updates one stage and leaves every other message alone", () => {
    const [thread, id] = threadWithRequest();
    const next = updateStage(thread, id, "plan", { status: "done", output: "1. toggle" });
    expect(next.messages[1]).toMatchObject({ plan: { status: "done", output: "1. toggle" }, code: { status: "waiting" } });
    expect(next.messages[0]).toBe(thread.messages[0]);
    expect(activeRun(next)?.step).toBe("code");
  });

  it("a finished plan waits for the owner, a newer plan replaces an older one, and approving lets the code run", () => {
    const [first, firstId] = threadWithRequest();
    const [second] = threadWithRequest();
    const secondId = second.messages[1].id;
    let thread: Thread = { ...first, messages: [...first.messages, ...second.messages] };
    thread = toReview(updateStage(thread, firstId, "plan", { status: "done", output: "1. toggle" }), firstId);
    expect(awaitingReview(thread)).toBe(true);
    expect(activeRun(thread)?.message.id, "a plan in review doesn't hold the queue").toBe(secondId);

    thread = toReview(updateStage(thread, secondId, "plan", { status: "done", output: "1. toggle\n2. persist" }), secondId);
    const codeOf = (t: Thread, id: string) => (t.messages.find((m) => m.id === id) as RunMessage).code.status;
    expect([codeOf(thread, firstId), codeOf(thread, secondId)]).toEqual(["declined", "review"]);
    expect(approved(thread, firstId), "a replaced plan can't be approved").toBe(thread);

    const edited = approved(thread, secondId, "  1. toggle\n2. persist in localStorage ");
    expect((edited.messages[3] as RunMessage).plan).toMatchObject({ output: "1. toggle\n2. persist in localStorage", edited: true });
    expect(nextUp(edited)).toMatchObject({ step: "code", message: { id: secondId } });
    expect(awaitingReview(edited)).toBe(false);
    expect((approved(thread, secondId, "1. toggle\n2. persist").messages[3] as RunMessage).plan?.edited, "unchanged is not an edit").toBeUndefined();
    expect(approved(edited, secondId), "approving twice does nothing").toBe(edited);
  });

  it("a stage that was running when the app closed comes back interrupted", () => {
    const [thread, id] = threadWithRequest();
    const reopened = interruptStale(updateStage(thread, id, "plan", { status: "running" }));
    expect(reopened.messages[1]).toMatchObject({ plan: { status: "interrupted" }, code: { status: "interrupted" } });
    expect(activeRun(reopened)).toBeNull();
  });

  it("remembers a session per CLI only while context is kept", () => {
    const kept = withSession(emptyThread(), "codex", "t-1");
    expect(sessionFor(kept, "codex")).toBe("t-1");
    expect(sessionFor(kept, "claude-code")).toBeUndefined();
    const off = { ...kept, keepContext: false };
    expect(sessionFor(off, "codex")).toBeUndefined();
    expect(withSession(off, "claude-code", "s-1").sessions["claude-code"]).toBeUndefined();
  });

  it("a session named while a run is going is kept for that run's CLI, and only for a known run", () => {
    const [thread, id] = threadWithRequest();
    const running = updateStage(thread, id, "plan", { status: "running", runId: "r1" });
    expect(sessionFor(withRunSession(running, "r1", "s-1"), "claude-code")).toBe("s-1");
    expect(withRunSession(running, "other", "s-2")).toBe(running);
    expect(withRunSession({ ...running, keepContext: false }, "r1", "s-1").sessions).toEqual({});
  });

  it("a run's changes land on its own stage", () => {
    const [thread, id] = threadWithRequest();
    const running = updateStage(thread, id, "code", { status: "running", runId: "r2" });
    const changes = { before: "a".repeat(40), after: "b".repeat(40), files: [{ path: "theme.ts", status: "modified" as const, additions: 2, deletions: 1 }] };
    const [, run] = withRunChanges(running, "r2", changes).messages as [unknown, RunMessage];
    expect([run.code.changes, run.plan?.changes]).toEqual([changes, undefined]);
    expect(withRunChanges(running, "nope", changes)).toBe(running);
  });
});
