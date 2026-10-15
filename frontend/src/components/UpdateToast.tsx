import { X } from "lucide-react";

import { restartApp } from "@/lib/api";
import { useApp } from "@/store/app";
import { buttonVariants } from "@/components/ui/button";

// Shown once an update is downloaded and staged; restart now or it applies on next launch.
export function UpdateToast() {
  const version = useApp((s) => s.updateReady);
  const setUpdateReady = useApp((s) => s.setUpdateReady);
  if (version === null) return null;
  return (
    <div role="status" className="pop-in flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-[12.5px] shadow-popover">
      <span className="h-2 w-2 flex-none rounded-full bg-foreground" />
      <div className="flex-1">
        <p className="font-medium">Update ready</p>
        <p className="text-xs text-muted-foreground">
          dhrive {version} is installed — restart to use it.
        </p>
      </div>
      <button
        type="button"
        className={buttonVariants({ variant: "primary", size: "sm" })}
        onClick={() => void restartApp()}
      >
        Restart
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="-mr-1.5 flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        onClick={() => setUpdateReady(null)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
