import { useId, useState } from "react";

import { confirmed } from "@/lib/confirm";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/layer";
import { fieldVariants } from "@/components/ui/field";
import { buttonVariants } from "@/components/ui/button";

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
  return (
    <Dialog role="alertdialog" labelledBy={titleId} onClose={() => !busy && onClose()} className="grid max-w-[400px] gap-4 p-5">
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
          className={cn(fieldVariants({ size: "lg" }), "font-mono")}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} className={cn(buttonVariants({ variant: "ghost", size: "md" }), "px-4")} onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!ready} className={cn(buttonVariants({ variant: "destroy", size: "md" }), "px-4")} onClick={() => void go()}>
          {busy ? doing : action}
        </button>
      </div>
    </Dialog>
  );
}
