import { describe, expect, it } from "vitest";

import type { Engine, PlanUsage } from "./api";
import { newAgent } from "./army";
import { ownTask } from "./day";
import { enginesFor, route } from "./logistics";

const NOW = 1_800_000_000_000;
const plan = (percent: number): PlanUsage => ({ plan: "Max", account: "a@b.c", windows: [{ label: "Session (5 h)", percent, resetsAt: NOW / 1000 + 3600, warn: percent >= 90 }], shares: [], notes: [] });
const usage = (byEngine: Partial<Record<Engine, PlanUsage>>) => (engine: Engine) => byEngine[engine];

const claude = { engine: "claude-code" as const, model: "opus" };
const task = ownTask("Add the API", "code", claude)!;

describe("an army's logistics", () => {
  it("lets a task go while its plan has room, and on Ollama always", () => {
    expect(route(task, undefined, usage({ "claude-code": plan(40) }), NOW)).toEqual({ kind: "go" });
    expect(route({ ...task, engine: "ollama", model: "qwen3" }, undefined, usage({}), NOW)).toEqual({ kind: "go" });
  });

  it("moves it to its agent's backup near the limit, when the backup has room", () => {
    const back = { ...newAgent("Back", "", claude)!, fallback: { engine: "codex" as const, model: "gpt-6" } };
    const r = route({ ...task, agentId: back.id }, back, usage({ "claude-code": plan(95), codex: plan(20) }), NOW);
    expect(r).toEqual({ kind: "switch", to: back.fallback, note: "Claude Code: Session (5 h) limit is at 95%, so it runs on Codex instead" });
  });

  it("holds it when there's no backup, or the backup is full too, and never picks a model itself", () => {
    const back = { ...newAgent("Back", "", claude)!, fallback: { engine: "codex" as const, model: "" } };
    expect(route(task, undefined, usage({ "claude-code": plan(95) }), NOW)).toEqual({ kind: "hold", why: "Claude Code: Session (5 h) limit is at 95%" });
    expect(route(task, back, usage({ "claude-code": plan(95), codex: plan(97) }), NOW).kind).toBe("hold");
  });

  it("asks only the CLIs with a plan: the tasks' own and their backups'", () => {
    const back = { ...newAgent("Back", "", claude)!, fallback: { engine: "codex" as const, model: "" } };
    expect(enginesFor([{ ...task, agentId: back.id }, { ...task, engine: "ollama" }], [back]).sort()).toEqual(["claude-code", "codex"]);
  });
});
