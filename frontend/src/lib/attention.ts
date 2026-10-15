import type { Task } from "./day";

// What in a company's day waits on its owner, and the order its tasks show in so that it's never
// hidden under "+N more": the owner looks there first, so that's where it goes first.

const asks = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));

// In words, or null when nothing waits. A tool call a running task can't make without the owner
// comes first: the task is stuck until they answer. Then suggestions that Ask first holds back.
export function needsOwner(tasks: Task[], asking: (runId: string) => boolean, askFirst: boolean): string | null {
  const tools = tasks.filter((t) => t.status === "running" && t.runId && asking(t.runId)).length;
  if (tools) return asks(tools, "A task needs your OK", "# tasks need your OK");
  const held = askFirst ? tasks.filter((t) => t.status === "suggested").length : 0;
  if (held) return asks(held, "A suggestion waits for your OK", "# suggestions wait for your OK");
  return null;
}

// Up next: what asks for the owner, then what runs, then what waits its turn, each in its own order.
export function upNext(tasks: Task[], asking: (runId: string) => boolean): Task[] {
  const rank = (t: Task) => (t.status === "running" ? (t.runId && asking(t.runId) ? 0 : 1) : 2);
  return tasks.filter((t) => t.status === "running" || t.status === "planned").sort((a, b) => rank(a) - rank(b));
}

// What failed or was stopped: it waits on the owner too, to try again or let go.
export const unfinished = (tasks: Task[]) => tasks.filter((t) => t.status === "failed" || t.status === "stopped");

// A task tried again goes ahead of what's waiting, not behind it: the owner asked for it just now.
export function aheadOfQueue(tasks: Task[], task: Task): Task[] {
  const at = tasks.findIndex((t) => t.status === "planned");
  return at < 0 ? [...tasks, task] : [...tasks.slice(0, at), task, ...tasks.slice(at)];
}
