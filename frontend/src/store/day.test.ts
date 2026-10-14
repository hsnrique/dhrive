import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckReport, StepRequest, Synced } from "@/lib/api";
import { EMPTY_BRIEF } from "@/lib/company";

// Each run stays pending until the test settles it, so a stop can land before the reply.
const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();

// The company is on GitHub: each backup is noted, with how many steps were still in flight.
const backups: number[] = [];
// dhrive's checks after each task answer from this list, and find nothing to check once it's empty.
const reports: CheckReport[] = [];
// An army task's syncs answer from this list, and are clean once it's empty; landings are noted.
const syncs: Synced[] = [];
const landed: string[] = [];
// How many syncs are in flight at once, and the most there ever were: landings must take turns.
const syncing = { now: 0, most: 0 };
// What an army task changed, per ask: from this list, nothing once it's empty.
const changed: { files: string[]; diff: string }[] = [];
vi.mock("@/lib/api", () => ({
  armyPrepare: vi.fn(async (_project: string, task: string) => `/planilha/.dhrive/${task}`),
  armySync: vi.fn(async () => {
    syncing.now += 1;
    syncing.most = Math.max(syncing.most, syncing.now);
    await new Promise((resolve) => setTimeout(resolve, 0));
    syncing.now -= 1;
    return syncs.shift() ?? { kind: "clean" };
  }),
  armyLand: vi.fn(async (_project: string, _task: string, title: string) => void landed.push(title)),
  armyDiscard: vi.fn(async () => undefined),
  armyChanges: vi.fn(async () => changed.shift() ?? { files: [], diff: "" }),
  readCompanyRecord: vi.fn(async () => null),
  saveCompanyRecord: vi.fn(async () => undefined),
  archiveCompanyRecord: vi.fn(async () => undefined),
  githubState: vi.fn(async () => ({ gh: true, account: "ana", repo: "https://github.com/ana/acme", changes: 1 })),
  saveToGithub: vi.fn(async () => {
    backups.push(pending.size);
    return "https://github.com/ana/acme";
  }),
  readCompany: vi.fn(async () => ""),
  saveCompany: vi.fn(async () => undefined),
  publishSite: vi.fn(async () => ({ url: "https://planilha.dhrive.site" })),
  readDocuments: vi.fn(async () => [{ id: "mission", text: "# Mission" }]),
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  runChecks: vi.fn(async () => reports.shift() ?? { kind: "skipped", why: "Only documents changed." }),
  stopRun: vi.fn(async (runId: string) => {
    pending.get(runId)?.reject(new Error("killed"));
    pending.delete(runId);
  }),
}));

const { useApp } = await import("./app");
const { useArmy } = await import("./army");
const { newAgent } = await import("@/lib/army");
const { useCompany } = await import("./company");
const { EMPTY_DAY, useDay } = await import("./day");
const { useLog } = await import("./log");

const P = "p1";
const day = () => useDay.getState().byProject[P] ?? EMPTY_DAY;
const last = () => [...pending.values()].pop()!;
const reply = (output: string) => {
  const call = last();
  pending.delete(call.request.runId);
  call.resolve({ output, usage: null, sessionId: null, needsAnswers: false, blocked: [] });
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// Enough turns for a stopped pass to wind down, so the next test starts a pass of its own.
const windDown = async () => {
  for (let i = 0; i < 8; i++) await settle();
};
const PLAN = JSON.stringify([
  { title: "Ads", area: "marketing", cli: "codex", prompt: "Write three ads" },
  { title: "Form", area: "code", cli: "claude", prompt: "Fix the signup form" },
]);

describe("a company's day", () => {
  beforeEach(() => {
    pending.clear();
    reports.length = 0;
    syncs.length = 0;
    landed.length = 0;
    syncing.most = 0;
    changed.length = 0;
    useApp.setState({
      projects: [{ id: P, name: "planilha.", folder: "/planilha", createdAt: 0 }],
      clis: [{ engine: "claude-code", installed: true }, { engine: "codex", installed: true }] as never,
      choices: { plan: { engine: "claude-code", model: "opus" }, code: null },
    });
    useCompany.setState({ byProject: { [P]: { brief: { ...EMPTY_BRIEF, goals: "More trials" }, saving: "saved", runId: null, error: null } }, choice: null, agents: {} });
    useArmy.setState({ byProject: {} });
    // Looked over first unless a test says otherwise, so each step can be seen.
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY, ask: true } } });
  });

  it("suggests from the brief on the company's agent, reading only, then waits when asked to", async () => {
    void useDay.getState().plan(P);
    expect(last().request).toMatchObject({ step: "day", engine: "claude-code", model: "opus", folder: "/planilha" });
    expect(last().request.task).toContain("## Goals\n\nMore trials");
    reply(PLAN);
    await settle();
    expect(day().tasks.map((t) => [t.title, t.engine, t.model, t.status])).toEqual([["Ads", "claude-code", "opus", "suggested"], ["Form", "claude-code", "opus", "suggested"]]);
    expect(pending.size).toBe(0);
  });

  it("tells the planner the army, runs each task as the agent it names, and moves waiting tasks with their agent", async () => {
    const qa = newAgent("QA", "Writes the missing tests", { engine: "codex", model: "gpt-6" })!;
    useArmy.setState({ byProject: { [P]: [qa] } });
    void useDay.getState().plan(P);
    expect(last().request.task).toContain("- QA: Writes the missing tests");
    reply(JSON.stringify([{ title: "Tests", area: "code", agent: "QA", prompt: "Cover the signup form" }, { title: "Ads", area: "marketing", prompt: "Write ads" }]));
    await settle();
    expect(day().tasks.map((t) => [t.title, t.agentId, t.engine])).toEqual([["Tests", qa.id, "codex"], ["Ads", undefined, "claude-code"]]);
    useDay.getState().follow(P, qa.id, { ...qa, engine: "claude-code", model: "sonnet" });
    expect(day().tasks[0]).toMatchObject({ agentId: qa.id, engine: "claude-code", model: "sonnet" });
    useDay.getState().follow(P, qa.id, null);
    expect(day().tasks[0].agentId, "a dismissed agent's task goes back to the company's agent").toBeUndefined();
    expect(day().tasks[0]).toMatchObject({ engine: "claude-code", model: "opus" });
    useDay.setState({ byProject: { [P]: { ...day(), tasks: day().tasks.map((t, i) => (i === 0 ? { ...t, agentId: qa.id } : t)) } } });
    useDay.getState().accept(P, day().tasks[0].id);
    await settle();
    expect(last().request).toMatchObject({ step: "code", folder: `/planilha/.dhrive/${day().tasks[0].id}` });
    expect(last().request.task).toMatch(/^You are QA, one of planilha\.'s agents/);
    useDay.getState().stop(P);
    await windDown();
  });

  it("an army works three tasks at once, each in its own copy, and lands them one by one", async () => {
    useArmy.setState({ byProject: { [P]: [newAgent("Back", "", { engine: "claude-code", model: "opus" })!] } });
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY } } });
    void useDay.getState().plan(P);
    reply(JSON.stringify(["One", "Two", "Three", "Four"].map((title) => ({ title, area: "code", prompt: `Do ${title}` }))));
    await settle();
    await settle();
    const running = () => [...pending.values()].filter((p) => p.request.step === "code");
    expect(running().map((p) => p.request.folder.split("/.dhrive/").length)).toEqual([2, 2, 2]);
    expect(day().tasks.map((t) => t.status)).toEqual(["running", "running", "running", "planned"]);
    syncs.push({ kind: "conflicts", files: ["src/app.ts"] });
    reply("Did three");
    await windDown();
    expect(last().request.task, "a clash goes back to its agent").toContain("conflicts in: src/app.ts");
    reply("Resolved");
    await windDown();
    expect(landed).toEqual(["Three"]);
    expect(day().tasks.map((t) => t.status), "the fourth starts as soon as one lands").toEqual(["running", "running", "done", "running"]);
    useDay.getState().stop(P);
    await windDown();
    expect(day().tasks.map((t) => t.status), "standing down stops every one of them").toEqual(["stopped", "stopped", "done", "stopped"]);
  });

  it("the General's order holds: a task waiting for another starts only once that one has landed", async () => {
    useArmy.setState({ byProject: { [P]: [newAgent("Back", "", { engine: "claude-code", model: "opus" })!] } });
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY } } });
    void useDay.getState().plan(P);
    expect(last().request.task).toContain('"after"');
    reply(JSON.stringify([{ title: "API", area: "code", prompt: "Add the API" }, { title: "Page", area: "code", prompt: "Build the page", after: ["API"] }]));
    await windDown();
    expect(day().tasks.map((t) => t.status), "three could run, but the page waits").toEqual(["running", "planned"]);
    reply("Added the API");
    await windDown();
    expect(day().tasks.map((t) => t.status)).toEqual(["done", "running"]);
    expect(last().request.task, "and hears what the API task delivered").toContain("API (Added the API)");
    useDay.getState().stop(P);
    await windDown();
  });

  it("an agent that strays outside its territory is sent back once, then lands", async () => {
    const back = { ...newAgent("Back", "APIs", { engine: "claude-code", model: "opus" })!, owns: "server" };
    useArmy.setState({ byProject: { [P]: [back] } });
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY } } });
    void useDay.getState().plan(P);
    reply(JSON.stringify([{ title: "API", area: "code", agent: "Back", prompt: "Add the API" }]));
    await windDown();
    changed.push({ files: ["server/api.ts", "app/page.tsx"], diff: "" }, { files: ["server/api.ts"], diff: "" });
    reply("Added it, and a page");
    await windDown();
    expect(last().request.task, "back to its agent").toContain("outside what you own (server/): app/page.tsx");
    reply("Took the page out");
    await windDown();
    expect(landed).toEqual(["API"]);
  });

  it("with review on, the company's agent reads the diff first and what it finds goes back before landing", async () => {
    useArmy.setState({ byProject: { [P]: [newAgent("Back", "", { engine: "codex", model: "gpt-6" })!] } });
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY, review: true } } });
    void useDay.getState().plan(P);
    reply(JSON.stringify([{ title: "API", area: "code", agent: "Back", prompt: "Add the API" }]));
    await windDown();
    changed.push({ files: ["server/api.ts"], diff: "+export const bill = (n) => n;" });
    reply("Added it");
    await windDown();
    expect(last().request, "reviewed read-only on the company's agent").toMatchObject({ step: "chat", engine: "claude-code", model: "opus" });
    expect(last().request.task).toContain("+export const bill = (n) => n;");
    reply("CHANGES\n- Validate the amount");
    await windDown();
    expect(last().request).toMatchObject({ step: "code", engine: "codex" });
    expect(last().request.task).toContain("- Validate the amount");
    reply("Validated it");
    await windDown();
    expect(landed).toEqual(["API"]);
  });

  it("whatever order an army's tasks finish in, at most three work at once, landings take turns and every task lands", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      let state = seed;
      const random = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      useArmy.setState({ byProject: { [P]: [newAgent("Back", "", { engine: "claude-code", model: "opus" })!] } });
      useDay.setState({ byProject: { [P]: { ...EMPTY_DAY } } });
      landed.length = 0;
      syncing.most = 0;
      void useDay.getState().plan(P);
      const titles = ["A", "B", "C", "D", "E"];
      reply(JSON.stringify(titles.map((title) => ({ title, area: "code", prompt: `Do ${title}` }))));
      await windDown();
      for (let turn = 0; turn < 40; turn++) {
        const code = [...pending.values()].filter((p) => p.request.step === "code");
        expect(code.length, `seed ${seed}: never more than three at once`).toBeLessThanOrEqual(3);
        if (!code.length) break;
        const pick = code[Math.floor(random() * code.length)];
        pending.delete(pick.request.runId);
        pick.resolve({ output: "ok", usage: null, sessionId: null, needsAnswers: false, blocked: [] });
        await windDown();
      }
      expect(syncing.most, `seed ${seed}: one landing at a time`).toBe(1);
      expect([...landed].sort(), `seed ${seed}: every task landed once`).toEqual(titles);
      expect(day().tasks.every((t) => t.status === "done")).toBe(true);
    }
  });

  it("runs accepted tasks one after another, each as a code step that hears the rules", async () => {
    void useDay.getState().plan(P);
    reply(PLAN);
    await settle();
    useDay.getState().accept(P);
    expect(pending.size).toBe(1);
    expect(last().request).toMatchObject({ step: "code", engine: "claude-code", model: "opus" });
    expect(last().request.task).toContain("Don't publish");
    reply("Wrote marketing/ads.md");
    await settle();
    expect(day().tasks.map((t) => t.status)).toEqual(["done", "running"]);
    expect(day().tasks[0].result).toBe("Wrote marketing/ads.md");
    reply("Fixed");
    await settle();
    expect(day().tasks.map((t) => t.status)).toEqual(["done", "done"]);
    expect((useLog.getState().byProject[P] ?? []).slice(-2).map((e) => [e.kind, e.text])).toEqual([["done", "Ads"], ["done", "Form"]]);
    expect(backups.slice(-2), "backed up after each task, with no step running").toEqual([0, 0]);
  });

  it("runs as soon as it's planned, which is how a new day starts", async () => {
    useDay.setState({ byProject: {} });
    expect(day().ask).toBe(false);
    void useDay.getState().plan(P);
    reply(PLAN);
    await settle();
    expect(last().request.step).toBe("code");
    expect(last().request, "Ask first off: it runs on its own, MCP tools off").toMatchObject({ unattended: true, mcp: false });
    useDay.getState().stop(P);
    await settle();
  });

  it("a task asks the owner while Ask first is on, and has MCP tools on its own only when allowed", async () => {
    void useDay.getState().plan(P);
    reply(PLAN);
    await settle();
    useDay.getState().accept(P);
    expect(last().request).toMatchObject({ step: "code", unattended: false });
    useDay.getState().stop(P);
    await settle();
    useDay.getState().setAsk(P, false);
    useDay.getState().setMcp(P, true);
    expect(day().mcp).toBe(true);
    useDay.getState().retry(P, day().tasks[0].id);
    await settle();
    expect(last().request).toMatchObject({ step: "code", unattended: true, mcp: true });
    useDay.getState().stop(P);
    await settle();
  });

  it("a delivery that fails dhrive's checks goes back to the same conversation, and is done once it passes", async () => {
    const failed: CheckReport = { kind: "ran", checks: [{ name: "lint", ok: true, tail: "" }, { name: "test", ok: false, tail: "expected 2, got 3" }], missing: [] };
    reports.push(failed, { kind: "ran", checks: [{ name: "lint", ok: true, tail: "" }, { name: "test", ok: true, tail: "" }], missing: [] });
    void useDay.getState().plan(P);
    reply(PLAN);
    await settle();
    useDay.getState().accept(P, day().tasks[0].id);
    const first = last();
    pending.delete(first.request.runId);
    first.resolve({ output: "Wrote the ads", usage: null, sessionId: "3f48b81e-5a2c", needsAnswers: false, blocked: [] });
    await settle();
    expect(last().request).toMatchObject({ step: "code", resume: "3f48b81e-5a2c" });
    expect(last().request.task).toContain("## test\n\nexpected 2, got 3");
    expect(day().tasks[0].status).toBe("running");
    reply("Fixed the test");
    await settle();
    expect(day().tasks[0]).toMatchObject({ status: "done", result: "Fixed the test\n\nChecks passed after 1 fix: lint, test." });
  });

  it("after two fixes that still don't pass, the task is marked failed with what didn't", async () => {
    const failed: CheckReport = { kind: "ran", checks: [{ name: "build", ok: false, tail: "Module not found" }], missing: [] };
    reports.push(failed, failed, failed);
    void useDay.getState().plan(P);
    reply(PLAN);
    await settle();
    useDay.getState().accept(P, day().tasks[0].id);
    for (const said of ["Wrote it", "Fixed", "Fixed again"]) {
      reply(said);
      await settle();
    }
    expect(day().tasks[0]).toMatchObject({ status: "failed", result: "Didn't pass dhrive's checks: build.\n\nModule not found" });
    expect(pending.size, "no fourth try").toBe(0);
    expect((useLog.getState().byProject[P] ?? []).slice(-1)[0]).toMatchObject({ kind: "failed", text: "Ads" });
  });

  it("a new agent takes over what's waiting, not the task running or one the owner gave its own model", () => {
    const task = (id: string, status: string, engine = "claude-code", model = "opus") => ({ id, title: id, area: "code", engine, model, prompt: id, status, runId: null, result: "" });
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY, tasks: [task("run", "running"), task("next", "planned"), task("own", "planned", "codex", "gpt-5.5"), task("idea", "suggested"), task("old", "done")] as never } } });
    useDay.getState().setAgent(P, { engine: "codex", model: "gpt-5.5-codex", effort: "high" });
    expect(day().tasks.map((t) => [t.id, t.engine, t.model])).toEqual([
      ["run", "claude-code", "opus"],
      ["next", "codex", "gpt-5.5-codex"],
      ["own", "codex", "gpt-5.5"],
      ["idea", "codex", "gpt-5.5-codex"],
      ["old", "claude-code", "opus"],
    ]);
    expect(day().tasks[1].effort).toBe("high");
  });

  it("a stop ends the running task and holds the rest", async () => {
    void useDay.getState().plan(P);
    reply(PLAN);
    await settle();
    useDay.getState().accept(P);
    useDay.getState().stop(P);
    await settle();
    expect(day().tasks.map((t) => t.status)).toEqual(["stopped", "planned"]);
    expect(pending.size).toBe(0);
  });

  it("a first delivery ends on the web once every task is done, then writes the missing documents", async () => {
    useDay.getState().setAsk(P, false);
    void useDay.getState().plan(P, "This is the company's first day.");
    reply(PLAN);
    await settle();
    reply("Built the app");
    await settle();
    reply("Built the landing");
    await settle();
    await settle();
    const { usePublish } = await import("./publish");
    expect(usePublish.getState().byProject[P]?.url).toBe("https://planilha.dhrive.site");
    expect(day().tasks.filter((t) => t.status !== "done").map((t) => t.title)).toEqual(["Write the product roadmap", "Write the design guide", "Write the market research"]);
    expect(day().first).toBe(false);
    useDay.getState().stop(P);
  });

  it("keeps what's done, tells the agent about it, and replaces only waiting suggestions", async () => {
    void useDay.getState().plan(P);
    reply(PLAN);
    await settle();
    const [ads] = day().tasks;
    useDay.getState().accept(P, ads.id);
    reply("Wrote ads");
    await settle();
    void useDay.getState().plan(P);
    expect(last().request.task).toContain("Already done:\n- Ads");
    reply(JSON.stringify([{ title: "Blog", area: "marketing", prompt: "Draft a post" }]));
    await settle();
    expect(day().tasks.map((t) => [t.title, t.status])).toEqual([["Ads", "done"], ["Blog", "suggested"]]);
  });

  it("starts the owner's own tasks and retries right away", async () => {
    expect(useDay.getState().add(P, "   ", "code")).toBe(false);
    expect(useDay.getState().add(P, "Add a pricing page\nwith three plans", "code")).toBe(true);
    expect(day().tasks[0]).toMatchObject({ title: "Add a pricing page", status: "running", engine: "claude-code" });
    useDay.getState().stop(P);
    await settle();
    useDay.getState().retry(P, day().tasks[0].id);
    expect(day().tasks[0].status).toBe("running");
    expect(last().request.task).toContain("with three plans");
    reply("Done");
    await settle();
    useDay.getState().retry(P, day().tasks[0].id);
    expect(day().tasks[0].status).toBe("done");
  });

  it("won't plan without a brief", async () => {
    useCompany.setState({ byProject: { [P]: { brief: { ...EMPTY_BRIEF }, saving: "saved", runId: null, error: null } } });
    await useDay.getState().plan(P);
    expect(pending.size).toBe(0);
  });
});
