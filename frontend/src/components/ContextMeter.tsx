import { useEffect, useMemo, useRef, useState } from "react";

import { fullness, percentOf, sessionsOf, tokens, type ThreadSession } from "@/lib/context";
import { cliLabel } from "@/lib/names";
import { activeRun } from "@/lib/thread";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { contextKey, useContextUsage } from "@/store/context";
import { useLayer } from "@/components/ui/layer";
import { EngineMark } from "./EngineMark";

// How full each CLI session the conversation continues is: a ring in the header, and on a click what
// fills it and a way to compact it before it gets compacted mid-task.

const STROKE = { ok: "stroke-foreground/70", high: "stroke-attention", full: "stroke-failure" };

function Ring({ percent, level }: { percent: number; level: keyof typeof STROKE }) {
  const around = 2 * Math.PI * 5;
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r="5" fill="none" strokeWidth="2" className="stroke-white/15" />
      <circle cx="7" cy="7" r="5" fill="none" strokeWidth="2" strokeLinecap="round" className={STROKE[level]} strokeDasharray={`${(percent / 100) * around} ${around}`} />
    </svg>
  );
}

function Details({ session, folder, label, busy }: { session: ThreadSession; folder: string; label: string; busy: boolean }) {
  const seen = useContextUsage((s) => s.seen[contextKey(session.engine, session.session)]);
  if (!seen?.value) return null;
  const { used, max, parts, autoCompactAt } = seen.value;
  const percent = percentOf(used, max);
  return (
    <div role="dialog" aria-label={`${label} context`} className="pop-in absolute right-0 top-full z-30 mt-2 grid w-72 gap-2.5 rounded-xl border border-border bg-popover shadow-popover p-3.5">
      <div>
        <p className="text-[12.5px] font-medium">{label} session</p>
        <p className="text-[11.5px] text-muted-foreground">{tokens(used)} of {tokens(max)} tokens · {percent}%</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-selected">
        <div className={cn("h-full rounded-full", { ok: "bg-foreground/70", high: "bg-attention", full: "bg-failure" }[fullness(percent)])} style={{ width: `${percent}%` }} />
      </div>
      {parts.length > 0 && (
        <ul className="grid gap-0.5 text-[11.5px]">
          {parts.map((part) => (
            <li key={part.name} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{part.name}</span>
              <span className="font-mono tabular-nums">{tokens(part.tokens)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">{autoCompactAt ? `Compacts on its own at ${percentOf(autoCompactAt, max)}%.` : "Compacts on its own when full."}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || seen.compacting}
          title={busy ? "Wait for the run to end" : "Summarize the conversation so far to free room"}
          className="rounded-md border border-border px-3 py-1 text-[12px] transition-colors hover:bg-hover disabled:opacity-40"
          onClick={() => void useContextUsage.getState().compact({ ...session, folder })}
        >
          {seen.compacting ? "Compacting…" : "Compact now"}
        </button>
        {seen.note && <span className="min-w-0 text-[11px] text-muted-foreground">{seen.note}</span>}
      </div>
    </div>
  );
}

function Meter({ conversationId, session, folder }: { conversationId: string; session: ThreadSession; folder: string }) {
  const [open, setOpen] = useState(false);
  const seen = useContextUsage((s) => s.seen[contextKey(session.engine, session.session)]);
  const busy = useApp((s) => activeRun(s.threads[conversationId]) !== null);
  const label = useApp((s) => cliLabel(session.engine, s.clis));
  const panel = useRef<HTMLDivElement>(null);
  useLayer(panel, () => setOpen(false), { active: open });
  if (!seen?.value) return null;
  const percent = percentOf(seen.value.used, seen.value.max);
  return (
    <div className="relative">
      <button type="button" title={`${label} session: ${percent}% of its context used`} aria-label={`${percent}% of ${label}'s context used`} aria-expanded={open} className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={() => setOpen((v) => !v)}>
        <EngineMark engine={session.engine} className="h-3 w-3" />
        <Ring percent={percent} level={fullness(percent)} />
        <span className={cn("font-mono tabular-nums", seen.compacting && "motion-safe:animate-pulse")}>{percent}%</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div ref={panel} className="contents">
            <Details session={session} folder={folder} label={label} busy={busy} />
          </div>
        </>
      )}
    </div>
  );
}

export function ContextMeters({ conversationId, folder }: { conversationId: string; folder: string }) {
  const thread = useApp((s) => s.threads[conversationId]);
  const sessions = useMemo(() => sessionsOf(thread), [thread]);
  const which = sessions.map((s) => `${s.engine}:${s.session}:${s.model}`).join(" ");
  useEffect(() => {
    for (const session of sessions) void useContextUsage.getState().read({ ...session, folder });
    // Read again only when the sessions or their models change, not on every update to the thread.
  }, [which, folder]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {sessions.map((session) => (
        <Meter key={session.engine} conversationId={conversationId} session={session} folder={folder} />
      ))}
    </>
  );
}
