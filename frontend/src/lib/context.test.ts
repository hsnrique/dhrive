import { describe, expect, it } from "vitest";

import { fullness, percentOf, sessionsOf, tokens } from "./context";
import { emptyThread, newRequest, updateStage, type Thread } from "./thread";

describe("context meter", () => {
  it("lists each CLI session a conversation continues, with the model its latest stage there used", () => {
    let n = 0;
    const [user, run] = newRequest("add dark mode", { engine: "claude-code", model: "opus" }, { engine: "codex", model: "gpt-6-astra" }, 1, () => `m${++n}`);
    const [user2, chat] = newRequest("why?", null, { engine: "claude-code", model: "haiku" }, 2, () => `m${++n}`, true);
    let thread: Thread = { ...emptyThread(), messages: [user, run, user2, chat], sessions: { "claude-code": "s-claude", codex: "t-codex" } };
    thread = updateStage(thread, run.id, "plan", { status: "done" });
    expect(sessionsOf(thread)).toEqual([
      { engine: "claude-code", session: "s-claude", model: "haiku" },
      { engine: "codex", session: "t-codex", model: "gpt-6-astra" },
    ]);
    expect(sessionsOf({ ...thread, keepContext: false }), "context off keeps no sessions").toEqual([]);
    expect(sessionsOf(undefined)).toEqual([]);
    expect(sessionsOf({ ...thread, sessions: { antigravity: "c-agy" } }), "Antigravity reports no context").toEqual([]);
  });

  it("says token counts and how full a session is at a glance", () => {
    expect([tokens(900), tokens(4638), tokens(49_855), tokens(200_000), tokens(1_000_000), tokens(1_250_000)]).toEqual(["900", "4.6k", "50k", "200k", "1M", "1.3M"]);
    expect([percentOf(49_855, 200_000), percentOf(5, 0), percentOf(300, 200)]).toEqual([25, 0, 100]);
    expect([fullness(25), fullness(70), fullness(93)]).toEqual(["ok", "high", "full"]);
  });
});
