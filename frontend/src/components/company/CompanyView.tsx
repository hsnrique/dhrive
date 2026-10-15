import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Building2, MessageCircle } from "lucide-react";

import type { Project } from "@/lib/api";
import { isBlank, tagline, type Brief } from "@/lib/company";
import { standing } from "@/lib/day";
import { CHAT_DOCKS_AT, columnCount, columnsFor, useWidth, type SectionId } from "@/lib/deck";
import { cn } from "@/lib/utils";
import { useCompany, useCompanyOf, type Saving } from "@/store/company";
import { useDayOf } from "@/store/day";
import { useDomains } from "@/store/domains";
import { useFavorite } from "@/store/favorite";
import { usePublish, usePublishedOf } from "@/store/publish";
import { useLayer } from "@/components/ui/layer";
import { Army } from "./Army";
import { BriefCard } from "./BriefCard";
import { Documents } from "./Documents";
import { Environment } from "./Environment";
import { ConnectorsButton } from "./Connectors";
import { GitHubButton } from "./GitHubButton";
import { RunControl, SidePane } from "./SitePane";
import { SiteSheet } from "./SitePreview";
import { Tasks } from "./Tasks";
import { Website } from "./Website";

// A project run as a company, all of it on one screen: its sections side by side in as many columns
// as the room holds (lib/deck.ts), and its chat and website docked on the right while there's room
// for two columns beside them; with less, the chat slides over the work from the toolbar.

const SAVING: Record<Saving, string> = { saved: "Saved to COMPANY.md", saving: "Saving…", failed: "Couldn't save COMPANY.md" };

function Overview({ project, brief }: { project: Project; brief: Brief }) {
  const day = useDayOf(project.id);
  const now = standing(day.tasks, day.first);
  const line = tagline(brief);
  const live = usePublishedOf(project.id);
  return (
    <section className="grid gap-3">
      <h1 className="break-words display-title">{project.name}</h1>
      {line ? <p className="text-[14.5px] leading-relaxed text-foreground/80">{line}</p> : <p className="text-[13.5px] text-muted-foreground">An autonomous company. It works from its brief, one task after another.</p>}
      {!isBlank(brief) && (
        <p className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 flex-none rounded-full", now.live ? "node-live bg-foreground" : "bg-white/30")} />
          <span className="min-w-0 truncate">
            {live.busy ? "Publishing its website…" : now.text}
            {live.url && !live.busy && <span className="text-muted-foreground/70"> · live at {live.url.replace(/^https:\/\//, "")}</span>}
          </span>
        </p>
      )}
    </section>
  );
}

function Sections({ project, brief }: { project: Project; brief: Brief }) {
  const scroller = useRef<HTMLDivElement>(null);
  const count = columnCount(useWidth(scroller));
  const section: Record<SectionId, ReactNode> = {
    overview: <Overview project={project} brief={brief} />,
    tasks: <Tasks project={project} brief={brief} />,
    army: <Army project={project} />,
    website: <Website project={project} />,
    environment: <Environment project={project} />,
    documents: <Documents project={project} />,
    brief: <BriefCard project={project} brief={brief} />,
  };
  return (
    <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
      <div className="deck mx-auto grid max-w-[1440px] items-start gap-6 px-6 pb-24 pt-8" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {columnsFor(count).map((column) => (
          <div key={column.join()} className="grid min-w-0 content-start gap-12">
            {column.map((id) => <Fragment key={id}>{section[id]}</Fragment>)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Labels give way to their icons as the toolbar narrows (SiteActions, the tools, GitHubButton and
// RunControl read the same container), so nothing in it ever wraps or spills. A size container is
// its own stacking context: z-20 keeps its menus above the sections below.
function Toolbar({ project, brief, saving, chat }: { project: Project; brief: Brief | null; saving: Saving; chat: ReactNode }) {
  return (
    <header data-tauri-drag-region className="@container relative z-20 flex h-[52px] flex-none items-center gap-2.5 border-b border-border bg-card px-4">
      <Building2 className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.75} />
      <span className="min-w-0 truncate text-[14px] font-semibold tracking-tight">{project.name}</span>
      <span className="hidden flex-none text-[13px] text-muted-foreground @[46rem]:inline">Company</span>
      <span className="ml-auto" />
      {brief && (saving !== "saved" || !isBlank(brief)) && <span className={cn("hidden flex-none text-[11.5px] text-muted-foreground @[64rem]:inline", saving === "failed" && "inline text-failure")}>{SAVING[saving]}</span>}
      <ConnectorsButton project={project} />
      <GitHubButton projectId={project.id} />
      <RunControl project={project} />
      {chat}
    </header>
  );
}

export function CompanyView({ project }: { project: Project }) {
  const { brief, saving, unreadable } = useCompanyOf(project.id);
  const root = useRef<HTMLDivElement>(null);
  const docked = useWidth(root) >= CHAT_DOCKS_AT;
  const [sliding, setSliding] = useState(false);
  useEffect(() => void useCompany.getState().load(project.id), [project.id]);
  // Where its website lives, its own domains and which address is starred come from the site host
  // and the folder, never only from this webview's memory. The toolbar's address needs the domains
  // before the Domains section is ever opened.
  useEffect(() => {
    void useFavorite.getState().load(project.id);
    void usePublish.getState().sync(project.id).then(() => {
      if (usePublish.getState().byProject[project.id]?.url) void useDomains.getState().load(project.id);
    });
  }, [project.id]);
  useEffect(() => {
    if (docked) setSliding(false);
  }, [docked]);
  const slid = useRef<HTMLDivElement>(null);
  useLayer(slid, () => setSliding(false), { active: sliding });
  const chat = !docked && (
    <button type="button" aria-label="Chat" aria-expanded={sliding} title="Chat" className={cn("flex h-7 flex-none items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] transition-colors hover:bg-hover", sliding && "bg-selected")} onClick={() => setSliding((v) => !v)}>
      <MessageCircle className="h-3.5 w-3.5" />
      <span className="hidden @[40rem]:inline">Chat</span>
    </button>
  );
  return (
    <div ref={root} className="relative flex h-full flex-col">
      <Toolbar project={project} brief={brief} saving={saving} chat={chat} />
      <div className="flex min-h-0 flex-1">
        {unreadable && (
          <div role="alert" className="mx-6 mt-6 flex items-start gap-3 rounded-md border border-failure/40 px-3 py-2.5">
            <p className="min-w-0 flex-1 text-[12.5px] text-failure">{unreadable}</p>
            <button type="button" className="h-7 flex-none rounded-md bg-selected px-3 text-[12px] font-medium transition-colors hover:bg-pressed" onClick={() => void useCompany.getState().load(project.id)}>Try again</button>
          </div>
        )}
        {brief === null ? !unreadable && <p className="flex-1 px-6 pt-8 text-[12.5px] text-muted-foreground">Reading COMPANY.md…</p> : <Sections project={project} brief={brief} />}
        {docked && <SidePane project={project} className="flex w-[clamp(340px,28%,440px)] flex-none" />}
      </div>
      {sliding && (
        <>
          <div aria-hidden className="fade-in absolute inset-x-0 bottom-0 top-[52px] z-30 bg-black/50" onClick={() => setSliding(false)} />
          <div ref={slid} className="slide-in-right absolute bottom-0 right-0 top-[52px] z-40 flex w-[min(420px,100%)] shadow-dialog">
            <SidePane project={project} className="flex w-full" />
          </div>
        </>
      )}
      <SiteSheet project={project} />
    </div>
  );
}
