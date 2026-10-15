import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project, StepRequest } from "@/lib/api";
import { FIRST_DELIVERY, parseFounding, surprise } from "@/lib/founding";

// Each run stays pending until the test settles it, so a stop can land before the reply.
const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const LAPSE: Project = { id: "p9", name: "Lapse", folder: "/home/dhrive/lapse", createdAt: 0 } as Project;
const foundCompany = vi.fn(async () => LAPSE);

vi.mock("@/lib/api", () => ({
  readCompanyRecord: vi.fn(async () => null),
  saveCompanyRecord: vi.fn(async () => undefined),
  archiveCompanyRecord: vi.fn(async () => undefined),
  foundingDir: vi.fn(async () => "/data/founding"),
  foundCompany,
  readCompany: vi.fn(async () => "# Lapse\n\n## Goals\n\nA waitlist"),
  saveCompany: vi.fn(async () => undefined),
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  runChecks: vi.fn(async () => ({ kind: "skipped", why: "Only documents changed." })),
  stopRun: vi.fn(async (runId: string) => {
    pending.get(runId)?.reject(new Error("killed"));
    pending.delete(runId);
  }),
}));

const { useApp } = await import("./app");
const { useCompany } = await import("./company");
const { useFounding } = await import("./founding");
const { useDay } = await import("./day");

const last = () => [...pending.values()].pop()!;
const reply = (output: string) => {
  const call = last();
  pending.delete(call.request.runId);
  call.resolve({ output, usage: null, sessionId: null, needsAnswers: false, blocked: [] });
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const FOUNDED = '{"name": "Lapse", "product": "Cancels forgotten subscriptions", "goals": "A waitlist"}';

describe("founding a company", () => {
  beforeEach(() => {
    pending.clear();
    foundCompany.mockClear();
    useApp.setState({ projects: [], page: null, choices: { plan: { engine: "claude-code", model: "opus" }, code: { engine: "claude-code", model: "sonnet" } } });
    useCompany.setState({ openId: null, byProject: {}, choice: null });
    useDay.setState({ byProject: {} });
    useFounding.getState().reset();
  });

  it("reads a founding reply, and only one with a name", () => {
    expect(parseFounding(`Here:\n${FOUNDED}`)).toEqual({ name: "Lapse", draft: { product: "Cancels forgotten subscriptions", goals: "A waitlist" } });
    expect(parseFounding('{"product": "x"}')).toBeNull();
    const corners = new Set(Array.from({ length: 40 }, (_, i) => surprise(() => (i * 0.137) % 1)));
    expect(corners.size).toBeGreaterThan(10);
    expect(surprise(() => 0)).toBe("Surprise me: pick a company worth starting. Look around pet owners, for a tool they'd use every week.");
  });

  it("names it in an empty folder, plans its first delivery and starts it, all without stopping", async () => {
    void useFounding.getState().start("", false);
    await settle();
    expect(last().request).toMatchObject({ step: "found", folder: "/data/founding", model: "sonnet", task: expect.stringMatching(/^Surprise me: pick a company worth starting\. Look around /) });
    reply(FOUNDED);
    await settle();
    expect(foundCompany).toHaveBeenCalledWith("Lapse", "# Lapse\n\n## Product\n\nCancels forgotten subscriptions\n\n## Goals\n\nA waitlist");
    expect(useApp.getState().projects[0]).toEqual(LAPSE);
    await settle();
    expect(useFounding.getState().phase).toBe("planning");
    expect(last().request).toMatchObject({ step: "day", folder: "/home/dhrive/lapse" });
    expect(last().request.task.endsWith(FIRST_DELIVERY)).toBe(true);
    reply('[{"title": "Waitlist", "area": "marketing", "cli": "claude", "prompt": "Draft the waitlist post"}]');
    await settle();
    expect(useFounding.getState().phase).toBe("idle");
    expect(useApp.getState().page).toBe("company");
    expect(useCompany.getState().openId).toBe("p9");
    expect(last().request).toMatchObject({ step: "code", folder: "/home/dhrive/lapse", task: expect.stringContaining("Draft the waitlist post") });
    useFounding.getState().reset();
  });

  it("with Ask first on, the first delivery waits for the owner's OK", async () => {
    void useFounding.getState().start("a tool that cancels forgotten subscriptions", true);
    await settle();
    reply(FOUNDED);
    await settle();
    await settle();
    reply('[{"title": "Waitlist", "area": "marketing", "cli": "claude", "prompt": "Draft the waitlist post"}]');
    await settle();
    expect(useDay.getState().byProject.p9.ask).toBe(true);
    expect(useDay.getState().byProject.p9.tasks.map((t) => t.status)).toEqual(["suggested"]);
    expect(pending.size, "nothing started").toBe(0);
    useFounding.getState().reset();
  });

  it("founds what the owner described, and says so when the CLI founds nothing", async () => {
    void useFounding.getState().start("a tool that cancels forgotten subscriptions", false);
    await settle();
    expect(last().request.task).toBe("a tool that cancels forgotten subscriptions");
    reply("I can't do that.");
    await settle();
    expect(useFounding.getState()).toMatchObject({ phase: "failed", error: expect.stringContaining("didn't found a company") });
    expect(foundCompany).not.toHaveBeenCalled();
  });

  it("a stop between steps holds: once the company exists and its brief is being read, nothing gets planned", async () => {
    const api = await import("@/lib/api");
    let read: (text: string) => void = () => {};
    vi.mocked(api.readCompany).mockImplementationOnce(() => new Promise((done) => (read = done)));
    void useFounding.getState().start("", false);
    await settle();
    reply(FOUNDED);
    await settle();
    useFounding.getState().stop();
    read("# Lapse\n\n## Goals\n\nA waitlist");
    await settle();
    await settle();
    expect(pending.size, "no first delivery was planned after the stop").toBe(0);
    expect(useFounding.getState().phase).toBe("failed");
  });

  it("a stop ends the step in flight and goes no further", async () => {
    void useFounding.getState().start("", false);
    await settle();
    useFounding.getState().stop();
    await settle();
    expect(useFounding.getState()).toMatchObject({ phase: "failed", error: "Stopped." });
    expect(pending.size).toBe(0);
  });
});
