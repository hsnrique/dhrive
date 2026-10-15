import { openUrl } from "@tauri-apps/plugin-opener";
import { GitMerge, X } from "lucide-react";

import type { Together } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePaneStatus } from "@/store/pane-status";
import type { TerminalSession } from "@/store/terminals";
import { useTogether, workPanes } from "@/store/together";
import { buttonVariants } from "@/components/ui/button";

// Bringing the session's panes together on one branch, and what came of it: what merged, what had
// nothing new, and what conflicted, with a pane to resolve each conflict in the project folder.

const pill = buttonVariants({ variant: "outline", size: "sm" });
const OUTCOME: Record<Together["merges"][number]["outcome"], string> = { merged: "merged", "nothing-new": "nothing new", conflict: "conflicts", "no-copy": "no copy of its own" };

export function TogetherButton({ session, className }: { session: TerminalSession; className: string }) {
  const panes = workPanes(session);
  const busy = useTogether((s) => s.bySession[session.id]?.busy ?? false);
  // Committing a pane's copy while its CLI still writes would take half its work, and a pane on the
  // project folder may be mid-merge.
  const working = usePaneStatus((s) => [...panes.map((p) => p.id), session.id].some((id) => s.byPane[id]?.state === "working"));
  if (panes.length === 0) return null;
  return (
    <button type="button" disabled={busy || working} title={working ? "Wait for the panes to finish" : "Merge every pane's work onto one branch"} className={className} onClick={() => void useTogether.getState().bring(session)}>
      <GitMerge className="h-3.5 w-3.5" /> {busy ? "Bringing together…" : "Bring together"}
    </button>
  );
}

function MergeRow({ session, merge }: { session: TerminalSession; merge: Together["merges"][number] }) {
  const pane = session.panes.find((p) => p.id === merge.pane);
  const resolving = session.panes.some((p) => p.id === session.id);
  const conflict = merge.outcome === "conflict";
  return (
    <li className="flex min-h-7 items-center gap-2 text-xs">
      <span className={cn("h-1.5 w-1.5 flex-none rounded-full", conflict ? "bg-attention" : merge.outcome === "merged" ? "bg-foreground" : "bg-muted-foreground/50")} />
      <span className="min-w-0 truncate text-foreground/90">{pane?.title || merge.branch}</span>
      <span className="flex-none text-muted-foreground">{OUTCOME[merge.outcome]}</span>
      {conflict && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={merge.files.join("\n")}>{merge.files.join(", ")}</span>}
      {conflict && (
        <button type="button" disabled={resolving} title={resolving ? "A pane is already open on the result" : undefined} className={cn(pill, "ml-auto")} onClick={() => useTogether.getState().openOnIt(session, merge)}>
          Resolve in a pane
        </button>
      )}
    </li>
  );
}

export function TogetherBar({ session }: { session: TerminalSession }) {
  const gathering = useTogether((s) => s.bySession[session.id]);
  if (!gathering || (!gathering.result && !gathering.error)) return null;
  const { result, error, pullRequest, busy } = gathering;
  const onIt = session.panes.some((p) => p.id === session.id);
  return (
    <div className="pop-in flex-none border-b border-border bg-card/60 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <GitMerge className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        {result ? (
          <span className="min-w-0 truncate text-[12.5px]">
            Brought together on <span className="font-mono text-[12px]">{result.branch}</span>
          </span>
        ) : (
          <span className="text-[12.5px]">Couldn't bring them together</span>
        )}
        <span className="ml-auto" />
        {result && (
          <button type="button" disabled={onIt} className={pill} onClick={() => useTogether.getState().openOnIt(session)}>
            Look it over in a pane
          </button>
        )}
        {result && (pullRequest ? (
          <button type="button" className={pill} onClick={() => void openUrl(pullRequest)}>Pull request ↗</button>
        ) : (
          <button type="button" disabled={busy} className={pill} onClick={() => void useTogether.getState().pullRequest(session)}>
            Open pull request
          </button>
        ))}
        <button type="button" aria-label="Close" className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground" onClick={() => useTogether.getState().dismiss(session.id)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <p className="mt-1.5 select-text whitespace-pre-wrap text-xs text-failure">{error}</p>}
      {result && (
        <ul className="mt-1.5 grid gap-0.5 pl-5">
          {result.merges.map((merge) => (
            <MergeRow key={merge.pane} session={session} merge={merge} />
          ))}
        </ul>
      )}
    </div>
  );
}
