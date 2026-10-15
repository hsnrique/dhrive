import { useRef } from "react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { useLayer } from "./layer";

// A question in place of what asked it, for what ends work but can be found again: focus lands on
// the safe choice, and Escape keeps, like Keep does. What can't be taken back asks for the name
// typed instead (TypeToConfirm).
export function InlineConfirm({ question, action, busy, onYes, onNo, className }: { question: string; action: string; busy?: boolean; onYes: () => void; onNo: () => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayer(box, () => !busy && onNo());
  return (
    <div ref={box} role="group" aria-label={question} className={cn("flex items-center gap-1 text-[12px]", className)}>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{question}</span>
      <button type="button" disabled={busy} className={cn(buttonVariants({ variant: "danger", size: "xs" }), "px-1.5")} onClick={onYes}>
        {action}
      </button>
      <button type="button" autoFocus disabled={busy} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "px-1.5 text-foreground")} onClick={onNo}>
        Keep
      </button>
    </div>
  );
}
