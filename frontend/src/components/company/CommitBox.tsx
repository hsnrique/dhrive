import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useGitHub, useGitHubOf } from "@/store/github";

// Saving to GitHub with a message: the owner writes what changed, or has the company's agent write it
// from the changes, then saves. Left empty, the save goes out with dhrive's plain line, as before.
// Esc or a click outside closes it; ⌘↵ saves from the message.

const quiet = "h-7 rounded-md px-3 text-[12px] text-foreground/80 transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:opacity-40";
const primary = "h-7 rounded-md bg-foreground px-3.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40";

export function CommitBox({ projectId, changes, onClose }: { projectId: string; changes: number; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const { writing } = useGitHubOf(projectId);
  const box = useRef<HTMLDivElement>(null);
  const { save, writeMessage } = useGitHub.getState();
  useEffect(() => {
    // The box and the button that opens it share a parent; a press on the button is its own toggle.
    const away = (e: PointerEvent) => !box.current?.parentElement?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
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
        className="resize-none rounded-lg border border-border bg-black/30 px-2.5 py-2 text-[13px] leading-snug outline-none placeholder:text-muted-foreground/70 focus-visible:border-white/30 disabled:opacity-60"
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
