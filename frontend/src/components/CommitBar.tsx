import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, GitBranch, GitCommitHorizontal } from "lucide-react";

import { gitInfo, type GitInfo } from "@/lib/api";
import { branchName, commitMessage } from "@/lib/git";
import type { RunMessage } from "@/lib/thread";
import { cn } from "@/lib/utils";
import { folderOf } from "@/store/conversations";
import { commitStep, openPr } from "@/store/git";
import { fieldVariants } from "@/components/ui/field";
import { buttonVariants } from "@/components/ui/button";

// The end of a code step, the way a developer ends one: commit the files it changed, on a new branch
// when the project is on its default one, and open a pull request.

function Action({ primary, disabled, title, onClick, children }: { primary?: boolean; disabled?: boolean; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} title={title} className={buttonVariants({ variant: primary ? "primary" : "outline", size: "sm" })} onClick={onClick}>
      {children}
    </button>
  );
}

function Done({ conversationId, message }: { conversationId: string; message: RunMessage }) {
  const committed = message.code.committed!;
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folder = folderOf(conversationId);
  useEffect(() => void (folder && !committed.pr && gitInfo(folder).then(setInfo, () => undefined)), [folder, committed.pr]);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await openPr(conversationId, message.id);
      if (url) void openUrl(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const canPr = info && info.canPush && info.gh && !info.onDefault && info.branch === committed.branch;
  return (
    <div className="grid gap-1.5 border-t border-border px-2 py-1.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Check className="h-3.5 w-3.5 text-live" />
        <span>
          Committed <span className="font-mono text-[11.5px]">{committed.sha}</span>
          {committed.branch && <span className="text-muted-foreground"> on <span className="font-mono text-[11.5px]">{committed.branch}</span></span>}
        </span>
        {committed.pr ? (
          <button type="button" className="ml-auto flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => void openUrl(committed.pr!)}>
            Pull request <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          canPr && <span className="ml-auto"><Action disabled={busy} onClick={() => void open()}>{busy ? "Pushing and opening…" : "Open pull request"}</Action></span>
        )}
      </div>
      {error && <p className="whitespace-pre-wrap text-[11.5px] text-failure">{error}</p>}
    </div>
  );
}

function Form({ conversationId, message, info, onCancel }: { conversationId: string; message: RunMessage; info: GitInfo; onCancel: () => void }) {
  const [text, setText] = useState(() => commitMessage(message.task));
  const [newBranch, setNewBranch] = useState(info.onDefault);
  const [branch, setBranch] = useState(() => branchName(message.task));
  const [busy, setBusy] = useState<"commit" | "pr" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const willBranch = newBranch && branch.trim() !== "";
  const prReady = info.canPush && info.gh && (willBranch || (!info.onDefault && info.branch !== null));
  const go = async (andPr: boolean) => {
    setBusy(andPr ? "pr" : "commit");
    setError(null);
    try {
      await commitStep(conversationId, message.id, text, willBranch ? branch.trim() : null);
      if (andPr) {
        const url = await openPr(conversationId, message.id);
        if (url) void openUrl(url);
      }
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };
  const count = message.code.changes?.files.length ?? 0;
  return (
    <div className="grid gap-2 border-t border-border p-2">
      <textarea autoFocus rows={2} value={text} aria-label="Commit message" className={cn(fieldVariants({ size: "area" }), "w-full resize-y px-2.5 py-1.5 text-[12.5px]")} onChange={(e) => setText(e.target.value)} />
      {info.onDefault && (
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={newBranch} className="accent-foreground" onChange={(e) => setNewBranch(e.target.checked)} />
          <GitBranch className="h-3.5 w-3.5" />
          New branch
          <input value={branch} disabled={!newBranch} aria-label="Branch name" spellCheck={false} className={cn(fieldVariants({ size: "xs" }), "flex-1 font-mono")} onChange={(e) => setBranch(e.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Action primary disabled={busy !== null || !text.trim()} onClick={() => void go(false)}>{busy === "commit" ? "Committing…" : "Commit"}</Action>
        {info.canPush && info.gh && (
          <Action disabled={busy !== null || !text.trim() || !prReady} title={prReady ? undefined : "A pull request needs a branch other than the default one"} onClick={() => void go(true)}>
            {busy === "pr" ? "Committing and opening…" : "Commit and open pull request"}
          </Action>
        )}
        <button type="button" disabled={busy !== null} className="px-1.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={onCancel}>Cancel</button>
        <span className="ml-auto text-[11px] text-muted-foreground">Only the {count === 1 ? "file" : `${count} files`} this step changed</span>
      </div>
      {error && <p className="whitespace-pre-wrap text-[11.5px] text-failure">{error}</p>}
    </div>
  );
}

export function CommitBar({ conversationId, message }: { conversationId: string; message: RunMessage }) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reading the branch takes a moment on a big repo; the button says so instead of doing nothing.
  const [reading, setReading] = useState(false);
  if (message.code.committed) return <Done conversationId={conversationId} message={message} />;
  if (info) return <Form conversationId={conversationId} message={message} info={info} onCancel={() => setInfo(null)} />;
  const start = () => {
    const folder = folderOf(conversationId);
    if (!folder || reading) return;
    setReading(true);
    setError(null);
    gitInfo(folder).then(setInfo, (e) => setError(String(e))).finally(() => setReading(false));
  };
  return (
    <div className="flex items-center gap-2 border-t border-border px-2 py-1.5 text-[12px]">
      <button type="button" aria-busy={reading} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={start}>
        <GitCommitHorizontal className="h-3.5 w-3.5" />
        {reading ? "Reading the branch…" : "Commit"}
      </button>
      {error && <span className="min-w-0 truncate text-[11.5px] text-failure" title={error}>{error}</span>}
    </div>
  );
}
