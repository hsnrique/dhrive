import type { Engine } from "@/lib/api";
import { savedEffort, type Choice } from "@/lib/flow";
import { agentByName, agentIntro, type Agent } from "./army";
import { savedSpent, type Spent } from "./spend";
import { LEAN, STANDARDS } from "./standards";

// A company's tasks: those its agent suggests from the brief and those the owner adds, each run in
// turn as a code step in the project, kept afterwards as what the company has done. A suggestion is a
// JSON array that models wrap in a fence or a sentence anyway, so it's read from its first "[" to its
// last "]"; anything that isn't a plain, bounded string is dropped.

export type Area = "code" | "marketing" | "support" | "research";
export type TaskStatus = "suggested" | "planned" | "running" | "done" | "failed" | "stopped";

export interface Task {
  id: string;
  title: string;
  area: Area;
  engine: Engine;
  // The CLI's own default when empty.
  model: string;
  effort?: string;
  prompt: string;
  status: TaskStatus;
  // While running: its progress is in the app's live log under this id.
  runId: string | null;
  // What the CLI said when it finished, or why it failed.
  result: string;
  // The army's agent doing it (army.ts); none for the company's own agent.
  agentId?: string;
  // The tasks it waits for, by id: it starts once each of them is done.
  after?: string[];
  // Why it runs where it does when that changed on its own: its plan was full, it went to its backup.
  note?: string;
  // The tokens its runs spent, as its CLIs reported them (spend.ts).
  spent?: Spent;
}

export const AREAS: Area[] = ["code", "marketing", "support", "research"];
// What one suggestion holds, and how many tasks a company keeps, the oldest finished ones going first.
export const MAX_TASKS = 5;
export const MAX_KEPT = 60;
const MAX_TITLE = 80;
// What the backend takes as a task.
const MAX_PROMPT = 20_000;
const MAX_RESULT = 20_000;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function arrayIn(output: string): unknown[] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(output.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A task goes to the army's agent the planner named, on that agent's CLI and model, or else to the
// agent the owner picked for the company; dhrive never picks a model for them.
function taskOf(item: unknown, agent: Choice, army: Agent[]): Task | null {
  if (typeof item !== "object" || item === null) return null;
  const { title, area, prompt, agent: who } = item as Record<string, unknown>;
  const ask = text(prompt);
  if (!ask || ask.length > MAX_PROMPT) return null;
  const said = text(area).toLowerCase() as Area;
  const named = agentByName(army, who);
  const task = newTask(ask, text(title).slice(0, MAX_TITLE) || ask.slice(0, 40), AREAS.includes(said) ? said : "code", named ?? agent);
  return named ? { ...task, agentId: named.id } : task;
}

function newTask(prompt: string, title: string, area: Area, agent: Choice): Task {
  return { id: crypto.randomUUID(), title, area, engine: agent.engine, model: agent.model, ...savedEffort(agent.effort), prompt, status: "planned", runId: null, result: "" };
}

// A task the owner wrote: its first line is its title.
export function ownTask(said: string, area: Area, agent: Choice): Task | null {
  const ask = said.trim();
  if (!ask || ask.length > MAX_PROMPT) return null;
  const line = ask.split("\n")[0].trim();
  return newTask(ask, line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line, area, agent);
}

const finished = (t: Task) => t.status === "done" || t.status === "failed" || t.status === "stopped";

export function trimmed(tasks: Task[]): Task[] {
  let extra = tasks.length - MAX_KEPT;
  return tasks.filter((t) => {
    if (extra <= 0 || !finished(t)) return true;
    extra -= 1;
    return false;
  });
}

// What the agent hears besides the brief when it suggests more, so it doesn't suggest them again.
export function alreadyNote(tasks: Task[]): string {
  const list = (status: (t: Task) => boolean) => tasks.filter(status).slice(-20).map((t) => `- ${t.title}`).join("\n");
  const done = list((t) => t.status === "done");
  const queued = list((t) => t.status === "planned" || t.status === "running");
  const waiting = list((t) => t.status === "suggested");
  return [done && `Already done:\n${done}`, queued && `Already queued:\n${queued}`, waiting && `Already suggested, waiting for the owner's OK:\n${waiting}`].filter(Boolean).join("\n\n");
}

// The planner names what a task waits for by the other tasks' titles in the same reply; they become
// ids here. A task waits only for ones listed before it, so two tasks can never wait for each other
// (a cycle no run could ever start); a name that isn't an earlier task is dropped.
export function parseDay(output: string, agent: Choice, army: Agent[] = []): Task[] {
  const items = arrayIn(output);
  const pairs = items.map((item) => [item, taskOf(item, agent, army)] as const).filter((p): p is readonly [unknown, Task] => p[1] !== null).slice(0, MAX_TASKS);
  return pairs.map(([item, task], at) => {
    const earlier = new Map(pairs.slice(0, at).map(([, t]) => [t.title.trim().toLowerCase(), t.id]));
    const said = (item as { after?: unknown }).after;
    const after = (Array.isArray(said) ? said : [])
      .map((title) => (typeof title === "string" ? earlier.get(title.trim().toLowerCase()) : undefined))
      .filter((id): id is string => id !== undefined);
    return after.length ? { ...task, after: [...new Set(after)] } : task;
  });
}

// A task may start once every task it waits for is done; one the owner dropped no longer holds it.
export const ready = (task: Task, tasks: Task[]) =>
  (task.after ?? []).every((id) => {
    const before = tasks.find((t) => t.id === id);
    return !before || before.status === "done";
  });

// What holds it that failed or was stopped, through any chain of tasks waiting on each other: it
// can't start until that one runs again, so it is stuck rather than waiting, and nothing should keep
// trying to start it.
export function stuckOn(task: Task, tasks: Task[], seen = new Set<string>()): Task[] {
  seen.add(task.id);
  return (task.after ?? []).flatMap((id) => {
    const before = tasks.find((t) => t.id === id);
    if (!before || seen.has(id)) return [];
    if (before.status === "failed" || before.status === "stopped") return [before];
    return before.status === "done" ? [] : stuckOn(before, tasks, seen);
  });
}

// The titles of what it still waits for, for its card.
export const waitingOn = (task: Task, tasks: Task[]) =>
  (task.after ?? []).map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => t !== undefined && t.status !== "done").map((t) => t.title);

// The war room: what the army delivered lately, so each agent knows what the others just did.
export function handoffs(tasks: Task[], army: Agent[]): string {
  const lines = tasks
    .filter((t) => t.status === "done")
    .slice(-6)
    .map((t) => {
      const who = army.find((a) => a.id === t.agentId)?.name ?? "The company's agent";
      const said = taskSummary(t);
      return `- ${who}: ${t.title}${said ? ` (${said.slice(0, 160)})` : ""}`;
    });
  return lines.length ? `What the company's other agents delivered lately:\n${lines.join("\n")}` : "";
}


// What each task's agent hears around its own prompt: whose company it works for, the standards,
// and the rule the planner was given, since this agent never saw it.
export function taskPrompt(task: Task, company: string, agent?: Agent, lately = "", lean = false): string {
  const intro = agent ? `${agentIntro(agent, company)}\n\n` : "";
  const room = lately ? `\n\n${lately}` : "";
  const style = lean ? `\n\n${LEAN}` : "";
  return `${intro}${task.prompt}${room}\n\nThis is one of the tasks of ${company}; its brief is in COMPANY.md and its documents, if it has them yet, in docs/ (follow docs/design-guide.md in any interface).\n\n${STANDARDS}\n\nDon't publish, post, send, buy or spend anything: write what's meant for the outside world as a draft file in the project.${style}`;
}

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

// Where the company stands, in a line for the top of its page.
export function standing(tasks: Task[], first: boolean): { live: boolean; text: string } {
  const live = tasks.some((t) => t.status === "running");
  const queued = tasks.filter((t) => t.status === "planned").length;
  const suggested = tasks.filter((t) => t.status === "suggested").length;
  if (first) {
    const done = tasks.filter((t) => t.status === "done").length;
    if (live) return { live, text: `Working on its first delivery · ${done} of ${tasks.length} done` };
    if (tasks.length > 0 && done === tasks.length) return { live, text: "First delivery done" };
  }
  const working = tasks.filter((t) => t.status === "running").length;
  const doing = working > 1 ? `${working} working` : "Working";
  if (live) return { live, text: queued ? `${doing} · ${queued} up next` : doing };
  if (queued) return { live, text: `${count(queued, "task")} up next` };
  if (suggested) return { live, text: `${count(suggested, "suggested task")} to look over` };
  return { live, text: "Resting" };
}

export const clipped = (said: string) => said.trim().slice(0, MAX_RESULT);

// A saved task comes back only if it still looks like one; one that was running when the app closed
// was cut off, so it comes back stopped.
export function savedTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is Task => ["id", "title", "area", "engine", "model", "prompt", "status", "result"].every((key) => typeof (t as Record<string, unknown>)?.[key] === "string"))
    .map((t) => {
      const { agentId, after, note, spent, ...rest } = t;
      const waits = Array.isArray(after) ? after.filter((id): id is string => typeof id === "string") : [];
      const said = typeof note === "string" ? { note: note.slice(0, 200) } : {};
      const counted = savedSpent(spent);
      return { ...rest, ...(typeof agentId === "string" ? { agentId } : {}), ...(waits.length ? { after: waits } : {}), ...said, ...(counted ? { spent: counted } : {}), status: t.status === "running" ? "stopped" : t.status, runId: null };
    });
}

// One plain line for a task's folded card: what it asks beyond its title while it waits, what the CLI
// said once it ran, with the markdown marks a single line can't show taken out.
export function taskSummary(task: Task): string {
  const waiting = task.status === "suggested" || task.status === "planned";
  const text = waiting ? task.prompt.replace(task.title, "") : task.result;
  const line = text.split("\n").map((l) => l.replace(/^[\s>#*\-+\d.]+/, "").replace(/[*_`]/g, "").trim()).find(Boolean) ?? "";
  return line;
}
