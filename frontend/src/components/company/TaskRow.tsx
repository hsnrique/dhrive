import { Check, Code2, LifeBuoy, Megaphone, RotateCcw, Search, Square, X, type LucideIcon } from "lucide-react";

import type { Engine } from "@/lib/api";
import { stuckOn, taskSummary, waitingOn, type Area, type Task, type TaskStatus } from "@/lib/day";
import { spendDetail, spendLine } from "@/lib/spend";
import { cn } from "@/lib/utils";
import { agentById } from "@/lib/army";
import { useArmyOf } from "@/store/army";
import { useDay } from "@/store/day";
import { useFold } from "@/store/fold";
import { useLiveLast, useLivePhase } from "@/store/live";
import { buttonVariants } from "@/components/ui/button";
import { revealed } from "@/components/ui/reveal";
import { Approvals } from "../Approvals";
import { Markdown } from "../Markdown";
import { ChoicePicker } from "../ModelPicker";

// One of the company's tasks: what it's for, who does it, and how it went. A suggestion can be added
// to the queue; until it starts, a task can be handed to another CLI or dropped (those show on hover,
// or unfolded); while it runs it shows what the CLI is doing and anything it needs the owner's OK
// for; after, what it said it did, and one that failed or was stopped can be tried again.

export const AREA_LOOK: Record<Area, { label: string; Icon: LucideIcon }> = {
  code: { label: "Code", Icon: Code2 },
  marketing: { label: "Marketing", Icon: Megaphone },
  support: { label: "Support", Icon: LifeBuoy },
  research: { label: "Research", Icon: Search },
};

const action = cn(buttonVariants({ variant: "ghost", size: "xs" }), "px-2");

const STATUS: Record<TaskStatus, string> = { suggested: "Suggested", planned: "Up next", running: "Working", done: "Done", failed: "Failed", stopped: "Stopped" };

function Mark({ status }: { status: TaskStatus }) {
  const box = "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full";
  if (status === "running") return <span className={box} title={STATUS[status]}><span className="node-live h-2 w-2 rounded-full bg-foreground" /></span>;
  if (status === "done") return <span className={cn(box, "bg-foreground text-background")} title={STATUS[status]}><Check className="h-3 w-3" strokeWidth={3} /></span>;
  if (status === "failed") return <span className={cn(box, "border border-failure/60 text-failure")} title={STATUS[status]}><X className="h-3 w-3" strokeWidth={2.5} /></span>;
  if (status === "stopped") return <span className={cn(box, "border border-border text-muted-foreground")} title={STATUS[status]}><Square className="h-2 w-2 fill-current" /></span>;
  return <span className={cn(box, "border border-border", status === "suggested" && "border-dashed")} title={STATUS[status]} />;
}

function Progress({ runId }: { runId: string }) {
  const phase = useLivePhase(runId) || "Starting";
  const doing = useLiveLast(runId);
  const said = doing ? `${phase} · ${doing}` : phase;
  return <p className="truncate text-[12.5px] text-muted-foreground" title={said}>{said}</p>;
}

// Folded, a task is one card: its mark, title and area, and one line of what it asks or what it did.
// A click unfolds the whole of it with what can be done to it. Its live progress and anything it waits
// on the owner for always show, folded or not.
export function TaskRow({ projectId, task, engines, tasks = [] }: { projectId: string; task: Task; engines: Engine[]; tasks?: Task[] }) {
  const [open, setOpen] = useFold(`task:${task.id}`);
  const { label, Icon } = AREA_LOOK[task.area];
  const agent = agentById(useArmyOf(projectId), task.agentId);
  const waits = task.status === "planned" ? waitingOn(task, tasks) : [];
  const stuck = task.status === "planned" ? stuckOn(task, tasks) : [];
  const { edit, drop, accept, retry } = useDay.getState();
  const editable = task.status === "planned" || task.status === "suggested";
  const again = task.status === "failed" || task.status === "stopped";
  const summary = taskSummary(task);
  const more = editable ? task.prompt !== task.title : Boolean(task.result);
  const toggle = () => more && setOpen((v) => !v);
  const running = task.status === "running" && task.runId;
  // A card with a second line shows its actions over it; one with nothing more to say keeps them
  // there, and so does one that didn't finish: trying again is what it's there for.
  const line = running || (task.note && task.status === "planned") || waits.length > 0 || (!open && summary);
  // The card's own buttons act without folding or unfolding it.
  const own = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <li className={cn("group relative grid gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors", more && "cursor-pointer hover:border-white/20", task.status === "running" && "border-white/20")} onClick={toggle}>
      <div
        className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
        role={more ? "button" : undefined}
        tabIndex={more ? 0 : undefined}
        aria-expanded={more ? open : undefined}
        onKeyDown={(e) => more && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
      >
        <Mark status={task.status} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.title}</span>
        {agent && <span className="max-w-24 flex-none truncate font-mono text-[11px] text-muted-foreground" title={`${agent.name} does it`}>{agent.name}</span>}
        <Icon className="h-3 w-3 flex-none text-muted-foreground" strokeWidth={1.75} aria-label={label} />
        {task.status === "suggested" ? (
          <button type="button" className="h-6 flex-none rounded-md bg-selected px-2.5 text-[11.5px] font-medium transition-colors hover:bg-pressed" onClick={(e) => (own(e), accept(projectId, task.id))}>
            Add
          </button>
        ) : !editable && <span className="flex-none text-[11px] text-muted-foreground">{STATUS[task.status]}</span>}
      </div>
      <div className="grid min-w-0 gap-2 pl-[28px]">
        {running ? (
          <div className="grid gap-2" onClick={own}>
            <Progress runId={running} />
            <Approvals projectId={projectId} runId={task.runId} />
          </div>
        ) : task.note && task.status === "planned" ? (
          <p className="truncate font-mono text-[11.5px] text-muted-foreground" title={task.note}>{task.note}</p>
        ) : waits.length > 0 ? (
          <p className="truncate font-mono text-[11.5px] text-muted-foreground" title={stuck.length ? `It starts once ${stuck[0].title} is tried again and done, or drop it` : `Starts once ${waits.join(", ")} ${waits.length === 1 ? "is" : "are"} done`}>
            waits for {waits.join(", ")}
            {stuck.length > 0 && <span className="text-failure"> · {stuck[0].status}</span>}
          </p>
        ) : !open && summary && (
          <div className="flex min-w-0 items-baseline gap-2">
            <p className={cn("min-w-0 flex-1 truncate text-[12px]", task.status === "failed" ? "text-failure" : "text-muted-foreground")}>{summary}</p>
            {task.spent && <span className="flex-none font-mono text-[11px] text-muted-foreground" title={spendDetail(task.spent)}>{spendLine(task.spent)}</span>}
          </div>
        )}
        {open && (editable ? (
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">{task.prompt}</p>
        ) : task.status === "failed" ? (
          <p className="whitespace-pre-wrap text-[12.5px] text-failure">{task.result}</p>
        ) : (
          <div className="min-w-0 [&_p]:text-[12.5px]"><Markdown source={task.result} /></div>
        ))}
        {(editable || again) && (
          <div className={open || !line || again ? "flex flex-wrap items-center gap-1.5" : revealed("bg-card")} onClick={own}>
            {editable && <ChoicePicker choice={{ engine: task.engine, model: task.model, effort: task.effort }} onChoose={(choice) => edit(projectId, task.id, choice)} label={`CLI for ${task.title}`} engines={engines} align="right" down tunable />}
            {editable && (
              <button type="button" className={action} onClick={() => drop(projectId, task.id)}>
                <X className="h-3 w-3" />
                {task.status === "suggested" ? "Dismiss" : "Drop"}
              </button>
            )}
            {again && (
              <button type="button" className={action} onClick={() => retry(projectId, task.id)}>
                <RotateCcw className="h-3 w-3" />
                Try again
              </button>
            )}
            {again && (
              <button type="button" className={action} onClick={() => drop(projectId, task.id)}>
                <X className="h-3 w-3" />
                Drop
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
