import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Check, Globe, Hammer, Infinity as Loop, RotateCcw, X, type LucideIcon } from "lucide-react";

import { FIX_TITLE, fixPrompt } from "@/lib/build";
import type { Entry } from "@/lib/log";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat";
import { useDay } from "@/store/day";
import { useLog } from "@/store/log";
import { usePublish } from "@/store/publish";
import { buttonVariants } from "@/components/ui/button";
import { Markdown } from "../Markdown";

// One line of the company's timeline. What the owner said sits on the right; the agent answers on
// the left, with any work it suggests ready to add; what the company did is a quiet line between,
// with what can be done about it: a failed task tried again, a published site opened, a failed build
// handed to the agent to fix and built again once it has.

const EVENTS: Record<"done" | "failed" | "published" | "auto" | "build", { Icon: LucideIcon; label: string }> = {
  done: { Icon: Check, label: "Done" },
  failed: { Icon: X, label: "Failed" },
  published: { Icon: Globe, label: "Published" },
  auto: { Icon: Loop, label: "Auto mode" },
  build: { Icon: Hammer, label: "Build failed" },
};

const action = buttonVariants({ variant: "soft", size: "xs" });

function Suggested({ projectId, said }: { projectId: string; said: Entry }) {
  return (
    <ul className="grid gap-1.5">
      {said.tasks!.map((task) => {
        const added = said.added?.includes(task.id);
        return (
          <li key={task.id} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px]" title={task.prompt}>{task.title}</span>
            {added ? (
              <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground"><Check className="h-3 w-3" />Added</span>
            ) : (
              <button type="button" className={action} onClick={() => useChat.getState().addTask(projectId, said.id, task.id)}>Add</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// What can be done about a failed build: hand it to the agent, wait for its fix, then build again.
function BuildFix({ projectId, event }: { projectId: string; event: Entry }) {
  const fixing = useDay((s) => s.byProject[projectId]?.tasks.some((t) => t.title === FIX_TITLE && (t.status === "planned" || t.status === "running")));
  const fixed = useLog((s) => {
    const entries = s.byProject[projectId] ?? [];
    return entries.slice(entries.findIndex((e) => e.id === event.id) + 1).some((e) => e.kind === "done" && e.text === FIX_TITLE);
  });
  if (fixing) return <span className="flex-none text-[11.5px] text-muted-foreground">Fixing…</span>;
  if (fixed) {
    return (
      <button type="button" className={action} onClick={() => void usePublish.getState().build(projectId)}>
        <Hammer className="h-3 w-3" />
        Build again
      </button>
    );
  }
  return (
    <button type="button" className={action} aria-label="Fix it" title={event.detail} onClick={() => useDay.getState().add(projectId, fixPrompt(event.detail ?? ""), "code")}>
      Fix it
    </button>
  );
}

function Event({ projectId, event }: { projectId: string; event: Entry }) {
  const { Icon, label } = EVENTS[event.kind as keyof typeof EVENTS];
  const stillFailed = useDay((s) => event.kind === "failed" && s.byProject[projectId]?.tasks.some((t) => t.id === event.taskId && t.status === "failed"));
  return (
    <div className="flex min-h-7 items-center gap-2 px-1 text-[12px] text-muted-foreground">
      <Icon className={cn("h-3.5 w-3.5 flex-none", (event.kind === "failed" || event.kind === "build") && "text-failure")} strokeWidth={2} />
      <span className="flex-none">{label}</span>
      <span className="min-w-0 flex-1 truncate text-foreground/85">{event.text}</span>
      {stillFailed && (
        <button type="button" className={action} onClick={() => useDay.getState().retry(projectId, event.taskId!)}>
          <RotateCcw className="h-3 w-3" />
          Try again
        </button>
      )}
      {event.kind === "build" && <BuildFix projectId={projectId} event={event} />}
      {event.url && (
        <button type="button" className={action} onClick={() => void openUrl(event.url!).catch(() => undefined)}>
          Open
          <ArrowUpRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function ChatEntry({ projectId, said }: { projectId: string; said: Entry }) {
  if (said.kind === "owner") {
    return <p className="ml-10 min-w-0 justify-self-end whitespace-pre-wrap rounded-2xl [overflow-wrap:anywhere] rounded-br-md bg-selected px-3.5 py-2 text-[13px] leading-relaxed">{said.text}</p>;
  }
  if (said.kind === "agent") {
    return (
      <div className="mr-6 grid min-w-0 gap-2.5 [overflow-wrap:anywhere]">
        {said.text && <div className="text-[13px] leading-relaxed"><Markdown source={said.text} /></div>}
        {said.tasks && said.tasks.length > 0 && <Suggested projectId={projectId} said={said} />}
      </div>
    );
  }
  return <Event projectId={projectId} event={said} />;
}
