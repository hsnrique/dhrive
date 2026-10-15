import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Paperclip, Square, UserCheck } from "lucide-react";

import { draftKeyOf, type Open } from "@/lib/conversations";
import { readDraft, writeDraft } from "@/lib/drafts";
import { MODES, stagesFor, type Mode } from "@/lib/flow";
import { activeRun } from "@/lib/thread";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useConversations } from "@/store/conversations";
import { useFiles } from "@/store/files";
import { runsBlocked, useAccount } from "@/store/account";
import { send, stop } from "@/store/runs";
import { AttachmentChips, useAttachments } from "./Attachments";
import { MentionList, useMentionPicker } from "./Mentions";
import { ModelPicker } from "./ModelPicker";

const MAX_HEIGHT = 240;

const MODE_INFO: Record<Mode, { label: string; title: string }> = {
  chat: { label: "Chat", title: "Think it through. Nothing is edited." },
  relay: { label: "Plan", title: "Plan first, then code once you approve the plan." },
  code: { label: "Code", title: "Straight to code, no plan." },
};

// The mode leads the routing sentence: "Chat with Opus", "Plan with Opus → code with Sonnet",
// "Code with Sonnet".
function ModeSwitch() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  return (
    <div role="radiogroup" aria-label="Mode" className="flex items-center rounded-full border border-border p-0.5">
      {MODES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={mode === option}
          title={MODE_INFO[option].title}
          className={cn("h-6 rounded-md px-2.5 text-xs transition-colors", mode === option ? "bg-selected font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          onClick={() => setMode(option)}
        >
          {MODE_INFO[option].label}
        </button>
      ))}
    </div>
  );
}

// Between the planner and the coder: the owner's OK on each plan (the default), or straight on.
function Handoff() {
  const autoCode = useApp((s) => s.autoCode);
  const setAutoCode = useApp((s) => s.setAutoCode);
  return (
    <button
      type="button"
      aria-pressed={!autoCode}
      title={autoCode ? "The code starts right after the plan. Click to approve each plan first." : "You approve each plan before the code starts. Click to code right after the plan."}
      className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      onClick={() => setAutoCode(!autoCode)}
    >
      {!autoCode && (
        <>
          <UserCheck className="h-3.5 w-3.5" aria-hidden />
          your OK
        </>
      )}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function Route({ mode }: { mode: Mode }) {
  const words = "px-0.5 text-xs text-muted-foreground";
  return (
    <>
      <span className={words}>with</span>
      <ModelPicker step={mode === "code" ? "code" : "plan"} />
      {mode === "relay" && (
        <>
          <Handoff />
          <span className={words}>code with</span>
          <ModelPicker step="code" />
        </>
      )}
    </>
  );
}

// Where a request is written, and the sentence that routes it. The first request of a new
// conversation is what creates it.
export function Composer({ open, projectName, folder }: { open: Open; projectName: string; folder: string }) {
  const draftKey = draftKeyOf(open);
  const [text, setText] = useState(() => readDraft(draftKey));
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useAttachments();
  const index = useFiles((s) => s.byFolder[folder]);
  const mentions = useMentionPicker(text, setText, area, index);
  const { conversationId } = open;
  const running = useApp((s) => conversationId !== null && activeRun(s.threads[conversationId]) !== null);
  const mode = useApp((s) => s.mode);
  const ready = useApp((s) => stagesFor(s.mode, s.choices).main !== null);
  const blocked = useAccount((s) => runsBlocked(s.status));
  // Sending while a request runs queues the new one; it starts when the current one ends.
  const canSend = text.trim() !== "" && ready && !blocked;

  useEffect(() => writeDraft(draftKey, text), [draftKey, text]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const submit = () => {
    if (!canSend) return;
    writeDraft(draftKey, "");
    const id = useConversations.getState().begin(text);
    if (id) void send(id, text, files.items);
    setText("");
    files.clear();
  };

  return (
    <div className={cn("relative rounded-2xl border border-border bg-card p-2 transition-colors", files.dragging && "border-ring bg-white/[0.06]")}>
      {blocked && (
        <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2 text-[12.5px]">
          <span className="flex-1 text-muted-foreground">Your free days are over. Subscribe to keep sending.</span>
          <button type="button" className="rounded-md bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground hover:opacity-90" onClick={() => useAccount.getState().setSheetOpen(true)}>
            Subscribe
          </button>
        </div>
      )}
      <MentionList items={mentions.items} active={mentions.active} onPick={mentions.pick} />
      <AttachmentChips items={files.items} previews={files.previews} onRemove={files.remove} className="px-1.5 pb-1 pt-1" />
      <textarea
        ref={area}
        autoFocus
        rows={1}
        aria-label="Request"
        className="block max-h-60 min-h-11 w-full resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        placeholder={running ? "Send a follow-up; it runs when this one ends" : mode === "chat" ? `Ask anything about ${projectName} · @ for a file` : `What should change in ${projectName}? · @ for a file`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          mentions.track(e.target);
        }}
        // Not onSelect: React fires it during the keydown that picks a mention, with the old caret.
        onKeyUp={(e) => mentions.track(e.currentTarget)}
        onClick={(e) => mentions.track(e.currentTarget)}
        onPaste={files.onPaste}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || mentions.onKeyDown(e)) return;
          // Escape stops what's running, as it does in Claude Code.
          if (e.key === "Escape" && running && conversationId) {
            e.preventDefault();
            stop(conversationId);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 pt-1">
        <button
          type="button"
          title={files.full ? "Up to 10 files per request" : "Attach files (or paste a screenshot, or drop files here)"}
          aria-label="Attach files"
          disabled={files.full}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
          onClick={() => void files.pick()}
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <ModeSwitch />
        <Route mode={mode} />
        <span className="ml-auto flex items-center gap-1.5">
          {running && (
            <button
              type="button"
              title="Stop"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-selected text-foreground transition-colors hover:bg-pressed"
              onClick={() => conversationId && stop(conversationId)}
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          )}
          {(!running || canSend) && (
            <button
              type="button"
              title={running ? "Queue it (Enter)" : "Send (Enter)"}
              disabled={!canSend}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-95 disabled:opacity-25"
              onClick={submit}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
