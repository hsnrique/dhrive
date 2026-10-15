import { ArrowUp, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

// The two ends of every composer (a conversation's, Maestro's, a company's chat): send what's
// written, or stop what's running. One size and one look wherever something is written to an agent.

export function SendButton({ label, title = label, disabled, onClick }: { label: string; title?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={label} disabled={disabled} className={buttonVariants({ variant: "primary", size: "icon" })} onClick={onClick}>
      <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
    </button>
  );
}

export function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" title="Stop" aria-label="Stop" className={cn(buttonVariants({ variant: "soft", size: "icon" }), "border border-border font-normal")} onClick={onClick}>
      <Square className="h-3 w-3 fill-current" />
    </button>
  );
}
