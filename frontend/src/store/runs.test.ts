import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepRequest } from "@/lib/api";
import type { Mode } from "@/lib/flow";
import { emptyThread, type RunMessage, type Stage } from "@/lib/thread";

// Every runStep call stays pending until the test settles it, so sends, stops and results can
// land in any order, across two projects at once.
const pending = new Map<string, { request: StepRequest; resolve: (value: unknown) => void; reject: (error: Error) => void }>();

// Each compaction stays pending until the test ends it.
const compacted: ((value: unknown) => void)[] = [];

vi.mock("@/lib/api", () => ({
  runStep: vi.fn((request: StepRequest) => new Promise((resolve, reject) => pending.set(request.runId, { request, resolve, reject }))),
  stopRun: vi.fn(async (runId: string) => pending.get(runId)?.reject(new Error("killed"))),
  saveThread: vi.fn(async () => undefined),
  contextUsage: vi.fn(async () => ({ used: 1000, max: 200_000, parts: [], autoCompactAt: null })),
  compactSession: vi.fn(() => new Promise((resolve) => compacted.push(resolve))),
  saveConversation: vi.fn(async (conversation: unknown) => conversation),
  undoChanges: vi.fn(async () => ({ restored: ["theme.ts"], kept: [] })),
  notify: vi.fn(async () => undefined),
  devServers: vi.fn(async () => []),
  answerApproval: vi.fn(async () => undefined),
  allowInProject: vi.fn(async (id: string, rule: string) => ({ id, name: "a", folder: "/a", createdAt: 0, allowed: [rule] })),
}));

// Tests run without a DOM; the window's focus is what decides whether a finished request notifies.
let focused = true;
vi.stubGlobal("document", { hasFocus: () => focused });

const { useApp } = await import("./app");
const { useConversations } = await import("./conversations");
const { send, stop, retry, undoRun, cancelQueued, answer, approvePlan } = await import("./runs");
const { queuedIds } = await import("@/lib/thread");

const PROJECTS = [
  { id: "pa", name: "a", folder: "/a", createdAt: 0 },
  { id: "pb", name: "b", folder: "/b", createdAt: 0 },
];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

// One conversation per project, under the project's own id, as a project's first thread migrates.
// Most tests are about the relay itself, so the code follows the plan on its own there; the owner's
// review of each plan has tests of its own.
function reset(mode: Mode, autoCode = true) {
  pending.clear();
  useConversations.setState({ conversations: PROJECTS.map((p) => ({ id: p.id, projectId: p.id, title: p.name, createdAt: 0, updatedAt: 0, continues: [] })) });
  useApp.setState({
    projects: PROJECTS,
    threads: { pa: emptyThread(), pb: emptyThread() },
    choices: { plan: { engine: "claude-code", model: "opus", effort: "max" }, code: { engine: "codex", model: "gpt-6-astra" } },
    mode,
    autoCode,
    error: null,
  });
}

const runsOf = (id: string) => useApp.getState().threads[id].messages.filter((m): m is RunMessage => m.role === "run");
const stagesOf = (id: string) => runsOf(id).flatMap((m) => [m.plan, m.code].filter((s): s is Stage => s !== null));

// A test can end with runs still going or queued. Each is failed until nothing is left, so no
// conversation's queue is still busy when the next test starts.
async function settleAll() {
  for (let round = 0; round < 100 && pending.size > 0; round++) {
    for (const [runId, call] of [...pending]) {
      pending.delete(runId);
      call.reject(new Error("test ended"));
    }
    await flush();
  }
}

describe("carrying out requests", () => {
  beforeEach(async () => {
    await settleAll();
    reset("relay");
  });

  it("keeps every interleaving of sends, stops, results, failures, take-backs and approvals consistent", async () => {
    for (let seed = 1; seed <= 80; seed++) {
      const random = prng(seed);
      const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
      reset(pick<Mode>(["relay", "relay", "code", "chat"]), random() < 0.5);
      const owner = new Map<string, string>();
      // An approved plan's code may wait behind a request that started while the plan was in review.
      const approvedIds = new Set<string>();
      const settle = (runId: string, call: { resolve: (v: unknown) => void; reject: (e: Error) => void }, ok: boolean) => {
        pending.delete(runId);
        if (ok) call.resolve({ output: `out ${runId}`, usage: null, sessionId: `s-${runId}`, needsAnswers: random() < 0.15 });
        else call.reject(new Error(`boom ${runId}`));
      };
      const check = () => {
        for (const p of PROJECTS) {
          const stages = stagesOf(p.id);
          expect(stages.filter((s) => s.status === "running").length, `seed ${seed}: one run per conversation`).toBeLessThanOrEqual(1);
          const runs = runsOf(p.id);
          expect(runs.filter((run) => run.code.status === "review").length, `seed ${seed}: one plan in review per conversation`).toBeLessThanOrEqual(1);
          const running = runs.findIndex((run) => [run.plan, run.code].some((s) => s?.status === "running"));
          for (const earlier of runs.slice(0, Math.max(running, 0)).filter((run) => !approvedIds.has(run.id))) {
            expect([earlier.plan, earlier.code].some((s) => s?.status === "waiting"), `seed ${seed}: requests run in the order they were sent`).toBe(false);
          }
        }
      };
      for (let op = 0; op < 30; op++) {
        const project = pick(PROJECTS);
        const action = pick(["send", "send", "stop", "resolve", "resolve", "reject", "cancel", "approve"]);
        if (action === "send") void send(project.id, `task ${op}`);
        if (action === "approve") {
          const inReview = runsOf(project.id).filter((run) => run.code.status === "review");
          if (inReview.length) {
            const run = pick(inReview);
            approvedIds.add(run.id);
            void approvePlan(project.id, run.id, random() < 0.3 ? `edited ${op}` : undefined);
          }
        }
        if (action === "stop") stop(project.id);
        if (action === "cancel") {
          const queued = [...queuedIds(useApp.getState().threads[project.id])];
          if (queued.length) cancelQueued(project.id, pick(queued));
        }
        const open = [...pending.entries()];
        if ((action === "resolve" || action === "reject") && open.length > 0) {
          const [runId, call] = pick(open);
          settle(runId, call, action === "resolve");
        }
        await flush();
        for (const [runId, call] of pending) owner.set(runId, call.request.folder);
        check();
      }
      // Whatever is still going or queued finishes, and nothing is left waiting.
      for (let round = 0; round < 200 && pending.size > 0; round++) {
        const [[runId, call]] = [...pending.entries()];
        settle(runId, call, true);
        await flush();
        check();
      }
      for (const p of PROJECTS) {
        expect(stagesOf(p.id).filter((s) => ["waiting", "running"].includes(s.status)), `seed ${seed}: the queue drains`).toEqual([]);
        for (const run of runsOf(p.id)) {
          const planOk = !run.plan || run.plan.status === "done";
          if (["running", "done"].includes(run.code.status)) expect(planOk, `seed ${seed}: code only after a finished plan`).toBe(true);
          if (run.chat) expect(run.plan, `seed ${seed}: a chat has no plan`).toBeNull();
          if (run.code.status === "held") expect(run.plan?.status, `seed ${seed}: only a finished plan holds the code`).toBe("done");
          if (["review", "declined"].includes(run.code.status)) expect(run.plan?.status, `seed ${seed}: only a finished plan waits for review`).toBe("done");
          if (run.code.status !== "waiting" && run.code.runId && run.plan && !approvedIds.has(run.id)) expect(useApp.getState().autoCode, `seed ${seed}: without auto, code runs only once approved`).toBe(true);
          for (const stage of [run.plan, run.code]) {
            if (stage?.status === "done" && !stage.edited) expect(stage.output).toBe(`out ${stage.runId}`);
            if (stage?.runId && owner.has(stage.runId)) expect(owner.get(stage.runId), `seed ${seed}: runs stay in their conversation`).toBe(p.folder);
          }
        }
      }
    }
  });

  it("by default the code waits for the owner's OK on the plan, and gets the plan as they edited it", async () => {
    const { runStep, notify } = await import("@/lib/api");
    reset("relay", false);
    focused = false;
    vi.mocked(notify).mockClear();
    void send("pa", "add dark mode");
    await flush();
    const [[planId, planning]] = [...pending.entries()];
    expect(planning.request, "the planner thinks as hard as the owner picked").toMatchObject({ engine: "claude-code", effort: "max" });
    pending.delete(planId);
    planning.resolve({ output: "1. add a toggle", usage: null, sessionId: "claude-1", needsAnswers: false });
    await flush();
    expect(pending.size, "no code before the OK").toBe(0);
    const message = runsOf("pa")[0];
    expect(message.code.status).toBe("review");
    expect(notify).toHaveBeenCalledWith("a", "The plan is ready for your OK.");

    void approvePlan("pa", message.id, "1. add a toggle\n2. remember it");
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "code", plan: "1. add a toggle\n2. remember it" });
    expect(vi.mocked(runStep).mock.lastCall![0].effort, "and the coder at its CLI's default").toBeUndefined();
    expect(runsOf("pa")[0].plan).toMatchObject({ edited: true, output: "1. add a toggle\n2. remember it" });
    focused = true;
  });

  it("a newer plan replaces one still waiting, and a chat about it doesn't", async () => {
    reset("relay", false);
    const finishNext = async (output: string) => {
      const [[runId, call]] = [...pending.entries()];
      pending.delete(runId);
      call.resolve({ output, usage: null, sessionId: null, needsAnswers: false });
      await flush();
    };
    void send("pa", "add dark mode");
    await flush();
    await finishNext("1. add a toggle");
    useApp.setState({ mode: "chat" });
    void send("pa", "why a toggle and not a menu?");
    await flush();
    await finishNext("A toggle is one click.");
    expect(runsOf("pa")[0].code.status, "still yours to approve").toBe("review");

    useApp.setState({ mode: "relay" });
    void send("pa", "make it a menu instead");
    await flush();
    await finishNext("1. add a menu");
    expect(runsOf("pa").map((run) => run.code.status)).toEqual(["declined", "done", "review"]);
  });

  it("a run on a session being compacted waits for the compaction to end", async () => {
    const { runStep } = await import("@/lib/api");
    const { useContextUsage } = await import("./context");
    reset("chat");
    useApp.setState({ threads: { ...useApp.getState().threads, pa: { ...emptyThread(), sessions: { "claude-code": "s-1" } } } });
    void useContextUsage.getState().compact({ engine: "claude-code", session: "s-1", folder: "/a" });
    vi.mocked(runStep).mockClear();
    void send("pa", "what changed?");
    await flush();
    expect(runStep, "waits for the compaction").not.toHaveBeenCalled();
    compacted.shift()!({ used: 9000, max: 200_000, parts: [], autoCompactAt: null });
    await flush();
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "chat", resume: "s-1" });
  });

  it("a stop while it waits for a compaction holds: the run never starts, and stays stopped", async () => {
    const { runStep } = await import("@/lib/api");
    const { useContextUsage } = await import("./context");
    reset("chat");
    useApp.setState({ threads: { ...useApp.getState().threads, pa: { ...emptyThread(), sessions: { "claude-code": "s-1" } } } });
    void useContextUsage.getState().compact({ engine: "claude-code", session: "s-1", folder: "/a" });
    vi.mocked(runStep).mockClear();
    void send("pa", "what changed?");
    await flush();
    stop("pa");
    compacted.shift()!({ used: 9000, max: 200_000, parts: [], autoCompactAt: null });
    await flush();
    await flush();
    expect(runStep, "stopped before it started").not.toHaveBeenCalled();
    expect(stagesOf("pa").map((s) => s.status)).toEqual(["stopped"]);
  });

  it("a result that lands after a stop doesn't turn the stage back to done", async () => {
    reset("chat");
    void send("pa", "what changed?");
    await flush();
    const [runId, call] = [...pending].pop()!;
    // The CLI finished in the same instant the owner pressed Stop: its answer still arrives.
    const { stopRun } = await import("@/lib/api");
    vi.mocked(stopRun).mockImplementationOnce(async () => undefined);
    stop("pa");
    pending.delete(runId);
    call.resolve({ output: "too late", usage: null, sessionId: null, needsAnswers: false, blocked: [] });
    await flush();
    expect(stagesOf("pa").map((s) => [s.status, s.output])).toEqual([["stopped", ""]]);
  });

  it("a request sent while another runs waits its turn, and can be taken back", async () => {
    const { runStep } = await import("@/lib/api");
    reset("chat");
    void send("pa", "first");
    await flush();
    void send("pa", "second");
    void send("pa", "third");
    await flush();
    expect(pending.size).toBe(1);
    const [secondRun, thirdRun] = runsOf("pa").slice(1);
    expect([...queuedIds(useApp.getState().threads.pa)]).toEqual([secondRun.id, thirdRun.id]);

    cancelQueued("pa", secondRun.id);
    expect(useApp.getState().threads.pa.messages.map((m) => (m.role === "user" ? m.text : m.task))).toEqual(["first", "first", "third", "third"]);
    const [[runId, first]] = [...pending.entries()];
    pending.delete(runId);
    first.resolve({ output: "1", usage: null, sessionId: null, needsAnswers: false });
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "chat", task: "third" });
  });

  it("a request that ends while the owner is away notifies, but done ones wait for the queue to end", async () => {
    const { notify } = await import("@/lib/api");
    vi.mocked(notify).mockClear();
    reset("chat");
    focused = false;
    void send("pa", "first");
    await flush();
    void send("pa", "second");
    await flush();
    const finish = async () => {
      const [[runId, call]] = [...pending.entries()];
      pending.delete(runId);
      call.resolve({ output: "ok", usage: null, sessionId: null, needsAnswers: false });
      await flush();
    };
    await finish();
    expect(notify).not.toHaveBeenCalled();
    await finish();
    expect(notify).toHaveBeenCalledWith("a", "Replied.");
    focused = true;
  });

  it("a request moves its conversation to the top", async () => {
    void send("pb", "add dark mode");
    await flush();
    expect(useConversations.getState().conversations.find((c) => c.id === "pb")!.updatedAt).toBeGreaterThan(0);
    expect(useConversations.getState().conversations.find((c) => c.id === "pa")!.updatedAt).toBe(0);
  });

  it("a code step's changes arrive while it runs, and undo waits until nothing is running", async () => {
    const { undoChanges } = await import("@/lib/api");
    reset("code");
    void send("pa", "rename the button");
    await flush();
    const [[runId, coding]] = [...pending.entries()];
    const changes = { before: "a".repeat(40), after: "b".repeat(40), files: [{ path: "theme.ts", status: "modified", additions: 1, deletions: 1 }] };
    useApp.getState().onProgress({ runId, kind: "changes", value: JSON.stringify(changes) });
    const message = runsOf("pa")[0];
    expect(message.code.changes).toEqual(changes);

    await undoRun("pa", message.id);
    expect(undoChanges).not.toHaveBeenCalled();
    pending.delete(runId);
    coding.resolve({ output: "done", usage: null, sessionId: null, needsAnswers: false });
    await flush();
    vi.mocked(undoChanges).mockClear();
    await Promise.all([undoRun("pa", message.id), undoRun("pa", message.id)]);
    expect(undoChanges, "a double click undoes once").toHaveBeenCalledTimes(1);
    expect(undoChanges).toHaveBeenCalledWith("/a", changes);
    expect(runsOf("pa")[0].code.undone).toEqual({ restored: ["theme.ts"], kept: [] });
    await undoRun("pa", message.id);
    expect(undoChanges, "and an undone step isn't undone again").toHaveBeenCalledTimes(1);
  });

  it("stopping the plan skips the code and raises no error", async () => {
    void send("pa", "add dark mode");
    await flush();
    stop("pa");
    await flush();
    expect(runsOf("pa")[0]).toMatchObject({ plan: { status: "stopped" }, code: { status: "skipped" } });
    expect(useApp.getState().error).toBeNull();
  });

  it("the coder gets the plan, and each CLI resumes its own session next time", async () => {
    const { runStep } = await import("@/lib/api");
    void send("pa", "add dark mode");
    await flush();
    const [planRun] = [...pending.values()];
    pending.clear();
    planRun.resolve({ output: "1. add a toggle", usage: null, sessionId: "claude-1" });
    await flush();
    const codeCall = vi.mocked(runStep).mock.lastCall![0];
    expect(codeCall).toMatchObject({ step: "code", engine: "codex", plan: "1. add a toggle" });
    expect(codeCall.resume).toBeUndefined();
    [...pending.values()][0].resolve({ output: "done", usage: null, sessionId: "codex-1" });
    pending.clear();
    await flush();

    void send("pa", "now persist it");
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "plan", resume: "claude-1" });
  });

  it("a run that fails after its CLI named the session still continues it next time", async () => {
    const { runStep } = await import("@/lib/api");
    void send("pa", "add dark mode");
    await flush();
    const [[runId, failing]] = [...pending.entries()];
    pending.delete(runId);
    useApp.getState().onProgress({ runId, kind: "session", value: "claude-failed" });
    failing.reject(new Error("Not logged in"));
    await flush();
    expect(runsOf("pa")[0].plan).toMatchObject({ status: "failed" });

    void send("pa", "logged in, go on");
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "plan", task: "logged in, go on", resume: "claude-failed" });
  });

  it("a chat talks with the planner's model read-only, and the plan that follows continues it", async () => {
    const { runStep } = await import("@/lib/api");
    reset("chat");
    void send("pa", "should we cache the API?");
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "chat", engine: "claude-code", model: "opus", plan: undefined });
    expect(runsOf("pa")[0]).toMatchObject({ chat: true, plan: null, code: { status: "running", engine: "claude-code" } });
    [...pending.values()][0].resolve({ output: "Yes, cache reads for 60s.", usage: null, sessionId: "claude-chat" });
    pending.clear();
    await flush();
    expect(runsOf("pa")[0].code).toMatchObject({ status: "done", output: "Yes, cache reads for 60s." });

    useApp.setState({ mode: "relay" });
    void send("pa", "do it");
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "plan", engine: "claude-code", resume: "claude-chat" });
  });

  it("a plan that asks questions holds the code, and the answer reaches the same planner session", async () => {
    const { runStep } = await import("@/lib/api");
    void send("pa", "set up payments");
    await flush();
    [...pending.values()][0].resolve({ output: "Stripe or Paddle?", usage: null, sessionId: "claude-q", needsAnswers: true });
    pending.clear();
    await flush();
    expect(runsOf("pa")[0]).toMatchObject({ plan: { status: "done", output: "Stripe or Paddle?" }, code: { status: "held" } });
    expect(pending.size).toBe(0);

    void send("pa", "Stripe");
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "plan", task: "Stripe", resume: "claude-q" });
  });

  it("attached files go to every stage of the request", async () => {
    const { runStep } = await import("@/lib/api");
    const shot = { path: "/Users/ana/Desktop/bug.png", name: "bug.png", image: true };
    void send("pa", "fix this", [shot]);
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "plan", attachments: [shot.path] });
    [...pending.values()][0].resolve({ output: "1. fix", usage: null, sessionId: null, needsAnswers: false });
    pending.clear();
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "code", attachments: [shot.path] });
    expect(useApp.getState().threads.pa.messages[0]).toMatchObject({ role: "user", attachments: [shot] });
  });

  it("a tool call waits on the owner, and always keeps the rule in the project", async () => {
    const { answerApproval, allowInProject } = await import("@/lib/api");
    reset("code");
    void send("pa", "run the tests");
    await flush();
    const [[runId, call]] = [...pending.entries()];
    const question = { id: "q1", tool: "Bash", detail: "npm test", description: "Run the tests", rule: "Bash(npm test:*)" };
    useApp.getState().onProgress({ runId, kind: "approval", value: JSON.stringify(question) });
    expect(useApp.getState().approvals[runId]).toEqual([question]);

    await answer("pa", runId, question, "always");
    expect(answerApproval).toHaveBeenCalledWith("q1", true, true);
    expect(allowInProject).toHaveBeenCalledWith("pa", "Bash(npm test:*)");
    expect(useApp.getState().projects.find((p) => p.id === "pa")?.allowed).toEqual(["Bash(npm test:*)"]);
    expect(useApp.getState().approvals[runId]).toEqual([]);

    useApp.getState().onProgress({ runId, kind: "approval", value: JSON.stringify({ ...question, id: "q2" }) });
    pending.delete(runId);
    call.resolve({ output: "ok", usage: null, sessionId: null, needsAnswers: false });
    await flush();
    expect(useApp.getState().approvals[runId], "a run that ends drops its questions").toBeUndefined();
  });

  it("what the CLI refused is kept on the stage that asked", async () => {
    reset("chat");
    void send("pa", "run the tests");
    await flush();
    const [[runId, call]] = [...pending.entries()];
    pending.delete(runId);
    call.resolve({ output: "I couldn't run them.", usage: null, sessionId: null, needsAnswers: false, blocked: ["Bash: npm test"] });
    await flush();
    expect(runsOf("pa")[0].code).toMatchObject({ status: "done", blocked: ["Bash: npm test"] });
  });

  it("code mode goes straight to the coder with no plan", async () => {
    const { runStep } = await import("@/lib/api");
    reset("code");
    void send("pb", "rename the button");
    await flush();
    expect(vi.mocked(runStep).mock.lastCall![0]).toMatchObject({ step: "code", engine: "codex", plan: undefined });
    expect(runsOf("pb")[0]).toMatchObject({ plan: null, code: { status: "running" } });
  });

  it("a failed stage can be retried with the same CLI and model", async () => {
    void send("pb", "add dark mode");
    await flush();
    const [[runId, planRun]] = [...pending.entries()];
    pending.delete(runId);
    planRun.reject(new Error("Overloaded"));
    await flush();
    const failed = runsOf("pb")[0];
    expect(failed).toMatchObject({ plan: { status: "failed", error: "Error: Overloaded" }, code: { status: "skipped" } });

    void retry("pb", failed.id, "plan");
    await flush();
    expect(runsOf("pb")[0]).toMatchObject({ plan: { status: "running", error: null }, code: { status: "waiting" } });
  });
});
