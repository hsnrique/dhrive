import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, ScrollText, X } from "lucide-react";

import { instructionsKeyOf, type Open } from "@/lib/conversations";
import { readDraft, writeDraft } from "@/lib/drafts";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useFiles } from "@/store/files";
import { useInstructions } from "@/store/instructions";
import { usePanel } from "@/store/panel";

// The owner's own AGENTS.md, for every project, and what one conversation adds on top. Every agent
// dhrive runs gets both, even in a project that has no AGENTS.md or CLAUDE.md of its own.

type Scope = "every" | "here";

const MAX_CHARS = 20_000;
const PROJECT_FILES = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"];
const EXAMPLE = "- Answer in Portuguese\n- Run the tests before saying it's done\n- Never commit on your own";

const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: "every", label: "Every project", hint: "Every agent follows these, in every project." },
  { id: "here", label: "This conversation", hint: "Only this conversation. These win over the rest." },
];

type Status = "saved" | "saving" | "failed";

// Saves half a second after the last keystroke, and whatever is still pending when the editor closes.
function useAutosave(save: (text: string) => Promise<void> | void) {
  const [status, setStatus] = useState<Status>("saved");
  const saver = useRef(save);
  saver.current = save;
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useRef(async () => {
    clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    try {
      await saver.current(text);
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  });
  useEffect(() => () => void flush.current(), []);
  const change = (text: string) => {
    pending.current = text;
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), 500);
  };
  return { status, change };
}

function Editor({ initial, save }: { initial: string; save: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState(initial);
  const { status, change } = useAutosave(save);
  return (
    <>
      <textarea
        autoFocus
        value={text}
        maxLength={MAX_CHARS}
        placeholder={EXAMPLE}
        spellCheck={false}
        aria-label="Instructions"
        className="h-[min(50vh,420px)] w-full resize-none rounded-xl border border-border bg-black/30 p-3 font-mono text-[12.5px] leading-relaxed outline-none transition-colors [font-variant-ligatures:none] placeholder:text-muted-foreground/60 focus:border-ring"
        onChange={(e) => {
          setText(e.target.value);
          change(e.target.value);
        }}
      />
      <p className={cn("text-[11px] text-muted-foreground", status === "failed" && "text-failure")}>
        {status === "saving" ? "Saving…" : status === "failed" ? "Couldn't save. Keep typing to try again." : "Saved"} · {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
      </p>
    </>
  );
}

// A conversation's instructions live in its thread; a new one's wait with its draft.
function saveHere(open: Open) {
  return (text: string) => {
    if (open.conversationId) useApp.getState().setThread(open.conversationId, (t) => ({ ...t, instructions: text }));
    else writeDraft(instructionsKeyOf(open), text);
  };
}

function ProjectFiles({ folder, onOpen }: { folder: string; onOpen: () => void }) {
  const index = useFiles((s) => s.byFolder[folder]);
  const found = PROJECT_FILES.filter((path) => index?.files.has(path));
  if (found.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      Also follows this project's
      {found.map((path) => (
        <button key={path} type="button" className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-foreground/85 transition-colors hover:bg-hover" onClick={() => { usePanel.getState().open(folder, path); onOpen(); }}>
          <FileText className="h-3 w-3" />
          {path}
        </button>
      ))}
    </div>
  );
}

function Dialog({ open, folder, onClose }: { open: Open; folder: string; onClose: () => void }) {
  const [scope, setScope] = useState<Scope>("every");
  const everyProject = useInstructions((s) => s.everyProject);
  const here = useApp((s) => (open.conversationId ? (s.threads[open.conversationId]?.instructions ?? "") : readDraft(instructionsKeyOf(open))));
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const hint = SCOPES.find((s) => s.id === scope)!.hint;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Instructions" className="pop-in grid w-full max-w-[640px] gap-3 rounded-2xl border border-border bg-popover p-4 shadow-dialog">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[14px] font-semibold tracking-tight">Instructions</h2>
          <button type="button" aria-label="Close" className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div role="tablist" className="flex rounded-lg border border-border p-0.5">
            {SCOPES.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} className={cn("rounded-md px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground", scope === s.id && "bg-selected text-foreground")} onClick={() => setScope(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="min-w-0 truncate text-[11.5px] text-muted-foreground">{hint}</p>
        </div>
        {scope === "every" ? (
          everyProject === null ? <p className="py-10 text-center text-[12px] text-muted-foreground">Loading…</p> : <Editor key="every" initial={everyProject} save={useInstructions.getState().save} />
        ) : (
          <Editor key={`here:${open.conversationId ?? instructionsKeyOf(open)}`} initial={here} save={saveHere(open)} />
        )}
        <ProjectFiles folder={folder} onOpen={onClose} />
      </div>
    </div>
  );
}

// The header button: brighter when there are instructions this conversation's agents will get.
export function InstructionsButton({ open, folder }: { open: Open; folder: string }) {
  const [shown, setShown] = useState(false);
  const everyProject = useInstructions((s) => Boolean(s.everyProject?.trim()));
  const here = useApp((s) => Boolean(open.conversationId && s.threads[open.conversationId]?.instructions?.trim()));
  useEffect(() => void useInstructions.getState().load(), []);
  return (
    <>
      <button type="button" title="Instructions every agent follows" aria-label="Instructions" className={cn("flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground", (everyProject || here) && "text-foreground")} onClick={() => setShown(true)}>
        <ScrollText className="h-4 w-4" />
      </button>
      {/* On the body: the glass header's backdrop filter would otherwise hold a fixed overlay inside it. */}
      {shown && createPortal(<Dialog open={open} folder={folder} onClose={() => setShown(false)} />, document.body)}
    </>
  );
}
