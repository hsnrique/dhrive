import { create } from "zustand";

import { armyDiscard, readDocuments, runStep, stopRun } from "@/lib/api";
import { PARALLEL, rosterNote, type Agent } from "@/lib/army";
import { RECHECK_MS } from "@/lib/logistics";
import { isBlank, toMarkdown } from "@/lib/company";
import { alreadyNote, ownTask, parseDay, ready, savedTasks, trimmed, type Area, type Task } from "@/lib/day";
import { documentPrompt, missing, writtenOf } from "@/lib/documents";
import type { Choice } from "@/lib/flow";
import { readSaved } from "@/lib/storage";
import { useApp } from "./app";
import { useArmy } from "./army";
import { companyAgent, useCompany } from "./company";
import { useGitHub } from "./github";
import { nextToStart } from "./army-pick";
import { taskRunner } from "./task-run";
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
  // Whether an army's tasks are reviewed by the company's own agent before they land; off unless asked.
  review: boolean;
  // Whether its agents work without narrating (standards.ts LEAN); on unless turned off.
  lean: boolean;
  // A new company's first day: its first delivery, the product and its website.
  first: boolean;
  error: string | null;
  // Why an army's next tasks wait instead of starting (their plans are full); not saved.
  held?: string | null;
}

export const EMPTY_DAY: Day = { tasks: [], plannedAt: null, planRunId: null, ask: false, mcp: false, review: false, lean: true, first: false, error: null };

export function savedDay(value: unknown): Day {
  const d = (typeof value === "object" && value !== null ? value : {}) as Partial<Day>;
  return { ...EMPTY_DAY, tasks: savedTasks(d.tasks), plannedAt: typeof d.plannedAt === "number" ? d.plannedAt : null, ask: d.ask === true, mcp: d.mcp === true, review: d.review === true, lean: d.lean !== false, first: d.first === true };
}

function legacyDays(): Record<string, unknown> {
  const value = readSaved(LEGACY_KEY);
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

const kept = ({ tasks, plannedAt, ask, mcp, review, lean, first }: Day) => ({ tasks, plannedAt, ask, mcp, review, lean, first });

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
  setReview: (projectId: string, review: boolean) => void;
  setLean: (projectId: string, lean: boolean) => void;
  // A new agent for the company: the tasks waiting on the old one move to it; one the owner gave its
  // own CLI or model keeps it, and the one running finishes where it started.
  setAgent: (projectId: string, agent: Choice) => void;
  // An army agent changed CLI or model, or was dismissed (null): the tasks waiting on it follow, a
  // dismissed agent's going back to the company's own agent.
  follow: (projectId: string, agentId: string, agent: Agent | null) => void;
  add: (projectId: string, said: string, area: Area) => boolean;
  // A task already written, as the company's chat suggests one; queued as the owner's and started.
  queue: (projectId: string, task: Task) => void;
  // One suggestion, or all of them when no id is given.
  accept: (projectId: string, id?: string) => void;
  retry: (projectId: string, id: string) => void;
}

const projectOf = (projectId: string) => useApp.getState().projects.find((p) => p.id === projectId);
const armyOf = (projectId: string) => useArmy.getState().byProject[projectId] ?? [];
const waiting = (t: Task) => t.status === "planned" || t.status === "suggested";

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

  const { runTask } = taskRunner({ day, patchTask });

  // The first task up next whose tasks it waits for are done.
  const nextUp = (projectId: string) => {
    const { tasks } = day(projectId);
    return tasks.find((t) => t.status === "planned" && ready(t, tasks));
  };

  const work = async (projectId: string) => {
    halted.delete(projectId);
    if (armyOf(projectId).length) return workArmy(projectId);
    for (let next = nextUp(projectId); next && !halted.has(projectId); next = nextUp(projectId)) {
      await runTask(projectId, next);
      // Between tasks, so no CLI is editing while it commits.
      // ponytail: the record writes of the task just ended may land in the next backup, not this one.
      await useGitHub.getState().backup(projectId);
    }
  };

  // An army works up to PARALLEL tasks at once, each in its own copy; it backs up as each one lands.
  // A company whose next tasks all wait on a plan looks again in a while, unless it's stopped first.
  const rechecks = new Map<string, ReturnType<typeof setTimeout>>();
  const setHeld = (projectId: string, held: string | null) => {
    if (day(projectId).held !== held) set({ byProject: { ...get().byProject, [projectId]: { ...day(projectId), held } } });
  };
  const recheck = (projectId: string) => {
    clearTimeout(rechecks.get(projectId));
    rechecks.set(projectId, setTimeout(() => void get().run(projectId), RECHECK_MS));
  };

  const workArmy = async (projectId: string) => {
    const running = new Set<Promise<void>>();
    clearTimeout(rechecks.get(projectId));
    for (;;) {
      while (running.size < PARALLEL && !halted.has(projectId)) {
        const next = await nextToStart(projectId, { day, patchTask, setHeld });
        // Reading the plans takes a moment; a stop pressed meanwhile starts nothing.
        if (!next || halted.has(projectId)) break;
        // Marked before it starts, so the next pick never takes it again.
        patchTask(projectId, next.id, { status: "running" });
        const run: Promise<void> = runTask(projectId, next, true).finally(() => running.delete(run));
        running.add(run);
      }
      if (!running.size) {
        if (day(projectId).held && !halted.has(projectId)) recheck(projectId);
        return;
      }
      await Promise.race(running);
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
    // A folder that can't be read at all writes nothing: missing is only what is known to be absent.
    const written = await readDocuments(projectId).catch(() => null);
    if (!written) return;
    for (const kind of missing(writtenOf(written))) get().add(projectId, documentPrompt(kind), kind.area);
  };

  return {
    byProject: {},
    plan: async (projectId, also) => {
      const project = projectOf(projectId);
      const brief = useCompany.getState().byProject[projectId]?.brief;
      const choice = companyAgent(projectId);
      if (!project || !brief || isBlank(brief) || !choice || day(projectId).planRunId) return;
      const planRunId = crypto.randomUUID();
      // Suggestions add to what waits: the ones still waiting for an OK stay (the planner hears them,
      // so it doesn't repeat them), and a first day stays one, so its delivery still ends on the web.
      // Replacing them here once threw away a first delivery the owner was asked to look over.
      patch(projectId, (d) => ({ planRunId, first: also !== undefined || d.first, error: null }));
      try {
        const army = armyOf(projectId);
        const task = [toMarkdown(brief, project.name), rosterNote(army), alreadyNote(day(projectId).tasks), also].filter(Boolean).join("\n\n");
        const result = await runStep({ runId: planRunId, folder: project.folder, step: "day", engine: choice.engine, model: choice.model, effort: choice.effort, task });
        if (day(projectId).planRunId !== planRunId) return;
        const status = day(projectId).ask ? "suggested" : "planned";
        const fresh = parseDay(result.output, choice, army).map((t) => ({ ...t, status }) as Task);
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
    // Every task running stops (an army stands down at once); their copies stay for a retry.
    stop: (projectId) => {
      halted.add(projectId);
      clearTimeout(rechecks.get(projectId));
      setHeld(projectId, null);
      for (const running of day(projectId).tasks.filter((t) => t.status === "running")) {
        patchTask(projectId, running.id, { status: "stopped", runId: null });
        if (running.runId) void stopRun(running.runId);
      }
    },
    hold: (projectId) => void halted.add(projectId),
    edit: (projectId, id, change) => patchTask(projectId, id, change),
    drop: (projectId, id) => {
      const task = day(projectId).tasks.find((t) => t.id === id && t.status !== "running");
      if (!task) return;
      patch(projectId, (d) => ({ tasks: d.tasks.filter((t) => t.id !== id) }));
      // A stopped army task may have a copy left: its work goes to its branch, the copy away.
      if (task.status === "stopped" && armyOf(projectId).length) void armyDiscard(projectId, id, task.title).catch(() => undefined);
    },
    setAsk: (projectId, ask) => patch(projectId, () => ({ ask })),
    setMcp: (projectId, mcp) => patch(projectId, () => ({ mcp })),
    setReview: (projectId, review) => patch(projectId, () => ({ review })),
    setLean: (projectId, lean) => patch(projectId, () => ({ lean })),
    setAgent: (projectId, agent) => {
      const before = companyAgent(projectId);
      useCompany.getState().choose(agent, projectId);
      if (!before) return;
      const was = (t: Task) => waiting(t) && !t.agentId && t.engine === before.engine && t.model === before.model;
      patch(projectId, (d) => ({ tasks: d.tasks.map((t) => (was(t) ? { ...t, engine: agent.engine, model: agent.model, effort: agent.effort } : t)) }));
    },
    follow: (projectId, agentId, agent) => {
      const company = companyAgent(projectId);
      const to = agent ?? company;
      if (!to) return;
      const moved = (t: Task): Task => {
        const next = { ...t, engine: to.engine, model: to.model, effort: to.effort };
        if (agent) return next;
        const { agentId: _, ...own } = next;
        return own;
      };
      patch(projectId, (d) => ({ tasks: d.tasks.map((t) => (waiting(t) && t.agentId === agentId ? moved(t) : t)) }));
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
