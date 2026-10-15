import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useGitHub, useGitHubOf } from "@/store/github";
import { useLayer } from "@/components/ui/layer";
import { fieldVariants } from "@/components/ui/field";
import { buttonVariants } from "@/components/ui/button";

// Saving to GitHub with a message: the owner writes what changed, or has the company's agent write it
// from the changes, then saves. Left empty, the save goes out with dhrive's plain line, as before.
// Esc or a click outside closes it; ⌘↵ saves from the message.

const quiet = buttonVariants({ variant: "ghost", size: "sm" });
const primary = cn(buttonVariants({ variant: "primary", size: "sm" }), "px-3.5");

export function CommitBox({ projectId, changes, onClose }: { projectId: string; changes: number; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const { writing } = useGitHubOf(projectId);
  const box = useRef<HTMLDivElement>(null);
  const { save, writeMessage } = useGitHub.getState();
  useEffect(() => {
    // The box and the button that opens it share a parent; a press on the button is its own toggle.
    const away = (e: PointerEvent) => !box.current?.parentElement?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [onClose]);
  useLayer(box, onClose);
  const submit = () => {
    onClose();
    void save(projectId, message.trim() || undefined);
  };
  const write = async () => {
    const written = await writeMessage(projectId);
    if (written) setMessage(written);
  };
  return (
    <div ref={box} className="absolute right-0 top-9 z-30 grid w-[min(340px,calc(100vw-32px))] gap-2.5 rounded-xl border border-border bg-popover p-3 shadow-popover">
      <p className="text-[12px] text-muted-foreground">{changes === 1 ? "1 change" : `${changes} changes`}</p>
      <textarea
        autoFocus
        rows={3}
        value={message}
        placeholder="What changed"
        aria-label="Commit message"
        disabled={writing !== null}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.metaKey && submit()}
        className={cn(fieldVariants({ size: "area" }), "resize-none px-2.5 py-2 leading-snug")}
      />
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={cn(quiet, "flex items-center gap-1.5")} disabled={writing !== null} onClick={() => void write()}>
          {writing !== null && <span className="node-live h-1.5 w-1.5 rounded-full bg-foreground" />}
          {writing !== null ? "Writing…" : "Write it for me"}
        </button>
        <button type="button" className={primary} disabled={writing !== null} onClick={submit}>Save</button>
      </div>
    </div>
  );
}
