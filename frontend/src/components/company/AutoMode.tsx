import { useState } from "react";
import { Infinity as Loop, Square, X } from "lucide-react";

import { HOURS, timeLeft } from "@/lib/auto";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useAuto, useAutoOf } from "@/store/auto";

// Auto mode beside the Tasks heading: off, one button that opens the hours to hand over; on, the
// time left and Stop. When it stopped by itself, why, in a line under the heading.

const pill = "flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors disabled:opacity-40";

export function AutoMode({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const { until } = useAutoOf(projectId);
  const now = useNow(until !== null);
  const [picking, setPicking] = useState(false);
  const { start, stop } = useAuto.getState();
  if (until !== null) {
    return (
      <div className="flex items-center gap-1 rounded-full border border-white/20 bg-white/[0.06] py-0.5 pl-3 pr-0.5">
        <span className="node-live h-1.5 w-1.5 rounded-full bg-foreground" />
        <span className="ml-1 text-[12.5px] font-medium">Auto</span>
        <span className="text-[12.5px] text-muted-foreground">· {timeLeft(until, now)}</span>
        <button type="button" className={cn(pill, "ml-1 bg-white/[0.08] hover:bg-white/[0.14]")} onClick={() => stop(projectId)}>
          <Square className="h-3 w-3 fill-current" />
          Stop
        </button>
      </div>
    );
  }
  if (picking) {
    return (
      <div className="flex items-center gap-1" role="group" aria-label="Work on its own for">
        {HOURS.map((hours) => (
          <button key={hours} type="button" className={cn(pill, "bg-white/[0.08] font-medium hover:bg-white/[0.16]")} onClick={() => (setPicking(false), start(projectId, hours))}>
            {hours}h
          </button>
        ))}
        <button type="button" aria-label="Cancel" title="Cancel" className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground" onClick={() => setPicking(false)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <button type="button" disabled={disabled} title={disabled ? "Write the brief first" : "Let the company work on its own for a few hours"} className={cn(pill, "bg-white/[0.08] hover:bg-white/[0.14]")} onClick={() => setPicking(true)}>
      <Loop className="h-3.5 w-3.5" />
      Auto mode
    </button>
  );
}

export function AutoEnded({ projectId }: { projectId: string }) {
  const { ended } = useAutoOf(projectId);
  if (!ended) return null;
  return <p className="-mt-2 px-1 text-[12.5px] text-muted-foreground">Auto mode stopped · {ended}</p>;
}
