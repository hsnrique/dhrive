import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepRequest } from "@/lib/api";
import { EMPTY_BRIEF } from "@/lib/company";

const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let percent = 10;

vi.mock("@/lib/api", () => ({
  readCompanyRecord: vi.fn(async () => null),
  saveCompanyRecord: vi.fn(async () => undefined),
  archiveCompanyRecord: vi.fn(async () => undefined),
  readCompany: vi.fn(async () => ""),
  saveCompany: vi.fn(async () => undefined),
  readDocuments: vi.fn(async () => []),
  publishSite: vi.fn(async () => ({ url: "https://acme.dhrive.site" })),
  keepAwake: vi.fn(async () => undefined),
  planUsage: vi.fn(async () => ({ plan: null, account: null, windows: [{ label: "5-hour", percent, resetsAt: null, warn: false }], shares: [], notes: [] })),
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  runChecks: vi.fn(async () => ({ kind: "skipped", why: "Only documents changed." })),
  stopRun: vi.fn(async (runId: string) => {
    pending.get(runId)?.reject(new Error("killed"));
    pending.delete(runId);
  }),
}));

const api = await import("@/lib/api");
const { useApp } = await import("./app");
const { useCompany } = await import("./company");
const { EMPTY_DAY, useDay } = await import("./day");
const { OFF, useAuto } = await import("./auto");

const P = "p1";
const auto = () => useAuto.getState().byProject[P] ?? OFF;
const tasks = () => useDay.getState().byProject[P]?.tasks ?? [];
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const last = () => [...pending.values()].pop()!;
const reply = async (output: string) => {
  const call = last();
  pending.delete(call.request.runId);
  call.resolve({ output, usage: null, sessionId: null, needsAnswers: false, blocked: [] });
  await settle();
};
const fail = async () => {
  const call = last();
  pending.delete(call.request.runId);
  call.reject(new Error("broke"));
  await settle();
};
const ONE = JSON.stringify([{ title: "Ads", area: "marketing", prompt: "Write ads" }]);

describe("auto mode", () => {
  beforeEach(() => {
    pending.clear();
    percent = 10;
    vi.mocked(api.keepAwake).mockClear();
    useApp.setState({ projects: [{ id: P, name: "Acme", folder: "/acme", createdAt: 0 }], clis: [{ engine: "claude-code", installed: true }] as never, choices: { plan: { engine: "claude-code", model: "opus" }, code: null } });
    useCompany.setState({ byProject: { [P]: { brief: { ...EMPTY_BRIEF, goals: "First customers" }, saving: "saved", runId: null, error: null } }, choice: null });
    // Asking first is on, and auto mode doesn't wait for it.
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY, ask: true } } });
    useAuto.setState({ byProject: {} });
  });

  it("suggests, works, suggests again, and stops when nothing is worth doing", async () => {
    useAuto.getState().start(P, 1);
    await settle();
    expect(api.keepAwake).toHaveBeenLastCalledWith(true);
    expect(last().request.step).toBe("day");
    await reply(ONE);
    expect(last().request.step).toBe("code");
    await reply("Wrote ads");
    expect(last().request.step).toBe("day");
    await reply("[]");
    expect(tasks().map((t) => [t.title, t.status])).toEqual([["Ads", "done"]]);
    expect(auto()).toEqual({ until: null, ended: "Nothing worth doing right now" });
    expect(api.keepAwake).toHaveBeenLastCalledWith(false);
  });

  it("stops after two failures in a row", async () => {
    useAuto.getState().start(P, 1);
    await settle();
    await reply(JSON.stringify([{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }]));
    await fail();
    await fail();
    expect(auto().ended).toBe("2 tasks failed in a row");
  });

  it("a task stuck behind a failed one isn't retried round after round: auto mode suggests more and ends", async () => {
    useAuto.getState().start(P, 1);
    await settle();
    await reply(JSON.stringify([{ title: "A", prompt: "a" }, { title: "B", prompt: "b", after: ["A"] }, { title: "C", prompt: "c", after: ["B"] }]));
    await fail();
    expect(last().request.step, "B and C can't start, so the next round asks for more").toBe("day");
    await reply("[]");
    expect(tasks().map((t) => [t.title, t.status])).toEqual([["A", "failed"], ["B", "planned"], ["C", "planned"]]);
    expect(auto().ended).toBe("Nothing worth doing right now");
    expect(pending.size).toBe(0);
  });

  it("won't start a round near the plan's limit", async () => {
    percent = 95;
    useAuto.getState().start(P, 1);
    await settle();
    expect(pending.size).toBe(0);
    expect(auto().ended).toBe("5-hour limit is at 95%");
  });

  it("runs on Ollama with no plan to check, on the model picked there", async () => {
    percent = 95;
    useApp.setState({ clis: [{ engine: "claude-code", installed: true }, { engine: "ollama", installed: true }] as never });
    useCompany.setState({ choice: { engine: "ollama", model: "qwen3-coder:30b" } });
    vi.mocked(api.planUsage).mockClear();
    useAuto.getState().start(P, 1);
    await settle();
    expect(api.planUsage).not.toHaveBeenCalled();
    expect(last().request).toMatchObject({ engine: "ollama", model: "qwen3-coder:30b", step: "day" });
  });

  it("stopping it stops the work in flight", async () => {
    useAuto.getState().start(P, 1);
    await settle();
    await reply(ONE);
    useAuto.getState().stop(P);
    await settle();
    expect(tasks()[0].status).toBe("stopped");
    expect(auto()).toEqual(OFF);
    expect(pending.size).toBe(0);
  });

  it("stopping after this task lets the running one land and starts nothing more", async () => {
    useAuto.getState().start(P, 1);
    await settle();
    await reply(JSON.stringify([{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }]));
    useAuto.getState().finish(P);
    await settle();
    expect(auto()).toEqual({ until: null, ended: "what's running finishes first" });
    expect(tasks()[0].status, "still running, not cut off").toBe("running");
    await reply("A done");
    expect(tasks().map((t) => [t.title, t.status])).toEqual([["A", "done"], ["B", "planned"]]);
    expect(pending.size, "B never starts").toBe(0);
  });
});
