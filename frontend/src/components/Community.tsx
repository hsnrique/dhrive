import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MessageSquare } from "lucide-react";

import { sendFeedback } from "@/lib/api";
import { BRANDS } from "@/lib/brands";

// Right above the account: feedback to the dhrive team in one box, and the community on Discord.
// The invite never expires.
export const DISCORD = "https://discord.gg/wKwzSV3dyJ";
const MAX = 4000;

export const openDiscord = () => void openUrl(DISCORD).catch(() => undefined);

export function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox={BRANDS.discord.viewBox} aria-hidden fill="currentColor" className={className}>
      {BRANDS.discord.paths.map((d) => <path key={d.slice(0, 24)} d={d} />)}
    </svg>
  );
}

type State = "writing" | "sending" | "sent";

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>("writing");
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const ready = text.trim().length > 0 && state === "writing";
  const submit = async () => {
    if (!ready) return;
    setState("sending");
    setError(null);
    try {
      await sendFeedback(text);
      setState("sent");
      setTimeout(onClose, 1600);
    } catch (e) {
      setError(String(e));
      setState("writing");
    }
  };
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && state !== "sending" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [state, onClose]);
  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && state !== "sending" && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby={titleId} className="pop-in grid w-full max-w-[440px] gap-3 rounded-2xl border border-border bg-popover p-5 shadow-[0_24px_70px_rgba(0,0,0,0.6)]" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 id={titleId} className="text-[15px] font-medium">Feedback</h2>
        {state === "sent" ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Sent. Thank you, every one gets read.</p>
        ) : (
          <>
            <textarea
              autoFocus
              value={text}
              maxLength={MAX}
              rows={5}
              disabled={state === "sending"}
              placeholder="What's working, what isn't, what you wish it did…"
              aria-label="Your feedback"
              className="resize-none rounded-lg border border-border bg-black/30 px-3 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:border-white/30"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.metaKey && void submit()}
            />
            {error && <p className="text-[12px] text-[#ff8a8f]" role="alert">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <button type="button" disabled={state === "sending"} className="h-8 rounded-full px-4 text-[12.5px] text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:opacity-40" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={!ready} className="h-8 rounded-full bg-foreground px-4 text-[12.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40">{state === "sending" ? "Sending…" : "Send"}</button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

const link = "flex h-8 flex-1 items-center justify-center gap-2 rounded-md text-[12px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground";

export function CommunityRow() {
  const [writing, setWriting] = useState(false);
  return (
    <div className="flex gap-1 border-t border-border px-2 py-1.5">
      <button type="button" className={link} onClick={() => setWriting(true)}>
        <MessageSquare className="h-3.5 w-3.5" />
        Feedback
      </button>
      <button type="button" className={link} title="dhrive on Discord" onClick={openDiscord}>
        <DiscordMark className="h-3.5 w-3.5" />
        Community
      </button>
      {writing && <FeedbackDialog onClose={() => setWriting(false)} />}
    </div>
  );
}
