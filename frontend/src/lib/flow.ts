import type { Cli, Engine, Step } from "@/lib/api";

export interface Choice {
  engine: Engine;
  model: string;
  // One of the model's effort levels; the CLI's own default when absent or empty.
  effort?: string;
}

// A saved effort comes back only as a word; the backend checks it again before any CLI sees it.
export const savedEffort = (effort: unknown) => (typeof effort === "string" && effort ? { effort } : {});

// How a request runs: a read-only chat to think out loud, the plan-then-code relay, or code alone.
export type Mode = "chat" | "relay" | "code";

export const MODES: Mode[] = ["chat", "relay", "code"];

// The saved mode, or the old plan switch it replaces (off meant straight to code).
export function restoreMode(saved: unknown, planFirst: unknown): Mode {
  if (MODES.includes(saved as Mode)) return saved as Mode;
  return planFirst === false ? "code" : "relay";
}

// Which stages a request in this mode runs, on which CLI and model. A chat talks with the planner's
// model, so what was discussed is already in that CLI's session when the plan comes.
export function stagesFor(mode: Mode, choices: Record<Step, Choice | null>): { plan: Choice | null; main: Choice | null } {
  if (mode === "chat") return { plan: null, main: choices.plan };
  return { plan: mode === "relay" ? choices.plan : null, main: choices.code };
}

// The owner's own split: plan with the strongest model, code with the faster one. Only used
// until they pick something else, and only on a CLI that's actually installed.
const PREFERRED: Record<Step, Choice> = {
  plan: { engine: "claude-code", model: "opus" },
  code: { engine: "claude-code", model: "sonnet" },
};

export function defaultChoice(step: Step, clis: Cli[]): Choice | null {
  const installed = clis.filter((cli) => cli.installed);
  if (installed.some((cli) => cli.engine === PREFERRED[step].engine)) return PREFERRED[step];
  return installed[0] ? { engine: installed[0].engine, model: "" } : null;
}

// A saved choice survives only while its CLI is still installed.
export function restoreChoice(saved: unknown, step: Step, clis: Cli[]): Choice | null {
  const choice = saved as Partial<Choice> | null;
  const usable = clis.some((cli) => cli.installed && cli.engine === choice?.engine);
  if (usable && typeof choice?.model === "string") return { engine: choice.engine as Engine, model: choice.model, ...savedEffort(choice.effort) };
  return defaultChoice(step, clis);
}

export const MAX_LOG_LINES = 400;

// The backend batches several lines per event; keep them as lines and only the latest ones, so a
// long run can't grow the log without bound.
export function appendLog(lines: string[], chunk: string, max = MAX_LOG_LINES): string[] {
  const next = lines.concat(chunk.split("\n").filter((line) => line.trim() !== ""));
  return next.length > max ? next.slice(next.length - max) : next;
}
