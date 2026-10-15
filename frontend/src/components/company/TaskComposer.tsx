import { useState } from "react";
import { Plus } from "lucide-react";

import { AREAS, type Area } from "@/lib/day";
import { cn } from "@/lib/utils";
import { useKeptText } from "@/lib/drafts";
import { useDay } from "@/store/day";
import { AREA_LOOK } from "./TaskRow";

// The owner adds a task in their own words. It joins the queue and the company starts on it, since
// the owner asking is the OK. Enter adds it; Shift+Enter starts a new line.

export function TaskComposer({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [said, setSaid] = useKeptText(`task:${projectId}`);
  const [area, setArea] = useState<Area>("code");
  const submit = () => {
    if (useDay.getState().add(projectId, said, area)) setSaid("");
  };
  return (
    <li className="grid gap-2 rounded-xl border border-dashed border-border px-3 py-1.5 transition-colors focus-within:border-ring">
      <div className="flex items-start gap-2.5">
        <Plus className="mt-[5px] h-[18px] w-[18px] flex-none p-0.5 text-muted-foreground" />
        <textarea
          value={said}
          disabled={disabled}
          rows={said.includes("\n") ? 4 : 1}
          aria-label="Add a task"
          placeholder={disabled ? "Install Claude Code, Codex or Antigravity to add tasks" : "Add a task"}
          className="min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
          onChange={(e) => setSaid(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
        />
      </div>
      {said.trim() && (
        <div className="flex flex-wrap items-center gap-1 pl-[28px]" role="radiogroup" aria-label="Area">
          {AREAS.map((each) => {
            const { label, Icon } = AREA_LOOK[each];
            return (
              <button
                key={each}
                type="button"
                role="radio"
                aria-checked={area === each}
                className={cn("flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors", area === each ? "bg-selected text-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setArea(each)}
              >
                <Icon className="h-3 w-3" strokeWidth={1.75} />
                {label}
              </button>
            );
          })}
          <span className="ml-auto text-[11.5px] text-muted-foreground">Enter to add</span>
        </div>
      )}
    </li>
  );
}
