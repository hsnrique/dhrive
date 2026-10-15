import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { editLines, type LiveEdit } from "@/lib/linediff";
import { cn } from "@/lib/utils";
import { useLiveEdits } from "@/store/live";
import { FileMention } from "./Mentions";

// The edits a running step makes, as it makes them: each file and its change, the newest open. The
// full picture of what changed comes after, in the step's list of changed files.

const MAX_SHOWN_LINES = 80;

function EditCard({ edit, folder, open, onToggle }: { edit: LiveEdit; folder: string | undefined; open: boolean; onToggle: () => void }) {
  // The diff is quadratic in the file's lines; every new edit re-renders the list, so each card
  // works out its own once.
  const { lines, added, removed } = useMemo(() => {
    const lines = editLines(edit.before, edit.after);
    return { lines, added: lines.filter((l) => l.kind === "add").length, removed: lines.filter((l) => l.kind === "remove").length };
  }, [edit.before, edit.after]);
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 bg-white/[0.03] px-2 py-1 text-[12px]">
        <button type="button" aria-expanded={open} aria-label={open ? "Hide this edit" : "Show this edit"} className="flex-none text-muted-foreground hover:text-foreground" onClick={onToggle}>
          <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        </button>
        <span className="min-w-0 flex-1 truncate">{folder ? <FileMention folder={folder} path={edit.path} /> : <span className="font-mono text-[11.5px]">{edit.path}</span>}</span>
        <span className="flex flex-none gap-1.5 font-mono text-[11px] tabular-nums">
          {added > 0 && <span className="text-diff-add">+{added}</span>}
          {removed > 0 && <span className="text-diff-remove">−{removed}</span>}
        </span>
      </div>
      {open && (
        <div className="max-h-64 overflow-auto border-t border-border py-1 font-mono text-[11.5px] leading-[1.55] [font-variant-ligatures:none]">
          {lines.slice(0, MAX_SHOWN_LINES).map((line, i) => (
            <div key={i} className={cn("whitespace-pre px-2", line.kind === "add" ? "bg-diff-add/[0.07] text-diff-add" : line.kind === "remove" ? "bg-diff-remove/[0.07] text-diff-remove" : "text-foreground/60")}>
              {line.text || " "}
            </div>
          ))}
          {lines.length > MAX_SHOWN_LINES && <p className="px-2 pt-1 font-sans text-[11px] text-muted-foreground">{lines.length - MAX_SHOWN_LINES} more lines.</p>}
        </div>
      )}
    </div>
  );
}

export function LiveEdits({ runId, folder }: { runId: string | null; folder: string | undefined }) {
  const edits = useLiveEdits(runId);
  // Which ones the owner opened or closed; by default only the newest is open.
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  if (edits.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      {edits.map((edit, i) => (
        <EditCard key={i} edit={edit} folder={folder} open={toggled[i] ?? i === edits.length - 1} onToggle={() => setToggled((t) => ({ ...t, [i]: !(t[i] ?? i === edits.length - 1) }))} />
      ))}
    </div>
  );
}
