import { describe, expect, it } from "vitest";

import type { Cli } from "@/lib/api";
import { appendLog, defaultChoice, restoreChoice, restoreMode, stagesFor } from "./flow";
import { ago, formatElapsed } from "./time";

const cli = (engine: Cli["engine"], installed: boolean): Cli => ({ engine, installed, label: engine, docsUrl: "", version: null, updatedFrom: null, missing: [] });

describe("defaultChoice", () => {
  it("plans with Opus and codes with Sonnet when Claude Code is installed", () => {
    const clis = [cli("claude-code", true), cli("codex", true)];
    expect(defaultChoice("plan", clis)).toEqual({ engine: "claude-code", model: "opus" });
    expect(defaultChoice("code", clis)).toEqual({ engine: "claude-code", model: "sonnet" });
  });

  it("falls back to whatever is installed, on its default model, or nothing", () => {
    expect(defaultChoice("plan", [cli("claude-code", false), cli("codex", true)])).toEqual({ engine: "codex", model: "" });
    expect(defaultChoice("code", [cli("claude-code", false), cli("codex", false)])).toBeNull();
  });
});

describe("restoreChoice", () => {
  it("keeps a saved choice only while its CLI is installed", () => {
    const clis = [cli("claude-code", false), cli("codex", true)];
    expect(restoreChoice({ engine: "codex", model: "gpt-6-astra" }, "plan", clis)).toEqual({ engine: "codex", model: "gpt-6-astra" });
    expect(restoreChoice({ engine: "claude-code", model: "opus" }, "plan", clis)).toEqual({ engine: "codex", model: "" });
    expect(restoreChoice("garbage", "plan", clis)).toEqual({ engine: "codex", model: "" });
    expect(restoreChoice({ engine: "codex", model: "", effort: "xhigh" }, "plan", clis)).toEqual({ engine: "codex", model: "", effort: "xhigh" });
    expect(restoreChoice({ engine: "codex", model: "", effort: 3 }, "plan", clis)).toEqual({ engine: "codex", model: "" });
  });
});

describe("appendLog", () => {
  it("splits batched chunks into lines, drops blanks and keeps only the latest", () => {
    expect(appendLog(["a"], "b\n\nc")).toEqual(["a", "b", "c"]);
    expect(appendLog(["a", "b"], "c\nd", 3)).toEqual(["b", "c", "d"]);
  });
});

describe("formatElapsed", () => {
  it("reads like a clock", () => {
    expect(formatElapsed(42_400)).toBe("0:42");
    expect(formatElapsed(727_000)).toBe("12:07");
    expect(formatElapsed(3_800_000)).toBe("1:03:20");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("modes", () => {
  const plan = { engine: "claude-code" as const, model: "opus" };
  const code = { engine: "codex" as const, model: "gpt-6-sol" };

  it("chat talks with the planner, relay plans then codes, code goes straight to the coder", () => {
    expect(stagesFor("chat", { plan, code })).toEqual({ plan: null, main: plan });
    expect(stagesFor("relay", { plan, code })).toEqual({ plan, main: code });
    expect(stagesFor("code", { plan, code })).toEqual({ plan: null, main: code });
  });

  it("keeps a saved mode and reads the old plan switch otherwise", () => {
    expect(restoreMode("chat", true)).toBe("chat");
    expect(restoreMode(null, false)).toBe("code");
    expect(restoreMode(null, null)).toBe("relay");
    expect(restoreMode("nonsense", true)).toBe("relay");
  });
});

describe("ago", () => {
  it("says when a session was last used in the largest whole unit", () => {
    const now = 1_000_000_000_000;
    expect(ago(now - 20_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(ago(now - 4 * 3_600_000, now)).toBe("4 h ago");
    expect(ago(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });
});
