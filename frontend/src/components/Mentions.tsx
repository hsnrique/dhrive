import { useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { FileText, Folder } from "lucide-react";

import { insertMention, mentionAt, resolvePath, segments, suggest, type FileIndex } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { useFiles } from "@/store/files";
import { usePanel } from "@/store/panel";

// Files and folders mentioned in a conversation: typed after "@" in the composer, and written by a
// model in its replies. Either way they show as a chip that opens the file.

export function FileMention({ folder, path, label }: { folder: string; path: string; label?: string }) {
  return (
    <button
      type="button"
      title={`Open ${path} beside the conversation`}
      className="rounded bg-selected px-1 py-px font-mono text-[0.86em] text-foreground underline-offset-2 transition-colors hover:bg-pressed hover:underline"
      onClick={() => usePanel.getState().open(folder, path)}
    >
      {label ?? path}
    </button>
  );
}

// Code spans in a reply that name a file or folder of the project become chips that open it.
export function useFileSpans(folder: string | undefined): ((text: string) => ReactNode | null) | undefined {
  const index = useFiles((s) => (folder ? s.byFolder[folder] : undefined));
  return useMemo(() => {
    if (!folder || !index) return undefined;
    return (text: string) => {
      const path = resolvePath(text, index);
      return path ? <FileMention folder={folder} path={path} label={text} /> : null;
    };
  }, [folder, index]);
}

// The owner's message, with each @mention of the project picked out.
export function MessageText({ text, folder, index }: { text: string; folder: string | undefined; index: FileIndex | undefined }) {
  if (!folder || !index) return <>{text}</>;
  return (
    <>
      {segments(text, index).map((part, i) => (part.kind === "mention" ? <FileMention key={i} folder={folder} path={part.path} label={part.text} /> : <span key={i}>{part.text}</span>))}
    </>
  );
}

// Suggestions while "@" is being typed. Arrow keys move, Enter or Tab picks, Escape closes; a closed
// list stays closed for that "@" until the text before the caret changes.
export function useMentionPicker(text: string, setText: (text: string) => void, area: RefObject<HTMLTextAreaElement | null>, index: FileIndex | undefined) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const at = index ? mentionAt(text, caret) : null;
  const typed = at ? text.slice(at.start, caret) : null;
  const items = at && index && typed !== dismissed ? suggest(index, at.query) : [];

  const pick = (path: string) => {
    if (!at) return;
    const next = insertMention(text, at.start, caret, path);
    setText(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => area.current?.setSelectionRange(next.caret, next.caret));
  };

  // True when the key was the list's, so the composer doesn't also act on it (Enter sends).
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (items.length === 0) return false;
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) setActive((current) => (current + move + items.length) % items.length);
    else if (e.key === "Enter" || e.key === "Tab") pick(items[Math.min(active, items.length - 1)]);
    else if (e.key === "Escape") setDismissed(typed);
    else return false;
    e.preventDefault();
    return true;
  };

  const track = (el: HTMLTextAreaElement) => {
    if (el.selectionStart !== caret) setActive(0);
    setCaret(el.selectionStart);
  };

  return { items, active: Math.min(active, Math.max(items.length - 1, 0)), pick, onKeyDown, track };
}

export function MentionList({ items, active, onPick }: { items: string[]; active: number; onPick: (path: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div role="listbox" aria-label="Files and folders" className="pop-in absolute bottom-full left-0 right-0 z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-popover p-1">
      {items.map((path, i) => {
        const folder = path.endsWith("/");
        const Icon = folder ? Folder : FileText;
        const name = path.replace(/\/$/, "").split("/").pop();
        return (
          <button
            key={path}
            type="button"
            role="option"
            aria-selected={i === active}
            className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors", i === active ? "bg-selected" : "hover:bg-hover")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(path)}
          >
            <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" />
            <span className="flex-none">{name}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{path}</span>
          </button>
        );
      })}
    </div>
  );
}
