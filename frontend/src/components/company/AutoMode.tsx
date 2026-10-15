import { useState } from "react";
import { Infinity as Loop, Square, X } from "lucide-react";

import { HOURS, timeLeft } from "@/lib/auto";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useAuto, useAutoOf } from "@/store/auto";
import { useDayOf } from "@/store/day";
import { buttonVariants } from "@/components/ui/button";

// Auto mode beside the Tasks heading: off, one button that opens the hours to hand over; on, the
// time left and Stop. When it stopped by itself, why, in a line under the heading.

const soft = cn(buttonVariants({ variant: "soft", size: "md" }), "px-3");
const ghost = buttonVariants({ variant: "ghost", size: "md" });

export function AutoMode({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const { until } = useAutoOf(projectId);
  const askFirst = useDayOf(projectId).ask;
  const now = useNow(until !== null);
  const [picking, setPicking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const { start, stop, finish } = useAuto.getState();
  if (until !== null) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-white/20 bg-white/[0.06] py-0.5 pl-3 pr-0.5">
        <span className="node-live h-1.5 w-1.5 rounded-full bg-foreground" />
        <span className="ml-1 text-[12.5px] font-medium">Auto</span>
        <span className="text-[12.5px] text-muted-foreground">· {timeLeft(until, now)}</span>
        {stopping ? (
          // Letting the running task land is the usual stop; cutting it off is the second choice.
          <span role="group" aria-label="Stop auto mode" className="ml-1 flex items-center gap-1">
            <button type="button" autoFocus className={cn(soft, "font-normal")} onClick={() => (setStopping(false), finish(projectId))}>After this task</button>
            <button type="button" className={ghost} onClick={() => (setStopping(false), stop(projectId))}>Now</button>
            <button type="button" className={ghost} onClick={() => setStopping(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className={cn(soft, "ml-1 font-normal")} onClick={() => setStopping(true)}>
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        )}
      </div>
    );
  }
  if (picking) {
    return (
      <div className="flex items-center gap-1" role="group" aria-label="Work on its own for">
        {HOURS.map((hours) => (
          <button key={hours} type="button" className={soft} onClick={() => (setPicking(false), start(projectId, hours))}>
            {hours}h
          </button>
        ))}
        {/* Auto mode takes its own suggestions, but tool calls still stop for the owner, who's away. */}
        {askFirst && <span className="px-1 text-[11.5px] text-attention">Ask first: tool calls wait for you</span>}
        <button type="button" aria-label="Cancel" title="Cancel" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={() => setPicking(false)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <button type="button" disabled={disabled} title={disabled ? "Write the brief first" : "Let the company work on its own for a few hours"} className={cn(soft, "font-normal")} onClick={() => setPicking(true)}>
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
