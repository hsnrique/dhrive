import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import type { Project } from "@/lib/api";
import { useApp } from "@/store/app";
import { companyAgent, useAgentOf } from "@/store/company";
import { useChat, useTalkOf } from "@/store/chat";
import { useLogOf } from "@/store/log";
import { ChatEntry } from "./ChatEntry";

// The company's chat: its timeline, newest at the bottom, and a box to ask it anything. An empty
// chat offers the two questions an owner asks most.

const STARTERS = ["How are we doing?", "What should we do next?"];

function Thinking({ runId }: { runId: string }) {
  const phase = useApp((s) => s.live[runId]?.phase) || "Thinking";
  const doing = useApp((s) => s.live[runId]?.log[s.live[runId].log.length - 1]);
  const said = doing ? `${phase} · ${doing}` : phase;
  return (
    <p className="flex min-w-0 items-center gap-2 px-1 text-[12.5px] text-muted-foreground" title={said}>
      <span className="node-live h-1.5 w-1.5 flex-none rounded-full bg-foreground" />
      <span className="min-w-0 truncate">{said}</span>
    </p>
  );
}

function Composer({ project, busy }: { project: Project; busy: boolean }) {
  const [said, setSaid] = useState("");
  useAgentOf(project.id);
  const can = Boolean(companyAgent(project.id));
  const { ask, stop } = useChat.getState();
  const send = () => {
    if (!said.trim() || busy) return;
    void ask(project.id, said);
    setSaid("");
  };
  return (
    <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 transition-colors focus-within:border-white/25">
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
        <button type="button" aria-label="Stop" title="Stop" className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/[0.1] transition-colors hover:bg-white/[0.16]" onClick={() => stop(project.id)}>
          <Square className="h-2.5 w-2.5 fill-current" />
        </button>
      ) : (
        <button type="button" aria-label="Send" title="Send" disabled={!said.trim() || !can} className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-30" onClick={send}>
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export function Chat({ project }: { project: Project }) {
  const entries = useLogOf(project.id);
  const { runId, error } = useTalkOf(project.id);
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer engines return a promise from scrollIntoView, and an effect may only return a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length, runId]);
  const quiet = !entries.some((e) => e.kind === "owner");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4">
        {/* One column that never grows past the pane: a long command or path truncates instead. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-4">
          {entries.map((said) => <ChatEntry key={said.id} projectId={project.id} said={said} />)}
          {runId && <Thinking runId={runId} />}
          {error && <p className="px-1 text-[12.5px] text-[#ff8a8f]">{error}</p>}
          <div ref={end} />
        </div>
      </div>
      <div className="grid gap-2 border-t border-border p-3">
        {quiet && !runId && (
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((starter) => (
              <button key={starter} type="button" disabled={!companyAgent(project.id)} className="h-7 rounded-full border border-border px-3 text-[12px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40" onClick={() => void useChat.getState().ask(project.id, starter)}>
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
