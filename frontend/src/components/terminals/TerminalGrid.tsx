import { useEffect, useState } from "react";
import { GitBranch, Plus, RotateCw, SquareTerminal, X } from "lucide-react";

import { removePaneCopy, type Cli, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useDraft, useMaestro } from "@/store/maestro";
import { usePaneStatus } from "@/store/pane-status";
import { columnsFor, MAX_PANES, useTerminals, type Pane, type TerminalSession } from "@/store/terminals";
import { InlineEdit } from "../InlineEdit";
import { ChoicePicker } from "../ModelPicker";
import { Maestro } from "./Maestro";
import { TerminalView } from "./TerminalView";
import { TogetherBar, TogetherButton } from "./Together";

// A Terminals session: up to six CLIs on screen at once in its project, each its own Claude Code,
// Codex or agy, side by side. Local models have no screen of their own, so they aren't offered.

const withScreen = (clis: Cli[]) => clis.filter((cli) => cli.installed && cli.engine !== "ollama");

const headerButton = "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40";
const tool = "flex h-6 w-6 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground";

// A marker only when there's something to know: working, the owner's turn, or ended.
function StatusMarker({ pane }: { pane: string }) {
  const state = usePaneStatus((s) => s.byPane[pane]?.state ?? "idle");
  if (state === "working") return <span className="node-live h-1.5 w-1.5 flex-none rounded-full bg-foreground" title="Working" />;
  if (state === "needs-you") return <span className="flex flex-none items-center gap-1 text-[11px] text-foreground"><span className="h-1.5 w-1.5 rounded-full bg-attention" />your turn</span>;
  if (state === "ended") return <span className="flex-none text-[11px] text-muted-foreground">ended</span>;
  return null;
}

// The pane's own worktree goes away with the switch or the pane, unless git says it holds
// uncommitted work: then it stays, and the owner is told where.
async function dropCopy(projectId: string, pane: Pane) {
  if (!pane.copy) return;
  await removePaneCopy(projectId, pane.id).catch(useApp.getState().reportError);
}

function CopySwitch({ projectId, pane, branch }: { projectId: string; pane: Pane; branch: string | null }) {
  const { change } = useTerminals.getState();
  const toggle = () => {
    change(pane.id, { copy: !pane.copy });
    if (pane.copy) void dropCopy(projectId, pane);
  };
  return (
    <button type="button" title={pane.copy ? `Working in its own copy on ${branch ?? "its branch"}. Click to go back to the project folder.` : "Work in a copy of its own (a git worktree), so other panes on this project never collide"} aria-pressed={pane.copy} className={cn(tool, "w-auto gap-1 px-1.5", pane.copy && "text-foreground")} onClick={toggle}>
      <GitBranch className="h-3.5 w-3.5" />
      {pane.copy && branch && <span className="max-w-28 truncate font-mono text-[10.5px]">{branch}</span>}
    </button>
  );
}

function PaneHeader({ pane, projectId, clis, branch }: { pane: Pane; projectId: string; clis: Cli[]; branch: string | null }) {
  const { change, restart, remove } = useTerminals.getState();
  const title = usePaneStatus((s) => s.byPane[pane.id]?.title ?? "");
  return (
    <div className="flex h-9 flex-none items-center gap-1.5 border-b border-border px-1.5">
      <ChoicePicker choice={{ engine: pane.engine, model: pane.model }} onChoose={({ engine, model }) => change(pane.id, { engine, model })} label="Pane CLI" engines={clis.map((cli) => cli.engine)} down />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={title}>{title}</span>
      <StatusMarker pane={pane.id} />
      <CopySwitch projectId={projectId} pane={pane} branch={branch} />
      <button type="button" title="Start it again" aria-label="Restart" className={tool} onClick={() => restart(pane.id)}>
        <RotateCw className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Close this pane" aria-label="Close" className={tool} onClick={() => { remove(pane.id); void dropCopy(projectId, pane); }}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PaneBox({ pane, project, clis }: { pane: Pane; project: Project | undefined; clis: Cli[] }) {
  const cli = clis.find((c) => c.engine === pane.engine);
  const installed = cli !== undefined;
  const label = `${cli?.label ?? "The CLI"} in ${project?.name ?? "a project"}`;
  const { report, retitle, reset } = usePaneStatus.getState();
  const [branch, setBranch] = useState<string | null>(null);
  // Each start begins with a clean slate, and a closed pane leaves nothing behind.
  useEffect(() => {
    reset(pane.id);
    return () => reset(pane.id);
  }, [pane.id, pane.run, reset]);
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-terminal">
      {project && <PaneHeader pane={pane} projectId={project.id} clis={clis} branch={branch} />}
      <div className="min-h-0 flex-1 overflow-hidden rounded-b-xl">
        {project && installed ? (
          // A new run id each start, so a stopped CLI's last words never reach its replacement.
          <TerminalView key={pane.run} id={`${pane.id}-${pane.run}`} engine={pane.engine} project={project.id} copy={pane.copy ? pane.id : null} model={pane.model} task={pane.task} onStarted={() => useTerminals.getState().started(pane.id)} onBranch={setBranch} onEvent={(event) => report(pane.id, event, label)} onTitle={(title) => retitle(pane.id, title)} />
        ) : (
          <p className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">{installed ? "This project is no longer in dhrive." : "That CLI isn't installed."}</p>
        )}
      </div>
    </section>
  );
}

function Header({ session, project, clis }: { session: TerminalSession; project: Project | undefined; clis: Cli[] }) {
  const maestro = useDraft(session.id).open;
  const add = () => clis[0] && useTerminals.getState().add(session.id, clis[0].engine);
  return (
    <header data-tauri-drag-region className="flex h-[52px] flex-none items-center gap-2 border-b border-border bg-card px-4">
      <SquareTerminal className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.75} aria-label="Terminals" />
      <InlineEdit value={session.title} label="Terminals name" onSave={(title) => useTerminals.getState().rename(session.id, title)} className="max-w-72 text-[13px] font-semibold" inputClassName="w-72 text-[13px]" />
      {project && <span className="truncate text-[12px] text-muted-foreground">in {project.name}</span>}
      <span className="ml-auto" />
      <TogetherButton session={session} className={headerButton} />
      {/* With no panes the session is the maestro's, so the toggle only says so. */}
      <button type="button" aria-pressed={maestro || session.panes.length === 0} title={session.panes.length ? "Show or hide the maestro" : "The maestro"} disabled={clis.length === 0 || session.panes.length === 0} className={cn(headerButton, "disabled:opacity-100", (maestro || session.panes.length === 0) && "bg-selected text-foreground")} onClick={() => useMaestro.getState().set(session.id, { open: !maestro })}>
        Maestro
      </button>
      <button type="button" disabled={session.panes.length >= MAX_PANES || clis.length === 0} className={headerButton} onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Pane
      </button>
    </header>
  );
}

export function TerminalGrid({ session }: { session: TerminalSession }) {
  const project = useApp((s) => s.projects.find((p) => p.id === session.projectId));
  const clis = withScreen(useApp((s) => s.clis));
  const maestro = useDraft(session.id).open;
  const { panes } = session;
  return (
    <div className="flex h-full flex-col">
      <Header session={session} project={project} clis={clis} />
      <TogetherBar session={session} />
      {clis.length === 0 ? (
        <p className="m-auto text-[13px] text-foreground/85">Install Claude Code, Codex or Antigravity to start.</p>
      ) : (
        (maestro || panes.length === 0) && <Maestro session={session.id} clis={clis} room={MAX_PANES - panes.length} fill={panes.length === 0} />
      )}
      {panes.length > 0 && (
        <div className="grid min-h-0 flex-1 auto-rows-fr gap-2 p-2" style={{ gridTemplateColumns: `repeat(${columnsFor(panes.length)}, minmax(0, 1fr))` }}>
          {panes.map((pane) => (
            <PaneBox key={pane.id} pane={pane} project={project} clis={clis} />
          ))}
        </div>
      )}
    </div>
  );
}
