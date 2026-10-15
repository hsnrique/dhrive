import { X } from "lucide-react";

import { useApp } from "@/store/app";

// Global error surface — every user-initiated invoke failure lands here instead of vanishing.
export function ErrorToast() {
  const error = useApp((s) => s.error);
  const clearError = useApp((s) => s.clearError);
  if (error === null) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-failure/40 bg-card px-4 py-3 text-[12.5px]"
    >
      <span className="flex-1">{error}</span>
      <button
        aria-label="Dismiss"
        className="text-muted-foreground transition-colors hover:text-foreground"
        onClick={clearError}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
