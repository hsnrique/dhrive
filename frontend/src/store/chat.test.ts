import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepRequest } from "@/lib/api";
import { EMPTY_BRIEF } from "@/lib/company";
import { entry } from "@/lib/log";

const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();

vi.mock("@/lib/api", () => ({
  readCompanyRecord: vi.fn(async () => null),
  saveCompanyRecord: vi.fn(async () => undefined),
  archiveCompanyRecord: vi.fn(async () => undefined),
  readCompany: vi.fn(async () => ""),
  saveCompany: vi.fn(async () => undefined),
  readDocuments: vi.fn(async () => []),
  publishSite: vi.fn(async () => ({ url: "https://acme.dhrive.site" })),
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  stopRun: vi.fn(async (runId: string) => {
    pending.get(runId)?.reject(new Error("killed"));
    pending.delete(runId);
  }),
}));

const { useApp } = await import("./app");
const { useCompany } = await import("./company");
const { EMPTY_DAY, useDay } = await import("./day");
const { useLog } = await import("./log");
const { useChat } = await import("./chat");

const P = "p1";
const log = () => useLog.getState().byProject[P] ?? [];
const latest = () => log()[log().length - 1];
const last = () => [...pending.values()].pop()!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const reply = async (output: string, sessionId = "s1") => {
  const call = last();
  pending.delete(call.request.runId);
  call.resolve({ output, usage: null, sessionId, needsAnswers: false, blocked: [] });
  await settle();
};

describe("a company's chat", () => {
  beforeEach(() => {
    pending.clear();
    useApp.setState({ projects: [{ id: P, name: "Acme", folder: "/acme", createdAt: 0 }], clis: [{ engine: "claude-code", installed: true }] as never, choices: { plan: { engine: "claude-code", model: "opus" }, code: null } });
    useCompany.setState({ byProject: { [P]: { brief: { ...EMPTY_BRIEF, goals: "First customers" }, saving: "saved", runId: null, error: null } }, choice: null });
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY } } });
    useLog.setState({ byProject: { [P]: [entry("done", "Landing page")] } });
    useChat.setState({ byProject: {}, sessions: {} });
  });

  it("asks the agent, reading only, with what happened since it last spoke", async () => {
    void useChat.getState().ask(P, "  how are we doing? ");
    expect(last().request).toMatchObject({ step: "talk", engine: "claude-code", model: "opus", folder: "/acme", resume: undefined });
    expect(last().request.task).toBe("What happened since we last spoke:\n- Done: Landing page\n\nhow are we doing?");
    await reply("Good.");
    expect(log().map((e) => [e.kind, e.text])).toEqual([["done", "Landing page"], ["owner", "how are we doing?"], ["agent", "Good."]]);
  });

  it("carries on in the same session, hearing only what's new", async () => {
    void useChat.getState().ask(P, "hi");
    await reply("Hi.");
    void useChat.getState().ask(P, "and now?");
    expect(last().request).toMatchObject({ resume: "s1", task: "and now?" });
    await reply("Still good.");
  });

  it("turns suggested work into tasks the owner adds once", async () => {
    void useChat.getState().ask(P, "what next?");
    await reply('A pricing page.\n```tasks\n[{"title": "Pricing page", "area": "code", "prompt": "Add a pricing page"}]\n```');
    const said = latest();
    expect(said.text).toBe("A pricing page.");
    useChat.getState().addTask(P, said.id, said.tasks![0].id);
    useChat.getState().addTask(P, said.id, said.tasks![0].id);
    expect(useDay.getState().byProject[P].tasks.map((t) => [t.title, t.status])).toEqual([["Pricing page", "running"]]);
    expect(latest().added).toEqual([said.tasks![0].id]);
  });

  it("stops a question in flight without an answer or an error", async () => {
    void useChat.getState().ask(P, "long one");
    useChat.getState().stop(P);
    await settle();
    expect(useChat.getState().byProject[P]).toEqual({ runId: null, error: null });
    expect(latest().kind).toBe("owner");
  });
});
