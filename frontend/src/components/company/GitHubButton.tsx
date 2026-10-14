import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, CircleAlert } from "lucide-react";

import { useDay } from "@/store/day";
import { useGitHub, useGitHubOf } from "@/store/github";
import { CommitBox } from "./CommitBox";

// The company's code on GitHub, in the toolbar, one button that's always the next step: install gh,
// connect GitHub (gh's code shows while the owner approves in the browser), put the company on GitHub
// as a private repo, save what changed since (with a message, CommitBox), or open the repo when
// everything is there. Until the
// repo exists the company lives only on this Mac, which the attention dot says; after, every
// finished task is backed up on its own (store/github.ts).

const pill = "flex h-7 flex-none items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] @[60rem]:px-3 transition-colors hover:bg-white/[0.07] disabled:opacity-50";
const open = (url: string) => void openUrl(url).catch(() => undefined);
// The toolbar is a container (CompanyView): below this the label gives way to the mark.
const label = "hidden @[60rem]:inline";

function Mark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function NotBackedUp() {
  return <span className="h-1.5 w-1.5 flex-none rounded-full bg-attention" aria-hidden />;
}

function Code({ code }: { code: string }) {
  return (
    <div className="absolute right-0 top-9 z-30 grid w-[260px] gap-2 rounded-xl border border-border bg-popover p-3 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
      <p className="text-[12px] text-muted-foreground">Enter this code on GitHub to connect:</p>
      <button type="button" title="Copy" className="justify-self-start font-mono text-[18px] tracking-[0.12em]" onClick={() => void navigator.clipboard.writeText(code).catch(() => undefined)}>
        {code}
      </button>
      <button type="button" className="flex items-center gap-1 justify-self-start text-[12px] text-foreground/85 hover:text-foreground" onClick={() => open("https://github.com/login/device")}>
        Open github.com/login/device
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  );
}

export function GitHubButton({ projectId }: { projectId: string }) {
  const { state, saving, error } = useGitHubOf(projectId);
  const signingIn = useGitHub((s) => s.signingIn);
  const code = useGitHub((s) => s.code);
  const done = useDay((s) => s.byProject[projectId]?.tasks.filter((t) => t.status === "done").length ?? 0);
  const { load, signIn, save } = useGitHub.getState();
  const [writing, setWriting] = useState(false);
  const close = useCallback(() => setWriting(false), []);
  // Asked again as tasks finish: each one is work that isn't on GitHub yet.
  useEffect(() => void load(projectId), [projectId, done, load]);
  if (!state) return null;
  const errorLine = error && (
    <span className="flex min-w-0 items-center text-[11.5px] text-[#ff8a8f]" title={error} role="alert">
      <CircleAlert className="h-3.5 w-3.5 flex-none @[52rem]:hidden" aria-label={error} />
      <span className="hidden max-w-[200px] truncate @[52rem]:inline">{error}</span>
    </span>
  );
  if (!state.gh) {
    return <button type="button" className={pill} aria-label="Not backed up: get GitHub CLI" title="Not backed up. dhrive backs up to GitHub through GitHub's own command line tool" onClick={() => open("https://cli.github.com")}><NotBackedUp /><Mark /><span className={label}>Get GitHub CLI</span></button>;
  }
  if (!state.account) {
    return (
      <div className="relative flex items-center gap-1.5">
        {errorLine}
        <button type="button" disabled={signingIn} className={pill} aria-label="Not backed up: connect GitHub" title="Not backed up. Connect GitHub to keep a copy off this Mac" onClick={() => void signIn(projectId)}><NotBackedUp /><Mark /><span className={label}>{signingIn ? "Connecting…" : "Connect GitHub"}</span></button>
        {signingIn && code && <Code code={code} />}
      </div>
    );
  }
  if (saving) return <span className="flex h-7 items-center gap-1.5 px-1 text-[12px] text-muted-foreground" title="Saving to GitHub…"><span className="node-live h-1.5 w-1.5 rounded-full bg-foreground" /><span className={label}>Saving to GitHub…</span></span>;
  if (!state.repo || state.changes > 0) {
    return (
      <div className="relative flex items-center gap-1.5">
        {errorLine}
        <button type="button" aria-expanded={state.repo ? writing : undefined} className={pill} aria-label={state.repo ? `Save ${state.changes} changes to GitHub` : "Not backed up: put on GitHub"} title={state.repo ? "Commit what changed and push it" : `Not backed up. A private repo on ${state.account}'s GitHub, saved after every task`} onClick={() => (state.repo ? setWriting((open) => !open) : void save(projectId))}>
          {!state.repo && <NotBackedUp />}
          <Mark />
          {state.repo ? <><span className={label}>Save to GitHub · </span>{state.changes}</> : <span className={label}>Put on GitHub</span>}
        </button>
        {state.repo && writing && <CommitBox projectId={projectId} changes={state.changes} onClose={close} />}
      </div>
    );
  }
  return <button type="button" className={pill} aria-label="Open on GitHub" title="Everything is on GitHub" onClick={() => open(state.repo!)}><Mark /><span className={label}>GitHub</span><ArrowUpRight className="h-3 w-3 text-muted-foreground" /></button>;
}
