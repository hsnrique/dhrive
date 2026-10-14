import type { Engine, PlanUsage } from "./api";
import type { Agent } from "./army";
import { limitReached } from "./auto";
import type { Task } from "./day";
import type { Choice } from "./flow";
import { cliLabel } from "./names";

// An army's logistics: before a task starts, its CLI's plan is looked at. Near its limit, the task
// moves to the backup the owner gave its agent, if that one has room; otherwise it waits for the
// plan to reset. dhrive never picks a model itself: the backup is the owner's choice, or nothing.

export type Route = { kind: "go" } | { kind: "switch"; to: Choice; note: string } | { kind: "hold"; why: string };

// Ollama runs on this Mac: there's no plan to run out of.
const full = (engine: Engine, model: string, usage: (e: Engine) => PlanUsage | undefined, now: number) =>
  engine === "ollama" ? null : limitReached(usage(engine), model, now);

export function route(task: Task, agent: Agent | undefined, usage: (e: Engine) => PlanUsage | undefined, now: number): Route {
  const reached = full(task.engine, task.model, usage, now);
  if (!reached) return { kind: "go" };
  const why = `${cliLabel(task.engine, [])}: ${reached}`;
  const backup = agent?.fallback;
  if (backup && !(backup.engine === task.engine && backup.model === task.model) && !full(backup.engine, backup.model, usage, now)) {
    return { kind: "switch", to: backup, note: `${why}, so it runs on ${cliLabel(backup.engine, [])} instead` };
  }
  return { kind: "hold", why };
}

// The CLIs a set of tasks would ask about: their own and their agents' backups.
export function enginesFor(tasks: Task[], army: Agent[]): Engine[] {
  const all = tasks.flatMap((t) => [t.engine, army.find((a) => a.id === t.agentId)?.fallback?.engine]);
  return [...new Set(all.filter((e): e is Engine => e !== undefined && e !== "ollama"))];
}

// How long a company whose next tasks all wait on a plan rests before it looks again.
export const RECHECK_MS = 10 * 60_000;
