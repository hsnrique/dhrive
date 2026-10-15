import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { confirmed } from "@/lib/confirm";
import { cn } from "@/lib/utils";

// The ask before anything that can't be taken back (a company, a domain): what goes, said once,
// and the thing's name typed to go ahead. Escape or Cancel leaves it all as it was.

interface Props {
  title: string;
  detail: string;
  word: string;
  action: string;
  doing: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function TypeToConfirm({ title, detail, word, action, doing, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const ready = confirmed(typed, word) && !busy;
  const go = async () => {
    if (!ready) return;
    setBusy(true);
    await onConfirm();
    onClose();
  };
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="pop-in grid w-full max-w-[400px] gap-4 rounded-2xl border border-border bg-popover p-5 shadow-dialog">
        <div className="grid gap-1.5">
          <h2 id={titleId} className="text-[15px] font-medium">{title}</h2>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        <label className="grid gap-1.5 text-[12px] text-muted-foreground">
          <span>
            Type <span className="font-mono text-foreground">{word}</span> to confirm
          </span>
          <input
            autoFocus
            value={typed}
            disabled={busy}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="h-9 rounded-lg border border-border bg-black/30 px-3 font-mono text-[13px] text-foreground outline-none focus:border-ring"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void go()}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} className="h-8 rounded-md px-4 text-[12.5px] text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:opacity-40" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!ready} className={cn("h-8 rounded-md px-4 text-[12.5px] font-medium transition-colors", ready ? "bg-[#ff8a8f] text-background hover:opacity-90" : "bg-white/[0.06] text-muted-foreground")} onClick={() => void go()}>
            {busy ? doing : action}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
