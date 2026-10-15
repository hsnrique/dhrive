import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useApp } from "@/store/app";
import { UpdateToast } from "./UpdateToast";

// One column in the corner, on the body beside the app: a modal leaves the app inert, and an error
// it caused must still be read and dismissed. An update and what went wrong stack, never overlap.
export function Toasts() {
  return createPortal(
    <div data-live className="pointer-events-none fixed bottom-6 right-6 z-[60] grid w-[min(24rem,calc(100vw-48px))] gap-2 [&>*]:pointer-events-auto">
      <UpdateToast />
      <ErrorToast />
    </div>,
    document.body,
  );
}

// Where what went wrong lands, newest on top: every failure the owner didn't see coming, kept
// until they dismiss it, a count when the same thing failed again.
function ErrorToast() {
  const errors = useApp((s) => s.errors);
  const dismiss = useApp((s) => s.dismissError);
  if (errors.length === 0) return null;
  return (
    <ul role="alert" className="grid gap-2">
      {errors.map((error) => (
        <li key={error.id} className="pop-in flex items-start gap-3 rounded-xl border border-failure/40 bg-card px-4 py-3 text-[12.5px] shadow-popover">
          <span className="min-w-0 flex-1 select-text break-words">{error.text}</span>
          {error.count > 1 && <span className="flex-none font-mono text-[11px] text-muted-foreground">×{error.count}</span>}
          <button type="button" aria-label="Dismiss" className="-my-0.5 -mr-1.5 flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={() => dismiss(error.id)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
