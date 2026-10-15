import { cn } from "@/lib/utils";
import { runsBlocked, useAccount } from "@/store/account";
import { buttonVariants } from "@/components/ui/button";

// When the account can't start runs (the free days are over, a subscription ended), it says so
// where work starts, not only after a step fails for it: the conversation's composer, the founding
// card, the company's tasks.

export const useRunsBlocked = () => useAccount((s) => runsBlocked(s.status));

export const BLOCKED_TITLE = "Subscribe to keep going";

export function RunsBlocked({ className }: { className?: string }) {
  const reason = useAccount((s) => (runsBlocked(s.status) ? (s.status?.state === "ended" ? s.status.reason : "Sign in to start.") : null));
  if (!reason) return null;
  return (
    <div className={cn("flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2 text-[12.5px]", className)}>
      <span className="flex-1 text-muted-foreground">{reason}</span>
      <button type="button" className={buttonVariants({ variant: "primary", size: "xs" })} onClick={() => useAccount.getState().setSheetOpen(true)}>
        Subscribe
      </button>
    </div>
  );
}
