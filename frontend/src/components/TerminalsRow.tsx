import { useState } from "react";
import { SquareTerminal, Trash2 } from "lucide-react";

import { removePaneCopy } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useMaestro } from "@/store/maestro";
import { openSession } from "@/store/open-terminals";
import { usePaneStatus } from "@/store/pane-status";
import { useTerminals, type TerminalSession } from "@/store/terminals";
import { useTogether } from "@/store/together";
import { NameInput } from "./InlineEdit";
import { Confirm, HoverAction, rowClass } from "./SidebarRow";

// A Terminals session among a project's conversations, marked as one, with a dot when its maestro
// or one of its panes works, or a pane waits for the owner.

function useStatus(session: TerminalSession): "needs-you" | "working" | null {
  const splitting = useMaestro((s) => Boolean(s.bySession[session.id]?.runId));
  const panes = usePaneStatus((s) => {
    const states = session.panes.map((p) => s.byPane[p.id]?.state);
    return states.includes("needs-you") ? "needs-you" : states.includes("working") ? "working" : null;
  });
  return panes ?? (splitting ? "working" : null);
}

// Closing the session closes its panes; each one's own worktree goes too, unless git says it holds
// uncommitted work.
async function dropSession(session: TerminalSession) {
  useTerminals.getState().drop(session.id);
  useMaestro.getState().forget(session.id);
  useTogether.getState().dismiss(session.id);
  // The session's own copy, where its panes were brought together, goes the same way.
  const copies = [...new Set([...session.panes.filter((p) => p.copy).map((p) => p.id), session.id])];
  for (const id of copies) await removePaneCopy(session.projectId, id).catch(useApp.getState().reportError);
}

export function TerminalsRow({ session }: { session: TerminalSession }) {
  const onTerminals = useApp((s) => s.page === "terminals");
  const shown = useTerminals((s) => s.openId === session.id);
  const active = onTerminals && shown;
  const status = useStatus(session);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  if (confirming) return <Confirm question="Close these terminals?" action="Close" onYes={() => void dropSession(session)} onNo={() => setConfirming(false)} />;
  if (editing) return <NameInput value={session.title} label="Terminals name" onSave={(title) => useTerminals.getState().rename(session.id, title)} onDone={() => setEditing(false)} className="ml-[10px] w-[calc(100%-10px)] text-[12.5px]" />;
  return (
    <div className="group relative">
      <button type="button" title={`${session.title} · Terminals\nDouble-click to rename`} className={cn(rowClass(active), "group-hover:pr-8")} onClick={() => openSession(session.id)} onDoubleClick={() => setEditing(true)}>
        <SquareTerminal className="h-[13px] w-[13px] flex-none opacity-70" strokeWidth={1.75} aria-label="Terminals" />
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
        {status === "needs-you" ? <span className="h-1.5 w-1.5 flex-none rounded-full bg-attention" title="A pane is waiting for you" /> : status === "working" && <span className="node-live h-1.5 w-1.5 flex-none rounded-full bg-foreground" title="Working" />}
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <HoverAction label="Close these terminals" onClick={() => setConfirming(true)}>
          <Trash2 className="h-3.5 w-3.5" />
        </HoverAction>
      </div>
    </div>
  );
}
