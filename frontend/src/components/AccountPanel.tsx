import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, LogOut, X } from "lucide-react";

import type { AccountStatus } from "@/lib/api";
import { ACCOUNT_URL, PORTAL_URL, TRIAL_DAYS, checkoutUrl, emailOf, initialOf, planLine, planName } from "@/lib/account";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";
import { useApp } from "@/store/app";
import { standDown } from "@/store/stand-down";
import { Dialog } from "@/components/ui/layer";
import { buttonVariants } from "@/components/ui/button";

// The account, all of it in one place: who's signed in on this Mac, the plan and where it stands,
// subscribing or managing billing on dhrive.app, and signing out (which asks once, since it stops
// every company's work on this Mac until signing back in).

const quiet = cn(buttonVariants({ variant: "outline", size: "md" }), "px-4");
const loud = cn(buttonVariants({ variant: "primary", size: "md" }), "px-4");
const soft = cn(buttonVariants({ variant: "soft", size: "md" }), "px-4");

const open = (url: string) => void openUrl(url).catch(() => undefined);

export function Avatar({ email, className }: { email: string | null; className?: string }) {
  return <span className={cn("flex flex-none items-center justify-center rounded-full bg-selected font-medium text-foreground", className)}>{initialOf(email)}</span>;
}

function TrialBar({ daysLeft }: { daysLeft: number }) {
  const used = Math.min(100, Math.max(0, ((TRIAL_DAYS - daysLeft) / TRIAL_DAYS) * 100));
  return (
    <div className="h-1 overflow-hidden rounded-full bg-selected" role="progressbar" aria-valuemin={0} aria-valuemax={TRIAL_DAYS} aria-valuenow={TRIAL_DAYS - daysLeft} aria-label="Free days used">
      <div className={cn("h-full rounded-full", daysLeft <= 3 ? "bg-attention" : "bg-foreground/70")} style={{ width: `${used}%` }} />
    </div>
  );
}

function Plan({ status }: { status: AccountStatus }) {
  return (
    <section className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
      <div className="grid gap-1">
        <p className="text-[11.5px] text-muted-foreground">Plan</p>
        <p className="text-[15px] font-medium">{planName(status)}</p>
        <p className="text-[12.5px] text-muted-foreground">{planLine(status)}</p>
      </div>
      {status.state === "trial" && <TrialBar daysLeft={status.daysLeft} />}
      <div className="flex flex-wrap gap-2">
        {status.state === "subscribed" ? (
          <button type="button" className={quiet} onClick={() => open(PORTAL_URL)}>
            Manage plan & billing
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        ) : (
          <>
            <button type="button" className={loud} onClick={() => open(checkoutUrl("yearly"))}>Subscribe yearly</button>
            <button type="button" className={quiet} onClick={() => open(checkoutUrl("monthly"))}>Monthly</button>
          </>
        )}
      </div>
    </section>
  );
}

// "Companies stop working here": signing out stands every company down first, so nothing of theirs
// keeps starting steps that would each fail for want of an account.
function SignOut() {
  const [asking, setAsking] = useState(false);
  const leaving = useAccount((s) => s.signingOut);
  const error = useAccount((s) => s.error);
  const leave = () => {
    for (const project of useApp.getState().projects) standDown(project.id);
    void useAccount.getState().signOut();
  };
  if (!asking) {
    return (
      <button type="button" className={quiet} onClick={() => setAsking(true)}>
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-[12px]", error ? "text-failure" : "text-muted-foreground")} role={error ? "alert" : undefined}>{error ?? "Companies stop working here."}</span>
      <button type="button" disabled={leaving} className={soft} onClick={leave}>{leaving ? "Signing out…" : "Sign out"}</button>
      <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setAsking(false)}>Cancel</button>
    </div>
  );
}

export function AccountPanel({ status, onClose }: { status: AccountStatus; onClose: () => void }) {
  const email = emailOf(status);
  useEffect(() => void useAccount.getState().load(), []);
  return (
    <Dialog label="Account" onClose={onClose} className="grid max-w-[440px] gap-4 p-5">
      <div className="flex items-center gap-3">
        <Avatar email={email} className="h-10 w-10 text-[15px]" />
        <div className="grid min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{email ?? "Your account"}</p>
          <p className="text-[12px] text-muted-foreground">Signed in on this Mac</p>
        </div>
        <button type="button" aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {status.state === "free" ? <p className="text-[12.5px] text-muted-foreground">This build of dhrive has no account.</p> : <Plan status={status} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="flex items-center gap-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground" onClick={() => open(ACCOUNT_URL)}>
          Account on the web
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        {status.state !== "free" && <SignOut />}
      </div>
    </Dialog>
  );
}
