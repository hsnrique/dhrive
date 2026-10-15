import type { ReactNode } from "react";
import { Square } from "lucide-react";

import type { Engine, Project } from "@/lib/api";
import { isBlank, type Brief } from "@/lib/company";
import { stuckOn, type Task } from "@/lib/day";
import { totalDetail, totalLine, totalOf } from "@/lib/spend";
import { ago, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { unfinished, upNext } from "@/lib/attention";
import { useApp } from "@/store/app";
import { companyAgent, useAgentOf } from "@/store/company";
import { useDay, useDayOf, type Day } from "@/store/day";
import { useFold } from "@/store/fold";
import { useLiveLast, useLivePhase } from "@/store/live";
import { buttonVariants } from "@/components/ui/button";
import { BLOCKED_TITLE, RunsBlocked, useRunsBlocked } from "../RunsBlocked";
import { ChoicePicker } from "../ModelPicker";
import { Switch } from "../ui/switch";
import { AutoEnded, AutoMode } from "./AutoMode";
import { SectionHead } from "./SectionHead";
import { TaskComposer } from "./TaskComposer";
import { TaskRow } from "./TaskRow";

// The company's tasks, above its brief: what it's working on and what's next, the owner's own among
// them; what its agent suggests, waiting there only when the owner asked to look first; and what it
// has done, newest first, the older ones folded away.

const primary = cn(buttonVariants({ variant: "primary", size: "md" }), "px-4");
const quiet = cn(buttonVariants({ variant: "soft", size: "md" }), "px-3");

// What the tasks on this page spent, in one quiet figure; what it's made of is in its tooltip.
function Spent({ tasks }: { tasks: Task[] }) {
  const total = totalOf(tasks.map((t) => t.spent));
  if (!total.input && !total.output) return null;
  return <span className="font-mono text-[11px] text-muted-foreground" title={`What these tasks' runs spent, as their CLIs reported it: ${totalDetail(total)}`}>{totalLine(total)}</span>;
}

function Progress({ runId }: { runId: string }) {
  const phase = useLivePhase(runId) || "Starting";
  const doing = useLiveLast(runId);
  const said = doing ? `${phase} · ${doing}` : phase;
  return (
    <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground" title={said}>
      <span className="node-live mr-2 inline-block h-1.5 w-1.5 rounded-full bg-foreground align-middle" />
      {said}
    </p>
  );
}

function Planning() {
  return (
    <ul className="grid gap-2" aria-hidden>
      {[0, 1, 2].map((at) => (
        <li key={at} className="ghost-sweep grid gap-2.5 rounded-2xl border border-border bg-card px-4 py-3.5" style={{ animationDelay: `${at * 0.2}s` }}>
          <span className="h-2.5 w-2/5 rounded-full bg-selected" />
          <span className="ml-[30px] h-2 w-4/5 rounded-full bg-white/[0.05]" />
        </li>
      ))}
    </ul>
  );
}

// What Ask first holds back, said the same way wherever it's switched.
export const ASK_FIRST_ON = "Suggestions and tool use wait for your OK";
export const ASK_FIRST_OFF = "Suggestions start right away, and tasks don't ask before using a tool";

// The rules the work runs under, in a few words: while it runs the switches step aside, the rules don't.
const policy = (day: Day) => [day.ask ? "Asks first" : day.mcp ? "On its own, MCP on" : "On its own", day.lean && "Lean", day.review && "Review"].filter(Boolean).join(" · ");

// What can happen next, in one bar: get suggestions, run what's waiting, or stop.
function Bar({ project, day, engines, blank }: { project: Project; day: Day; engines: Engine[]; blank: boolean }) {
  useAgentOf(project.id);
  const choice = companyAgent(project.id);
  const { plan, stopPlan, run, stop, setAsk, setMcp, setLean, setAgent } = useDay.getState();
  // Changeable whatever the company is doing: what's waiting moves to the new pick.
  const picker = choice && <ChoicePicker choice={choice} onChoose={(next) => setAgent(project.id, next)} label="Agent that works for the company" engines={engines} down tunable />;
  const now = useNow(false);
  const blocked = useRunsBlocked();
  const running = day.tasks.some((t) => t.status === "running");
  // What Run would start: a task stuck behind a failed one can't, so it isn't counted.
  const waiting = day.tasks.filter((t) => t.status === "planned" && !stuckOn(t, day.tasks).length).length;
  const suggested = day.tasks.filter((t) => t.status === "suggested").length;
  // Wraps rather than overflows when its column is narrow.
  const card = "flex min-h-[48px] flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border border-border bg-card px-2.5 py-2";
  const said = blocked ? BLOCKED_TITLE : blank ? "Write the brief first" : day.plannedAt ? `Suggested ${ago(day.plannedAt, now)}. Reads the brief and the project, changes nothing.` : "Reads the brief and the project, changes nothing.";
  const suggest = (
    <button type="button" disabled={!choice || blank || blocked} title={said} className={waiting || running || suggested ? quiet : primary} onClick={() => void plan(project.id)}>
      {day.plannedAt ? "Suggest more" : "Suggest tasks"}
    </button>
  );
  if (day.planRunId) {
    return (
      <div className={card}>
        <Progress runId={day.planRunId} />
        <button type="button" className={quiet} onClick={() => stopPlan(project.id)}><Square className="h-3 w-3 fill-current" />Stop</button>
      </div>
    );
  }
  if (running) {
    return (
      <div className={card}>
        {/* What's working is said above the bar and on the task itself; here, only what can change. */}
        {picker ?? <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">Working{waiting ? ` · ${waiting} up next` : ""}</p>}
        <span className="min-w-0 truncate text-[11.5px] text-muted-foreground" title="Change them once it's done, or stop it">{policy(day)}</span>
        <span className="ml-auto" />
        {suggest}
        <button type="button" className={quiet} onClick={() => stop(project.id)}><Square className="h-3 w-3 fill-current" />Stop</button>
      </div>
    );
  }
  return (
    <div className={card}>
      {picker}
      <Switch on={day.ask} label="Ask first" title={day.ask ? ASK_FIRST_ON : ASK_FIRST_OFF} onChange={(on) => setAsk(project.id, on)} />
      <Switch on={day.mcp && !day.ask} disabled={day.ask} label="MCP tools" title={day.ask ? "With Ask first on, every tool waits for your OK" : day.mcp ? "MCP tools run without asking too: they can send, post or pay in your name" : "MCP tools are off while tasks run on their own"} onChange={(on) => setMcp(project.id, on)} />
      <Switch on={day.lean} label="Lean" title={day.lean ? "Agents work without narrating, one line at the end: your plan lasts longer" : "Agents explain as they work"} onChange={(on) => setLean(project.id, on)} />
      <span className="ml-auto" />
      {suggest}
      {/* What waits for the owner's OK comes before asking for more. */}
      {suggested > 0 && <button type="button" className={waiting ? quiet : primary} onClick={() => useDay.getState().accept(project.id)}>Add all · {suggested}</button>}
      {waiting > 0 && <button type="button" disabled={!choice || blocked} title={blocked ? BLOCKED_TITLE : undefined} className={primary} onClick={() => void run(project.id)}>Run {waiting}</button>}
      {day.held && <p className="w-full truncate font-mono text-[11.5px] text-attention" title={`${day.held}. It looks again in a few minutes, or press Run.`}>waiting: {day.held}</p>}
    </div>
  );
}

// A list that shows its first few, and the rest on asking.
function Group({ id, title, action, items, cap, children }: { id: string; title: string; action?: ReactNode; items: ReactNode[]; cap: number; children?: ReactNode }) {
  const [all, setAll] = useFold(id);
  if (!items.length && !children) return null;
  const hidden = items.length - cap;
  return (
    <div className="grid gap-2">
      <div className="flex h-6 items-center gap-2 px-1">
        <h3 className="text-[12px] font-medium text-muted-foreground">{title}</h3>
        <span className="ml-auto" />
        {action}
      </div>
      <ul className="grid gap-1.5">
        {all ? items : items.slice(0, cap)}
        {children}
      </ul>
      {hidden > 0 && (
        <button type="button" className="justify-self-start px-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

const SHOWN = { next: 4, suggested: 3, attention: 4, done: 3 };

// Where the overview's "needs your OK" line takes the owner.
export const tasksId = (projectId: string) => `tasks-${projectId}`;

export function Tasks({ project, brief }: { project: Project; brief: Brief }) {
  const day = useDayOf(project.id);
  useAgentOf(project.id);
  const engines = useApp((s) => s.clis).filter((cli) => cli.installed).map((cli) => cli.engine);
  const asking = useApp((s) => s.approvals);
  const open = upNext(day.tasks, (runId) => (asking[runId]?.length ?? 0) > 0);
  const suggested = day.tasks.filter((t) => t.status === "suggested");
  const attention = unfinished(day.tasks);
  const finished = day.tasks.filter((t) => t.status === "done");
  const row = (task: Task) => <TaskRow key={task.id} projectId={project.id} task={task} engines={engines} tasks={day.tasks} />;
  return (
    <section id={tasksId(project.id)} className="grid gap-4 scroll-mt-16">
      <SectionHead title={day.first ? "First delivery" : "Tasks"}>
        <Spent tasks={day.tasks} />
        {!day.first && <AutoMode projectId={project.id} disabled={isBlank(brief) || !companyAgent(project.id)} />}
      </SectionHead>
      <AutoEnded projectId={project.id} />
      {isBlank(brief) && !day.tasks.length ? (
        <p className="text-[13.5px] text-muted-foreground">Write the brief below, or let its agent draft it, and the company suggests its tasks from it.</p>
      ) : (
        <>
          <RunsBlocked />
          <Bar project={project} day={day} engines={engines} blank={isBlank(brief)} />
          {day.error && <p className="px-1 text-[12.5px] text-failure">{day.error}</p>}
          <Group id={`next:${project.id}`} title="Up next" items={open.map(row)} cap={SHOWN.next}>
            <TaskComposer projectId={project.id} disabled={!companyAgent(project.id)} />
          </Group>
          {day.planRunId ? <Planning /> : (
            <Group id={`suggested:${project.id}`} title="Suggested" items={suggested.map(row)} cap={SHOWN.suggested} action={<button type="button" className="text-[12px] font-medium text-foreground/80 transition-colors hover:text-foreground" onClick={() => useDay.getState().accept(project.id)}>Add all</button>} />
          )}
          <Group id={`attention:${project.id}`} title="Needs attention" items={[...attention].reverse().map(row)} cap={SHOWN.attention} />
          <Group id={`done:${project.id}`} title="Done" items={[...finished].reverse().map(row)} cap={SHOWN.done} />
        </>
      )}
    </section>
  );
}
