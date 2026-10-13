import { describe, expect, it } from "vitest";

import { outcome } from "./outcome";
import { newRequest, updateStage, type RunMessage, type Thread } from "./thread";

const opus = { engine: "claude-code" as const, model: "opus" };
let n = 0;
const request = (plan: boolean, chat = false): [Thread, RunMessage] => {
  const [user, run] = newRequest("x", plan ? opus : null, opus, 0, () => `m${++n}`, chat);
  return [{ messages: [user, run], sessions: {} }, run];
};
const after = (thread: Thread, run: RunMessage, changes: Parameters<typeof updateStage>[3], step: "plan" | "code" = "code") => updateStage(thread, run.id, step, changes).messages[1] as RunMessage;

describe("a finished request's outcome", () => {
  it("says what happened, and whether it needs the owner", () => {
    const [thread, run] = request(true);
    expect(outcome(after(thread, run, { status: "done" }))).toEqual({ text: "Done.", needsYou: false });
    expect(outcome(after(thread, run, { status: "held" }))).toEqual({ text: "The plan has questions for you.", needsYou: true });
    expect(outcome(after(thread, run, { status: "failed" }, "plan"))).toEqual({ text: "The plan failed.", needsYou: true });
    const changes = { before: "a".repeat(40), after: "b".repeat(40), files: [{ path: "a.ts", status: "added" as const, additions: 1, deletions: 0 }, { path: "b.ts", status: "modified" as const, additions: 1, deletions: 1 }] };
    expect(outcome(after(thread, run, { status: "done", changes }))?.text).toBe("Done. 2 files changed.");
  });

  it("stays quiet when the owner stopped it or it never finished", () => {
    const [thread, run] = request(false);
    expect(outcome(after(thread, run, { status: "stopped" }))).toBeNull();
    expect(outcome(after(thread, run, { status: "interrupted" }))).toBeNull();
  });

  it("calls a chat's answer a reply", () => {
    const [thread, run] = request(false, true);
    expect(outcome(after(thread, run, { status: "done" }))?.text).toBe("Replied.");
    expect(outcome(after(thread, run, { status: "failed" }))?.text).toBe("The reply failed.");
  });
});
