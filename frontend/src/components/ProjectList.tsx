import { useMemo, useState } from "react";
import { Folder, FolderOpen, MessageSquare, Plus, SquareTerminal, Trash2 } from "lucide-react";

import type { Conversation, PastSession, Project } from "@/lib/api";
import { isOpen, sessionSource, sidebarItems, type Item } from "@/lib/conversations";
import { foundedByDhrive } from "@/lib/founding";
import { readSaved, save } from "@/lib/storage";
import { activeRun, awaitingReview, runningId } from "@/lib/thread";
import { ago, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useConversations } from "@/store/conversations";
import { useDay } from "@/store/day";
import { startSession } from "@/store/open-terminals";
import { useTerminals, type TerminalSession } from "@/store/terminals";
import { EngineMark } from "./EngineMark";
import { NameInput } from "./InlineEdit";
import { Confirm, HoverAction, rowClass } from "./SidebarRow";
import { TerminalsRow } from "./TerminalsRow";
import { TypeToConfirm } from "./TypeToConfirm";
import { CompanyRow } from "./company/CompanyRow";

// Each project as a folder with its conversations and its Terminals sessions under it, newest
// first, each marked with what it is. The sessions the owner had with a CLI in that folder sit
// among them, marked with that CLI too; opening one carries it on.

const VISIBLE = 5;
const NO_SESSIONS: PastSession[] = [];

type Row = Item | { kind: "terminals"; session: TerminalSession; at: number };

const chatMark = <MessageSquare className="h-[13px] w-[13px] flex-none opacity-70" strokeWidth={1.75} aria-label="Conversation" />;

function ConversationRow({ conversation, active }: { conversation: Conversation; active: boolean }) {
  const running = useApp((s) => activeRun(s.threads[conversation.id]) !== null);
  const needsYou = useApp((s) => {
    const runId = runningId(s.threads[conversation.id]);
    if (runId !== null && (s.approvals[runId]?.length ?? 0) > 0) return "Needs your OK";
    return awaitingReview(s.threads[conversation.id]) ? "Plan waiting for your OK" : null;
  });
  const { show, remove, rename } = useConversations.getState();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  if (confirming) return <Confirm question="Delete this conversation?" action="Delete" onYes={() => void remove(conversation.id)} onNo={() => setConfirming(false)} />;
  if (editing) return <NameInput value={conversation.title} label="Conversation name" onSave={(title) => rename(conversation.id, title)} onDone={() => setEditing(false)} className="ml-[10px] w-[calc(100%-10px)] text-[12.5px]" />;
  return (
    <div className="group relative">
      <button type="button" title={`${conversation.title}\nDouble-click to rename`} className={cn(rowClass(active), !running && "group-hover:pr-8")} onClick={() => void show(conversation.id)} onDoubleClick={() => setEditing(true)}>
        {chatMark}
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {needsYou ? <span className="h-1.5 w-1.5 flex-none rounded-full bg-attention" title={needsYou} /> : running && <span className="node-live h-1.5 w-1.5 flex-none rounded-full bg-foreground" title="Running" />}
      </button>
      {!running && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          <HoverAction label="Delete this conversation" onClick={() => setConfirming(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </HoverAction>
        </div>
      )}
    </div>
  );
}

// A CLI's session can only leave the list: its record is the CLI's, and stays there.
function PastRow({ projectId, session, active }: { projectId: string; session: PastSession; active: boolean }) {
  const now = useNow(false);
  const { startNew, hidePast } = useConversations.getState();
  const [confirming, setConfirming] = useState(false);
  const source = sessionSource(session);
  if (confirming) return <Confirm question={`Remove it? ${source[0].toUpperCase()}${source.slice(1)} keeps it.`} action="Remove" onYes={() => hidePast(projectId, session.id)} onNo={() => setConfirming(false)} />;
  return (
    <div className="group relative">
      <button
        type="button"
        title={`${session.title}\nFrom ${sessionSource(session)} · ${ago(session.updatedAt, now)} · ${session.messages} messages`}
        className={cn(rowClass(active), "group-hover:pr-8")}
        onClick={() => startNew(projectId, session)}
      >
        {chatMark}
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
        <EngineMark engine={session.engine} className="h-3 w-3 flex-none opacity-60 group-hover:hidden" />
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <HoverAction label="Remove from the list" onClick={() => setConfirming(true)}>
          <Trash2 className="h-3.5 w-3.5" />
        </HoverAction>
      </div>
    </div>
  );
}

function NewRows({ projectId, drafting, empty }: { projectId: string; drafting: boolean; empty: boolean }) {
  const startNew = useConversations((s) => s.startNew);
  return (
    <>
      <button type="button" className={rowClass(drafting)} onClick={() => startNew(projectId)}>
        {chatMark}
        <span className="flex-1 truncate">New conversation</span>
      </button>
      {empty && (
        <button type="button" className={rowClass(false)} onClick={() => startSession(projectId)}>
          <SquareTerminal className="h-[13px] w-[13px] flex-none opacity-70" strokeWidth={1.75} aria-hidden />
          <span className="flex-1 truncate">New terminals</span>
        </button>
      )}
    </>
  );
}

function ProjectGroup({ project, collapsed, onToggle }: { project: Project; collapsed: boolean; onToggle: () => void }) {
  const conversations = useConversations((s) => s.conversations);
  const past = useConversations((s) => s.past[project.id] ?? NO_SESSIONS);
  const open = useConversations((s) => s.open);
  const allTerminals = useTerminals((s) => s.sessions);
  const terminals = useMemo(() => allTerminals.filter((t) => t.projectId === project.id), [allTerminals, project.id]);
  const items = useMemo((): Row[] => [...sidebarItems(project.id, conversations, past), ...terminals.map((session) => ({ kind: "terminals" as const, session, at: session.updatedAt }))].sort((a, b) => b.at - a.at), [project.id, conversations, past, terminals]);
  const opened = (item: Row) => item.kind !== "terminals" && isOpen(item, open);
  const running = useApp((s) => items.some((item) => item.kind === "conversation" && activeRun(s.threads[item.conversation.id]) !== null));
  const working = useDay((s) => Boolean(s.byProject[project.id]?.planRunId) || (s.byProject[project.id]?.tasks.some((t) => t.status === "running") ?? false));
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const founded = foundedByDhrive(project.folder);
  const { startNew, deleteProject } = useConversations.getState();
  const drafting = open?.projectId === project.id && open.conversationId === null && open.from === null;
  const shown = expanded || items.findIndex(opened) >= VISIBLE ? items : items.slice(0, VISIBLE);
  const Icon = collapsed ? Folder : FolderOpen;

  return (
    <section className="flex min-w-0 flex-col gap-px">
      {confirming && (
        <TypeToConfirm
          title={`Delete ${project.name}?`}
          detail={founded ? "Its website goes offline, its dhrive.site address is freed for anyone, and its folder goes to the Trash." : "Its website goes offline and its dhrive.site address is freed for anyone. The folder stays where it is."}
          word={project.name}
          action="Delete"
          doing="Deleting…"
          onConfirm={() => deleteProject(project.id)}
          onClose={() => setConfirming(false)}
        />
      )}
      <div className="group relative">
        <button type="button" aria-expanded={!collapsed} title={project.folder} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-white/[0.04] group-hover:pr-24" onClick={onToggle}>
          <Icon className="h-[15px] w-[15px] flex-none text-muted-foreground" strokeWidth={1.75} />
          <span className="truncate">{project.name}</span>
          {running && collapsed && <span className="node-live h-1.5 w-1.5 flex-none rounded-full bg-foreground" title="Running" />}
        </button>
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          <HoverAction label={`New conversation in ${project.name} (⌘N)`} onClick={() => startNew(project.id)}>
            <Plus className="h-3.5 w-3.5" />
          </HoverAction>
          <HoverAction label={`New terminals in ${project.name}`} onClick={() => startSession(project.id)}>
            <SquareTerminal className="h-3.5 w-3.5" />
          </HoverAction>
          {!running && !working && (
            <HoverAction label={founded ? "Delete this company: its site, its name on dhrive.site, its folder" : "Delete this company and its site (the folder stays)"} onClick={() => setConfirming(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </HoverAction>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="flex min-w-0 flex-col gap-px pb-2">
          <CompanyRow projectId={project.id} />
          {(drafting || items.length === 0) && <NewRows projectId={project.id} drafting={drafting} empty={items.length === 0} />}
          {shown.map((item) =>
            item.kind === "conversation" ? (
              <ConversationRow key={item.conversation.id} conversation={item.conversation} active={opened(item)} />
            ) : item.kind === "terminals" ? (
              <TerminalsRow key={item.session.id} session={item.session} />
            ) : (
              <PastRow key={item.session.id} projectId={project.id} session={item.session} active={opened(item)} />
            ),
          )}
          {items.length > VISIBLE && (
            <button type="button" className="rounded-md py-1 pl-[35px] text-left text-[11.5px] text-muted-foreground/80 transition-colors hover:text-foreground" onClick={() => setExpanded((value) => !value)}>
              {shown.length < items.length ? `Show ${items.length - shown.length} more` : "Show less"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function useCollapsed(): [string[], (id: string) => void] {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    const saved = readSaved("collapsed");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  });
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id];
      save("collapsed", next);
      return next;
    });
  return [collapsed, toggle];
}

export function ProjectList({ projects }: { projects: Project[] }) {
  const [collapsed, toggle] = useCollapsed();
  return (
    <>
      {projects.map((project) => (
        <ProjectGroup key={project.id} project={project} collapsed={collapsed.includes(project.id)} onToggle={() => toggle(project.id)} />
      ))}
    </>
  );
}
