import type { PlanUsage } from "./api";
import type { Task } from "./day";
import { shownPercent } from "./usage";

// Auto mode's judgment, kept apart from its loop: how long the owner can hand the company over for,
// when the CLI's plan is too close to its limit to start more, and when work has gone wrong enough
// in a row that carrying on would only spend tokens.

export const HOURS = [1, 2, 4, 8] as const;
// Past this, a round could run the plan out mid-task; better to stop and say why.
const LIMIT_PERCENT = 90;
export const MAX_FAILURES = 2;

// A window the CLI keeps for one model ("Week, Fable") matters only when the agent uses that model.
function counts(label: string, model: string): boolean {
  const scope = label.split(", ")[1]?.toLowerCase();
  return !scope || scope === "all models" || (model !== "" && (scope.includes(model.toLowerCase()) || model.toLowerCase().includes(scope)));
}

export function limitReached(usage: PlanUsage | undefined, model: string, now: number): string | null {
  const full = usage?.windows.find((window) => counts(window.label, model) && shownPercent(window, now) >= LIMIT_PERCENT);
  return full ? `${full.label} limit is at ${Math.round(shownPercent(full, now))}%` : null;
}

// "1 h 42 min left", "8 min left".
export function timeLeft(until: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((until - now) / 60_000));
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""} left`;
}

// Failures in a row at the end of a round, starting from those carried over from the last one; a
// task that worked resets the count.
export function failuresAfter(round: Task[], carried: number): number {
  return round.reduce((streak, task) => (task.status === "failed" ? streak + 1 : task.status === "done" ? 0 : streak), carried);
}
