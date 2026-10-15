import { useEffect, useRef } from "react";

import type { Project } from "@/lib/api";
import { useKeptText } from "@/lib/drafts";
import { companyAgent, useAgentOf } from "@/store/company";
import { useChat, useTalkOf } from "@/store/chat";
import { useLogOf } from "@/store/log";
import { useLiveLast, useLivePhase } from "@/store/live";
import { ChatEntry } from "./ChatEntry";
import { SendButton, StopButton } from "../ui/compose";

// The company's chat: its timeline, newest at the bottom, and a box to ask it anything. An empty
// chat offers the two questions an owner asks most.

const STARTERS = ["How are we doing?", "What should we do next?"];

function Thinking({ runId }: { runId: string }) {
  const phase = useLivePhase(runId) || "Thinking";
  const doing = useLiveLast(runId);
  const said = doing ? `${phase} · ${doing}` : phase;
  return (
    <p className="flex min-w-0 items-center gap-2 px-1 text-[12.5px] text-muted-foreground" title={said}>
      <span className="node-live h-1.5 w-1.5 flex-none rounded-full bg-foreground" />
      <span className="min-w-0 truncate">{said}</span>
    </p>
  );
}

function Composer({ project, busy }: { project: Project; busy: boolean }) {
  const [said, setSaid] = useKeptText(`chat:${project.id}`);
  useAgentOf(project.id);
  const can = Boolean(companyAgent(project.id));
  const { ask, stop } = useChat.getState();
  const send = () => {
    if (!said.trim() || busy) return;
    void ask(project.id, said);
    setSaid("");
  };
  return (
    <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 transition-colors focus-within:border-ring">
      <textarea
        value={said}
        rows={Math.min(5, said.split("\n").length)}
        disabled={!can}
        aria-label={`Ask ${project.name}`}
        placeholder={can ? `Ask ${project.name} anything` : "Install Claude Code, Codex or Antigravity to chat"}
        className="min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
        onChange={(e) => setSaid(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          send();
        }}
      />
      {busy ? (
        <StopButton onClick={() => stop(project.id)} />
      ) : (
        <SendButton label="Send" disabled={!said.trim() || !can} onClick={send} />
      )}
    </div>
  );
}

export function Chat({ project }: { project: Project }) {
  const entries = useLogOf(project.id);
  const { runId, error } = useTalkOf(project.id);
  const end = useRef<HTMLDivElement>(null);
  // Whether the owner is at the bottom: news (a task done, a site published) comes in all day, and
  // someone reading further up stays where they are. What they just said always comes into view.
  const pinned = useRef(true);
  const mine = entries[entries.length - 1]?.kind === "owner";
  // Braces matter: newer engines return a promise from scrollIntoView, and an effect may only return a cleanup.
  useEffect(() => {
    if (pinned.current || mine) end.current?.scrollIntoView({ block: "end" });
  }, [entries.length, runId, mine]);
  const quiet = !entries.some((e) => e.kind === "owner");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {/* One column that never grows past the pane: a long command or path truncates instead. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-4">
          {entries.map((said) => <ChatEntry key={said.id} projectId={project.id} said={said} />)}
          {runId && <Thinking runId={runId} />}
          {error && <p className="px-1 text-[12.5px] text-failure">{error}</p>}
          <div ref={end} />
        </div>
      </div>
      <div className="grid gap-2 border-t border-border p-3">
        {quiet && !runId && (
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((starter) => (
              <button key={starter} type="button" disabled={!companyAgent(project.id)} className="h-7 rounded-md border border-border px-3 text-[12px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40" onClick={() => void useChat.getState().ask(project.id, starter)}>
                {starter}
              </button>
            ))}
          </div>
        )}
        <Composer project={project} busy={Boolean(runId)} />
      </div>
    </div>
  );
}
