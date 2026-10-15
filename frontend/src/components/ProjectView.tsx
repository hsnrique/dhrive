import { useEffect, useLayoutEffect, useRef } from "react";
import { FolderTree, Globe } from "lucide-react";

import type { Project } from "@/lib/api";
import type { Open } from "@/lib/conversations";
import { shortPath } from "@/lib/names";
import { keepsContext } from "@/lib/thread";
import { useApp } from "@/store/app";
import { useConversations } from "@/store/conversations";
import { useFiles } from "@/store/files";
import { BROWSER, usePanel } from "@/store/panel";
import { setKeepContext } from "@/store/runs";
import { AllowedRules } from "./Approvals";
import { Composer } from "./Composer";
import { ContextMeters } from "./ContextMeter";
import { FilePanel } from "./FilePanel";
import { InlineEdit } from "./InlineEdit";
import { InstructionsButton } from "./Instructions";
import { Thread } from "./Thread";
import { Switch } from "./ui/switch";

function ProjectName({ project }: { project: Project }) {
  const rename = useApp((s) => s.rename);
  return <InlineEdit value={project.name} label="Project name" className="max-w-[40%] flex-none text-[14px] font-semibold tracking-tight" inputClassName="w-56 text-[14px] font-semibold" onSave={(name) => void rename(project.id, name)} />;
}

function ConversationTitle({ open }: { open: Open }) {
  const conversation = useConversations((s) => s.conversations.find((c) => c.id === open.conversationId));
  const rename = useConversations((s) => s.rename);
  if (!conversation) return <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">{open.from?.title ?? "New conversation"}</span>;
  return <InlineEdit value={conversation.title} label="Conversation name" className="min-w-0 flex-1 text-[13px] text-foreground/85" inputClassName="min-w-0 flex-1 text-[13px]" onSave={(title) => rename(conversation.id, title)} />;
}

function KeepContext({ conversationId }: { conversationId: string }) {
  const thread = useApp((s) => s.threads[conversationId]);
  const on = thread ? keepsContext(thread) : true;
  return (
    <Switch
      on={on}
      label="Keep context"
      title={on ? "Each request continues this conversation's CLI sessions" : "Each request starts fresh sessions"}
      onChange={(value) => setKeepContext(conversationId, value)}
    />
  );
}

// One scroll surface: the glass header and composer stay put while the conversation moves under
// them. It follows new output while you're at the bottom and stays put when you scroll up to read.
export function ProjectView({ project, open }: { project: Project; open: Open }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const seen = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const { conversationId } = open;
  // Only how many: what's inside them growing is the size observer's to follow, and re-rendering the
  // composer and the file panel for every stage update would be waste.
  const count = useApp((s) => (conversationId ? s.threads[conversationId]?.messages.length : undefined) ?? 0);
  // With the side panel open the header has less room, so the folder's path gives way first.
  const panelOpen = usePanel((s) => s.tabs.some((t) => t.folder === project.folder));

  // The project's files, for @-mentions and for the paths in replies; read again on every open.
  useEffect(() => void useFiles.getState().load(project.folder), [project.folder]);

  useLayoutEffect(() => {
    const el = scroller.current;
    // A new request always brings the view down to it, even after scrolling up to read.
    if (count > seen.current) pinned.current = true;
    seen.current = count;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  // Following the output by its size, not by watching every run's log: a line streaming in grows the
  // content, and only then does the view move, without the whole conversation re-rendering for it.
  useEffect(() => {
    const el = scroller.current;
    const body = content.current;
    if (!el || !body) return;
    const follow = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    follow.observe(body);
    return () => follow.disconnect();
  }, []);

  return (
    <div className="flex h-full min-w-0">
      <div
        ref={scroller}
        className="project-scroll flex h-full min-w-0 flex-1 flex-col overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
      >
        <header data-tauri-drag-region className="sticky top-0 z-10 flex h-[52px] flex-none items-center gap-3 border-b border-border bg-card px-4">
          <ProjectName project={project} />
          <span className="flex-none text-muted-foreground/60" aria-hidden>/</span>
          <ConversationTitle open={open} />
          {!panelOpen && <span className="hidden min-w-0 flex-none truncate font-mono text-[11px] text-muted-foreground lg:inline" title={project.folder}>{shortPath(project.folder)}</span>}
          <div className="ml-auto flex flex-none items-center gap-2">
            <InstructionsButton open={open} folder={project.folder} />
            <button type="button" title="Browse the project's files beside the conversation" aria-label="Files" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" onClick={() => usePanel.getState().open(project.folder, "")}>
              <FolderTree className="h-4 w-4" />
            </button>
            <button type="button" title="See the project's dev server beside the conversation" aria-label="Browser" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" onClick={() => usePanel.getState().open(project.folder, BROWSER)}>
              <Globe className="h-4 w-4" />
            </button>
            <AllowedRules project={project} />
            {conversationId && <ContextMeters conversationId={conversationId} folder={project.folder} />}
            {conversationId && <KeepContext conversationId={conversationId} />}
          </div>
        </header>
        <div ref={content} className="mx-auto flex w-full max-w-[780px] flex-1 flex-col gap-5 px-6 pt-6">
          <Thread conversationId={conversationId} from={open.from} />
          {/* Only the strip under the composer is painted black; the composer's own glass frosts
              whatever scrolls beneath it. */}
          <div className="sticky bottom-0 z-10 -mx-2 mt-auto bg-[linear-gradient(to_top,#000_20px,transparent_20px)] px-2 pb-5 pt-3">
            <Composer open={open} projectName={project.name} folder={project.folder} />
          </div>
        </div>
      </div>
      <FilePanel folder={project.folder} projectName={project.name} />
    </div>
  );
}
