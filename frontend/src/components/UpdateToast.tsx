import { X } from "lucide-react";

import { restartApp } from "@/lib/api";
import { useApp } from "@/store/app";

// Shown once an update is downloaded and staged; restart now or it applies on next launch.
export function UpdateToast() {
  const version = useApp((s) => s.updateReady);
  const setUpdateReady = useApp((s) => s.setUpdateReady);
  if (version === null) return null;
  return (
    <div className="fixed bottom-24 right-6 z-40 flex max-w-sm items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <span className="h-2 w-2 flex-none rounded-full bg-foreground" />
      <div className="flex-1">
        <p className="font-medium">Update ready</p>
        <p className="text-xs text-muted-foreground">
          dhrive {version} is installed — restart to use it.
        </p>
      </div>
      <button
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        onClick={() => void restartApp()}
      >
        Restart
      </button>
      <button
        aria-label="Dismiss"
        className="text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setUpdateReady(null)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
