import { useState, type ReactNode } from "react";
import { Check, Pencil } from "lucide-react";

import type { RunMessage } from "@/lib/thread";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { approvePlan } from "@/store/runs";

// A finished plan waits here for the owner: approve it as it is, edit it first, or reply below to
// have it changed. Nothing in the project is touched until they approve.

function Choice({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn("flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] transition-colors disabled:opacity-40", primary ? "bg-primary font-medium text-primary-foreground hover:opacity-90" : "border border-border hover:bg-hover")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PlanReview({ conversationId, message }: { conversationId: string; message: RunMessage }) {
  const plan = message.plan?.output ?? "";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(plan);
  const approve = (edited?: string) => void approvePlan(conversationId, message.id, edited);

  if (editing) {
    return (
      <div className="grid gap-2">
        <textarea
          autoFocus
          value={text}
          aria-label="The plan"
          spellCheck={false}
          className="max-h-[50vh] min-h-48 w-full resize-y rounded-xl border border-border bg-black/40 p-3 font-mono text-[12.5px] leading-relaxed outline-none [font-variant-ligatures:none] focus:border-ring"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
              e.preventDefault();
              approve(text);
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Choice primary disabled={!text.trim()} onClick={() => approve(text)}>
            <Check className="h-3.5 w-3.5" /> Approve and code
          </Choice>
          <Choice onClick={() => { setText(plan); setEditing(false); }}>Cancel</Choice>
          <span className="ml-1 text-[11px] text-muted-foreground">⌘↵ approves</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      <p className="text-[13px] text-attention">Waiting for your OK on the plan. Nothing is edited until then.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Choice primary onClick={() => approve()}>
          <Check className="h-3.5 w-3.5" /> Approve and code
        </Choice>
        <Choice onClick={() => setEditing(true)}>
          <Pencil className="h-3 w-3" /> Edit the plan
        </Choice>
        <span className="text-[11.5px] text-muted-foreground">or reply below to change it</span>
        <button
          type="button"
          title="Switch it back next to the models in the composer"
          className="ml-auto text-[11.5px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          onClick={() => {
            useApp.getState().setAutoCode(true);
            approve();
          }}
        >
          Always code right after the plan
        </button>
      </div>
    </div>
  );
}
