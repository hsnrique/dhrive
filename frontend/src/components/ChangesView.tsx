import { useEffect, useState } from "react";
import { ChevronRight, PanelRight, Undo2 } from "lucide-react";

import { fileDiff, type Changes, type FileChange } from "@/lib/api";
import { diffLines, totals, type DiffLine } from "@/lib/changes";
import { activeRun, type RunMessage } from "@/lib/thread";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { folderOf } from "@/store/conversations";
import { usePanel } from "@/store/panel";
import { undoRun } from "@/store/runs";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import { CommitBar } from "./CommitBar";

// What a code step changed: a line of totals, the files with their counts, one file's diff on click,
// and a way to put it all back.

const STATUS_MARK: Record<FileChange["status"], string> = { added: "A", modified: "M", deleted: "D" };

const LINE_CLASS: Record<DiffLine["kind"], string> = {
  add: "text-diff-add bg-diff-add/[0.07]",
  remove: "text-diff-remove bg-diff-remove/[0.07]",
  hunk: "text-muted-foreground",
  same: "text-foreground/70",
};

function Counts({ additions, deletions }: { additions: number | null; deletions: number | null }) {
  if (additions === null && deletions === null) return <span className="text-muted-foreground">binary</span>;
  return (
    <>
      {!!additions && <span className="text-diff-add">+{additions}</span>}
      {!!deletions && <span className="text-diff-remove">−{deletions}</span>}
    </>
  );
}

function Diff({ conversationId, changes, path }: { conversationId: string; changes: Changes; path: string }) {
  const [state, setState] = useState<{ diff: string | null; error: string | null }>({ diff: null, error: null });
  useEffect(() => {
    const folder = folderOf(conversationId);
    if (!folder) return;
    let current = true;
    fileDiff(folder, changes, path).then(
      (diff) => current && setState({ diff, error: null }),
      (error) => current && setState({ diff: null, error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [conversationId, changes, path]);
  if (state.error) return <p className="px-2 py-1.5 text-[12px] text-failure">{state.error}</p>;
  if (state.diff === null) return <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading…</p>;
  const { lines, cut } = diffLines(state.diff);
  return (
    <div className="overflow-x-auto border-t border-border py-1 font-mono text-[11.5px] leading-[1.55]">
      {lines.map((line, i) => (
        <div key={i} className={cn("whitespace-pre px-2", LINE_CLASS[line.kind])}>
          {line.text || " "}
        </div>
      ))}
      {cut && <p className="px-2 pt-1 font-sans text-[11px] text-muted-foreground">Cut at {lines.length} lines.</p>}
    </div>
  );
}

function FileRow({ conversationId, changes, file }: { conversationId: string; changes: Changes; file: FileChange }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="group relative overflow-hidden">
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] transition-colors hover:bg-hover focus-visible:outline-offset-[-2px]" onClick={() => setOpen((v) => !v)}>
        <ChevronRight className={cn("h-3 w-3 flex-none text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="w-3 flex-none font-mono text-[10.5px] text-muted-foreground" title={file.status}>{STATUS_MARK[file.status]}</span>
        <span className={cn("min-w-0 flex-1 truncate font-mono text-[11.5px]", file.status === "deleted" && "text-muted-foreground line-through")} title={file.path}>
          {file.path}
        </span>
        <span className="flex flex-none gap-1.5 font-mono text-[11px] tabular-nums">
          <Counts additions={file.additions} deletions={file.deletions} />
        </span>
      </button>
      {file.status !== "deleted" && (
        <button
          type="button"
          title="Open the file beside the conversation"
          aria-label={`Open ${file.path}`}
          className="absolute right-1 top-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-card text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => {
            const folder = folderOf(conversationId);
            if (folder) usePanel.getState().open(folder, file.path);
          }}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
      )}
      {open && <Diff conversationId={conversationId} changes={changes} path={file.path} />}
    </li>
  );
}

function UndoButton({ conversationId, message }: { conversationId: string; message: RunMessage }) {
  const busy = useApp((s) => activeRun(s.threads[conversationId]) !== null);
  const [confirming, setConfirming] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const count = message.code.changes?.files.length ?? 0;
  const undo = async () => {
    setUndoing(true);
    await undoRun(conversationId, message.id);
    setUndoing(false);
  };
  if (confirming) {
    return (
      <InlineConfirm question={undoing ? "Putting it back…" : `Undo ${count === 1 ? "this file" : `${count} files`}?`} action="Undo" busy={undoing} onYes={() => void undo()} onNo={() => setConfirming(false)} />
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      title={busy ? "Wait for the current run to finish" : "Put back what this step changed"}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
      onClick={() => setConfirming(true)}
    >
      <Undo2 className="h-3.5 w-3.5" />
      Undo
    </button>
  );
}

export function ChangesView({ conversationId, message }: { conversationId: string; message: RunMessage }) {
  const { changes, undone, committed, status } = message.code;
  if (!changes) return null;
  const { additions, deletions } = totals(changes);
  const files = changes.files.length;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 bg-white/[0.03] px-2 py-1.5 text-[12px]">
        <span className={cn(undone && "text-muted-foreground line-through")}>
          {files === 1 ? "1 file changed" : `${files} files changed`}
        </span>
        <span className="flex gap-1.5 font-mono text-[11px] tabular-nums">
          <Counts additions={additions} deletions={deletions} />
        </span>
        <span className="ml-auto">
          {/* Once committed, undoing would only leave the reverse as uncommitted changes. */}
          {undone ? <span className="text-muted-foreground">Undone</span> : !committed && <UndoButton conversationId={conversationId} message={message} />}
        </span>
      </div>
      {undone && undone.kept.length > 0 && (
        <p className="border-t border-border px-2 py-1.5 text-[12px] text-muted-foreground" title={undone.kept.join("\n")}>
          Kept {undone.kept.length === 1 ? "1 file" : `${undone.kept.length} files`} edited since: {undone.kept.join(", ")}
        </p>
      )}
      {!undone && (
        <ul className="border-t border-border py-0.5">
          {changes.files.map((file) => (
            <FileRow key={file.path} conversationId={conversationId} changes={changes} file={file} />
          ))}
        </ul>
      )}
      {!undone && status === "done" && <CommitBar conversationId={conversationId} message={message} />}
    </div>
  );
}
