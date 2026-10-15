import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

import { emailOf, standing, urgent } from "@/lib/account";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";
import { AccountPanel, Avatar } from "./AccountPanel";
import { BrandLogo } from "./BrandLogo";

// The sign-in on first open; the account always at the foot of the sidebar, with who's signed in and
// where the plan stands; a badge by the wordmark only when the free days are nearly or fully gone;
// and the account panel any of them opens. Nothing shows in a build without accounts.

function Pill({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} className={cn("h-8 rounded-md px-4 text-[12.5px] transition-colors disabled:opacity-40", primary ? "bg-primary font-medium text-primary-foreground hover:opacity-90" : "border border-border hover:bg-hover")} onClick={onClick}>
      {children}
    </button>
  );
}

function SignInButton() {
  const signingIn = useAccount((s) => s.signingIn);
  const error = useAccount((s) => s.error);
  const { signIn, cancelSignIn } = useAccount.getState();
  return (
    <div className="grid justify-items-center gap-3">
      <Pill primary disabled={signingIn} onClick={() => void signIn()}>
        {signingIn ? "Finish in your browser…" : "Sign in with your browser"}
      </Pill>
      {signingIn && (
        <button type="button" className="text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={cancelSignIn}>
          Cancel
        </button>
      )}
      {error && <p className="max-w-[320px] text-center text-[12px] text-failure">{error}</p>}
    </div>
  );
}

// The whole window until this Mac is signed in.
// Until it's decided, a plain cover: the app never shows for a moment and then hides behind it.
export function SignInGate() {
  const decided = useAccount((s) => s.decided);
  const signedOut = useAccount((s) => s.status?.state === "signedOut");
  if (decided && !signedOut) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div data-tauri-drag-region className="h-[44px] flex-none" />
      {signedOut && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-[44px] text-center">
          <BrandLogo className="h-6 w-6" />
          <h1 className="display-title">Sign in to start</h1>
          <p className="text-[13px] text-muted-foreground">14 days free, no card. Your CLIs and their plans stay as they are.</p>
          <SignInButton />
        </div>
      )}
    </div>,
    document.body,
  );
}

export function AccountSheet() {
  const status = useAccount((s) => s.status);
  const open = useAccount((s) => s.sheetOpen);
  if (!open || !status) return null;
  return createPortal(<AccountPanel status={status} onClose={() => useAccount.getState().setSheetOpen(false)} />, document.body);
}

// The foot of the sidebar: whose dhrive this is and where its plan stands, one click from the rest.
export function AccountRow() {
  const status = useAccount((s) => s.status);
  if (!status || status.state === "free" || status.state === "signedOut") return null;
  const email = emailOf(status);
  return (
    <div className="border-t border-border px-4 py-2">
      <button type="button" title="Your account" className="group -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover" onClick={() => useAccount.getState().setSheetOpen(true)}>
        <Avatar email={email} className="h-7 w-7 text-[12px]" />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-[12.5px] text-foreground/90">{email ?? "Your account"}</span>
          <span className={cn("truncate text-[11px]", urgent(status) ? "text-attention" : "text-muted-foreground")}>{standing(status)}</span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    </div>
  );
}

// Beside the wordmark, only when it matters: the last free days, or that they're over.
export function AccountBadge() {
  const status = useAccount((s) => s.status);
  if (!status || !urgent(status)) return null;
  const label = status.state === "trial" ? `${status.daysLeft}d left` : "Trial over";
  return (
    <button type="button" title="Your dhrive account" className="whitespace-nowrap rounded-md border border-attention/50 px-2 py-0.5 text-[10.5px] text-attention transition-colors hover:bg-hover" onClick={() => useAccount.getState().setSheetOpen(true)}>
      {label}
    </button>
  );
}
