import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, MessageSquare, Search } from "lucide-react";

import type { SearchHit } from "@/lib/api";
import { localResults, marked, withHits, type Result } from "@/lib/search";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useConversations } from "@/store/conversations";
import { useSearch } from "@/store/search";
import { Dialog } from "@/components/ui/layer";
import { EngineMark } from "./EngineMark";

// ⌘K: jump to any conversation, CLI session or project by typing part of its name or of anything said
// in it. Arrows move, Enter opens, Escape closes.

const NO_HITS: SearchHit[] = [];

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {marked(text, query).map((part, i) => (part.match ? <span key={i} className="rounded-sm bg-pressed text-foreground">{part.text}</span> : part.text))}
    </>
  );
}

function open(result: Result) {
  const conversations = useConversations.getState();
  if (result.kind === "conversation") void conversations.show(result.conversation.id);
  if (result.kind === "past") conversations.startNew(result.projectId, result.session);
  if (result.kind === "project") conversations.openLatest(result.project.id);
}

function Row({ result, query, active, onPick, onHover }: { result: Result; query: string; active: boolean; onPick: () => void; onHover: () => void }) {
  const row = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) row.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const title = result.kind === "project" ? result.project.name : result.kind === "past" ? result.session.title : result.conversation.title;
  const where = result.kind === "project" ? result.project.folder : result.project;
  const at = result.kind === "conversation" ? result.conversation.updatedAt : result.kind === "past" ? result.session.updatedAt : null;
  return (
    <button ref={row} type="button" role="option" aria-selected={active} className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left", active && "bg-selected")} onClick={onPick} onMouseMove={onHover}>
      <span className="mt-0.5 flex-none text-muted-foreground">
        {result.kind === "project" ? <Folder className="h-3.5 w-3.5" /> : result.kind === "past" ? <EngineMark engine={result.session.engine} className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px]"><Marked text={title} query={query} /></span>
          <span className="flex-none truncate text-[11px] text-muted-foreground">{where}{at !== null && ` · ${ago(at, Date.now())}`}</span>
        </span>
        {result.kind === "conversation" && result.snippet && (
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground"><Marked text={result.snippet} query={query} /></span>
        )}
      </span>
    </button>
  );
}

function Palette() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const projects = useApp((s) => s.projects);
  const conversations = useConversations((s) => s.conversations);
  const past = useConversations((s) => s.past);
  const hits = useSearch((s) => (s.hitsFor === query ? s.hits : NO_HITS));
  const close = () => useSearch.getState().setOpen(false);
  const results = useMemo(() => withHits(localResults(query, projects, conversations, past), hits, conversations, projects), [query, projects, conversations, past, hits]);

  useEffect(() => {
    setActive(0);
    const timer = setTimeout(() => void useSearch.getState().find(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const pick = (result: Result | undefined) => {
    if (!result) return;
    close();
    open(result);
  };

  return (
    <Dialog label="Search" onClose={close} top className="flex h-fit max-h-[62vh] max-w-[600px] flex-col overflow-hidden">
      <label className="flex items-center gap-2.5 border-b border-border px-4">
        <Search className="h-4 w-4 flex-none text-muted-foreground" />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="search-results"
          aria-label="Search conversations"
          placeholder="Search conversations, sessions and projects"
          spellCheck={false}
          value={query}
          className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") pick(results[active]);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((i) => (results.length ? (i + step + results.length) % results.length : 0));
            }
          }}
        />
      </label>
      <div id="search-results" role="listbox" className="min-h-0 overflow-y-auto p-1.5">
        {!query.trim() && results.length > 0 && <p className="px-3 pb-1 pt-1.5 text-[11px] text-muted-foreground">Recent</p>}
        {results.map((result, i) => (
          <Row key={result.key} result={result} query={query} active={i === active} onPick={() => pick(result)} onHover={() => setActive(i)} />
        ))}
        {results.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">{query.trim() ? "Nothing found." : "No conversations yet."}</p>}
      </div>
    </Dialog>
  );
}

export function SearchPalette() {
  const shown = useSearch((s) => s.open);
  return shown ? createPortal(<Palette />, document.body) : null;
}
