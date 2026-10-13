import { create } from "zustand";

import { readDocuments, runChecks, runStep, stopRun } from "@/lib/api";
import { FIX_ATTEMPTS, failure, fixPrompt, passed, verdict } from "@/lib/checks";
import { isBlank, toMarkdown } from "@/lib/company";
import { alreadyNote, clipped, ownTask, parseDay, savedTasks, taskPrompt, trimmed, type Area, type Task } from "@/lib/day";
import { documentPrompt, missing } from "@/lib/documents";
import type { Choice } from "@/lib/flow";
import { entry } from "@/lib/log";
import { readSaved } from "@/lib/storage";
import { useApp } from "./app";
import { companyAgent, useCompany } from "./company";
import { useLog } from "./log";
import { useGitHub } from "./github";
import { usePublish } from "./publish";
import { keeper } from "./records";

// Each company's tasks. Its agent suggests the next ones from the brief, reading only, and they're
// worked as soon as they arrive (an autonomous company), unless the owner asked to look them over
// first, in which case they wait as suggestions. Tasks the owner adds, accepts or retries are theirs,
// so they start right away. Tasks run one after another as code steps in the project, so two never
// edit the same files at once; finished ones stay as the company's history, the latest in the
// company's tasks record (records.rs) and the rest in its archive.

// Where tasks lived before the record: read once to move each company's over, never written again.
// ponytail: left in the webview's storage; clear it once every install has moved (0.4.x).
const LEGACY_KEY = "company.days";
export const NOTHING = "The agent didn't suggest any tasks. Try again, or say more in the brief's goals.";

export interface Day {
  tasks: Task[];
  plannedAt: number | null;
  // The plan in flight, whose progress is in the app's live log under this id.
  planRunId: string | null;
  // Whether suggestions wait for the owner's OK; off unless they turn it on. Off, tasks also run
  // without asking before they use a tool.
  ask: boolean;
  // With Ask first off, whether MCP tools (which can send, post or pay in the owner's name) run too.
  mcp: boolean;
  // A new company's first day: its first delivery, the product and its website.
  first: boolean;
  error: string | null;
}

export const EMPTY_DAY: Day = { tasks: [], plannedAt: null, planRunId: null, ask: false, mcp: false, first: false, error: null };

export function savedDay(value: unknown): Day {
  const d = (typeof value === "object" && value !== null ? value : {}) as Partial<Day>;
  return { ...EMPTY_DAY, tasks: savedTasks(d.tasks), plannedAt: typeof d.plannedAt === "number" ? d.plannedAt : null, ask: d.ask === true, mcp: d.mcp === true, first: d.first === true };
}

function legacyDays(): Record<string, unknown> {
  const value = readSaved(LEGACY_KEY);
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

const kept = ({ tasks, plannedAt, ask, mcp, first }: Day) => ({ tasks, plannedAt, ask, mcp, first });

// The record read after something already changed here (a company founded and planned at once): both
// sides' tasks are kept, this side's version of any task in both.
export function mergedDay(saved: Day, now: Day): Day {
  const here = new Set(now.tasks.map((t) => t.id));
  return { ...now, tasks: [...saved.tasks.filter((t) => !here.has(t.id)), ...now.tasks] };
}

interface DayState {
  byProject: Record<string, Day>;
  // `also` is said to the planner after the brief: what a first day must deliver, say.
  plan: (projectId: string, also?: string) => Promise<void>;
  stopPlan: (projectId: string) => void;
  run: (projectId: string) => Promise<void>;
  stop: (projectId: string) => void;
  // Lets the running task finish but starts no other.
  hold: (projectId: string) => void;
  edit: (projectId: string, id: string, patch: Partial<Pick<Task, "engine" | "model" | "effort" | "title" | "prompt">>) => void;
  drop: (projectId: string, id: string) => void;
  setAsk: (projectId: string, ask: boolean) => void;
  setMcp: (projectId: string, mcp: boolean) => void;
  // A new agent for the company: the tasks waiting on the old one move to it; one the owner gave its
  // own CLI or model keeps it, and the one running finishes where it started.
  setAgent: (projectId: string, agent: Choice) => void;
  add: (projectId: string, said: string, area: Area) => boolean;
  // A task already written, as the company's chat suggests one; queued as the owner's and started.
  queue: (projectId: string, task: Task) => void;
  // One suggestion, or all of them when no id is given.
  accept: (projectId: string, id?: string) => void;
  retry: (projectId: string, id: string) => void;
}

const projectOf = (projectId: string) => useApp.getState().projects.find((p) => p.id === projectId);

export const useDay = create<DayState>((set, get) => {
  const day = (projectId: string) => get().byProject[projectId] ?? EMPTY_DAY;
  const legacy = legacyDays();
  const record = keeper("tasks", (projectId) => kept(day(projectId)), (projectId, saved) => {
    if (saved === null && !(projectId in legacy)) return false;
    const fromFile = savedDay(saved ?? legacy[projectId]);
    const now = get().byProject[projectId];
    set({ byProject: { ...get().byProject, [projectId]: now ? mergedDay(fromFile, now) : fromFile } });
    return saved === null || now !== undefined;
  });
  const patch = (projectId: string, change: (d: Day) => Partial<Day>) => {
    const next = { ...day(projectId), ...change(day(projectId)) };
    const tasks = trimmed(next.tasks);
    set({ byProject: { ...get().byProject, [projectId]: { ...next, tasks } } });
    record.persist(projectId, next.tasks.filter((t) => !tasks.includes(t)));
  };
  const patchTask = (projectId: string, id: string, change: Partial<Task>) => patch(projectId, (d) => ({ tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...change } : t)) }));
  // Days the owner stopped: the one running ends and the rest wait.
  const halted = new Set<string>();
  // The queue being worked, per project: asking to run it again joins the same pass.
  const working = new Map<string, Promise<void>>();

  const finish = (projectId: string, task: Task, status: "done" | "failed", text: string) => {
    patchTask(projectId, task.id, { status, runId: null, result: clipped(text) });
    useLog.getState().add(projectId, entry(status, task.title, { taskId: task.id }));
  };

  // The task, then dhrive's own checks of what it delivered (checks.rs). What fails goes back to the
  // same conversation, up to FIX_ATTEMPTS times; only a delivery that passes is done. Every run (the
  // task, the checks, a fix) takes a fresh id, so a stop or a retry, which change the task's, end it.
  const runTask = async (projectId: string, task: Task) => {
    const project = projectOf(projectId);
    if (!project) return;
    let runId = "";
    const fresh = () => {
      runId = crypto.randomUUID();
      patchTask(projectId, task.id, { status: "running", runId });
      return runId;
    };
    const ours = () => day(projectId).tasks.find((t) => t.id === task.id)?.runId === runId;
    const code = (prompt: string, resume: string | null) => {
      const { ask, mcp } = day(projectId);
      return runStep({ runId: fresh(), folder: project.folder, step: "code", engine: task.engine, model: task.model, effort: task.effort, task: prompt, resume: resume ?? undefined, unattended: !ask, mcp });
    };
    patchTask(projectId, task.id, { result: "" });
    try {
      let result = await code(taskPrompt(task, project.name), null);
      for (let fixes = 0; ; fixes++) {
        const report = await runChecks(projectId, fresh());
        if (!ours()) return;
        if (passed(report)) return finish(projectId, task, "done", result.output + verdict(report, fixes));
        if (fixes === FIX_ATTEMPTS) return finish(projectId, task, "failed", failure(report));
        result = await code(fixPrompt(report, task.title), result.sessionId);
      }
    } catch (error) {
      if (ours()) finish(projectId, task, "failed", String(error));
    }
  };

  const work = async (projectId: string) => {
    halted.delete(projectId);
    for (let next = day(projectId).tasks.find((t) => t.status === "planned"); next && !halted.has(projectId); next = day(projectId).tasks.find((t) => t.status === "planned")) {
      await runTask(projectId, next);
      // Between tasks, so no CLI is editing while it commits.
      // ponytail: the record writes of the task just ended may land in the next backup, not this one.
      await useGitHub.getState().backup(projectId);
    }
  };

  // Once the queue is done; the pass has ended, so the documents queued here start a pass of their own.
  const finishFirst = async (projectId: string) => {
    // A first delivery ends on the web: the company is ready once its site is live. Then it writes
    // down what it is, from what it built: the documents it doesn't have yet.
    const { first, tasks } = day(projectId);
    if (!first || halted.has(projectId) || !tasks.length || !tasks.every((t) => t.status === "done")) return;
    patch(projectId, () => ({ first: false }));
    await usePublish.getState().publish(projectId);
    const written = await readDocuments(projectId).catch(() => []);
    for (const kind of missing(Object.fromEntries(written.map((d) => [d.id, d.text])))) get().add(projectId, documentPrompt(kind), kind.area);
  };

  return {
    byProject: {},
    plan: async (projectId, also) => {
      const project = projectOf(projectId);
      const brief = useCompany.getState().byProject[projectId]?.brief;
      const choice = companyAgent(projectId);
      if (!project || !brief || isBlank(brief) || !choice || day(projectId).planRunId) return;
      const planRunId = crypto.randomUUID();
      // Fresh suggestions replace the ones still waiting.
      patch(projectId, (d) => ({ planRunId, tasks: d.tasks.filter((t) => t.status !== "suggested"), first: also !== undefined, error: null }));
      try {
        const task = [toMarkdown(brief, project.name), alreadyNote(day(projectId).tasks), also].filter(Boolean).join("\n\n");
        const result = await runStep({ runId: planRunId, folder: project.folder, step: "day", engine: choice.engine, model: choice.model, effort: choice.effort, task });
        if (day(projectId).planRunId !== planRunId) return;
        const status = day(projectId).ask ? "suggested" : "planned";
        const fresh = parseDay(result.output, choice).map((t) => ({ ...t, status }) as Task);
        patch(projectId, (d) => ({ planRunId: null, tasks: [...d.tasks, ...fresh], plannedAt: Date.now(), error: fresh.length ? null : NOTHING }));
        if (status === "planned" && fresh.length) void get().run(projectId);
      } catch (error) {
        if (day(projectId).planRunId === planRunId) patch(projectId, () => ({ planRunId: null, error: String(error) }));
      }
    },
    stopPlan: (projectId) => {
      const { planRunId } = day(projectId);
      if (!planRunId) return;
      patch(projectId, () => ({ planRunId: null }));
      void stopRun(planRunId);
    },
    run: (projectId) => {
      const pass = working.get(projectId) ?? work(projectId).finally(() => working.delete(projectId)).then(() => finishFirst(projectId));
      working.set(projectId, pass);
      return pass;
    },
    stop: (projectId) => {
      halted.add(projectId);
      const running = day(projectId).tasks.find((t) => t.status === "running");
      if (!running?.runId) return;
      patchTask(projectId, running.id, { status: "stopped", runId: null });
      void stopRun(running.runId);
    },
    hold: (projectId) => void halted.add(projectId),
    edit: (projectId, id, change) => patchTask(projectId, id, change),
    drop: (projectId, id) => patch(projectId, (d) => ({ tasks: d.tasks.filter((t) => t.id !== id || t.status === "running") })),
    setAsk: (projectId, ask) => patch(projectId, () => ({ ask })),
    setMcp: (projectId, mcp) => patch(projectId, () => ({ mcp })),
    setAgent: (projectId, agent) => {
      const before = companyAgent(projectId);
      useCompany.getState().choose(agent, projectId);
      if (!before) return;
      const was = (t: Task) => (t.status === "planned" || t.status === "suggested") && t.engine === before.engine && t.model === before.model;
      patch(projectId, (d) => ({ tasks: d.tasks.map((t) => (was(t) ? { ...t, engine: agent.engine, model: agent.model, effort: agent.effort } : t)) }));
    },
    add: (projectId, said, area) => {
      const choice = companyAgent(projectId);
      const task = choice && ownTask(said, area, choice);
      if (!task) return false;
      get().queue(projectId, task);
      return true;
    },
    queue: (projectId, task) => {
      patch(projectId, (d) => ({ tasks: [...d.tasks, { ...task, id: crypto.randomUUID(), status: "planned", runId: null, result: "" }] }));
      void get().run(projectId);
    },
    accept: (projectId, id) => {
      patch(projectId, (d) => ({ tasks: d.tasks.map((t) => (t.status === "suggested" && (id === undefined || t.id === id) ? { ...t, status: "planned" } : t)) }));
      void get().run(projectId);
    },
    retry: (projectId, id) => {
      const task = day(projectId).tasks.find((t) => t.id === id && (t.status === "failed" || t.status === "stopped"));
      if (!task) return;
      patch(projectId, (d) => ({ tasks: [...d.tasks.filter((t) => t.id !== id), { ...task, status: "planned", result: "" }] }));
      void get().run(projectId);
    },
  };
});

export const useDayOf = (projectId: string) => useDay((s) => s.byProject[projectId] ?? EMPTY_DAY);
