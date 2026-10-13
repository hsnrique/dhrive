import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// What every row under a project in the sidebar shares: its look, the ask before a delete, and the
// actions that show on hover.

export const rowClass = (active: boolean) =>
  cn(
    "flex w-full items-center gap-2 rounded-md py-1 pl-[14px] pr-2 text-left text-[12.5px] transition-colors",
    active ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
  );

export function Confirm({ question, action, onYes, onNo }: { question: string; action: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-white/[0.06] py-1 pl-2.5 pr-1 text-[12px]">
      <span className="flex-1 text-muted-foreground">{question}</span>
      <button type="button" className="rounded px-1.5 py-0.5 text-[#ff8a8f] hover:bg-white/[0.08]" onClick={onYes}>
        {action}
      </button>
      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white/[0.08]" onClick={onNo}>
        Keep
      </button>
    </div>
  );
}

export function HoverAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
