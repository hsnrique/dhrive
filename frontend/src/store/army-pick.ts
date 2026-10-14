import { agentById } from "@/lib/army";
import { ready, type Task } from "@/lib/day";
import { enginesFor, route } from "@/lib/logistics";
import { useArmy } from "./army";
import type { Day } from "./day";
import { useUsage } from "./usage";

// Which of an army's tasks starts next: the first one up whose tasks it waits for are done and whose
// CLI has room in its plan, or whose agent's backup does (the task moves to it, and says so). When
// every one up waits on a plan, none starts and the company is told why (`held`).

interface Deps {
  day: (projectId: string) => Day;
  patchTask: (projectId: string, id: string, change: Partial<Task>) => void;
  setHeld: (projectId: string, why: string | null) => void;
}

export async function nextToStart(projectId: string, { day, patchTask, setHeld }: Deps): Promise<Task | undefined> {
  const { tasks } = day(projectId);
  const army = useArmy.getState().byProject[projectId] ?? [];
  const up = tasks.filter((t) => t.status === "planned" && ready(t, tasks));
  if (!up.length) return void setHeld(projectId, null);
  await Promise.all(enginesFor(up, army).map((engine) => useUsage.getState().refresh(engine)));
  const known = useUsage.getState().known;
  let why: string | null = null;
  for (const task of up) {
    // Still up next: another pick may have taken it while the plans were being read.
    if (day(projectId).tasks.find((t) => t.id === task.id)?.status !== "planned") continue;
    const r = route(task, agentById(army, task.agentId), (engine) => known[engine]?.usage, Date.now());
    if (r.kind === "hold") {
      why ??= r.why;
      continue;
    }
    setHeld(projectId, null);
    if (r.kind === "go") return task;
    const moved = { engine: r.to.engine, model: r.to.model, effort: r.to.effort, note: r.note };
    patchTask(projectId, task.id, moved);
    return { ...task, ...moved };
  }
  setHeld(projectId, why);
  return undefined;
}
