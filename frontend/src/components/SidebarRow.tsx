import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { InlineConfirm } from "@/components/ui/inline-confirm";

// What every row under a project in the sidebar shares: its look, the ask before a delete, and the
// actions that show on hover.

export const rowClass = (active: boolean) =>
  cn(
    "flex w-full items-center gap-2 rounded-md py-1 pl-[14px] pr-2 text-left text-[12.5px] transition-colors",
    active ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
  );

// A row's question, in the row's own place and shape.
export function Confirm({ question, action, onYes, onNo }: { question: string; action: string; onYes: () => void; onNo: () => void }) {
  return <InlineConfirm question={question} action={action} onYes={onYes} onNo={onNo} className="rounded-md bg-white/[0.06] py-0.5 pl-2.5 pr-0.5" />;
}

export function HoverAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
