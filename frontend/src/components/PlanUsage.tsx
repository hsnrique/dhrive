import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RotateCw } from "lucide-react";

import type { Engine, UsageWindow } from "@/lib/api";
import { ago, useNow } from "@/lib/time";
import { resetText, shownPercent } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { useUsage } from "@/store/usage";

function WindowRow({ window, now }: { window: UsageWindow; now: number }) {
  const percent = shownPercent(window, now);
  const reset = resetText(window, now);
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate">{window.label}</span>
        <span className={cn("font-mono tabular-nums", window.warn && "text-diff-remove")}>{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div className={cn("h-full rounded-full", window.warn ? "bg-diff-remove" : "bg-foreground/70")} style={{ width: `${percent}%` }} />
      </div>
      {reset && <p className="text-[10.5px] text-muted-foreground">{reset}</p>}
    </div>
  );
}

// Everything the CLI says about its plan: the account, each window with its reset, where the week
// went and what else the plan has. Showing it asks again, so it's never more than seconds old.
export function PlanUsageCard({ engine, label }: { engine: Engine; label: string }) {
  const known = useUsage((s) => s.known[engine]);
  const reading = useUsage((s) => s.reading[engine] ?? false);
  const failed = useUsage((s) => s.failed[engine]);
  const now = useNow(true);
  useEffect(() => void useUsage.getState().refresh(engine), [engine]);
  const usage = known?.usage;
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium">{usage?.plan ?? label}</p>
          {usage?.account && <p className="truncate text-[11px] text-muted-foreground">{usage.account}</p>}
        </div>
        <button type="button" title="Read it again" className="flex flex-none items-center gap-1 rounded-md px-1 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground" onClick={() => void useUsage.getState().refresh(engine, true)}>
          <RotateCw className={cn("h-3 w-3", reading && "motion-safe:animate-spin")} />
          {reading ? "Reading" : known && ago(known.at, now)}
        </button>
      </div>
      {usage?.windows.map((window) => <WindowRow key={window.label} window={window} now={now} />)}
      {!usage && !failed && <p className="text-[11.5px] text-muted-foreground">Asking {label}…</p>}
      {usage && (usage.shares.length > 0 || usage.notes.length > 0) && (
        <div className="grid gap-0.5 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
          {usage.shares.length > 0 && <p>This week: {usage.shares.map((s) => `${s.label} ${s.percent}%`).join(" · ")}</p>}
          {usage.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      )}
      {failed && <p className="text-[11px] text-diff-remove">Couldn't read it: {failed}</p>}
    </div>
  );
}

// A CLI's row shows its plan usage while the pointer rests on it; clicking opens the CLI's screen,
// which has the plan too and everything the CLI has connected.
export function UsageHover({ engine, label, active, onOpen, children }: { engine: Engine; label: string; active: boolean; onOpen: () => void; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const row = useRef<HTMLDivElement>(null);
  // A short grace either way, so crossing the gap to the card doesn't close it.
  const hoverTo = (on: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(on), on ? 120 : 200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // On its own screen the plan is already in view.
  const open = hovered && !active;
  const at = open ? row.current?.getBoundingClientRect() : undefined;
  return (
    <div ref={row} className="relative -mx-2" onMouseEnter={() => hoverTo(true)} onMouseLeave={() => hoverTo(false)}>
      <button
        type="button"
        className={cn("flex w-full rounded-md px-2 py-0.5 text-left transition-colors hover:bg-white/[0.05]", active && "bg-white/[0.07]")}
        onClick={() => {
          setHovered(false);
          onOpen();
        }}
      >
        {children}
      </button>
      {/* On the body, beside the row: inside the sidebar it would sit under the conversation, which
          paints later. React still counts it inside this row, so moving onto it keeps it open. */}
      {at &&
        createPortal(
          <div role="dialog" aria-label={`${label} plan usage`} className="pop-in fixed z-50 w-72 rounded-xl border border-border bg-popover p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]" style={{ left: at.right + 12, bottom: Math.max(8, window.innerHeight - at.bottom) }}>
            <PlanUsageCard engine={engine} label={label} />
          </div>,
          document.body,
        )}
    </div>
  );
}
