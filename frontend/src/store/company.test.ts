import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepRequest } from "@/lib/api";

// Each draft stays pending until the test settles it, so a stop can land before the reply.
const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let file = "";
const saveCompany = vi.fn(async (_project: string, text: string) => void (file = text));
let record: unknown = null;
const saveCompanyRecord = vi.fn(async () => undefined);

vi.mock("@/lib/api", () => ({
  readCompany: vi.fn(async () => file),
  saveCompany,
  readCompanyRecord: vi.fn(async () => record),
  saveCompanyRecord,
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  stopRun: vi.fn(async (runId: string) => pending.get(runId)?.reject(new Error("killed"))),
}));

const { useApp } = await import("./app");
const { useConversations } = await import("./conversations");
const { companyAgent, useCompany } = await import("./company");

const P = "p1";
const company = () => useCompany.getState().byProject[P];
const only = () => [...pending.values()].pop()!;
const reply = (output: string) => only().resolve({ output, usage: null, sessionId: null, needsAnswers: false, blocked: [] });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a project's company", () => {
  beforeEach(() => {
    vi.useRealTimers();
    pending.clear();
    saveCompany.mockClear();
    file = "# planilha.\n\n## Voice\n\nPlain.";
    useApp.setState({ projects: [{ id: P, name: "planilha.", folder: "/planilha", createdAt: 0 }], page: null, choices: { plan: { engine: "claude-code", model: "opus" }, code: null } });
    useCompany.setState({ openId: null, byProject: {}, choice: null, agents: {} });
    record = null;
  });

  it("opens as a page of its own, with the brief read from COMPANY.md", async () => {
    useConversations.setState({ open: { projectId: P, conversationId: "c1", from: null } });
    useCompany.getState().open(P);
    await settle();
    expect(useApp.getState().page).toBe("company");
    expect(useConversations.getState().open).toBeNull();
    expect(company().brief).toMatchObject({ voice: "Plain.", product: "" });
  });

  it("saves to COMPANY.md once the owner stops typing", async () => {
    await useCompany.getState().load(P);
    vi.useFakeTimers();
    useCompany.getState().change(P, "product", "A sheet");
    useCompany.getState().change(P, "product", "A finance sheet");
    expect(company().saving).toBe("saving");
    await vi.runAllTimersAsync();
    expect(saveCompany).toHaveBeenCalledTimes(1);
    expect(file).toBe("# planilha.\n\n## Product\n\nA finance sheet\n\n## Voice\n\nPlain.");
    expect(company().saving).toBe("saved");
  });

  it("drafts from the project on the planner's CLI, filling only what's empty", async () => {
    await useCompany.getState().load(P);
    void useCompany.getState().draft(P);
    expect(only().request).toMatchObject({ step: "company", engine: "claude-code", model: "opus", folder: "/planilha" });
    reply('{"product": "Finance without friction", "voice": "Loud"}');
    await settle();
    expect(company()).toMatchObject({ runId: null, error: null });
    expect(company().brief).toMatchObject({ product: "Finance without friction", voice: "Plain." });
  });

  it("says so when the CLI returns no brief, and a stop drops the draft", async () => {
    await useCompany.getState().load(P);
    void useCompany.getState().draft(P);
    reply("Sorry, I can't.");
    await settle();
    expect(company().error).toContain("didn't return a brief");
    void useCompany.getState().draft(P);
    useCompany.getState().stop(P);
    await settle();
    expect(company()).toMatchObject({ runId: null });
    expect(company().brief?.product).toBe("");
  });

  it("each company works with its own agent, and one without works with the default", () => {
    useApp.setState({ clis: [{ engine: "claude-code", installed: true }, { engine: "codex", installed: true }] as never });
    useCompany.getState().choose({ engine: "claude-code", model: "sonnet" });
    useCompany.getState().choose({ engine: "codex", model: "gpt-5.5" }, P);
    expect(companyAgent(P)).toEqual({ engine: "codex", model: "gpt-5.5" });
    expect(companyAgent("p2")).toEqual({ engine: "claude-code", model: "sonnet" });
    expect(saveCompanyRecord).toHaveBeenLastCalledWith(P, "agent", { engine: "codex", model: "gpt-5.5" });
  });

  it("reads a company's agent from its record when it opens, and a CLI gone falls back", async () => {
    useApp.setState({ clis: [{ engine: "codex", installed: true }] as never });
    record = { engine: "codex", model: "gpt-5.5", effort: "high" };
    await useCompany.getState().load(P);
    await settle();
    expect(companyAgent(P)).toEqual({ engine: "codex", model: "gpt-5.5", effort: "high" });
    useApp.setState({ clis: [] as never });
    expect(companyAgent(P), "its CLI isn't installed anymore").toEqual({ engine: "claude-code", model: "opus" });
  });
});
